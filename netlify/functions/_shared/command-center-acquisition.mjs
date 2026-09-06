// Stage 1 (Contract Acquisition) storage + job-status.
//
// REVISED 2026-09-06 per Jeff: no more state_raw_records staging table.
// Acquisition writes directly into the canonical state_contract_opportunities
// row, the same way ACB's cbrief_contract_opportunities is a single table that
// Contract Extraction and Work Capability progressively enrich in place
// (see cbrief_contract_opportunities on project pwvstaigtdrccirdvqka: one row,
// aoie_processing_status/match_readiness_status/publication_status flip as
// later stages complete -- no separate raw/normalized staging tables there
// either). Dedupe key is (state_code, source_fingerprint), same as before.
//
// A re-discovery of an already-acquired opportunity only refreshes
// acquisition-owned fields (title/description/deadline/source metadata) --
// it never touches requirements_extraction_status, requirements, or
// classifications, so a re-run of Contract Acquisition can never roll back
// work Contract Extraction or Work Capability already did on that row.
//
// state_contract_opportunities is also written by the separate scheduled
// scrapers (CA-CALEPROCURE/CA-PLANETBIDS/CA-OBAS, see this repo's CLAUDE.md)
// with their own acquisition_method values -- this pipeline's own coverage
// counts are scoped to acquisition_method=PUBLISHER_DIRECTED_OPENAI_WEB_SEARCH
// so the two never get conflated in the Command Center's own dashboards.
import { db, dbCount, sha256 } from './natcorp-db.mjs';
import { stateCodeFor } from './command-center-publisher-registry.mjs';
import { ensureJob, updateJob, discoveryJobId, jobAsRunSummary } from './command-center-jobs.mjs';

export { jobAsRunSummary };

export const ACQUISITION_METHOD = 'PUBLISHER_DIRECTED_OPENAI_WEB_SEARCH';

function clean(value, max = 2000) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, max) : null;
}

export async function storeAcquiredOpportunity({ candidate, url, evidence, stateName, scope, runId } = {}) {
  const stateCode = stateCodeFor(stateName);
  if (!stateCode) throw new Error(`UNSUPPORTED_STATE:${stateName}`);
  const title = clean(candidate.title, 500);
  const agency = clean(candidate.agency_name, 300);
  if (!title || !agency) throw new Error('TITLE_AND_AGENCY_REQUIRED');

  const sourceFingerprint = await sha256(url);
  const contentFingerprint = await sha256(`${title}|${agency}|${candidate.closes_at || ''}`);
  const timestamp = new Date().toISOString();

  const existing = await db(
    'state_contract_opportunities', 'GET',
    `?state_code=eq.${stateCode}&source_fingerprint=eq.${sourceFingerprint}&select=id&limit=1`,
  );

  if (existing?.[0]?.id) {
    // Re-discovery of an already-acquired opportunity: refresh only
    // acquisition-owned fields. Never touch requirements, classifications,
    // requirements_extraction_status, or qa_status here -- those belong to
    // later stages and must not be rolled back by a re-run of Acquisition.
    await db('state_contract_opportunities', 'PATCH', `?id=eq.${existing[0].id}`, {
      official_source_url: url,
      source_url: url,
      response_deadline: candidate.closes_at ? safeDate(candidate.closes_at) : undefined,
      raw_source_payload: acquisitionPayload(candidate, evidence, scope),
      content_fingerprint: contentFingerprint,
      last_seen_at: timestamp,
      updated_at: timestamp,
    }, 'return=minimal');
    return 'updated';
  }

  const row = {
    state_code: stateCode,
    jurisdiction_type: null,
    jurisdiction_name: agency,
    issuing_organization: agency,
    issuing_department: clean(candidate.department_name, 300),
    source_platform: clean(candidate.platform_name, 200) || scope?.platform || null,
    source_record_id: clean(candidate.source_opportunity_id || candidate.solicitation_number, 200) || sourceFingerprint.slice(0, 24),
    source_url: url,
    official_source_url: url,
    solicitation_number: clean(candidate.solicitation_number, 200),
    title,
    description: clean(candidate.description, 8000),
    procurement_type: clean(candidate.opportunity_type, 100),
    status: 'open',
    posted_at: candidate.posted_at ? safeDate(candidate.posted_at) : null,
    response_deadline: candidate.closes_at ? safeDate(candidate.closes_at) : null,
    place_of_performance_city: clean(candidate.city, 120),
    place_of_performance_state: clean(candidate.state, 20),
    raw_source_payload: acquisitionPayload(candidate, evidence, scope),
    source_fingerprint: sourceFingerprint,
    content_fingerprint: contentFingerprint,
    is_latest_version: true,
    first_seen_at: timestamp,
    last_seen_at: timestamp,
    acquisition_method: ACQUISITION_METHOD,
    updated_at: timestamp,
    created_at: timestamp,
    // requirements_extraction_status, qa_status, requirements, classifications,
    // package_status, match_readiness_status, natcorp_release_status,
    // natcorp_contract_dna_status all stay at their table defaults
    // (NOT_STARTED / unverified / {} / {} / PACKAGE_NOT_STARTED /
    // BLOCKED_PACKAGE_INCOMPLETE / not_evaluated / not_started) -- the last
    // four belong to the legacy AI-matching gate being retired alongside
    // natcorp-agent-matching.mjs and are not this pipeline's concern.
  };

  await db('state_contract_opportunities', 'POST', '', [row], 'return=minimal');
  return 'created';
}

function acquisitionPayload(candidate, evidence, scope) {
  return {
    discovery_method: 'PUBLISHER_DIRECTED_OPENAI_WEB_SEARCH_WITH_SERVER_VALIDATION',
    model: evidence?.model || null,
    response_id: evidence?.responseId || null,
    publisher_scope: scope?.id || null,
    publisher_name: scope?.name || null,
    publisher_site_url: scope?.site_url || null,
    platform_name: clean(candidate.platform_name, 200),
    citations: evidence?.citations || [],
    closing_timezone: clean(candidate.closing_timezone, 100),
    electronic_submission_allowed: typeof candidate.electronic_submission_allowed === 'boolean' ? candidate.electronic_submission_allowed : null,
    candidate,
  };
}

function safeDate(value) {
  const date = new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export async function ensureAcquisitionJob({ stateCode, scope }) {
  return ensureJob({
    jobId: discoveryJobId(stateCode, scope.id),
    jobName: `Command Center Publisher Defined -- ${scope.name}`,
    sourcePlatform: ACQUISITION_METHOD,
    stateCode,
    configuration: { scope_id: scope.id, publisher_id: scope.id },
  });
}

export const updateAcquisitionJob = updateJob;

export async function listAcquisitionJobs(limit = 20) {
  return (await db('pdas_acquisition_jobs', 'GET', `?source_platform=eq.${ACQUISITION_METHOD}&select=*&order=updated_at.desc&limit=${limit}`)) || [];
}

export async function acquisitionCoverage() {
  const scope = `acquisition_method=eq.${ACQUISITION_METHOD}`;
  const [pendingExtraction, total] = await Promise.all([
    dbCount('state_contract_opportunities', `?${scope}&requirements_extraction_status=eq.NOT_STARTED`),
    dbCount('state_contract_opportunities', `?${scope}`),
  ]);
  return { pending: pendingExtraction, total };
}
