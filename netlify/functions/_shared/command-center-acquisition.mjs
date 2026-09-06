// Stage 1 (Contract Acquisition) storage + job-status. Ported from
// APROPOS-CONTRACT-BRIEF's natcorp-pipeline-acquisition.mjs, adapted to call
// db()/dbCount() directly from natcorp-db.mjs instead of a cross-project client --
// this site's own SUPABASE_URL already IS the natcorp project, so there is no
// second project to reach across to.
//
// Raw candidates land in state_raw_records (pre-normalization staging). Dedupe
// here is "don't re-insert the same source URL for the same publisher on a
// re-run" -- real dedupe against the canonical table happens at promotion
// (Stage 2, see command-center-extraction.mjs).
import { db, dbCount, sha256 } from './natcorp-db.mjs';
import { stateCodeFor } from './command-center-publisher-registry.mjs';
import { ensureJob, updateJob, discoveryJobId, jobAsRunSummary } from './command-center-jobs.mjs';

export { jobAsRunSummary };

function clean(value, max = 2000) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, max) : null;
}

export async function storeRawCandidate({ candidate, url, evidence, stateName, scope, runId } = {}) {
  const stateCode = stateCodeFor(stateName);
  if (!stateCode) throw new Error(`UNSUPPORTED_STATE:${stateName}`);
  const title = clean(candidate.title, 500);
  const agency = clean(candidate.agency_name, 300);
  if (!title || !agency) throw new Error('TITLE_AND_AGENCY_REQUIRED');

  const sourceFingerprint = await sha256(url);
  const existing = await db(
    'state_raw_records', 'GET',
    `?state_code=eq.${stateCode}&source_fingerprint=eq.${sourceFingerprint}&select=id&limit=1`,
  );

  const timestamp = new Date().toISOString();
  const row = {
    state_code: stateCode,
    publisher_key: scope?.id || null,
    publisher_name: scope?.name || null,
    publisher_platform: clean(candidate.platform_name, 200) || scope?.platform || null,
    source_record_id: clean(candidate.source_opportunity_id || candidate.solicitation_number, 200) || sourceFingerprint.slice(0, 24),
    source_solicitation_number: clean(candidate.solicitation_number, 200),
    source_url: url,
    source_detail_url: url,
    source_package_url: null,
    raw_title: title,
    raw_agency: agency,
    raw_description: clean(candidate.description, 8000),
    raw_posted_date: candidate.posted_at ? String(candidate.posted_at) : null,
    raw_response_deadline: candidate.closes_at ? String(candidate.closes_at) : null,
    raw_contact_data: {},
    raw_requirements: {},
    raw_document_manifest: {},
    raw_payload: {
      discovery_method: 'PUBLISHER_DIRECTED_OPENAI_WEB_SEARCH_WITH_SERVER_VALIDATION',
      model: evidence?.model || null,
      response_id: evidence?.responseId || null,
      publisher_scope: scope?.id || null,
      publisher_name: scope?.name || null,
      publisher_site_url: scope?.site_url || null,
      platform_name: clean(candidate.platform_name, 200),
      citations: evidence?.citations || [],
      department_name: clean(candidate.department_name, 300),
      opportunity_type: clean(candidate.opportunity_type, 100),
      place_of_performance: clean(candidate.place_of_performance, 500),
      city: clean(candidate.city, 120),
      state: clean(candidate.state, 20),
      closing_timezone: clean(candidate.closing_timezone, 100),
      electronic_submission_allowed: typeof candidate.electronic_submission_allowed === 'boolean' ? candidate.electronic_submission_allowed : null,
      candidate,
    },
    document_count: 0,
    source_fingerprint: sourceFingerprint,
    content_fingerprint: await sha256(`${title}|${agency}|${candidate.closes_at || ''}`),
    acquisition_agent_id: 'natcorp_site_openai_discovery_v1',
    acquisition_session_id: runId || null,
    normalization_status: 'PENDING',
    updated_at: timestamp,
  };

  if (existing?.[0]?.id) {
    await db('state_raw_records', 'PATCH', `?id=eq.${existing[0].id}`, row, 'return=minimal');
    return 'updated';
  }
  await db('state_raw_records', 'POST', '', [{ ...row, acquired_at: timestamp, created_at: timestamp }], 'return=minimal');
  return 'created';
}

export async function ensureAcquisitionJob({ stateCode, scope }) {
  return ensureJob({
    jobId: discoveryJobId(stateCode, scope.id),
    jobName: `Command Center Publisher Defined -- ${scope.name}`,
    sourcePlatform: 'PUBLISHER_DIRECTED_OPENAI_WEB_SEARCH',
    stateCode,
    configuration: { scope_id: scope.id, publisher_id: scope.id },
  });
}

export const updateAcquisitionJob = updateJob;

export async function listAcquisitionJobs(limit = 20) {
  return (await db('pdas_acquisition_jobs', 'GET', `?source_platform=eq.PUBLISHER_DIRECTED_OPENAI_WEB_SEARCH&select=*&order=updated_at.desc&limit=${limit}`)) || [];
}

export async function rawCoverage() {
  const [pending, total] = await Promise.all([
    dbCount('state_raw_records', '?normalization_status=eq.PENDING'),
    dbCount('state_raw_records', ''),
  ]);
  return { pending, total };
}
