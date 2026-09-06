// Orchestrates a STATE_PUBLISHER_DEFINED run across its child publisher scopes.
// Cost control is enforced here: every child scope receives exactly one OpenAI
// Responses API discovery call per owner-triggered run.
import { runOneCallOpenAIDiscovery } from './command-center-openai-discovery-one-call.mjs';

function coverageEntry(child) {
  return {
    scope_id: child.id,
    family: child.vendor_name || child.platform || child.name,
    source_name: child.name,
    scope_type: child.scope_type,
    assigned_entities: (child.publishers || []).map((p) => ({ id: p.id, name: p.name })),
    assigned_entity_count: (child.publishers || []).length,
    status: 'PENDING',
    started_at: null,
    completed_at: null,
    listed: 0,
    qualified: 0,
    created: 0,
    updated: 0,
    rejected: 0,
    error: null,
  };
}

export async function runStatePublisherDefinedDiscovery({ scope, target = 50, runId, onProgress = async () => {} } = {}) {
  if (scope?.scope_type !== 'STATE_PUBLISHER_DEFINED' || !scope?.child_scopes?.length) throw new Error('STATE_PUBLISHER_DEFINED_SCOPE_REQUIRED');

  const totals = { totalListed: 0, processed: 0, created: 0, updated: 0, failed: 0 };
  const coverageExecution = scope.child_scopes.map(coverageEntry);
  const emit = async (extra = {}) => onProgress({ ...totals, coverage_execution: coverageExecution, ...extra });
  await emit({ current_publisher: `${scope.state} Publisher Defined`, current_family: null });

  // State Publisher Defined is a coverage-exhaustion run. The configured target is
  // retained as the per-family acquisition ceiling, but reaching it in one family
  // does not stop the remaining validated publishing families.
  for (let index = 0; index < scope.child_scopes.length; index += 1) {
    const child = scope.child_scopes[index];
    const evidence = coverageExecution[index];
    const base = { ...totals };
    const familyName = child.vendor_name || child.platform || child.name;
    evidence.status = 'SEARCHING';
    evidence.started_at = new Date().toISOString();
    await emit({ current_publisher: child.name, current_family: familyName });
    try {
      const summary = await runOneCallOpenAIDiscovery({
        scope: child,
        target,
        runId,
        stateName: scope.state,
        onProgress: async (progress) => {
          totals.totalListed = base.totalListed + Number(progress.totalListed || 0);
          totals.processed = base.processed + Number(progress.processed || 0);
          totals.created = base.created + Number(progress.created || 0);
          totals.updated = base.updated + Number(progress.updated || 0);
          totals.failed = base.failed + Number(progress.failed || 0);
          evidence.listed = Number(progress.totalListed || 0);
          evidence.qualified = Number(progress.processed || 0);
          evidence.created = Number(progress.created || 0);
          evidence.updated = Number(progress.updated || 0);
          evidence.rejected = Number(progress.failed || 0);
          await emit({ current_publisher: child.name, current_family: familyName });
        },
      });
      totals.totalListed = base.totalListed + Number(summary.totalListed || 0);
      totals.processed = base.processed + Number(summary.processed || 0);
      totals.created = base.created + Number(summary.created || 0);
      totals.updated = base.updated + Number(summary.updated || 0);
      totals.failed = base.failed + Number(summary.failed || 0);
      evidence.listed = Number(summary.totalListed || 0);
      evidence.qualified = Number(summary.processed || 0);
      evidence.created = Number(summary.created || 0);
      evidence.updated = Number(summary.updated || 0);
      evidence.rejected = Number(summary.failed || 0);
      evidence.status = 'SEARCHED';
    } catch (error) {
      totals.failed += 1;
      evidence.status = 'SOURCE_ERROR_CONTINUED';
      evidence.error = error instanceof Error ? error.message.slice(0, 500) : String(error || 'Unknown source error').slice(0, 500);
      console.error(`[command-center-publisher-runner] ${child.id} failed; continuing state coverage:`, evidence.error);
    }
    evidence.completed_at = new Date().toISOString();
    await emit({ current_publisher: child.name, current_family: familyName });
  }

  return { ...totals, coverageExecution };
}
