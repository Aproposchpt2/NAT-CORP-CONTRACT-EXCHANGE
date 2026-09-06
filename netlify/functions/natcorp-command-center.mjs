// NatCorp Contract Exchange internal operations endpoint behind command-center.html.
//
// This is the natcorp-only clone of APROPOS-CONTRACT-BRIEF's cbrief-command-center.mjs
// natcorp branch (see natcorp-clone-trace.md at the repo root for the full trace and
// review that preceded this port). Unlike the source file, there is no cbrief/natcorp
// target switch here -- this site only ever has one target, so the action routing
// below is the entire surface, not a branch inside a larger cbrief-mode handler.
//
// Pipeline:
//   1. Contract Acquisition   -> state_raw_records
//   2. Contract Extraction    -> state_normalized_records -> state_contract_opportunities
//                                 + five-field plain-language explainer
//   3. Taxonomy Classification -> aoie_taxonomy_capabilities match -> industry_label +
//                                 confidence, aoie_opportunity_service_mappings.
//                                 Deliberately NOT a Literal-Capability-Match-style
//                                 contractor eligibility engine -- there is no
//                                 business_profile_id anywhere in this pipeline.
import { env, json, nowIso, commandAuthorized } from './_shared/natcorp-db.mjs';
import { DISCOVERY_TARGET, STATE_NAME_TO_CODE } from './_shared/command-center-publisher-registry.mjs';
import { getStatePublisherDefinedScope, listStatePublisherDefinedScopes } from './_shared/command-center-state-publisher-defined.mjs';
import { ensureAcquisitionJob, listAcquisitionJobs, jobAsRunSummary, rawCoverage } from './_shared/command-center-acquisition.mjs';
import { getJob, EXTRACTION_JOB_ID, TAXONOMY_JOB_ID, REPROCESS_JOB_ID } from './_shared/command-center-jobs.mjs';
import { extractionCoverage } from './_shared/command-center-extraction.mjs';
import { taxonomyStatus } from './_shared/command-center-taxonomy.mjs';
import { reprocessCoverage } from './_shared/command-center-reprocess.mjs';

const EXTRACTION_TARGET = 25;
const WORK_CAPABILITY_TARGET = 25;

async function discoveryStatus() {
  const jobs = await listAcquisitionJobs(20);
  const runs = jobs.map((job) => jobAsRunSummary(job, DISCOVERY_TARGET)).filter(Boolean);
  return {
    publishers: listStatePublisherDefinedScopes(),
    target_records: DISCOVERY_TARGET,
    runs,
    selection_model: 'STATE_PUBLISHER_DEFINED',
  };
}

async function extractionStatus() {
  const coverage = await extractionCoverage();
  const job = await getJob(EXTRACTION_JOB_ID);
  return {
    coverage: { extracted: coverage.extracted, total: coverage.total },
    runs: { target_records: EXTRACTION_TARGET, runs: [jobAsRunSummary(job, EXTRACTION_TARGET)].filter(Boolean) },
    raw_pending: coverage.pending_raw,
    raw_total: coverage.total_raw,
  };
}

async function workCapabilityStatus() {
  const status = await taxonomyStatus();
  const reprocessJob = await getJob(REPROCESS_JOB_ID);
  const reprocessCov = await reprocessCoverage();
  return {
    mode: 'TAXONOMY_CLASSIFICATION',
    target_records: WORK_CAPABILITY_TARGET,
    total: status.total,
    ready: status.ready,
    pending: status.pending,
    taxonomy_capability_count: status.taxonomy_capability_count,
    current_version: 'natcorp_site_taxonomy_classification_v1',
    recent: status.recent,
    reprocess: {
      missing_response_deadline: reprocessCov.missing_response_deadline,
      total: reprocessCov.total,
      last_run: jobAsRunSummary(reprocessJob, WORK_CAPABILITY_TARGET),
    },
  };
}

async function statusBundle() {
  const [discovery, extraction, workCapability] = await Promise.all([
    discoveryStatus(),
    extractionStatus(),
    workCapabilityStatus(),
  ]);
  const taxonomyJob = await getJob(TAXONOMY_JOB_ID);
  return {
    ok: true,
    retrieved_at: nowIso(),
    operational_pipeline: ['CONTRACT_ACQUISITION', 'CONTRACT_EXTRACTION', 'TAXONOMY_CLASSIFICATION'],
    discovery,
    extraction: extraction.coverage,
    extraction_runs: extraction.runs,
    work_capability: workCapability,
    errors: {
      discovery_runs: (await listAcquisitionJobs(50)).filter((j) => j.job_status === 'FAILED'),
      extraction_runs: [taxonomyJob].filter((j) => j?.job_status === 'FAILED'),
      profiles_with_errors: [],
    },
    task_reporting: {
      active_sessions: {},
      recent_sessions: [],
      current_reports: {
        ACQUISITION: { session: null, runs: discovery.runs, latest_run: discovery.runs[0] || null, candidate_decisions: [], summary: {} },
        EXTRACTION: { session: null, runs: extraction.runs.runs, latest_run: extraction.runs.runs[0] || null, summary: {} },
      },
    },
  };
}

export default async function handler(req) {
  if (!commandAuthorized(req)) {
    return json(401, { ok: false, error: 'Command center access denied.' });
  }

  if (req.method === 'GET') {
    try {
      return json(200, await statusBundle());
    } catch (error) {
      console.error('[natcorp-command-center]', error);
      return json(500, { ok: false, error: error instanceof Error ? error.message : 'Command center status failed.' });
    }
  }

  if (req.method !== 'POST') {
    return json(405, { ok: false, error: 'GET or POST only.' });
  }

  let payload;
  try {
    payload = await req.json();
  } catch {
    return json(400, { ok: false, error: 'Invalid JSON.' });
  }
  const action = String(payload?.action || '');
  const forwardKey = req.headers.get('x-natcorp-command-key') || req.headers.get('x-dashboard-password') || '';

  try {
    if (action === 'start_new_task') {
      // This site's stages each track one rolling job status (pdas_acquisition_jobs),
      // not a per-task-session ledger, so there is nothing to reset. Matches the
      // source repo's natcorp-mode behavior for this action.
      return json(400, { ok: false, error: 'Task-session resets are not applicable here: each stage tracks one rolling job status instead of per-task sessions.' });
    }

    const apiKey = env('OPENAI_API_KEY');

    if (action === 'launch_discovery') {
      if (!apiKey) return json(500, { ok: false, error: 'OPENAI_API_KEY is not configured.' });
      const scopeId = payload.scope_id || payload.publisher_id;
      const scope = getStatePublisherDefinedScope(scopeId);
      if (!scope || scope.scope_type !== 'STATE_PUBLISHER_DEFINED') {
        return json(400, { ok: false, error: 'Select a state Publisher Defined acquisition scope.' });
      }
      const stateCode = STATE_NAME_TO_CODE[scope.state];
      if (!stateCode) return json(400, { ok: false, error: `Unsupported state: ${scope.state}` });

      const job = await ensureAcquisitionJob({ stateCode, scope });
      if (job.job_status === 'RUNNING' || job.job_status === 'QUEUED') {
        return json(409, { ok: false, error: 'An acquisition job is already active for this scope.', run: jobAsRunSummary(job, DISCOVERY_TARGET) });
      }

      const backgroundUrl = new URL('/.netlify/functions/natcorp-discovery-run-background', req.url);
      const queued = await fetch(backgroundUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-natcorp-command-key': forwardKey },
        body: JSON.stringify({ job_id: job.job_id, scope_id: scope.id }),
      });
      if (!queued.ok && queued.status !== 202) return json(502, { ok: false, error: `Discovery background launch returned HTTP ${queued.status}.` });
      return json(202, { ok: true, action, run: jobAsRunSummary({ ...job, job_status: 'QUEUED' }, DISCOVERY_TARGET) });
    }

    if (action === 'launch_extraction') {
      if (!apiKey) return json(500, { ok: false, error: 'OPENAI_API_KEY is not configured.' });
      const targetRecords = Math.max(1, Math.min(50, Number(payload.limit) || EXTRACTION_TARGET));
      const backgroundUrl = new URL('/.netlify/functions/natcorp-extraction-run-background', req.url);
      const queued = await fetch(backgroundUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-natcorp-command-key': forwardKey },
        body: JSON.stringify({ target_records: targetRecords }),
      });
      if (!queued.ok && queued.status !== 202) return json(502, { ok: false, error: `Extraction background launch returned HTTP ${queued.status}.` });
      return json(202, { ok: true, action, run: { id: EXTRACTION_JOB_ID, status: 'QUEUED', target_records: targetRecords } });
    }

    if (action === 'launch_work_capability') {
      if (!apiKey) return json(500, { ok: false, error: 'OPENAI_API_KEY is not configured.' });
      const batchLimit = Math.max(1, Math.min(100, Number(payload.limit) || WORK_CAPABILITY_TARGET));
      const force = payload.force === true;
      // force === true is the Reprocess control: bypass-staging explainer +
      // classification batch against pre-existing canonical records.
      const functionName = force ? 'natcorp-reprocess-run-background' : 'natcorp-taxonomy-run-background';
      const backgroundUrl = new URL(`/.netlify/functions/${functionName}`, req.url);
      const queued = await fetch(backgroundUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-natcorp-command-key': forwardKey },
        body: JSON.stringify({ limit: batchLimit, force }),
      });
      if (!queued.ok && queued.status !== 202) return json(502, { ok: false, error: `Work capability background launch returned HTTP ${queued.status}.` });
      return json(202, { ok: true, action, batch_limit: batchLimit, force, mode: force ? 'REPROCESS' : 'TAXONOMY_CLASSIFICATION' });
    }

    return json(400, { ok: false, error: `Unknown action: ${action}` });
  } catch (error) {
    console.error('[natcorp-command-center]', action, error);
    return json(500, { ok: false, error: error instanceof Error ? error.message : 'Command failed.' });
  }
}
