// Stage 2 (Contract Extraction):
//   state_raw_records -> normalize -> state_normalized_records
//                      -> promote   -> state_contract_opportunities
//                      -> five-field plain-language explainer
//                         (apie_contract_plain_language_explainer)
//
// Ported from APROPOS-CONTRACT-BRIEF's natcorp-pipeline-extraction.mjs, adapted
// to call db()/dbCount() directly from natcorp-db.mjs instead of a cross-project
// client -- this site's own SUPABASE_URL already IS the natcorp project.
//
// The five-field explainer (required_licenses, required_certifications,
// bonding_requirements, key_dates, scope_summary) targets the five typed columns
// on apie_contract_plain_language_explainer.
import { env, sha256, db, dbCount } from './natcorp-db.mjs';
import { requestStructuredJson } from './openai-structured-json.mjs';

export const EXPLAINER_MODEL = 'gpt-5-mini';
const EXPLAINER_VERSION = 2;

function clean(value, max = 2000) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, max) : null;
}

// ---------- Normalization (state_raw_records -> state_normalized_records) ----------

function normalizeOne(raw) {
  return {
    raw_record_id: raw.id,
    state_code: raw.state_code,
    solicitation_number: raw.source_solicitation_number || null,
    title: clean(raw.raw_title, 500),
    agency: clean(raw.raw_agency, 300),
    department: null,
    description: clean(raw.raw_description, 8000),
    procurement_type: clean(raw.raw_payload?.opportunity_type, 100),
    status: 'open',
    posted_at: raw.raw_posted_date ? safeDate(raw.raw_posted_date) : null,
    response_deadline: raw.raw_response_deadline ? safeDate(raw.raw_response_deadline) : null,
    timezone: clean(raw.raw_payload?.closing_timezone, 100),
    contact_name: null,
    contact_email: null,
    contact_phone: null,
    requirements: raw.raw_requirements || {},
    document_manifest: raw.raw_document_manifest || {},
    source_fingerprint: raw.source_fingerprint,
    content_fingerprint: raw.content_fingerprint,
    publication_status: 'NORMALIZED',
    normalized_at: new Date().toISOString(),
  };
}

function safeDate(value) {
  const date = new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

async function promoteToCanonical(normalized, raw) {
  const existing = await db(
    'state_contract_opportunities', 'GET',
    `?state_code=eq.${normalized.state_code}&source_fingerprint=eq.${normalized.source_fingerprint}&select=id&limit=1`,
  );
  const timestamp = new Date().toISOString();
  const row = {
    state_code: normalized.state_code,
    jurisdiction_type: null,
    jurisdiction_name: normalized.agency,
    issuing_organization: normalized.agency,
    issuing_department: normalized.department,
    source_platform: raw.publisher_platform || raw.raw_payload?.publisher_name || null,
    source_record_id: raw.source_record_id,
    source_url: raw.source_url,
    official_source_url: raw.source_detail_url || raw.source_url,
    solicitation_number: normalized.solicitation_number,
    title: normalized.title,
    description: normalized.description,
    procurement_type: normalized.procurement_type,
    notice_type: null,
    status: 'OPEN',
    posted_at: normalized.posted_at,
    response_deadline: normalized.response_deadline,
    requirements: normalized.requirements,
    document_urls: normalized.document_manifest,
    raw_source_payload: raw.raw_payload || {},
    source_fingerprint: normalized.source_fingerprint,
    content_fingerprint: normalized.content_fingerprint,
    is_latest_version: true,
    first_seen_at: timestamp,
    last_seen_at: timestamp,
    acquisition_method: 'PUBLISHER_DIRECTED_OPENAI_WEB_SEARCH',
    requirements_extraction_status: 'PENDING',
    lifecycle_status: 'ACTIVE',
    updated_at: timestamp,
  };
  if (existing?.[0]?.id) {
    await db('state_contract_opportunities', 'PATCH', `?id=eq.${existing[0].id}`, { ...row, last_seen_at: timestamp }, 'return=minimal');
    return existing[0].id;
  }
  const created = await db('state_contract_opportunities', 'POST', '', [{ ...row, created_at: timestamp }], 'return=representation');
  return created?.[0]?.id || null;
}

// ---------- Five-field explainer ----------

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
  const parsed = await requestStructuredJson({
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
  return parsed;
}

async function sourceHashFor(opportunity) {
  return sha256(`${opportunity.title || ''} ${opportunity.description || ''} ${opportunity.response_deadline || ''}`);
}

async function persistExplainer(opportunityId, hash, summary, model) {
  await db('apie_contract_plain_language_explainer', 'POST', '', [{
    opportunity_id: opportunityId,
    source_hash: hash,
    explainer_version: EXPLAINER_VERSION,
    required_licenses: summary.required_licenses || [],
    required_certifications: summary.required_certifications || [],
    bonding_requirements: summary.bonding_requirements || 'Not specified in the listing.',
    key_dates: summary.key_dates || [],
    scope_summary: summary.scope_summary || '',
    model_used: model,
    generated_at: new Date().toISOString(),
  }], 'return=minimal,resolution=merge-duplicates');
}

// Explainer generation + optional response_deadline backfill for one
// already-canonical opportunity. Shared by the regular Stage 2 flow (after
// promotion) and Reprocess mode (direct against existing canonical rows).
export async function explainOpportunity(opportunity, { apiKey, model = EXPLAINER_MODEL, backfillDeadline = false } = {}) {
  const hash = await sourceHashFor(opportunity);
  const cached = (await db('apie_contract_plain_language_explainer', 'GET', `?opportunity_id=eq.${opportunity.id}&select=source_hash,explainer_version&limit=1`))?.[0];
  if (cached?.source_hash === hash && cached?.explainer_version === EXPLAINER_VERSION) {
    return { skipped: true, reason: 'CACHED' };
  }
  if (!opportunity.description || !String(opportunity.description).trim()) {
    return { skipped: true, reason: 'NO_DESCRIPTION' };
  }
  const summary = await generateExplainer(opportunity, { apiKey, model });
  await persistExplainer(opportunity.id, hash, summary, model);

  let deadlineBackfilled = false;
  if (backfillDeadline && !opportunity.response_deadline && summary.inferred_response_deadline) {
    const parsed = new Date(summary.inferred_response_deadline);
    if (Number.isFinite(parsed.getTime())) {
      await db('state_contract_opportunities', 'PATCH', `?id=eq.${opportunity.id}`, {
        response_deadline: parsed.toISOString(),
        updated_at: new Date().toISOString(),
      }, 'return=minimal');
      deadlineBackfilled = true;
    }
  }

  await db('state_contract_opportunities', 'PATCH', `?id=eq.${opportunity.id}`, {
    requirements_extraction_status: 'EXTRACTED',
    updated_at: new Date().toISOString(),
  }, 'return=minimal');

  return { skipped: false, deadline_backfilled: deadlineBackfilled };
}

// ---------- Regular Stage 2 batch: normalize + promote + explain new raw records ----------

export async function runExtractionBatch({ apiKey, limit = 25, onProgress = async () => {} } = {}) {
  const safeLimit = Math.max(1, Math.min(50, Number(limit) || 25));
  const rawRows = (await db(
    'state_raw_records', 'GET',
    `?normalization_status=eq.PENDING&select=*&order=acquired_at.asc&limit=${safeLimit}`,
  )) || [];

  let succeeded = 0, failed = 0;
  const results = [];
  await onProgress({ totalEligible: rawRows.length, processed: 0, succeeded, failed });

  for (const raw of rawRows) {
    try {
      const normalized = normalizeOne(raw);
      await db('state_normalized_records', 'POST', '', [normalized], 'return=minimal');
      const canonicalId = await promoteToCanonical(normalized, raw);
      if (!canonicalId) throw new Error('PROMOTION_DID_NOT_RETURN_AN_ID');
      await db('state_raw_records', 'PATCH', `?id=eq.${raw.id}`, {
        normalization_status: 'NORMALIZED',
        updated_at: new Date().toISOString(),
      }, 'return=minimal');

      let explainerResult = { skipped: true, reason: 'CANONICAL_ID_MISSING' };
      try {
        const canonical = (await db('state_contract_opportunities', 'GET', `?id=eq.${canonicalId}&select=id,title,description,issuing_organization,procurement_type,response_deadline&limit=1`))?.[0];
        if (canonical) explainerResult = await explainOpportunity(canonical, { apiKey, backfillDeadline: true });
      } catch (explainerError) {
        explainerResult = { skipped: true, reason: explainerError instanceof Error ? explainerError.message : String(explainerError) };
      }

      succeeded += 1;
      results.push({ raw_record_id: raw.id, canonical_opportunity_id: canonicalId, explainer: explainerResult });
    } catch (error) {
      failed += 1;
      await db('state_raw_records', 'PATCH', `?id=eq.${raw.id}`, {
        normalization_status: 'FAILED',
        updated_at: new Date().toISOString(),
      }, 'return=minimal').catch(() => {});
      results.push({ raw_record_id: raw.id, error: error instanceof Error ? error.message : String(error) });
    }
    await onProgress({ totalEligible: rawRows.length, processed: succeeded + failed, succeeded, failed });
  }

  return { totalEligible: rawRows.length, processed: rawRows.length, succeeded, failed, results };
}

export async function extractionCoverage() {
  const [pendingRaw, totalRaw, explained, totalCanonical] = await Promise.all([
    dbCount('state_raw_records', '?normalization_status=eq.PENDING'),
    dbCount('state_raw_records', ''),
    dbCount('state_contract_opportunities', '?requirements_extraction_status=eq.EXTRACTED'),
    dbCount('state_contract_opportunities', ''),
  ]);
  return { pending_raw: pendingRaw, total_raw: totalRaw, extracted: explained, total: totalCanonical };
}
