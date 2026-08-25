// LLM relevance judgment worker. Replaces scoreStateLocalMatch() as the
// actual pass/fail decision for contract matching -- see the migration
// comment in 20260824190000_aoie_llm_relevance_matching.sql and
// _shared/aoie-llm-relevance.mjs for why. This is a Netlify background
// function (the -background.mjs filename suffix is what makes Netlify
// return 202 immediately and let it run past the normal timeout): a POST
// here creates (or resumes) a judging job for the caller's verified
// business profile, then judges every MATCH_READY candidate contract in
// the requested states against it, one Claude call per contract, writing
// each verdict to aoie_llm_relevance_verdicts and updating
// aoie_llm_relevance_jobs progress as it goes so the dashboard's "Standby
// while we gather your matched contracts" message can show real progress
// instead of being cosmetic.
import { db, env, nowIso } from './_shared/natcorp-db.mjs';
import {
  authenticate, availableStates, candidateRows, fetchRegistry, normalizeStates, resolveProfile,
} from './_shared/aoie-candidates.mjs';
import { buildRegistryIndex, enrichOpportunity } from './_shared/aoie-state-local.mjs';
import { judgeRelevance, profileFingerprint } from './_shared/aoie-llm-relevance.mjs';

const MODEL = () => env('AOIE_LLM_RELEVANCE_MODEL') || 'claude-opus-5';

async function resolveStates(url, key, payload) {
  const inventoryStates = await availableStates(url, key);
  const requestedStates = normalizeStates(payload.states);
  const scope = String(payload.scope || (requestedStates.length ? 'selected' : 'all')).toLowerCase();
  if (scope === 'resident') {
    const residentState = String(payload.resident_state || '').trim().toUpperCase();
    return /^[A-Z]{2}$/.test(residentState) ? [residentState] : [];
  }
  if (requestedStates.length && scope !== 'all') return requestedStates;
  return inventoryStates;
}

async function existingActiveJob(fingerprint, states) {
  const rows = await db(
    'aoie_llm_relevance_jobs', 'GET',
    `?profile_fingerprint=eq.${encodeURIComponent(fingerprint)}&status=in.(QUEUED,RUNNING)&order=created_at.desc&limit=5&select=*`,
  );
  const sortedStates = [...states].sort().join(',');
  return (rows || []).find((row) => [...(row.states || [])].sort().join(',') === sortedStates) || null;
}

async function cachedVerdict(opportunityId, fingerprint) {
  const rows = await db(
    'aoie_llm_relevance_verdicts', 'GET',
    `?opportunity_id=eq.${encodeURIComponent(opportunityId)}&profile_fingerprint=eq.${encodeURIComponent(fingerprint)}&select=*&limit=1`,
  );
  return rows?.[0] || null;
}

async function writeVerdict(job, opportunity, verdict) {
  await db('aoie_llm_relevance_verdicts', 'POST', '', [{
    opportunity_id: opportunity.id,
    profile_fingerprint: job.profile_fingerprint,
    business_name: job.business_name,
    relevant: verdict.relevant,
    tier: verdict.tier,
    fit_score: verdict.fit_score,
    reasoning: verdict.reasoning,
    evidence: verdict.evidence,
    concerns: verdict.concerns,
    model: verdict.model,
    opportunity_updated_at: opportunity.updated_at || nowIso(),
    judged_at: verdict.judged_at,
  }], 'resolution=merge-duplicates,return=minimal');
}

async function judgeJob(job, apiKey) {
  const url = env('SUPABASE_URL').replace(/\/$/, '');
  const key = env('SUPABASE_SERVICE_ROLE_KEY') || env('SUPABASE_SERVICE_KEY');
  const nowIsoValue = new Date().toISOString();
  const [source, registry] = await Promise.all([
    candidateRows(url, key, job.states, nowIsoValue),
    fetchRegistry(url, key, job.states),
  ]);
  const index = buildRegistryIndex(registry);
  const candidates = source.rows.map((row) => enrichOpportunity(row, index, source.relation));

  await db('aoie_llm_relevance_jobs', 'PATCH', `?id=eq.${encodeURIComponent(job.id)}`, {
    total_candidates: candidates.length, updated_at: nowIso(),
  }, 'return=minimal');

  // Judging candidates one at a time (one Claude call each, ~5-10s apiece)
  // made a 98-candidate job take ~12 minutes real-world (confirmed live
  // 2026-08-25: Apropos Group LLC, 98 candidates, completed_at - started_at
  // ~= 12 min) -- long enough that the dashboard's own poll loop (capped
  // at 40 attempts * 6s = 4 min) gave up and stopped refreshing long
  // before the job actually finished, leaving the page stuck on stale
  // content with no error shown. Judging in concurrency-limited batches
  // instead of strictly sequentially cuts real time roughly in proportion
  // to the batch size. Progress is written once per BATCH, not once per
  // candidate, so concurrent writers within a batch never race each other
  // updating the same job row -- only one PATCH happens per batch, after
  // every promise in it has settled.
  const CONCURRENCY = 5;
  let judged = 0;
  let relevant = 0;
  for (let i = 0; i < candidates.length; i += CONCURRENCY) {
    const batch = candidates.slice(i, i + CONCURRENCY);
    const outcomes = await Promise.allSettled(batch.map(async (opportunity) => {
      // The canonical view (aoie_opportunity_candidates_v1) does not exist yet in
      // this project -- confirmed 2026-08-24 -- so every candidate today comes
      // through the direct-table fallback, which does carry updated_at (verified:
      // all 330 rows on state_contract_opportunities have it populated). If that
      // ever changes and a row shows up without updated_at, the Invalid Date
      // comparison below evaluates false and the candidate is simply re-judged
      // instead of a stale/incorrect verdict silently being trusted.
      const cached = await cachedVerdict(opportunity.id, job.profile_fingerprint);
      if (cached && opportunity.updated_at && new Date(cached.opportunity_updated_at) >= new Date(opportunity.updated_at)) {
        return cached;
      }
      const verdict = await judgeRelevance({ apiKey, model: MODEL(), profile: job.profile_snapshot, opportunity });
      await writeVerdict(job, opportunity, verdict);
      return verdict;
    }));
    for (let j = 0; j < outcomes.length; j++) {
      const outcome = outcomes[j];
      if (outcome.status === 'fulfilled') {
        judged += 1;
        if (outcome.value.relevant) relevant += 1;
      } else {
        // One bad contract (a malformed model response, a transient API
        // error) must not abort the whole job -- log and keep judging the
        // rest, the same way the shared candidate scoring never lets one
        // row's enrichment failure take down the batch.
        console.error('[aoie-llm-relevance-run] judgment failed for opportunity', batch[j].id, outcome.reason);
      }
    }
    await db('aoie_llm_relevance_jobs', 'PATCH', `?id=eq.${encodeURIComponent(job.id)}`, {
      judged_candidates: judged, relevant_count: relevant, updated_at: nowIso(),
    }, 'return=minimal').catch(() => {});
  }

  await db('aoie_llm_relevance_jobs', 'PATCH', `?id=eq.${encodeURIComponent(job.id)}`, {
    status: 'COMPLETED', judged_candidates: judged, relevant_count: relevant,
    completed_at: nowIso(), updated_at: nowIso(),
  }, 'return=minimal');
}

export default async function handler(req) {
  if (req.method !== 'POST') return;
  const auth = authenticate(req);
  if (!auth) return;
  const apiKey = env('ANTHROPIC_API_KEY');
  if (!apiKey) { console.error('[aoie-llm-relevance-run] ANTHROPIC_API_KEY is not configured.'); return; }

  const url = env('SUPABASE_URL').replace(/\/$/, '');
  const key = env('SUPABASE_SERVICE_ROLE_KEY') || env('SUPABASE_SERVICE_KEY');
  if (!url || !key) { console.error('[aoie-llm-relevance-run] AOIE database configuration missing.'); return; }

  let payload;
  try { payload = await req.json(); } catch { payload = {}; }

  const resolved = await resolveProfile(req, payload || {}, auth.mode);
  if (!resolved.profile) return;

  const states = await resolveStates(url, key, payload || {});
  if (!states.length) return;

  const fingerprint = profileFingerprint(resolved.profile);
  const existing = await existingActiveJob(fingerprint, states);
  if (existing) return; // already queued or in flight for this exact profile+states -- don't duplicate work

  const created = await db('aoie_llm_relevance_jobs', 'POST', '', [{
    profile_fingerprint: fingerprint,
    business_name: resolved.profile.business_name || null,
    states,
    status: 'QUEUED',
    profile_snapshot: resolved.profile,
  }], 'return=representation');
  const job = created?.[0];
  if (!job) return;

  const claimed = await db(
    'aoie_llm_relevance_jobs', 'PATCH', `?id=eq.${encodeURIComponent(job.id)}&status=eq.QUEUED`,
    { status: 'RUNNING', started_at: nowIso(), updated_at: nowIso() }, 'return=representation',
  );
  const running = claimed?.[0];
  if (!running) return;

  try {
    await judgeJob(running, apiKey);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'LLM relevance judging failed.';
    console.error('[aoie-llm-relevance-run]', error);
    await db('aoie_llm_relevance_jobs', 'PATCH', `?id=eq.${encodeURIComponent(running.id)}`, {
      status: 'FAILED', error_message: String(message).slice(0, 1200), updated_at: nowIso(),
    }, 'return=minimal').catch(() => {});
  }
}

export const config = {
  path: '/api/aoie-llm-relevance-run',
};
