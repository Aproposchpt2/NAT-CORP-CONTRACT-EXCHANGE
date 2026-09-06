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
import { getJob } from './_shared/command-center-jobs.mjs';

function acquisitionScope(scopeId) {
  const id = String(scopeId || '').toUpperCase();
  const stateScope = getStatePublisherDefinedScope(id);
  if (stateScope) return stateScope;
  const california = getStatePublisherDefinedScope('CA_PUBLISHER_DEFINED');
  return california?.child_scopes?.find((scope) => scope.id === id) || null;
}

function executionScope(scope) {
  if (scope?.scope_type === 'STATE_PUBLISHER_DEFINED') return scope;
  return {
    ...scope,
    scope_type: 'STATE_PUBLISHER_DEFINED',
    child_scopes: [scope],
  };
}

function diagnosticReport({ jobId, scope, coverageExecution = [], totals = {}, completedAt = null, lastError = null } = {}) {
  const connectorErrors = coverageExecution.filter((entry) => entry?.status === 'SOURCE_ERROR_CONTINUED');
  return {
    report_version: 'natcorp_acquisition_error_report_v1',
    generated_at: new Date().toISOString(),
    completed_at: completedAt,
    job_id: jobId,
    state: scope?.state || null,
    state_code: scope?.state_code || null,
    scope_id: scope?.id || null,
    scope_name: scope?.name || null,
    source_platform: 'PUBLISHER_DIRECTED_OPENAI_WEB_SEARCH',
    target_records: DISCOVERY_TARGET,
    totals: {
      listed: Number(totals.totalListed || 0),
      processed: Number(totals.processed || 0),
      created: Number(totals.created || 0),
      updated: Number(totals.updated || 0),
      failed: Number(totals.failed || 0),
      connector_errors: connectorErrors.length,
    },
    coverage_execution: coverageExecution,
    last_error: lastError,
    historical_detail_available: true,
  };
}

export default async function handler(req) {
  if (!commandAuthorized(req)) return;
  let body;
  try { body = await req.json(); } catch { return; }
  const jobId = String(body?.job_id || '');
  const scope = acquisitionScope(body?.scope_id);
  if (!jobId || !scope) return;
  const selectable = listStatePublisherDefinedScopes().some((s) => s.id === scope.id)
    || getStatePublisherDefinedScope('CA_PUBLISHER_DEFINED')?.child_scopes?.some((s) => s.id === scope.id);
  if (!selectable) return;

  const existingJob = await getJob(jobId).catch(() => null);
  const baseConfiguration = existingJob?.configuration && typeof existingJob.configuration === 'object'
    ? existingJob.configuration
    : {};
  let latestCoverage = [];
  let latestTotals = { totalListed: 0, processed: 0, created: 0, updated: 0, failed: 0 };

  try {
    await updateAcquisitionJob(jobId, {
      job_status: 'running',
      last_started_at: new Date().toISOString(),
      last_error: null,
      configuration: {
        ...baseConfiguration,
        diagnostics: diagnosticReport({ jobId, scope, coverageExecution: [], totals: latestTotals }),
      },
    });

    const summary = await runStatePublisherDefinedDiscovery({
      scope: executionScope(scope),
      target: DISCOVERY_TARGET,
      onProgress: async (progress) => {
        latestCoverage = Array.isArray(progress.coverage_execution) ? progress.coverage_execution : latestCoverage;
        latestTotals = {
          totalListed: Number(progress.totalListed || 0),
          processed: Number(progress.processed || 0),
          created: Number(progress.created || 0),
          updated: Number(progress.updated || 0),
          failed: Number(progress.failed || 0),
        };
        await updateAcquisitionJob(jobId, {
          last_records_discovered: latestTotals.totalListed,
          last_records_inserted: latestTotals.created,
          last_records_updated: latestTotals.updated,
          last_records_failed: latestTotals.failed,
          configuration: {
            ...baseConfiguration,
            diagnostics: diagnosticReport({ jobId, scope, coverageExecution: latestCoverage, totals: latestTotals }),
          },
        });
      },
    });

    latestCoverage = Array.isArray(summary.coverageExecution) ? summary.coverageExecution : latestCoverage;
    latestTotals = {
      totalListed: Number(summary.totalListed || 0),
      processed: Number(summary.processed || 0),
      created: Number(summary.created || 0),
      updated: Number(summary.updated || 0),
      failed: Number(summary.failed || 0),
    };
    const connectorErrors = latestCoverage.filter((entry) => entry?.status === 'SOURCE_ERROR_CONTINUED').length;
    const completedAt = new Date().toISOString();
    const status = connectorErrors > 0 ? 'degraded' : 'healthy';
    const summaryError = connectorErrors > 0
      ? `${connectorErrors} publisher connector${connectorErrors === 1 ? '' : 's'} failed during acquisition coverage.`
      : null;

    await updateAcquisitionJob(jobId, {
      job_status: status,
      last_records_discovered: latestTotals.totalListed,
      last_records_inserted: latestTotals.created,
      last_records_updated: latestTotals.updated,
      last_records_failed: latestTotals.failed,
      last_completed_at: completedAt,
      last_success_at: connectorErrors === 0 ? completedAt : existingJob?.last_success_at || null,
      last_failure_at: connectorErrors > 0 ? completedAt : existingJob?.last_failure_at || null,
      consecutive_failures: connectorErrors > 0 ? Number(existingJob?.consecutive_failures || 0) + 1 : 0,
      last_error: summaryError,
      configuration: {
        ...baseConfiguration,
        diagnostics: diagnosticReport({
          jobId,
          scope,
          coverageExecution: latestCoverage,
          totals: latestTotals,
          completedAt,
          lastError: summaryError,
        }),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 700) : 'Discovery run failed.';
    const completedAt = new Date().toISOString();
    await updateAcquisitionJob(jobId, {
      job_status: 'failed',
      last_completed_at: completedAt,
      last_failure_at: completedAt,
      last_error: message,
      configuration: {
        ...baseConfiguration,
        diagnostics: diagnosticReport({
          jobId,
          scope,
          coverageExecution: latestCoverage,
          totals: latestTotals,
          completedAt,
          lastError: message,
        }),
      },
    }).catch(() => {});
  }
}
