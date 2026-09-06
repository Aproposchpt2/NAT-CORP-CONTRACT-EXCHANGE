// Stage 2 (Contract Extraction): enriches an already-acquired
// state_contract_opportunities row in place with the five-field
// plain-language explainer (required_licenses, required_certifications,
// bonding_requirements, key_dates, scope_summary).
//
// REVISED 2026-09-06 per Jeff: no more state_raw_records/state_normalized_records
// staging and no more apie_contract_plain_language_explainer side table.
// Acquisition (command-center-acquisition.mjs) already writes the canonical
// row; this stage only UPDATEs it -- the same single-table, progressively-
// enriched-by-stage pattern cbrief_contract_opportunities uses (extraction
// writes into that row's own requirements/description columns, not a
// separate staging table). Idempotency is tracked with the real
// requirements_extraction_status enum already on the table
// (NOT_STARTED / PARTIAL / COMPLETE / REVIEW_REQUIRED / FAILED) instead of a
// content-hash cache row -- a record is only re-explained on repeat when the
// caller explicitly passes force:true (Reprocess mode).
import { env, db, dbCount } from './natcorp-db.mjs';
import { requestStructuredJson } from './openai-structured-json.mjs';
import { ACQUISITION_METHOD } from './command-center-acquisition.mjs';

export const EXPLAINER_MODEL = 'gpt-5-mini';

function clean(value, max = 2000) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, max) : null;
}

const EXPLAINER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['required_licenses', 'required_certifications', 'bonding_requirements', 'key_dates', 'scope_summary', 'inferred_response_deadline'],
  properties: {
    required_licenses: { type: 'array', items: { type: 'string' }, description: 'Licenses stated or clearly indicated as required. Empty array if none stated.' },
    required_certifications: { type: 'array', items: { type: 'string' }, description: 'Certifications / socio-economic set-asides stated or clearly indicated. Empty array if none stated.' },
    bonding_requirements: { type: 'string', description: 'Plain-English bonding/insurance requirement as stated, or "Not specified in the listing." if not stated -- never invent a dollar amount or percentage that was not given.' },
    key_dates: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: { label: { type: 'string' }, value: { type: 'string' } },
        required: ['label', 'value'],
      },
    },
    scope_summary: { type: 'string', description: 'Two to four plain-English sentences: what the winning bidder would actually have to deliver.' },
    inferred_response_deadline: { type: ['string', 'null'], description: 'ISO 8601 date/time if a response/bid due date is explicitly stated in the text, else null. Never guess.' },
  },
};

function explainerPrompt(opportunity) {
  return `You explain a government contract solicitation in plain English for a small business owner deciding whether to bid. Follow the Plain Writing Act standard: short sentences, active voice, define jargon on first use.

Hard rule: base every statement strictly on the text given below. Never infer or add outside knowledge. If a required field cannot be determined from the text, return an empty array/string or null as specified -- never invent a specific license type, certification, dollar amount, or date not actually stated.

Title: ${clean(opportunity.title, 600) || 'Untitled'}
Issuing agency: ${clean(opportunity.issuing_organization, 300) || 'Not provided'}
Procurement type: ${clean(opportunity.procurement_type, 200) || 'Not provided'}
Currently recorded response deadline: ${opportunity.response_deadline || 'None recorded'}
Description:
${clean(opportunity.description, 6000) || '(none captured)'}`;
}

export async function generateExplainer(opportunity, { apiKey, model = EXPLAINER_MODEL } = {}) {
  const key = apiKey || env('OPENAI_API_KEY');
  if (!key) throw new Error('OPENAI_API_KEY_REQUIRED');
  return requestStructuredJson({
    apiKey: key,
    model,
    system: 'You are a meticulous, literal government-procurement plain-language explainer. Never invent contract content that was not provided.',
    prompt: explainerPrompt(opportunity),
    schemaName: 'natcorp_plain_language_explainer_v2',
    schema: EXPLAINER_SCHEMA,
    errorPrefix: 'NATCORP_EXPLAINER',
    maxOutputTokens: 2200,
    retries: 1,
  });
}

// Explainer generation + optional response_deadline backfill for one
// already-canonical opportunity, writing directly onto its
// state_contract_opportunities row. Shared by the regular Stage 2 flow and
// Reprocess mode (force:true, direct against existing canonical rows
// regardless of current requirements_extraction_status).
export async function explainOpportunity(opportunity, { apiKey, model = EXPLAINER_MODEL, backfillDeadline = false, force = false } = {}) {
  if (!force && opportunity.requirements_extraction_status === 'COMPLETE') {
    return { skipped: true, reason: 'ALREADY_COMPLETE' };
  }
  if (!opportunity.description || !String(opportunity.description).trim()) {
    await db('state_contract_opportunities', 'PATCH', `?id=eq.${opportunity.id}`, {
      requirements_extraction_status: 'REVIEW_REQUIRED',
      updated_at: new Date().toISOString(),
    }, 'return=minimal');
    return { skipped: true, reason: 'NO_DESCRIPTION' };
  }

  const summary = await generateExplainer(opportunity, { apiKey, model });
  const timestamp = new Date().toISOString();
  const existingRequirements = opportunity.requirements && typeof opportunity.requirements === 'object' && !Array.isArray(opportunity.requirements) ? opportunity.requirements : {};

  let deadlineBackfilled = false;
  let responseDeadline;
  if (backfillDeadline && !opportunity.response_deadline && summary.inferred_response_deadline) {
    const parsed = new Date(summary.inferred_response_deadline);
    if (Number.isFinite(parsed.getTime())) {
      responseDeadline = parsed.toISOString();
      deadlineBackfilled = true;
    }
  }

  await db('state_contract_opportunities', 'PATCH', `?id=eq.${opportunity.id}`, {
    ...(responseDeadline ? { response_deadline: responseDeadline } : {}),
    requirements: {
      ...existingRequirements,
      scope_summary: summary.scope_summary || '',
      required_licenses: summary.required_licenses || [],
      required_certifications: summary.required_certifications || [],
      bonding_requirements: summary.bonding_requirements || 'Not specified in the listing.',
      key_dates: summary.key_dates || [],
    },
    certifications_required: summary.required_certifications || [],
    extraction_confidence: 1,
    qa_status: 'auto_ingested',
    requirements_extraction_status: 'COMPLETE',
    updated_at: timestamp,
  }, 'return=minimal');

  return { skipped: false, deadline_backfilled: deadlineBackfilled };
}

// ---------- Regular Stage 2 batch: explain newly-acquired opportunities ----------

export async function runExtractionBatch({ apiKey, limit = 25, onProgress = async () => {} } = {}) {
  const safeLimit = Math.max(1, Math.min(50, Number(limit) || 25));
  const rows = (await db(
    'state_contract_opportunities', 'GET',
    `?acquisition_method=eq.${ACQUISITION_METHOD}&requirements_extraction_status=eq.NOT_STARTED&select=*&order=first_seen_at.asc&limit=${safeLimit}`,
  )) || [];

  let succeeded = 0, failed = 0;
  const results = [];
  await onProgress({ totalEligible: rows.length, processed: 0, succeeded, failed });

  for (const opportunity of rows) {
    try {
      const result = await explainOpportunity(opportunity, { apiKey, backfillDeadline: true });
      succeeded += 1;
      results.push({ opportunity_id: opportunity.id, ...result });
    } catch (error) {
      failed += 1;
      await db('state_contract_opportunities', 'PATCH', `?id=eq.${opportunity.id}`, {
        requirements_extraction_status: 'FAILED',
        updated_at: new Date().toISOString(),
      }, 'return=minimal').catch(() => {});
      results.push({ opportunity_id: opportunity.id, error: error instanceof Error ? error.message : String(error) });
    }
    await onProgress({ totalEligible: rows.length, processed: succeeded + failed, succeeded, failed });
  }

  return { totalEligible: rows.length, processed: rows.length, succeeded, failed, results };
}

export async function extractionCoverage() {
  const scope = `acquisition_method=eq.${ACQUISITION_METHOD}`;
  const [pending, extracted, total] = await Promise.all([
    dbCount('state_contract_opportunities', `?${scope}&requirements_extraction_status=eq.NOT_STARTED`),
    dbCount('state_contract_opportunities', `?${scope}&requirements_extraction_status=eq.COMPLETE`),
    dbCount('state_contract_opportunities', `?${scope}`),
  ]);
  return { pending, extracted, total };
}
