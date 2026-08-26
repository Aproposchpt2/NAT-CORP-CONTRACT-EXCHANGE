import {
  DIRECT_TABLE, buildRegistryIndex, enrichOpportunity, expandBusinessProfile,
  publicOpportunity,
} from './_shared/aoie-state-local.mjs';
import { db, env } from './_shared/natcorp-db.mjs';
import {
  authenticate, availableStates, candidateRows, fetchRegistry,
  normalizeStates, resolveProfile,
} from './_shared/aoie-candidates.mjs';
import { profileFingerprint, RELEVANCE_ENGINE_VERSION } from './_shared/aoie-llm-relevance.mjs';

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
const LLM_ENGINE_VERSION = RELEVANCE_ENGINE_VERSION;

export function exactStateSetMatch(storedStates, requestedStates) {
  const stored = normalizeStates(storedStates).sort();
  const requested = normalizeStates(requestedStates).sort();
  if (!requested.length || stored.length !== requested.length) return false;
  return stored.every((state, index) => state === requested[index]);
}

async function latestJobFor(fingerprint, states) {
  const rows = await db(
    'aoie_llm_relevance_jobs', 'GET',
    `?profile_fingerprint=eq.${encodeURIComponent(fingerprint)}&order=created_at.desc&limit=10&select=*`,
  );
  return (rows || []).find((row) => exactStateSetMatch(row.states, states)) || null;
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

    const resolved = await resolveProfile(req, payload || {}, auth.mode);
    if (!resolved.profile) return json(401, { error: 'A verified Business Capability Profile is required.' });
    const profile = expandBusinessProfile({ ...resolved.profile, service_states: [] });
    const evidence = profile.keywords.length || profile.naics_codes.length || profile.unspsc_codes.length || profile.commodity_codes.length || profile.concepts.length;
    if (!profile.legal_name) return json(400, { error: 'A business name is required.' });
    if (!evidence) return json(400, { error: 'The verified profile does not contain enough capability evidence to search contracts.' });

    const requestedStates = normalizeStates(payload.states);
    const scope = String(payload.scope || (requestedStates.length ? 'selected' : 'all')).toLowerCase();
    const residentState = String(payload.resident_state || resolved.profile.resident_state || resolved.session?.resident_state || '').trim().toUpperCase();

    const isPoll = payload.poll === true && requestedStates.length > 0;
    let inventoryStates, states;
    if (isPoll) {
      inventoryStates = requestedStates;
      states = requestedStates;
    } else {
      inventoryStates = await availableStates(url, key);
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
    const [job, verdicts] = await Promise.all([latestJobFor(fingerprint, states), relevantVerdicts(fingerprint)]);

    let source, registry;
    if (!isPoll || verdicts.length) {
      [source, registry] = await Promise.all([candidateRows(url, key, states, nowIso), fetchRegistry(url, key, states)]);
    } else {
      source = { rows: [], relation: DIRECT_TABLE, mode: 'poll-skipped-no-verdicts-yet', canonical_view_available: false, direct_table_fallback_used: false };
      registry = { publishers: [], publisherPlatforms: [], platforms: [], degraded: false, errors: [] };
    }
    const index = buildRegistryIndex(registry);
    const candidates = source.rows.map((row) => enrichOpportunity(row, index, source.relation));
    const candidateById = new Map(candidates.map((row) => [row.id, row]));

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

    // CRITICAL CUSTOMER-TRUTH CONTROL:
    // If the background trigger has not yet created a durable job row for this
    // exact normalized geographic state set, report a synthetic QUEUED state
    // rather than borrowing completion truth from another scope. The dashboard
    // treats QUEUED/RUNNING as active and keeps polling.
    const judging = {
      status: job?.status || 'QUEUED',
      total_candidates: job?.total_candidates ?? candidates.length,
      judged_candidates: job?.judged_candidates ?? 0,
      relevant_count: job?.relevant_count ?? 0,
      started_at: job?.started_at || null,
      completed_at: job?.completed_at || null,
      error_message: job?.error_message || null,
      durable_job_created: Boolean(job),
    };

    return json(200, {
      ok: true, mode: 'llm-relevance', authentication_mode: auth.mode, profile_source: resolved.source, scope,
      resident_state: residentState || null, engine_version: LLM_ENGINE_VERSION, states, inventory_states: inventoryStates,
      profile, source_candidate_count: candidates.length, candidate_count: judging.judged_candidates, excluded_candidate_count: 0,
      judging, release_rejection_summary: {}, result_count: results.length, minimum_score: minimumScore, summary,
      data_source: {
        relation: `public.${source.relation}`, mode: source.mode, canonical_view_attempted: true,
        canonical_view_available: source.canonical_view_available, direct_table_fallback_used: source.direct_table_fallback_used,
        capability_first_search: true, resident_state_is_presentation_filter: true,
        latest_version_filter_applied: true, duplicate_filter_applied: true, normalized_status_filter_applied: true,
        deadline_current_or_open_ended_filter_applied: source.mode === 'direct-table-fallback',
        apie_package_complete_filter_applied: source.mode === 'direct-table-fallback',
        apie_requirements_complete_filter_applied: source.mode === 'direct-table-fallback',
        apie_match_ready_filter_applied: source.mode === 'direct-table-fallback',
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
