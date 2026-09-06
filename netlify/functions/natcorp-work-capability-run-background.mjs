// Stage 3 Work Capability V2 background worker.
// Netlify's -background suffix gives the owner-triggered OpenAI batch an async budget.
import { env, commandAuthorized } from './_shared/natcorp-db.mjs';
import {
  DEFAULT_WORK_CAPABILITY_MODEL,
  runWorkCapabilityBatch,
} from './_shared/command-center-work-capability.mjs';
import {
  ensureJob,
  updateJob,
  WORK_CAPABILITY_JOB_ID,
} from './_shared/command-center-jobs.mjs';

export default async function handler(req) {
  if (!commandAuthorized(req)) return;
  let body;
  try { body = await req.json(); } catch { return; }

  const limit = Math.max(1, Math.min(100, Number(body?.limit) || 25));
  const force = body?.force === true;
  const apiKey = env('OPENAI_API_KEY');
  const model = env('NATCORP_WORK_CAPABILITY_MODEL') || DEFAULT_WORK_CAPABILITY_MODEL;

  const job = await ensureJob({
    jobId: WORK_CAPABILITY_JOB_ID,
    jobName: 'Command Center Work Capability V2',
    sourcePlatform: 'NATCORP_WORK_CAPABILITY_V2',
    configuration: { version: 'natcorp_work_capability_v2' },
  });
  if (!job) return;

  if (!apiKey) {
    await updateJob(WORK_CAPABILITY_JOB_ID, {
      job_status: 'failed',
      last_error: 'OPENAI_API_KEY is not configured.',
      last_failure_at: new Date().toISOString(),
    });
    return;
  }

  try {
    await updateJob(WORK_CAPABILITY_JOB_ID, {
      job_status: 'running',
      last_started_at: new Date().toISOString(),
      last_error: null,
      last_records_discovered: 0,
      last_records_inserted: 0,
      last_records_updated: 0,
      last_records_failed: 0,
    });

    const summary = await runWorkCapabilityBatch({
      apiKey,
      limit,
      force,
      model,
      onProgress: async (progress) => updateJob(WORK_CAPABILITY_JOB_ID, {
        last_records_discovered: progress.totalEligible,
        last_records_inserted: progress.succeeded,
        last_records_updated: 0,
        last_records_failed: progress.failed,
      }),
    });

    await updateJob(WORK_CAPABILITY_JOB_ID, {
      job_status: summary.failed > 0 && summary.succeeded === 0 ? 'degraded' : 'healthy',
      last_records_discovered: summary.totalEligible,
      last_records_inserted: summary.succeeded,
      last_records_updated: 0,
      last_records_failed: summary.failed,
      last_completed_at: new Date().toISOString(),
      last_success_at: summary.succeeded > 0 ? new Date().toISOString() : job.last_success_at,
      last_error: summary.failed > 0 ? `${summary.failed} Work Capability record(s) failed in the batch.` : null,
      consecutive_failures: summary.failed > 0 && summary.succeeded === 0 ? Number(job.consecutive_failures || 0) + 1 : 0,
    });
  } catch (error) {
    await updateJob(WORK_CAPABILITY_JOB_ID, {
      job_status: 'failed',
      last_completed_at: new Date().toISOString(),
      last_failure_at: new Date().toISOString(),
      last_error: error instanceof Error ? error.message : 'Work Capability V2 run failed.',
    }).catch(() => {});
  }
}
