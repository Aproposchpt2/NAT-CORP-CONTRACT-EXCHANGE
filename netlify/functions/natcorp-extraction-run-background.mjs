// Stage 2 (Contract Extraction) background worker: normalize + promote +
// five-field explainer, on newly-acquired state_raw_records. "-background"
// suffix required for Netlify's async execution budget (batch OpenAI calls).
//
// Ported from APROPOS-CONTRACT-BRIEF's natcorp-extraction-run-background.mjs.
import { env, commandAuthorized } from './_shared/natcorp-db.mjs';
import { runExtractionBatch } from './_shared/command-center-extraction.mjs';
import { ensureJob, updateJob, EXTRACTION_JOB_ID } from './_shared/command-center-jobs.mjs';

export default async function handler(req) {
  if (!commandAuthorized(req)) return;
  let body;
  try { body = await req.json(); } catch { return; }
  const targetRecords = Number(body?.target_records) || 25;

  const apiKey = env('OPENAI_API_KEY');
  const job = await ensureJob({
    jobId: EXTRACTION_JOB_ID,
    jobName: 'Command Center Contract Extraction',
    sourcePlatform: 'NATCORP_SITE_EXTRACTION_NORMALIZE_PROMOTE_EXPLAIN',
  });
  if (!job) return;

  if (!apiKey) {
    await updateJob(EXTRACTION_JOB_ID, { job_status: 'FAILED', last_error: 'OPENAI_API_KEY is not configured.', last_failure_at: new Date().toISOString() });
    return;
  }

  try {
    await updateJob(EXTRACTION_JOB_ID, { job_status: 'RUNNING', last_started_at: new Date().toISOString(), last_error: null });
    const summary = await runExtractionBatch({
      apiKey, limit: targetRecords,
      onProgress: async (progress) => updateJob(EXTRACTION_JOB_ID, {
        last_records_discovered: progress.totalEligible,
        last_records_inserted: progress.succeeded,
        last_records_failed: progress.failed,
      }),
    });
    await updateJob(EXTRACTION_JOB_ID, {
      job_status: 'COMPLETED',
      last_records_discovered: summary.totalEligible,
      last_records_inserted: summary.succeeded,
      last_records_failed: summary.failed,
      last_completed_at: new Date().toISOString(),
      last_success_at: new Date().toISOString(),
      consecutive_failures: 0,
    });
  } catch (error) {
    await updateJob(EXTRACTION_JOB_ID, {
      job_status: 'FAILED',
      last_completed_at: new Date().toISOString(),
      last_failure_at: new Date().toISOString(),
      last_error: error instanceof Error ? error.message : 'Extraction run failed.',
    }).catch(() => {});
  }
}
