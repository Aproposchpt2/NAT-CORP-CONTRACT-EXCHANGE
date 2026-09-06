// Stage 3 (Taxonomy Classification) background worker. "-background" suffix
// required for Netlify's async execution budget (batch OpenAI calls).
//
// Ported from APROPOS-CONTRACT-BRIEF's natcorp-taxonomy-run-background.mjs.
import { env, commandAuthorized } from './_shared/natcorp-db.mjs';
import { runTaxonomyBatch } from './_shared/command-center-taxonomy.mjs';
import { ensureJob, updateJob, TAXONOMY_JOB_ID } from './_shared/command-center-jobs.mjs';

export default async function handler(req) {
  if (!commandAuthorized(req)) return;
  let body;
  try { body = await req.json(); } catch { return; }
  const limit = Number(body?.limit) || 25;
  const force = body?.force === true;

  const apiKey = env('OPENAI_API_KEY');
  const job = await ensureJob({
    jobId: TAXONOMY_JOB_ID,
    jobName: 'Command Center Taxonomy Classification',
    sourcePlatform: 'NATCORP_SITE_TAXONOMY_CLASSIFICATION',
  });
  if (!job) return;

  if (!apiKey) {
    await updateJob(TAXONOMY_JOB_ID, { job_status: 'failed', last_error: 'OPENAI_API_KEY is not configured.', last_failure_at: new Date().toISOString() });
    return;
  }

  try {
    await updateJob(TAXONOMY_JOB_ID, { job_status: 'running', last_started_at: new Date().toISOString(), last_error: null });
    const summary = await runTaxonomyBatch({
      apiKey, limit, force,
      onProgress: async (progress) => updateJob(TAXONOMY_JOB_ID, {
        last_records_discovered: progress.totalEligible,
        last_records_inserted: progress.succeeded,
        last_records_failed: progress.failed,
      }),
    });
    await updateJob(TAXONOMY_JOB_ID, {
      job_status: 'healthy',
      last_records_discovered: summary.totalEligible,
      last_records_inserted: summary.succeeded,
      last_records_failed: summary.failed,
      last_completed_at: new Date().toISOString(),
      last_success_at: new Date().toISOString(),
      last_error: summary.taxonomy_capability_count === 0
        ? 'Classified with industry labels only -- aoie_taxonomy_capabilities is currently empty, so no records could be linked to a taxonomy capability yet.'
        : null,
      consecutive_failures: 0,
    });
  } catch (error) {
    await updateJob(TAXONOMY_JOB_ID, {
      job_status: 'failed',
      last_completed_at: new Date().toISOString(),
      last_failure_at: new Date().toISOString(),
      last_error: error instanceof Error ? error.message : 'Taxonomy classification run failed.',
    }).catch(() => {});
  }
}
