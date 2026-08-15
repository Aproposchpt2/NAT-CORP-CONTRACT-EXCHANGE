import {
  ENGINE_VERSION, ONTOLOGY_VERSION, SCORING_VERSION, SOURCE_CONTRACT_VERSION,
  CANONICAL_VIEW, DIRECT_TABLE, buildCandidateQuery, buildRegistryIndex,
  enrichOpportunity, expandBusinessProfile, isMissingCanonicalRelation,
  publicOpportunity, scoreStateLocalMatch,
} from './_shared/aoie-state-local.mjs';
import { env } from './_shared/natcorp-db.mjs';
import { loadProfileSession } from './_shared/natcorp-profile-session.mjs';

const PAGE_SIZE = 1000;
const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
const dbHeaders = (key, extra = {}) => ({ apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json', ...extra });

function sameOrigin(req) {
  const target = new URL(req.url);
  const origin = req.headers.get('origin');
  const referer = req.headers.get('referer');
  const fetchSite = req.headers.get('sec-fetch-site');
  if (origin && origin !== target.origin) return false;
  if (referer) { try { if (new URL(referer).origin !== target.origin) return false; } catch { return false; } }
  if (fetchSite && !['same-origin', 'none'].includes(fetchSite)) return false;
  return origin === target.origin || Boolean(referer) || fetchSite === 'same-origin';
}

function authenticate(req) {
  const internal = env('AOIE_INTERNAL_TOKEN');
  if (internal && req.headers.get('x-aoie-token') === internal) return { mode: 'internal' };
  return sameOrigin(req) ? { mode: 'anonymous-same-origin' } : null;
}

function normalizeStates(value) {
  const raw = Array.isArray(value) ? value : String(value || '').split(/[,;\s]+/);
  return [...new Set(raw.map((v) => String(v || '').trim().toUpperCase()).filter((v) => /^[A-Z]{2}$/.test(v)))];
}

const DIRECT_SELECT = [
  'id','pdas_record_id','state_code','jurisdiction_type','jurisdiction_name','issuing_organization','issuing_department',
  'source_platform','source_record_id','source_url','official_source_url','vendor_registration_url','solicitation_number','title',
  'description','procurement_type','notice_type','status','posted_at','response_deadline','prebid_datetime','question_deadline',
  'place_of_performance_city','place_of_performance_county','place_of_performance_state','place_of_performance_zip',
  'estimated_value_min','estimated_value_max','currency','contact_name','contact_email','contact_phone','naics_codes','nigp_codes',
  'unspsc_codes','commodity_codes','set_asides','certifications_required','keywords','document_urls','classifications','requirements',
  'amendment_number','amendment_count','is_latest_version','duplicate_of','last_verified_at','data_quality_score','extraction_confidence',
  'qa_status','package_status','package_failed_count','requirements_extraction_status','match_readiness_status','lifecycle_status',
].join(',');

function directQuery(states, nowIso) {
  return new URLSearchParams({
    select: DIRECT_SELECT,
    state_code: `in.(${states.join(',')})`,
    is_latest_version: 'eq.true',
    duplicate_of: 'is.null',
    status: 'in.(open,upcoming,posted,active)',
    package_status: 'eq.PACKAGE_COMPLETE',
    package_failed_count: 'eq.0',
    requirements_extraction_status: 'eq.COMPLETE',
    match_readiness_status: 'eq.MATCH_READY',
    or: `(response_deadline.is.null,response_deadline.gte.${nowIso})`,
    order: 'response_deadline.asc.nullslast,posted_at.desc',
  });
}

async function fetchPaged(url, key, relation, states, nowIso, canonical) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const built = canonical
      ? buildCandidateQuery({ states, nowIso, canonical: true, from, pageSize: PAGE_SIZE })
      : { query: directQuery(states, nowIso), range: `${from}-${from + PAGE_SIZE - 1}` };
    const response = await fetch(`${url}/rest/v1/${relation}?${built.query}`, {
      headers: dbHeaders(key, { Range: built.range }), signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      const error = new Error(`${relation} query failed: ${response.status} ${body.slice(0, 240)}`);
      error.status = response.status; error.body = body; throw error;
    }
    const page = await response.json();
    if (!Array.isArray(page)) break;
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

async function availableStates(url, key) {
  const states = new Set();
  for (let from = 0; ; from += PAGE_SIZE) {
    const response = await fetch(`${url}/rest/v1/${DIRECT_TABLE}?select=state_code&order=state_code.asc`, {
      headers: dbHeaders(key, { Range: `${from}-${from + PAGE_SIZE - 1}` }), signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`State inventory query failed: ${response.status}`);
    const page = await response.json();
    if (!Array.isArray(page)) break;
    for (const row of page) {
      const code = String(row?.state_code || '').trim().toUpperCase();
      if (/^[A-Z]{2}$/.test(code)) states.add(code);
    }
    if (page.length < PAGE_SIZE) break;
  }
  return [...states].sort();
}

async function candidateRows(url, key, states, nowIso) {
  try {
    const rows = await fetchPaged(url, key, CANONICAL_VIEW, states, nowIso, true);
    return { rows, relation: CANONICAL_VIEW, mode: 'canonical-view', canonical_view_available: true, direct_table_fallback_used: false };
  } catch (error) {
    if (!isMissingCanonicalRelation(error.status, error.body || error.message)) throw error;
    return {
      rows: await fetchPaged(url, key, DIRECT_TABLE, states, nowIso, false),
      relation: DIRECT_TABLE, mode: 'direct-table-fallback', canonical_view_available: false, direct_table_fallback_used: true,
    };
  }
}

async function fetchJsonRows(url, key, relation, query) {
  const response = await fetch(`${url}/rest/v1/${relation}?${query}`, { headers: dbHeaders(key), signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`${relation} registry query failed: ${response.status}`);
  const rows = await response.json();
  return Array.isArray(rows) ? rows : [];
}

async function fetchRegistry(url, key, states) {
  const publishers = new URLSearchParams({
    select: 'publisher_id,state_code,organization_name,organization_type,jurisdiction_name,official_government_website,official_procurement_website,procurement_search_url,vendor_registration_url,registration_required,authentication_required,confidence_level,research_status,last_verified_at',
    research_status: 'eq.verified', limit: '5000',
  });
  if (states.length) publishers.set('state_code', `in.(${states.join(',')})`);
  const mappings = new URLSearchParams({
    select: 'publisher_id,platform_id,is_primary,platform_role,public_search_url,vendor_registration_url,registration_required,authentication_required,active,last_verified_at',
    active: 'eq.true', limit: '5000',
  });
  const platforms = new URLSearchParams({
    select: 'platform_id,platform_name,technology_vendor,public_search_url,vendor_registration_url,authentication_required,platform_status,last_verified_at',
    platform_status: 'eq.active', limit: '5000',
  });
  const [publisherRows, publisherPlatforms, platformRows] = await Promise.all([
    fetchJsonRows(url, key, 'pdas_publishers', publishers),
    fetchJsonRows(url, key, 'pdas_publisher_platforms', mappings),
    fetchJsonRows(url, key, 'pdas_procurement_platforms', platforms),
  ]);
  return { publishers: publisherRows, publisherPlatforms, platforms: platformRows };
}

async function resolveProfile(req, payload, authMode) {
  if (authMode === 'internal' && payload?.profile && typeof payload.profile === 'object') {
    return { profile: payload.profile, session: null, source: 'internal-request' };
  }
  const session = await loadProfileSession(req);
  if (!session || session.discovery_status !== 'verified' || !Object.keys(session.verified_profile || {}).length) {
    return { profile: null, session, source: 'session' };
  }
  return { profile: session.verified_profile, session, source: 'verified-session' };
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

    const inventoryStates = await availableStates(url, key);
    const requestedStates = normalizeStates(payload.states);
    const scope = String(payload.scope || (requestedStates.length ? 'selected' : 'all')).toLowerCase();
    const residentState = String(payload.resident_state || resolved.profile.resident_state || resolved.session?.resident_state || '').trim().toUpperCase();
    let states = inventoryStates;
    if (scope === 'resident') {
      if (!/^[A-Z]{2}$/.test(residentState)) return json(400, { error: 'Resident state is unavailable. Verify it in the Business Capability Profile first.' });
      states = [residentState];
    } else if (requestedStates.length && scope !== 'all') states = requestedStates;

    if (!states.length) return json(200, { ok: true, mode: 'shadow', scope, resident_state: residentState || null, states: [], profile, candidate_count: 0, result_count: 0, results: [], summary: {}, data_source: { relation: `public.${DIRECT_TABLE}`, mode: 'empty-inventory', retrieved_at: new Date().toISOString() } });

    const minimumScore = Math.max(0, Math.min(100, Number(payload.minimum_score ?? 35) || 35));
    const resultLimit = Math.max(1, Math.min(500, Number(payload.limit ?? 250) || 250));
    const nowIso = new Date().toISOString();
    const [source, registry] = await Promise.all([candidateRows(url, key, states, nowIso), fetchRegistry(url, key, states)]);
    const index = buildRegistryIndex(registry);
    const candidates = source.rows.map((row) => enrichOpportunity(row, index, source.relation));
    const scored = candidates.map((row) => ({ ...publicOpportunity(row), aoie: scoreStateLocalMatch(profile, row) }));
    const results = scored
      .filter((row) => row.aoie.fit_score >= minimumScore && row.aoie.match_status !== 'Not Recommended')
      .sort((a, b) => b.aoie.fit_score - a.aoie.fit_score || String(a.response_deadline || '').localeCompare(String(b.response_deadline || '')))
      .slice(0, resultLimit);
    const summary = scored.reduce((acc, row) => {
      acc[row.aoie.match_status] = (acc[row.aoie.match_status] || 0) + 1;
      if (row.aoie.hard_disqualifier) acc.disqualified = (acc.disqualified || 0) + 1;
      return acc;
    }, {});

    return json(200, {
      ok: true, mode: 'shadow', authentication_mode: auth.mode, profile_source: resolved.source, scope,
      resident_state: residentState || null, engine_version: ENGINE_VERSION, ontology_version: ONTOLOGY_VERSION,
      scoring_version: SCORING_VERSION, source_contract_version: SOURCE_CONTRACT_VERSION, states, inventory_states: inventoryStates,
      profile, source_candidate_count: candidates.length, candidate_count: candidates.length, excluded_candidate_count: 0,
      release_rejection_summary: {}, result_count: results.length, minimum_score: minimumScore, summary,
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
