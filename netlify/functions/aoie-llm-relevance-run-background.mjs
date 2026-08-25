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

// Retries a Postgres-side "canceling statement due to statement timeout"
// (error 57014) or a transient network failure -- confirmed live
// 2026-08-25: the initial candidate/registry fetch failed this way,
// distinct from and in addition to the client-side AbortSignal timeouts
// already fixed in aoie-candidates.mjs. This is the database itself
// killing a slow query, which a longer client-side timeout can't fix --
// a short retry is the pragmatic mitigation for what looks like
// occasional load-dependent query-planner variance, not a deterministic
// bug in the query itself (the same query succeeds the great majority of
// the time, including from the interactive aoie-state-shadow.mjs path).
async function withRetry(fn, attempts = 3, baseDelayMs = 3000) {
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (i < attempts - 1) await new Promise((resolve) => setTimeout(resolve, baseDelayMs * (i + 1)));
    }
  }
  throw lastError;
}

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

// Every dashboard load calls the trigger endpoint -- confirmed live
// 2026-08-25 this was creating a brand-new ~98-candidate job on EVERY
// single reload, even when a COMPLETED job for the exact same profile
// already existed. That's real repeat API cost, and it meant the
// dashboard's "reviewed N, found none" completed message almost never
// actually surfaced -- a fresh reload immediately buried the completed
// job under a newer QUEUED one before the user could see it. Now checks
// QUEUED/RUNNING/COMPLETED (not just the in-flight statuses) -- only a
// FAILED (or nonexistent) prior job allows a fresh one to be created.
// Freshness windows, not "forever": a COMPLETED job older than this is
// treated as stale so the profile eventually gets re-checked against
// newly-added contracts, not frozen on a result from hours ago. A
// QUEUED/RUNNING job that hasn't updated_at in a while is treated as
// dead (e.g. an invocation that silently hung) rather than blocking new
// attempts indefinitely -- confirmed live 2026-08-25 a job could get
// stuck at 0 progress with no error and no further updates.
const COMPLETED_FRESH_MS = 6 * 60 * 60 * 1000; // 6 hours
const IN_FLIGHT_STALE_MS = 30 * 60 * 1000; // 30 minutes with no progress update = treat as dead

async function existingUsableJob(fingerprint, states) {
  const rows = await db(
    'aoie_llm_relevance_jobs', 'GET',
    `?profile_fingerprint=eq.${encodeURIComponent(fingerprint)}&status=in.(QUEUED,RUNNING,COMPLETED)&order=created_at.desc&limit=5&select=*`,
  );
  const sortedStates = [...states].sort().join(',');
  const match = (rows || []).find((row) => [...(row.states || [])].sort().join(',') === sortedStates);
  if (!match) return null;
  const now = Date.now();
  if (match.status === 'COMPLETED') {
    const age = now - new Date(match.completed_at || match.updated_at).getTime();
    return age <= COMPLETED_FRESH_MS ? match : null;
  }
  const sinceUpdate = now - new Date(match.updated_at || match.created_at).getTime();
  return sinceUpdate <= IN_FLIGHT_STALE_MS ? match : null;
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
  const [source, registry] = await withRetry(() => Promise.all([
    candidateRows(url, key, job.states, nowIsoValue),
    fetchRegistry(url, key, job.states),
  ]));
  const index = buildRegistryIndex(registry);
  const candidates = source.rows.map((row) => enrichOpportunity(row, index, source.relation));

  await db('aoie_llm_relevance_jobs', 'PATCH', `?id=eq.${encodeURIComponent(job.id)}`, {
    total_candidates: candidates.length, updated_at: nowIso(),
  }, 'return=minimal');

  // Concurrency history, all confirmed live 2026-08-25 against the same
  // 98-candidate Apropos Group LLC run:
  //   - Strictly sequential (original): 95/98 judged. Reliable, slow (~12
  //     min) -- long enough that the dashboard's poll loop used to give up
  //     before the job finished (separately fixed: poll cap raised, and a
  //     "still working" fallback added so it can no longer go silent).
  //   - CONCURRENCY=5, no retry: only 42/98 judged. A clear regression.
  //   - CONCURRENCY=2 + 3-attempt retry (2s/4s backoff): STILL only 42/98
  //     on one run, then 0/98 on the very next run. Retrying within a few
  //     seconds doesn't help if the real constraint is a PER-MINUTE rate
  //     limit on the Opus model -- a short backoff never actually clears
  //     it, so retries just fail the same way again.
  // Sequential is the only configuration that has actually proven
  // reliable tonight. Reverted to it. The real fix for a rate limit is
  // pacing (stay under it), not concurrency -- worth revisiting with
  // proper per-minute throttling if speed becomes a priority again, not
  // by re-adding concurrency and hoping retries paper over it.
  const CONCURRENCY = 1;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  async function judgeWithRetry(params, attempts = 3) {
    let lastError;
    for (let i = 0; i < attempts; i++) {
      try {
        return await judgeRelevance(params);
      } catch (error) {
        lastError = error;
        if (i < attempts - 1) await sleep(2000 * (i + 1));
      }
    }
    throw lastError;
  }
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
      const verdict = await judgeWithRetry({ apiKey, model: MODEL(), profile: job.profile_snapshot, opportunity });
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
  const existing = await existingUsableJob(fingerprint, states);
  if (existing) return; // already queued, in flight, or already completed for this exact profile+states -- don't duplicate work

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
