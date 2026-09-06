// Rolling job-status tracking on pdas_acquisition_jobs, one row per stage,
// updated in place rather than a per-run ledger (that table is a job-DEFINITION
// registry, not a per-run history). This site's own SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY point at the NAT Corp Supabase project.
import { db } from './natcorp-db.mjs';

export const JOB_ID_PREFIX = 'natcorp_site_command_center';
export const EXTRACTION_JOB_ID = `${JOB_ID_PREFIX}:extraction`;
export const TAXONOMY_JOB_ID = `${JOB_ID_PREFIX}:taxonomy`;
export const WORK_CAPABILITY_JOB_ID = `${JOB_ID_PREFIX}:work-capability-v2`;
export const REPROCESS_JOB_ID = `${JOB_ID_PREFIX}:reprocess`;

// Real DB value -> display vocabulary used by command-center rendering.
const DISPLAY_STATUS = {
  not_started: 'QUEUED',
  scheduled: 'QUEUED',
  running: 'RUNNING',
  healthy: 'COMPLETED',
  degraded: 'FAILED',
  failed: 'FAILED',
  paused: 'QUEUED',
  retired: 'FAILED',
};

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
    job_status: 'not_started',
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

function fallbackErrorReport(job, targetRecords) {
  const failed = Number(job.last_records_failed || 0);
  if (!failed) return null;
  return {
    report_version: 'natcorp_acquisition_error_report_v1_legacy_summary',
    generated_at: job.last_completed_at || job.updated_at || null,
    job_id: job.job_id,
    job_name: job.job_name,
    state_code: job.state_code || null,
    source_platform: job.source_platform || null,
    target_records: targetRecords,
    totals: {
      listed: Number(job.last_records_discovered || 0),
      created: Number(job.last_records_inserted || 0),
      updated: Number(job.last_records_updated || 0),
      failed,
    },
    coverage_execution: [],
    last_error: job.last_error || null,
    historical_detail_available: false,
    note: 'This run predates persisted connector diagnostics. Re-run Contract Acquisition to capture per-connector error details.',
  };
}

export function jobAsRunSummary(job, targetRecords) {
  if (!job) return null;
  const processed = Number(job.last_records_inserted || 0) + Number(job.last_records_updated || 0);
  const persistedDiagnostics = job.configuration?.diagnostics || null;
  const errorReport = persistedDiagnostics || fallbackErrorReport(job, targetRecords);
  return {
    id: job.job_id,
    status: DISPLAY_STATUS[job.job_status] || 'QUEUED',
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
    error_report: errorReport,
    activity: {
      stage: job.job_status === 'running' ? 'SCANNING' : job.job_status || 'WAITING',
      message: job.last_error || `pdas_acquisition_jobs status: ${job.job_status || 'not_started'}.`,
      last_activity_at: job.updated_at,
      current_publisher: job.job_name,
      coverage_execution: persistedDiagnostics?.coverage_execution || [],
    },
  };
}
