// Stage 3 (Taxonomy Classification): matches a contract to
// aoie_taxonomy_capabilities and writes aoie_opportunity_service_mappings -- an
// industry classification + confidence, not a contractor eligibility/capability
// match. Ported from APROPOS-CONTRACT-BRIEF's natcorp-pipeline-taxonomy.mjs,
// adapted to call db()/dbCount() directly from natcorp-db.mjs.
//
// KNOWN BLOCKER (inherited from the source repo, unresolved as of the port): every
// aoie_taxonomy_* table is empty in the natcorp Supabase project. This code is
// correct and will classify real records against real capabilities once that
// taxonomy is seeded; until then every classification records
// NO_TAXONOMY_AVAILABLE (an industry_label is still produced and shown).
import { env, db, dbCount } from './natcorp-db.mjs';
import { requestStructuredJson } from './openai-structured-json.mjs';

export const TAXONOMY_CLASSIFICATION_VERSION = 'natcorp_site_taxonomy_classification_v1';
const DEFAULT_MODEL = 'gpt-5-mini';

function clean(value, max = 500) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, max) : '';
}

async function loadActiveCapabilities(limit = 300) {
  return (await db(
    'aoie_taxonomy_capabilities', 'GET',
    `?active_status=eq.true&select=id,capability_code,display_name,description&order=display_order.asc&limit=${limit}`,
  )) || [];
}

function schemaFor(capabilities) {
  const codes = capabilities.map((c) => c.capability_code);
  return {
    type: 'object',
    additionalProperties: false,
    required: ['industry_label', 'matched_capability_code', 'confidence', 'reasoning'],
    properties: {
      industry_label: { type: 'string', description: 'Short (2-6 word) plain-English industry/trade label for the principal work in this contract, e.g. "Commercial Roofing", "IT Network Services", "Landscaping & Grounds Maintenance".' },
      matched_capability_code: codes.length
        ? { type: ['string', 'null'], enum: [...codes, null], description: 'The single best-matching capability_code from the provided list, or null if none of the provided capabilities genuinely fit.' }
        : { type: 'null', description: 'No taxonomy capabilities are currently available to match against -- always null.' },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
      reasoning: { type: 'string' },
    },
  };
}

function prompt(opportunity, capabilities) {
  const list = capabilities.length
    ? capabilities.map((c) => `- ${c.capability_code}: ${c.display_name}${c.description ? ` -- ${c.description}` : ''}`).join('\n')
    : '(no taxonomy capabilities are currently loaded -- classify the industry_label only and leave matched_capability_code null)';
  return `Classify the principal industry/trade of this government contract.

CONTRACT
Title: ${clean(opportunity.title, 600) || 'Untitled'}
Issuing agency: ${clean(opportunity.issuing_organization, 300) || 'Not provided'}
Procurement type: ${clean(opportunity.procurement_type, 200) || 'Not provided'}
Description: ${clean(opportunity.description, 6000) || '(none captured)'}

AVAILABLE TAXONOMY CAPABILITIES
${list}

Return the best-fitting industry_label always. Only set matched_capability_code to a value from the list above if it genuinely represents the same work -- otherwise return null. Do not invent a capability_code that is not in the list.`;
}

export async function classifyOpportunity(opportunity, { apiKey, model = DEFAULT_MODEL, capabilities } = {}) {
  const key = apiKey || env('OPENAI_API_KEY');
  if (!key) throw new Error('OPENAI_API_KEY_REQUIRED');
  const caps = capabilities || (await loadActiveCapabilities());
  const parsed = await requestStructuredJson({
    apiKey: key,
    model,
    system: 'You are a precise government-contract industry classifier. Only select a taxonomy capability that genuinely matches; otherwise return null and explain in reasoning.',
    prompt: prompt(opportunity, caps),
    schemaName: 'natcorp_taxonomy_classification_v1',
    schema: schemaFor(caps),
    errorPrefix: 'NATCORP_TAXONOMY',
    maxOutputTokens: 1200,
    retries: 1,
  });
  const matched = caps.find((c) => c.capability_code === parsed.matched_capability_code) || null;
  return {
    industry_label: clean(parsed.industry_label, 200) || 'Unclassified',
    confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
    reasoning: clean(parsed.reasoning, 900),
    matched_capability: matched,
    version: TAXONOMY_CLASSIFICATION_VERSION,
    model,
    classified_at: new Date().toISOString(),
    taxonomy_available: caps.length > 0,
  };
}

export async function persistClassification(opportunity, classification) {
  const timestamp = new Date().toISOString();
  const raw = opportunity.raw_source_payload && typeof opportunity.raw_source_payload === 'object' ? opportunity.raw_source_payload : {};
  await db('state_contract_opportunities', 'PATCH', `?id=eq.${opportunity.id}`, {
    raw_source_payload: {
      ...raw,
      taxonomy_classification: {
        industry_label: classification.industry_label,
        confidence: classification.confidence,
        reasoning: classification.reasoning,
        matched_capability_id: classification.matched_capability?.id || null,
        matched_capability_code: classification.matched_capability?.capability_code || null,
        status: classification.matched_capability ? 'MATCHED' : (classification.taxonomy_available ? 'NO_MATCH' : 'NO_TAXONOMY_AVAILABLE'),
        version: classification.version,
        model: classification.model,
        classified_at: classification.classified_at,
      },
    },
    updated_at: timestamp,
  }, 'return=minimal');

  if (classification.matched_capability?.id) {
    await db('aoie_opportunity_service_mappings', 'POST', '', [{
      opportunity_id: opportunity.id,
      capability_id: classification.matched_capability.id,
      confidence: classification.confidence,
      classification_method: classification.version,
      evidence: { industry_label: classification.industry_label, reasoning: classification.reasoning, model: classification.model },
      primary_category: true,
      created_at: timestamp,
    }], 'return=minimal,resolution=merge-duplicates');
  }
}

function hasCurrentClassification(opportunity) {
  return opportunity?.raw_source_payload?.taxonomy_classification?.version === TAXONOMY_CLASSIFICATION_VERSION;
}

export async function runTaxonomyBatch({ apiKey, limit = 25, force = false, onProgress = async () => {} } = {}) {
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 25));
  const capabilities = await loadActiveCapabilities();
  const pageSize = 200;
  const targets = [];
  for (let offset = 0; offset < 5000 && targets.length < safeLimit; offset += pageSize) {
    const page = (await db(
      'state_contract_opportunities', 'GET',
      `?status=eq.OPEN&select=id,title,description,issuing_organization,procurement_type,raw_source_payload&order=created_at.asc&limit=${pageSize}&offset=${offset}`,
    )) || [];
    for (const row of page) {
      if (force || !hasCurrentClassification(row)) targets.push(row);
      if (targets.length >= safeLimit) break;
    }
    if (page.length < pageSize) break;
  }

  let succeeded = 0, failed = 0;
  const results = [];
  await onProgress({ totalEligible: targets.length, processed: 0, succeeded, failed });

  for (const opportunity of targets) {
    try {
      const classification = await classifyOpportunity(opportunity, { apiKey, capabilities });
      await persistClassification(opportunity, classification);
      succeeded += 1;
      results.push({ opportunity_id: opportunity.id, industry_label: classification.industry_label, confidence: classification.confidence, matched: Boolean(classification.matched_capability) });
    } catch (error) {
      failed += 1;
      results.push({ opportunity_id: opportunity.id, error: error instanceof Error ? error.message : String(error) });
    }
    await onProgress({ totalEligible: targets.length, processed: succeeded + failed, succeeded, failed });
  }

  return { totalEligible: targets.length, processed: targets.length, succeeded, failed, results, taxonomy_capability_count: capabilities.length };
}

export async function taxonomyStatus() {
  const total = await dbCount('state_contract_opportunities', '?status=eq.OPEN');
  const rows = [];
  const pageSize = 500;
  for (let offset = 0; offset < 5000; offset += pageSize) {
    const page = (await db(
      'state_contract_opportunities', 'GET',
      `?status=eq.OPEN&select=id,title,issuing_organization,response_deadline,raw_source_payload,updated_at&order=updated_at.desc&limit=${pageSize}&offset=${offset}`,
    )) || [];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  const classified = rows.filter((r) => hasCurrentClassification(r));
  const capabilityCount = await dbCount('aoie_taxonomy_capabilities', '?active_status=eq.true');
  return {
    total,
    ready: classified.length,
    pending: Math.max(0, rows.length - classified.length),
    taxonomy_capability_count: capabilityCount,
    recent: classified.slice(0, 12).map((r) => ({
      id: r.id,
      title: r.title,
      agency_name: r.issuing_organization,
      industry_label: r.raw_source_payload.taxonomy_classification.industry_label,
      confidence: r.raw_source_payload.taxonomy_classification.confidence,
      status: r.raw_source_payload.taxonomy_classification.status,
      processed_at: r.raw_source_payload.taxonomy_classification.classified_at,
    })),
  };
}
