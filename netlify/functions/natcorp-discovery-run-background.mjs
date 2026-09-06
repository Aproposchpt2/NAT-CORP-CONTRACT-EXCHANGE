// Stage 1 (Contract Acquisition) background worker. Naming keeps the
// "-background" suffix Netlify requires to run this as an async background
// function (longer execution budget than a synchronous function) -- this loop
// can run up to 6 OpenAI passes per child scope across an entire state's
// publisher roster, which would time out a normal function.
//
// Ported from APROPOS-CONTRACT-BRIEF's natcorp-discovery-run-background.mjs.
import { commandAuthorized } from './_shared/natcorp-db.mjs';
import { getStatePublisherDefinedScope, listStatePublisherDefinedScopes } from './_shared/command-center-state-publisher-defined.mjs';
import { DISCOVERY_TARGET } from './_shared/command-center-publisher-registry.mjs';
import { runStatePublisherDefinedDiscovery } from './_shared/command-center-publisher-runner.mjs';
import { updateAcquisitionJob } from './_shared/command-center-acquisition.mjs';

export default async function handler(req) {
  if (!commandAuthorized(req)) return;
  let body;
  try { body = await req.json(); } catch { return; }
  const jobId = String(body?.job_id || '');
  const scope = getStatePublisherDefinedScope(body?.scope_id);
  if (!jobId || !scope) return;
  if (!listStatePublisherDefinedScopes().some((s) => s.id === scope.id)) return;

  try {
    await updateAcquisitionJob(jobId, {
      job_status: 'running',
      last_started_at: new Date().toISOString(),
      last_error: null,
    });

    const summary = await runStatePublisherDefinedDiscovery({
      scope,
      target: DISCOVERY_TARGET,
      onProgress: async (progress) => {
        await updateAcquisitionJob(jobId, {
          last_records_discovered: progress.totalListed,
          last_records_inserted: progress.created,
          last_records_updated: progress.updated,
          last_records_failed: progress.failed,
        });
      },
    });

    await updateAcquisitionJob(jobId, {
      job_status: 'healthy',
      last_records_discovered: summary.totalListed,
      last_records_inserted: summary.created,
      last_records_updated: summary.updated,
      last_records_failed: summary.failed,
      last_completed_at: new Date().toISOString(),
      last_success_at: new Date().toISOString(),
      consecutive_failures: 0,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 700) : 'Discovery run failed.';
    await updateAcquisitionJob(jobId, {
      job_status: 'failed',
      last_completed_at: new Date().toISOString(),
      last_failure_at: new Date().toISOString(),
      last_error: message,
    }).catch(() => {});
  }
}
