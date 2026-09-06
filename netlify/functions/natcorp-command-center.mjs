// NatCorp Contract Exchange internal operations endpoint behind command-center.html.
//
// Production pipeline:
//   1. Contract Acquisition -> canonical state_contract_opportunities row.
//   2. Contract Extraction  -> description + requirements JSON + plain-language explainer.
//   3. Work Capability V2   -> precise work-subject/provider-domain profile answering
//                              "Who can perform this work?" for later capability matching.
//
// Stage 3 remains contract-only. It does not accept a business_profile_id and does not
// perform contractor eligibility, readiness, qualification, or matching.
import { env, json, nowIso, commandAuthorized } from './_shared/natcorp-db.mjs';
import { DISCOVERY_TARGET, STATE_NAME_TO_CODE } from './_shared/command-center-publisher-registry.mjs';
import { getStatePublisherDefinedScope, listStatePublisherDefinedScopes } from './_shared/command-center-state-publisher-defined.mjs';
import { ensureAcquisitionJob, listAcquisitionJobs, jobAsRunSummary } from './_shared/command-center-acquisition.mjs';
import {
  getJob,
  EXTRACTION_JOB_ID,
  WORK_CAPABILITY_JOB_ID,
} from './_shared/command-center-jobs.mjs';
import { extractionCoverage } from './_shared/command-center-extraction.mjs';
import {
  WORK_CAPABILITY_VERSION,
  workCapabilityStatus as getWorkCapabilityStatus,
} from './_shared/command-center-work-capability.mjs';

const EXTRACTION_TARGET = 25;
const WORK_CAPABILITY_TARGET = 25;

function californiaPublisherScopes() {
  const california = getStatePublisherDefinedScope('CA_PUBLISHER_DEFINED');
  return california?.child_scopes || [];
}

function acquisitionScope(scopeId) {
  const id = String(scopeId || '').toUpperCase();
  return getStatePublisherDefinedScope(id)
    || californiaPublisherScopes().find((scope) => scope.id === id)
    || null;
}

function acquisitionPublisherListing() {
  const stateScopes = listStatePublisherDefinedScopes();
  const californiaChildren = californiaPublisherScopes().map((scope) => ({
    id: scope.id,
    name: scope.name,
    site_url: scope.site_url,
    state: scope.state,
    market: scope.market,
    platform: scope.vendor_name || scope.platform || scope.name,
    scope_type: scope.scope_type,
    buyer_count: Array.isArray(scope.publishers) ? scope.publishers.length : 1,
    publisher_family_count: 1,
  }));
  return [
    ...californiaChildren,
    ...stateScopes.filter((scope) => scope.state !== 'California'),
  ];
}

async function discoveryStatus() {
  const jobs = await listAcquisitionJobs(20);
  const runs = jobs.map((job) => jobAsRunSummary(job, DISCOVERY_TARGET)).filter(Boolean);
  return {
    publishers: acquisitionPublisherListing(),
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
    pending: coverage.pending,
  };
}

async function workCapabilityStatus() {
  const status = await getWorkCapabilityStatus();
  const job = await getJob(WORK_CAPABILITY_JOB_ID);
  return {
    mode: 'WORK_CAPABILITY_V2',
    target_records: WORK_CAPABILITY_TARGET,
    total: status.total,
    ready: status.ready,
    pending: status.pending,
    high: status.high,
    moderate: status.moderate,
    limited: status.limited,
    current_version: WORK_CAPABILITY_VERSION,
    recent: status.recent,
    last_run: jobAsRunSummary(job, WORK_CAPABILITY_TARGET),
  };
}

async function statusBundle() {
  const [discovery, extraction, workCapability] = await Promise.all([
    discoveryStatus(),
    extractionStatus(),
    workCapabilityStatus(),
  ]);
  const workJob = await getJob(WORK_CAPABILITY_JOB_ID);
  const acquisitionJobs = await listAcquisitionJobs(50);
  return {
    ok: true,
    retrieved_at: nowIso(),
    operational_pipeline: ['CONTRACT_ACQUISITION', 'CONTRACT_EXTRACTION', 'WORK_CAPABILITY_V2'],
    discovery,
    extraction: extraction.coverage,
    extraction_runs: extraction.runs,
    work_capability: workCapability,
    errors: {
      // Acquisition connector failures are operational failures even when the
      // rolling job previously ended as healthy. This also keeps historical
      // pre-hotfix runs visible until they are re-run with detailed diagnostics.
      discovery_runs: acquisitionJobs
        .filter((j) => j.job_status === 'failed' || j.job_status === 'degraded' || Number(j.last_records_failed || 0) > 0)
        .map((j) => jobAsRunSummary(j, DISCOVERY_TARGET)),
      extraction_runs: extraction.runs.runs.filter((r) => r.status === 'FAILED'),
      work_capability_runs: [jobAsRunSummary(workJob, WORK_CAPABILITY_TARGET)].filter((r) => r?.status === 'FAILED'),
      profiles_with_errors: [],
    },
    task_reporting: {
      active_sessions: {},
      recent_sessions: [],
      current_reports: {
        ACQUISITION: {
          session: null,
          runs: discovery.runs,
          latest_run: discovery.runs[0] || null,
          candidate_decisions: [],
          summary: {},
        },
        EXTRACTION: {
          session: null,
          runs: extraction.runs.runs,
          latest_run: extraction.runs.runs[0] || null,
          summary: {},
        },
        WORK_CAPABILITY: {
          session: null,
          runs: [workCapability.last_run].filter(Boolean),
          latest_run: workCapability.last_run || null,
          summary: {
            ready: workCapability.ready,
            pending: workCapability.pending,
            high: workCapability.high,
            moderate: workCapability.moderate,
            limited: workCapability.limited,
          },
        },
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
      return json(400, {
        ok: false,
        error: 'Task-session resets are not applicable here: each stage tracks one rolling job status instead of per-task sessions.',
      });
    }

    const apiKey = env('OPENAI_API_KEY');

    if (action === 'launch_discovery') {
      if (!apiKey) return json(500, { ok: false, error: 'OPENAI_API_KEY is not configured.' });
      const scopeId = payload.scope_id || payload.publisher_id;
      const scope = acquisitionScope(scopeId);
      if (!scope) {
        return json(400, { ok: false, error: 'Select a configured acquisition publisher.' });
      }
      const stateCode = STATE_NAME_TO_CODE[scope.state];
      if (!stateCode) return json(400, { ok: false, error: `Unsupported state: ${scope.state}` });

      const job = await ensureAcquisitionJob({ stateCode, scope });
      if (job.job_status === 'running') {
        return json(409, {
          ok: false,
          error: 'An acquisition job is already active for this scope.',
          run: jobAsRunSummary(job, DISCOVERY_TARGET),
        });
      }

      const backgroundUrl = new URL('/.netlify/functions/natcorp-discovery-run-background', req.url);
      const queued = await fetch(backgroundUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-natcorp-command-key': forwardKey },
        body: JSON.stringify({ job_id: job.job_id, scope_id: scope.id }),
      });
      if (!queued.ok && queued.status !== 202) {
        return json(502, { ok: false, error: `Discovery background launch returned HTTP ${queued.status}.` });
      }
      return json(202, {
        ok: true,
        action,
        run: jobAsRunSummary({ ...job, job_status: 'not_started' }, DISCOVERY_TARGET),
      });
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
      if (!queued.ok && queued.status !== 202) {
        return json(502, { ok: false, error: `Extraction background launch returned HTTP ${queued.status}.` });
      }
      return json(202, {
        ok: true,
        action,
        run: { id: EXTRACTION_JOB_ID, status: 'QUEUED', target_records: targetRecords },
      });
    }

    if (action === 'launch_work_capability') {
      if (!apiKey) return json(500, { ok: false, error: 'OPENAI_API_KEY is not configured.' });
      const batchLimit = Math.max(1, Math.min(100, Number(payload.limit) || WORK_CAPABILITY_TARGET));
      const force = payload.force === true;
      const backgroundUrl = new URL('/.netlify/functions/natcorp-work-capability-run-background', req.url);
      const queued = await fetch(backgroundUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-natcorp-command-key': forwardKey },
        body: JSON.stringify({ limit: batchLimit, force }),
      });
      if (!queued.ok && queued.status !== 202) {
        return json(502, { ok: false, error: `Work Capability background launch returned HTTP ${queued.status}.` });
      }
      return json(202, {
        ok: true,
        action,
        batch_limit: batchLimit,
        force,
        mode: 'WORK_CAPABILITY_V2',
        run: { id: WORK_CAPABILITY_JOB_ID, status: 'QUEUED', target_records: batchLimit },
      });
    }

    return json(400, { ok: false, error: `Unknown action: ${action}` });
  } catch (error) {
    console.error('[natcorp-command-center]', action, error);
    return json(500, { ok: false, error: error instanceof Error ? error.message : 'Command failed.' });
  }
}
