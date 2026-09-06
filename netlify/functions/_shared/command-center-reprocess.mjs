// "Reprocess" batch (Stage 3's Reprocess control, reused): targets pre-existing
// state_contract_opportunities records directly -- bypassing Stage 1 and the
// raw/normalized staging tables entirely -- running both the five-field
// explainer (Stage 2) and taxonomy classification (Stage 3) in one pass per
// record. Priority order: response_deadline IS NULL first, then oldest first.
//
// Ported from APROPOS-CONTRACT-BRIEF's natcorp-pipeline-reprocess.mjs, adapted
// to call db()/dbCount() directly from natcorp-db.mjs.
import { db, dbCount } from './natcorp-db.mjs';
import { explainOpportunity } from './command-center-extraction.mjs';
import { classifyOpportunity, persistClassification } from './command-center-taxonomy.mjs';

export async function runReprocessBatch({ apiKey, limit = 25, onProgress = async () => {} } = {}) {
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 25));
  // response_deadline IS NULL sorts first under nullsfirst ordering; PostgREST
  // defaults NULLS LAST for asc order, so request nullsfirst explicitly.
  const rows = (await db(
    'state_contract_opportunities', 'GET',
    `?status=eq.OPEN&select=id,title,description,issuing_organization,procurement_type,response_deadline,raw_source_payload&order=response_deadline.asc.nullsfirst,created_at.asc&limit=${safeLimit}`,
  )) || [];

  let succeeded = 0, failed = 0, deadlinesBackfilled = 0;
  const results = [];
  await onProgress({ totalEligible: rows.length, processed: 0, succeeded, failed });

  for (const opportunity of rows) {
    try {
      const explainerResult = await explainOpportunity(opportunity, { apiKey, backfillDeadline: true });
      if (explainerResult.deadline_backfilled) deadlinesBackfilled += 1;
      const classification = await classifyOpportunity(opportunity, { apiKey });
      await persistClassification(opportunity, classification);
      succeeded += 1;
      results.push({
        opportunity_id: opportunity.id,
        had_missing_deadline: !opportunity.response_deadline,
        deadline_backfilled: Boolean(explainerResult.deadline_backfilled),
        industry_label: classification.industry_label,
        confidence: classification.confidence,
      });
    } catch (error) {
      failed += 1;
      results.push({ opportunity_id: opportunity.id, error: error instanceof Error ? error.message : String(error) });
    }
    await onProgress({ totalEligible: rows.length, processed: succeeded + failed, succeeded, failed, deadlines_backfilled: deadlinesBackfilled });
  }

  return { totalEligible: rows.length, processed: rows.length, succeeded, failed, deadlines_backfilled: deadlinesBackfilled, results };
}

export async function reprocessCoverage() {
  const [missingDeadline, total] = await Promise.all([
    dbCount('state_contract_opportunities', '?response_deadline=is.null'),
    dbCount('state_contract_opportunities', ''),
  ]);
  return { missing_response_deadline: missingDeadline, total };
}
