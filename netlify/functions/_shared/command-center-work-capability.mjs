// Stage 3: Work Capability V2 — owner-triggered answer to "Who can perform this work?"
//
// This is contract-side preparation only. It converts extracted contract evidence into
// a precise work-subject/provider-domain profile for later capability comparison.
// It deliberately does NOT evaluate contractor eligibility, readiness, qualification,
// licensing, bonding, size, geography, registration, financial capacity, or profile fit.
import { env, db, dbCount, nowIso } from './natcorp-db.mjs';
import { requestStructuredJson } from './openai-structured-json.mjs';
import { ACQUISITION_METHOD } from './command-center-acquisition.mjs';

export const WORK_CAPABILITY_VERSION = 'natcorp_work_capability_v2';
export const DEFAULT_WORK_CAPABILITY_MODEL = 'gpt-5-mini';

const PROFILE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'requested_work', 'work_subjects', 'primary_work_actions', 'provider_domain',
    'matching_anchors', 'who_can_perform_work', 'provider_path',
    'required_service_capabilities', 'equivalent_service_language',
    'related_provider_types', 'excluded_neighbor_types', 'confidence', 'reasoning',
  ],
  properties: {
    requested_work: { type: 'string' },
    work_subjects: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 8 },
    primary_work_actions: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 8 },
    provider_domain: { type: 'string' },
    matching_anchors: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 16 },
    who_can_perform_work: { type: 'string' },
    provider_path: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 6 },
    required_service_capabilities: { type: 'array', items: { type: 'string' }, maxItems: 12 },
    equivalent_service_language: { type: 'array', items: { type: 'string' }, maxItems: 16 },
    related_provider_types: { type: 'array', items: { type: 'string' }, maxItems: 8 },
    excluded_neighbor_types: { type: 'array', items: { type: 'string' }, maxItems: 12 },
    confidence: { type: 'string', enum: ['HIGH', 'MODERATE', 'LIMITED'] },
    reasoning: { type: 'string' },
  },
};

function clean(value, max = 500) {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  return normalized ? normalized.slice(0, max) : '';
}

function cleanList(value, maxItems, maxLength = 180) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const output = [];
  for (const item of value) {
    const normalized = clean(item, maxLength);
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    output.push(normalized);
    if (output.length >= maxItems) break;
  }
  return output;
}

export function normalizeWorkCapabilityProfile(value = {}) {
  const providerPath = cleanList(value.provider_path, 6);
  const who = clean(value.who_can_perform_work, 500);
  const providerDomain = clean(value.provider_domain, 300);
  const workSubjects = cleanList(value.work_subjects, 8);
  const primaryActions = cleanList(value.primary_work_actions, 8);
  const anchors = cleanList(value.matching_anchors, 16, 220);
  if (!who) throw new Error('WORK_CAPABILITY_PROVIDER_REQUIRED');
  if (!providerDomain) throw new Error('WORK_CAPABILITY_DOMAIN_REQUIRED');
  if (!workSubjects.length) throw new Error('WORK_CAPABILITY_SUBJECT_REQUIRED');
  if (!primaryActions.length) throw new Error('WORK_CAPABILITY_ACTION_REQUIRED');
  if (!anchors.length) throw new Error('WORK_CAPABILITY_ANCHOR_REQUIRED');
  return {
    requested_work: clean(value.requested_work, 900),
    work_subjects: workSubjects,
    primary_work_actions: primaryActions,
    provider_domain: providerDomain,
    matching_anchors: anchors,
    who_can_perform_work: who,
    provider_path: providerPath.length ? providerPath : [providerDomain, who],
    required_service_capabilities: cleanList(value.required_service_capabilities, 12),
    equivalent_service_language: cleanList(value.equivalent_service_language, 16),
    related_provider_types: cleanList(value.related_provider_types, 8),
    excluded_neighbor_types: cleanList(value.excluded_neighbor_types, 12),
    confidence: ['HIGH', 'MODERATE', 'LIMITED'].includes(value.confidence) ? value.confidence : 'LIMITED',
    reasoning: clean(value.reasoning, 900),
  };
}

function extractedScope(opportunity = {}) {
  const requirements = opportunity.requirements && typeof opportunity.requirements === 'object' && !Array.isArray(opportunity.requirements)
    ? opportunity.requirements
    : {};
  return clean(requirements.scope_summary, 2400);
}

export function workCapabilityPrompt(opportunity = {}) {
  return `Build Work Capability V2 for one state/local government contract by answering:\n\nWHO CAN PERFORM THIS WORK?\n\nPURPOSE\nCreate a precise capability-routing profile for later comparison to evidence-backed contractor service capabilities. Preserve the principal WORK SUBJECT and PROVIDER DOMAIN so shared generic words cannot create false matches.\n\nHARD MATCHING BOUNDARY\nContract work requirement ↔ contractor service capability. Nothing more, nothing less.\n\nRULES\n1. Use only work described in the captured contract record and extracted scope. Never invent missing scope.\n2. Identify the principal work subject: the physical, digital, technical, organizational, or service object being acted upon.\n3. Identify the primary actions performed on that subject. Generic actions such as maintenance, repair, installation, removal, support, management, consulting, testing, or training MUST remain attached to their subject/domain.\n4. A generic action alone is NEVER a matching anchor. Tree maintenance, network maintenance, HVAC maintenance, and vehicle maintenance are different work domains.\n5. Identify the provider domain and lowest reliable specialized provider. A school roofing contract needs a roofer, not an education provider. A hospital network contract needs an IT/network provider, not a healthcare provider.\n6. Do not infer provider type from the issuing agency, facility, population served, or industry setting.\n7. Do not route on shared generic verbs alone. A mechanic repairs vehicles; that does not make the mechanic a street-light repair provider.\n8. matching_anchors MUST be concrete noun-bearing phrases that preserve the work subject/provider domain. Never output maintenance, repair, installation, consulting, support, management, or services by itself.\n9. equivalent_service_language may expand commercial/buyer wording only for the SAME underlying work. Do not cross into an adjacent line of business.\n10. excluded_neighbor_types should name plausible-sounding providers that may share generic words but normally cannot perform the principal work.\n11. This is NOT Contract DNA and NOT an eligibility/readiness/qualification review. Do not evaluate bonding, insurance, licenses, certifications, employees, revenue, business size, geography, registration, past performance, or financial capacity.\n12. If the captured language is thin, choose the narrowest defensible subject/domain and set confidence to LIMITED.\n\nCONTRACT\nTitle: ${clean(opportunity.title, 600) || 'Untitled'}\nIssuing organization: ${clean(opportunity.issuing_organization, 300) || 'Not provided'}\nProcurement type: ${clean(opportunity.procurement_type, 200) || 'Not provided'}\nDescription: ${clean(opportunity.description, 6000) || '(none captured)'}\nExtracted scope summary: ${extractedScope(opportunity) || '(none captured)'}\n\nReturn:\n- requested_work: concise principal work request\n- work_subjects: concrete subjects/objects the vendor acts upon\n- primary_work_actions: actions performed on those subjects\n- provider_domain: concise trade/profession/service domain\n- matching_anchors: concrete subject+action/domain phrases suitable for precise matching\n- who_can_perform_work: readable specialized provider answer\n- provider_path: broad-to-specialized provider tree\n- required_service_capabilities: capabilities actually needed to perform the work\n- equivalent_service_language: same-work commercial/buyer synonyms\n- related_provider_types: close legitimate specialties worth advisor review\n- excluded_neighbor_types: adjacent but wrong provider types likely to share generic language\n- confidence: HIGH, MODERATE, or LIMITED based only on captured work language\n- reasoning: short explanation tying subject + action + provider domain together`;
}

export async function resolveWorkCapability({
  apiKey,
  opportunity,
  model = DEFAULT_WORK_CAPABILITY_MODEL,
  fetchImpl = fetch,
  timeoutMs = 90000,
}) {
  const key = apiKey || env('OPENAI_API_KEY');
  if (!key) throw new Error('OPENAI_API_KEY_REQUIRED');
  const parsed = await requestStructuredJson({
    apiKey: key,
    model,
    system: 'You are a precise government-contract capability-routing agent. Preserve the principal work subject and provider domain. Generic action words never establish a match by themselves. Never perform qualification analysis.',
    prompt: workCapabilityPrompt(opportunity),
    schemaName: 'natcorp_work_capability_profile_v2',
    schema: PROFILE_SCHEMA,
    errorPrefix: 'WORK_CAPABILITY',
    fetchImpl,
    timeoutMs,
    maxOutputTokens: 3200,
    retries: 1,
  });
  return {
    ...normalizeWorkCapabilityProfile(parsed),
    version: WORK_CAPABILITY_VERSION,
    model,
    processed_at: nowIso(),
    source: 'OWNER_TRIGGERED_CONTRACT_WORK_CAPABILITY',
  };
}

function storedProfile(opportunity = {}) {
  const classifications = opportunity.classifications && typeof opportunity.classifications === 'object' && !Array.isArray(opportunity.classifications)
    ? opportunity.classifications
    : {};
  return classifications.work_capability_profile || null;
}

export function hasCurrentWorkCapability(opportunity = {}) {
  return storedProfile(opportunity)?.version === WORK_CAPABILITY_VERSION;
}

export async function persistWorkCapability(opportunity, profile) {
  const latest = await db(
    'state_contract_opportunities', 'GET',
    `?id=eq.${encodeURIComponent(opportunity.id)}&select=classifications&limit=1`,
  );
  const existing = latest?.[0]?.classifications;
  const classifications = existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {};
  await db('state_contract_opportunities', 'PATCH', `?id=eq.${encodeURIComponent(opportunity.id)}`, {
    classifications: {
      ...classifications,
      who_can_perform_work: profile.who_can_perform_work,
      work_capability_profile: profile,
    },
    updated_at: nowIso(),
  }, 'return=minimal');
}

export async function runWorkCapabilityBatch({
  apiKey,
  limit = 25,
  force = false,
  model = DEFAULT_WORK_CAPABILITY_MODEL,
  onProgress = async () => {},
} = {}) {
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 25));
  const pageSize = 250;
  const targets = [];
  for (let offset = 0; offset < 10000 && targets.length < safeLimit; offset += pageSize) {
    const rows = (await db(
      'state_contract_opportunities', 'GET',
      `?acquisition_method=eq.${ACQUISITION_METHOD}&status=eq.open&requirements_extraction_status=eq.COMPLETE&select=id,title,description,issuing_organization,procurement_type,requirements,classifications&order=updated_at.asc&limit=${pageSize}&offset=${offset}`,
    )) || [];
    for (const row of rows) {
      if (force || !hasCurrentWorkCapability(row)) targets.push(row);
      if (targets.length >= safeLimit) break;
    }
    if (rows.length < pageSize) break;
  }

  let succeeded = 0;
  let failed = 0;
  const results = [];
  await onProgress({ totalEligible: targets.length, processed: 0, succeeded, failed });
  for (const opportunity of targets) {
    try {
      const profile = await resolveWorkCapability({ apiKey, opportunity, model });
      await persistWorkCapability(opportunity, profile);
      succeeded += 1;
      results.push({
        opportunity_id: opportunity.id,
        who_can_perform_work: profile.who_can_perform_work,
        provider_domain: profile.provider_domain,
        work_subjects: profile.work_subjects,
        confidence: profile.confidence,
      });
    } catch (error) {
      failed += 1;
      results.push({ opportunity_id: opportunity.id, error: error instanceof Error ? error.message : String(error) });
    }
    await onProgress({ totalEligible: targets.length, processed: succeeded + failed, succeeded, failed });
  }
  return { totalEligible: targets.length, processed: targets.length, succeeded, failed, results };
}

export async function workCapabilityStatus() {
  const scope = `acquisition_method=eq.${ACQUISITION_METHOD}&status=eq.open&requirements_extraction_status=eq.COMPLETE`;
  const total = await dbCount('state_contract_opportunities', `?${scope}`);
  const rows = [];
  const pageSize = 500;
  for (let offset = 0; offset < 10000; offset += pageSize) {
    const page = (await db(
      'state_contract_opportunities', 'GET',
      `?${scope}&select=id,title,issuing_organization,classifications,updated_at&order=updated_at.desc&limit=${pageSize}&offset=${offset}`,
    )) || [];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  const readyRows = rows.filter((r) => hasCurrentWorkCapability(r));
  const confidence = { HIGH: 0, MODERATE: 0, LIMITED: 0 };
  for (const row of readyRows) {
    const level = storedProfile(row)?.confidence;
    if (Object.hasOwn(confidence, level)) confidence[level] += 1;
  }
  return {
    total,
    ready: readyRows.length,
    pending: Math.max(0, rows.length - readyRows.length),
    high: confidence.HIGH,
    moderate: confidence.MODERATE,
    limited: confidence.LIMITED,
    current_version: WORK_CAPABILITY_VERSION,
    recent: readyRows.slice(0, 12).map((r) => {
      const profile = storedProfile(r) || {};
      return {
        id: r.id,
        title: r.title,
        agency_name: r.issuing_organization,
        who_can_perform_work: profile.who_can_perform_work,
        provider_domain: profile.provider_domain,
        provider_path: profile.provider_path || [],
        confidence: profile.confidence,
        processed_at: profile.processed_at,
      };
    }),
  };
}
