import {
  DIRECT_TABLE, buildRegistryIndex, enrichOpportunity, expandBusinessProfile,
  publicOpportunity,
} from './_shared/aoie-state-local.mjs';
import { db, env } from './_shared/natcorp-db.mjs';
import {
  authenticate, availableStates, candidateRows, fetchRegistry,
  normalizeStates, resolveProfile,
} from './_shared/aoie-candidates.mjs';
import { profileFingerprint } from './_shared/aoie-llm-relevance.mjs';

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
const LLM_ENGINE_VERSION = 'aoie_llm_relevance_v1';

async function latestJobFor(fingerprint, states) {
  const rows = await db(
    'aoie_llm_relevance_jobs', 'GET',
    `?profile_fingerprint=eq.${encodeURIComponent(fingerprint)}&order=created_at.desc&limit=10&select=*`,
  );
  const sortedStates = [...states].sort().join(',');
  return (rows || []).find((row) => [...(row.states || [])].sort().join(',') === sortedStates) || (rows || [])[0] || null;
}

async function relevantVerdicts(fingerprint) {
  const rows = await db(
    'aoie_llm_relevance_verdicts', 'GET',
    `?profile_fingerprint=eq.${encodeURIComponent(fingerprint)}&relevant=eq.true&select=*`,
  );
  return rows || [];
}

export default async function handler(req) {
  if (req.method !== 'POST') return json(405, { error: 'POST only' });
  const url = env('SUPABASE_URL').replace(/\/$/, '');
  const key = env('SUPABASE_SERVICE_ROLE_KEY') || env('SUPABASE_SERVICE_KEY');
  if (!url || !key) return json(500, { error: 'AOIE database configuration missing.' });
  try {
    const auth = authenticate(req);
    if (!auth) return json(401, { error: 'Same-origin NAT-CORP access or an authorized internal request is required.' });
    let payload;
    try { payload = await req.json(); } catch { return json(400, { error: 'Invalid JSON.' }); }

    const requestedStates = normalizeStates(payload.states);
    // A poll tick (the dashboard checking judging progress every few seconds
    // while aoie-llm-relevance-run works through candidates) reuses the exact
    // state scope its own initial, non-poll call already resolved -- state
    // inventory doesn't change mid-judge, so re-running availableStates() on
    // every tick is pure waste. Added 2026-08-24 after a real Supabase
    // call-volume scare (1.8M calls/month on a different project) made this
    // worth trimming before it became this project's problem too.
    const isPoll = payload.poll === true && requestedStates.length > 0;

    // resolveProfile() and availableStates() share no dependency on each
    // other -- they were running back-to-back for no reason, one full
    // sequential network round trip apiece. Run them concurrently instead.
    // (availableStates() is skipped outright for a poll tick, same as
    // before -- states are already known, see the comment above.) Confirmed
    // live 2026-08-28: this endpoint's own SQL runs in single-digit
    // milliseconds (EXPLAIN ANALYZE), so an 8-11s response was entirely
    // this kind of unnecessary stage-by-stage network round-tripping, not
    // a slow query -- per Jeff: "The site rendering contracts so slow."
    const [resolved, inventoryStatesResult] = await Promise.all([
      resolveProfile(req, payload || {}, auth.mode),
      isPoll ? Promise.resolve(null) : availableStates(url, key),
    ]);
    if (!resolved.profile) return json(401, { error: 'A verified Business Capability Profile is required.' });
    const profile = expandBusinessProfile({ ...resolved.profile, service_states: [] });
    const evidence = profile.keywords.length || profile.naics_codes.length || profile.unspsc_codes.length || profile.commodity_codes.length || profile.concepts.length;
    if (!profile.legal_name) return json(400, { error: 'A business name is required.' });
    if (!evidence) return json(400, { error: 'The verified profile does not contain enough capability evidence to search contracts.' });

    const scope = String(payload.scope || (requestedStates.length ? 'selected' : 'all')).toLowerCase();
    const residentState = String(payload.resident_state || resolved.profile.resident_state || resolved.session?.resident_state || '').trim().toUpperCase();

    let inventoryStates, states;
    if (isPoll) {
      inventoryStates = requestedStates;
      states = requestedStates;
    } else {
      inventoryStates = inventoryStatesResult;
      states = inventoryStates;
      if (scope === 'resident') {
        if (!/^[A-Z]{2}$/.test(residentState)) return json(400, { error: 'Resident state is unavailable. Verify it in the Business Capability Profile first.' });
        states = [residentState];
      } else if (requestedStates.length && scope !== 'all') states = requestedStates;
    }

    if (!states.length) return json(200, { ok: true, mode: 'shadow', scope, resident_state: residentState || null, states: [], profile, candidate_count: 0, result_count: 0, results: [], summary: {}, data_source: { relation: `public.${DIRECT_TABLE}`, mode: 'empty-inventory', retrieved_at: new Date().toISOString() } });

    const minimumScore = Math.max(0, Math.min(100, Number(payload.minimum_score ?? 35) || 35));
    const resultLimit = Math.max(1, Math.min(500, Number(payload.limit ?? 250) || 250));
    const nowIso = new Date().toISOString();
    const fingerprint = profileFingerprint(resolved.profile);

    // A non-poll request always needs the candidate pool + registry
    // regardless of verdicts (the old code ran this unconditionally via
    // `!isPoll || verdicts.length` short-circuiting on `!isPoll`), so
    // there's no real dependency between it and the job/verdicts lookup --
    // run all four together instead of two sequential Promise.all stages.
    // A poll tick keeps the original two-stage shape: skip the 4-call
    // candidate+registry fetch entirely until the first relevant verdict
    // actually lands, preserving the call-volume guard noted above.
    let job, verdicts, source, registry;
    if (!isPoll) {
      [job, verdicts, source, registry] = await Promise.all([
        latestJobFor(fingerprint, states), relevantVerdicts(fingerprint),
        candidateRows(url, key, states, nowIso), fetchRegistry(url, key, states),
      ]);
    } else {
      [job, verdicts] = await Promise.all([latestJobFor(fingerprint, states), relevantVerdicts(fingerprint)]);
      if (verdicts.length) {
        [source, registry] = await Promise.all([candidateRows(url, key, states, nowIso), fetchRegistry(url, key, states)]);
      } else {
        source = { rows: [], relation: DIRECT_TABLE, mode: 'poll-skipped-no-verdicts-yet' };
        registry = { publishers: [], publisherPlatforms: [], platforms: [], degraded: false, errors: [] };
      }
    }
    const index = buildRegistryIndex(registry);
    const candidates = source.rows.map((row) => enrichOpportunity(row, index, source.relation));
    const candidateById = new Map(candidates.map((row) => [row.id, row]));

    // Relevance is decided ONLY by cached LLM judgments (aoie_llm_relevance_verdicts) --
    // the keyword/ontology engine (aoie-state-scoring.mjs) was retired from this decision
    // path 2026-08-24 after repeatedly failing Jeff's manual real-data cross-check. A
    // candidate with no verdict yet simply isn't shown until aoie-llm-relevance-run has
    // judged it; the `judging` block below tells the dashboard whether that's still in
    // progress so it can show real progress instead of a false "no matches" state.
    const scored = verdicts
      .map((verdict) => {
        const row = candidateById.get(verdict.opportunity_id);
        if (!row) return null;
        const whyMatched = [verdict.reasoning, ...(verdict.evidence || []).map((e) => e.quote)].filter(Boolean);
        return {
          ...publicOpportunity(row),
          aoie: {
            engine_version: LLM_ENGINE_VERSION, model: verdict.model, fit_score: verdict.fit_score,
            match_status: verdict.tier, hard_disqualifier: null,
            explanation: { why_matched: whyMatched, concerns: verdict.concerns || [] },
            judged_at: verdict.judged_at,
          },
        };
      })
      .filter(Boolean);
    const results = scored
      .filter((row) => row.aoie.fit_score >= minimumScore)
      .sort((a, b) => b.aoie.fit_score - a.aoie.fit_score || String(a.response_deadline || '').localeCompare(String(b.response_deadline || '')))
      .slice(0, resultLimit);
    const summary = scored.reduce((acc, row) => {
      acc[row.aoie.match_status] = (acc[row.aoie.match_status] || 0) + 1;
      return acc;
    }, {});
    const judging = {
      status: job?.status || 'NOT_STARTED',
      total_candidates: job?.total_candidates ?? candidates.length,
      judged_candidates: job?.judged_candidates ?? 0,
      relevant_count: job?.relevant_count ?? 0,
      started_at: job?.started_at || null,
      completed_at: job?.completed_at || null,
      error_message: job?.error_message || null,
    };

    return json(200, {
      ok: true, mode: 'llm-relevance', authentication_mode: auth.mode, profile_source: resolved.source, scope,
      resident_state: residentState || null, engine_version: LLM_ENGINE_VERSION, states, inventory_states: inventoryStates,
      profile, source_candidate_count: candidates.length, candidate_count: judging.judged_candidates, excluded_candidate_count: 0,
      judging, release_rejection_summary: {}, result_count: results.length, minimum_score: minimumScore, summary,
      data_source: {
        // No canonical-view attempt-then-fallback dance anymore -- removed
        // 2026-08-28 after confirming aoie_opportunity_candidates_v1 never
        // existed in the database, so every request was paying for one
        // guaranteed-to-fail Supabase round trip before the real query ran.
        relation: `public.${source.relation}`, mode: source.mode,
        capability_first_search: true, resident_state_is_presentation_filter: true,
        latest_version_filter_applied: true, duplicate_filter_applied: true, normalized_status_filter_applied: true,
        deadline_current_or_open_ended_filter_applied: source.mode === 'direct-table',
        apie_package_complete_filter_applied: source.mode === 'direct-table',
        apie_requirements_complete_filter_applied: source.mode === 'direct-table',
        apie_match_ready_filter_applied: source.mode === 'direct-table',
        legacy_natcorp_qa_release_filter_applied: false, retrieved_at: nowIso,
      },
      registry: {
        degraded: registry.degraded,
        publishers_loaded: registry.publishers.length,
        publisher_platform_mappings_loaded: registry.publisherPlatforms.length,
        procurement_platforms_loaded: registry.platforms.length,
        opportunities_enriched: candidates.filter((row) => row.source_evidence?.registry_enriched).length,
      },
      results,
    });
  } catch (error) {
    console.error('[aoie-state-shadow]', error);
    return json(500, { error: 'AOIE state/local shadow evaluation failed.', detail: error instanceof Error ? error.message : String(error) });
  }
}

export const config = { path: '/api/aoie-state-shadow', rateLimit: { windowLimit: 30, windowSize: 60, aggregateBy: ['ip', 'domain'] } };
