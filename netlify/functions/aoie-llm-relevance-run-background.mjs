// OpenAI relevance judgment worker. OpenAI is NAT-CORP's sole active AI
// processing provider. A POST creates or resumes a judging job for the
// caller's verified business profile and judges MATCH_READY candidates.
import { db, env, nowIso } from './_shared/natcorp-db.mjs';
import {
  authenticate, availableStates, candidateRows, fetchRegistry, normalizeStates, resolveProfile,
} from './_shared/aoie-candidates.mjs';
import { buildRegistryIndex, enrichOpportunity } from './_shared/aoie-state-local.mjs';
import { judgeRelevance, profileFingerprint } from './_shared/aoie-llm-relevance.mjs';

async function withRetry(fn, attempts = 3, baseDelayMs = 3000) {
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); }
    catch (error) {
      lastError = error;
      if (i < attempts - 1) await new Promise((resolve) => setTimeout(resolve, baseDelayMs * (i + 1)));
    }
  }
  throw lastError;
}

const MODEL = () => env('AOIE_LLM_RELEVANCE_MODEL') || 'gpt-5-mini';

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

const COMPLETED_FRESH_MS = 6 * 60 * 60 * 1000;
const IN_FLIGHT_STALE_MS = 30 * 60 * 1000;

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
    // A completed job is reusable only when it truthfully judged every candidate.
    // Historical partial jobs must never suppress a corrective retry.
    if (Number(match.judged_candidates || 0) !== Number(match.total_candidates || 0)) return null;
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

  // Sequential processing remains the validated reliability setting. Cached
  // successful verdicts make a subsequent retry process only missing/stale rows.
  const CONCURRENCY = 1;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  async function judgeWithRetry(params, attempts = 3) {
    let lastError;
    for (let i = 0; i < attempts; i++) {
      try { return await judgeRelevance(params); }
      catch (error) {
        lastError = error;
        if (i < attempts - 1) await sleep(2000 * (i + 1));
      }
    }
    throw lastError;
  }

  let judged = 0;
  let relevant = 0;
  let lastFailureMessage = null;
  for (let i = 0; i < candidates.length; i += CONCURRENCY) {
    const batch = candidates.slice(i, i + CONCURRENCY);
    const outcomes = await Promise.allSettled(batch.map(async (opportunity) => {
      const cached = await cachedVerdict(opportunity.id, job.profile_fingerprint);
      if (cached && opportunity.updated_at && new Date(cached.opportunity_updated_at) >= new Date(opportunity.updated_at)) return cached;
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
        console.error('[aoie-llm-relevance-run] judgment failed for opportunity', batch[j].id, outcome.reason);
        lastFailureMessage = outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
      }
    }
    await db('aoie_llm_relevance_jobs', 'PATCH', `?id=eq.${encodeURIComponent(job.id)}`, {
      judged_candidates: judged, relevant_count: relevant, updated_at: nowIso(),
    }, 'return=minimal').catch(() => {});
  }

  if (judged !== candidates.length) {
    const failedCount = Math.max(0, candidates.length - judged);
    await db('aoie_llm_relevance_jobs', 'PATCH', `?id=eq.${encodeURIComponent(job.id)}`, {
      // FAILED is deliberate: the current customer dashboard already treats it as
      // non-final and a reload can safely create a retry job. Cached successful
      // verdicts mean the retry only spends model calls on missing/stale candidates.
      status: 'FAILED',
      error_message: `Partial contract review: ${judged}/${candidates.length} candidates judged; ${failedCount} require retry. Last error: ${String(lastFailureMessage || 'unknown').slice(0, 800)}`,
      judged_candidates: judged,
      relevant_count: relevant,
      updated_at: nowIso(),
    }, 'return=minimal');
    return;
  }

  await db('aoie_llm_relevance_jobs', 'PATCH', `?id=eq.${encodeURIComponent(job.id)}`, {
    status: 'COMPLETED', judged_candidates: judged, relevant_count: relevant,
    completed_at: nowIso(), updated_at: nowIso(), error_message: null,
  }, 'return=minimal');
}

export default async function handler(req) {
  if (req.method !== 'POST') return;
  const auth = authenticate(req);
  if (!auth) return;
  const apiKey = env('OPENAI_API_KEY');
  if (!apiKey) { console.error('[aoie-llm-relevance-run] OPENAI_API_KEY is not configured.'); return; }

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
  if (existing) return;

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

  try { await judgeJob(running, apiKey); }
  catch (error) {
    const message = error instanceof Error ? error.message : 'OpenAI relevance judging failed.';
    console.error('[aoie-llm-relevance-run]', error);
    await db('aoie_llm_relevance_jobs', 'PATCH', `?id=eq.${encodeURIComponent(running.id)}`, {
      status: 'FAILED', error_message: String(message).slice(0, 1200), updated_at: nowIso(),
    }, 'return=minimal').catch(() => {});
  }
}

export const config = { path: '/api/aoie-llm-relevance-run' };
