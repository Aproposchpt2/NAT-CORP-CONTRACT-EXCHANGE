// Rolling job-status tracking on pdas_acquisition_jobs, one row per stage,
// updated in place rather than a per-run ledger (that table is a job-DEFINITION
// registry, not a per-run history). Ported from APROPOS-CONTRACT-BRIEF's
// natcorp-pipeline-jobs.mjs, adapted to call db() directly from natcorp-db.mjs --
// this site's own SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY already point at the
// natcorp Supabase project, so no cross-project client is needed here.
//
// Job id prefix is deliberately `natcorp_site_command_center:` rather than the
// source repo's `cbrief_command_center:` -- both repos' natcorp-mode code paths
// read/write the SAME Supabase project (judislfknmhofcgzyozc), so using a
// distinct prefix keeps this site's job rows from ever colliding with
// apropos-contract-brief's if both are run against production at once. See
// natcorp-clone-trace.md for the full coexistence-risk note.
import { db } from './natcorp-db.mjs';

export const JOB_ID_PREFIX = 'natcorp_site_command_center';
export const EXTRACTION_JOB_ID = `${JOB_ID_PREFIX}:extraction`;
export const TAXONOMY_JOB_ID = `${JOB_ID_PREFIX}:taxonomy`;
export const REPROCESS_JOB_ID = `${JOB_ID_PREFIX}:reprocess`;

export function discoveryJobId(stateCode, scopeId) {
  return `${JOB_ID_PREFIX}:${stateCode}:${scopeId}`;
}

export async function ensureJob({ jobId, jobName, sourcePlatform, stateCode = null, configuration = {} }) {
  const existing = await db('pdas_acquisition_jobs', 'GET', `?job_id=eq.${encodeURIComponent(jobId)}&select=*&limit=1`);
  if (existing?.[0]) return existing[0];
  const timestamp = new Date().toISOString();
  const created = await db('pdas_acquisition_jobs', 'POST', '', [{
    job_id: jobId,
    job_name: jobName,
    state_code: stateCode,
    source_platform: sourcePlatform,
    enabled: true,
    job_status: 'READY',
    configuration: { origin: 'command-center.html', mode: 'MANUAL_TRIGGER', ...configuration },
    created_at: timestamp,
    updated_at: timestamp,
  }], 'return=representation');
  return created?.[0] || existing?.[0] || null;
}

export async function updateJob(jobId, patch) {
  await db('pdas_acquisition_jobs', 'PATCH', `?job_id=eq.${encodeURIComponent(jobId)}`, { ...patch, updated_at: new Date().toISOString() }, 'return=minimal');
}

export async function getJob(jobId) {
  return (await db('pdas_acquisition_jobs', 'GET', `?job_id=eq.${encodeURIComponent(jobId)}&select=*&limit=1`))?.[0] || null;
}

// Shapes a pdas_acquisition_jobs row into the run-summary fields
// command-center.html's rendering functions already read (from a
// cbrief_discovery_runs / cbrief_extraction_runs-shaped row upstream).
export function jobAsRunSummary(job, targetRecords) {
  if (!job) return null;
  const processed = Number(job.last_records_inserted || 0) + Number(job.last_records_updated || 0);
  return {
    id: job.job_id,
    status: job.job_status || 'READY',
    target_records: targetRecords,
    processed,
    total_listed: Number(job.last_records_discovered || 0),
    created: Number(job.last_records_inserted || 0),
    updated: Number(job.last_records_updated || 0),
    failed: Number(job.last_records_failed || 0),
    succeeded: Number(job.last_records_inserted || 0) + Number(job.last_records_updated || 0),
    started_at: job.last_started_at || null,
    completed_at: job.last_completed_at || null,
    created_at: job.created_at,
    updated_at: job.updated_at,
    error_message: job.last_error || null,
    publisher_name: job.job_name,
    activity: {
      stage: job.job_status === 'RUNNING' ? 'SCANNING' : job.job_status || 'WAITING',
      message: job.last_error || `pdas_acquisition_jobs status: ${job.job_status || 'READY'}.`,
      last_activity_at: job.updated_at,
      current_publisher: job.job_name,
      coverage_execution: [],
    },
  };
}
