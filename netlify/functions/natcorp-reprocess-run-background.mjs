// "Reprocess" background worker (Stage 3's Reprocess control, reused): explainer
// + taxonomy classification directly against existing state_contract_opportunities
// records, bypassing Stage 1 and raw/normalized staging. Prioritizes records
// missing response_deadline. "-background" suffix required for Netlify's async
// execution budget (batch OpenAI calls).
//
// Ported from APROPOS-CONTRACT-BRIEF's natcorp-reprocess-run-background.mjs.
import { env, commandAuthorized } from './_shared/natcorp-db.mjs';
import { runReprocessBatch } from './_shared/command-center-reprocess.mjs';
import { ensureJob, updateJob, REPROCESS_JOB_ID } from './_shared/command-center-jobs.mjs';

export default async function handler(req) {
  if (!commandAuthorized(req)) return;
  let body;
  try { body = await req.json(); } catch { return; }
  const limit = Number(body?.limit) || 25;

  const apiKey = env('OPENAI_API_KEY');
  const job = await ensureJob({
    jobId: REPROCESS_JOB_ID,
    jobName: 'Command Center Reprocess (explainer + taxonomy)',
    sourcePlatform: 'NATCORP_SITE_REPROCESS_EXPLAIN_AND_CLASSIFY',
  });
  if (!job) return;

  if (!apiKey) {
    await updateJob(REPROCESS_JOB_ID, { job_status: 'FAILED', last_error: 'OPENAI_API_KEY is not configured.', last_failure_at: new Date().toISOString() });
    return;
  }

  try {
    await updateJob(REPROCESS_JOB_ID, { job_status: 'RUNNING', last_started_at: new Date().toISOString(), last_error: null });
    const summary = await runReprocessBatch({
      apiKey, limit,
      onProgress: async (progress) => updateJob(REPROCESS_JOB_ID, {
        last_records_discovered: progress.totalEligible,
        last_records_inserted: progress.succeeded,
        last_records_failed: progress.failed,
      }),
    });
    await updateJob(REPROCESS_JOB_ID, {
      job_status: 'COMPLETED',
      last_records_discovered: summary.totalEligible,
      last_records_inserted: summary.succeeded,
      last_records_failed: summary.failed,
      last_completed_at: new Date().toISOString(),
      last_success_at: new Date().toISOString(),
      last_error: `Backfilled response_deadline on ${summary.deadlines_backfilled} record(s) this batch.`,
      consecutive_failures: 0,
    });
  } catch (error) {
    await updateJob(REPROCESS_JOB_ID, {
      job_status: 'FAILED',
      last_completed_at: new Date().toISOString(),
      last_failure_at: new Date().toISOString(),
      last_error: error instanceof Error ? error.message : 'Reprocess run failed.',
    }).catch(() => {});
  }
}
