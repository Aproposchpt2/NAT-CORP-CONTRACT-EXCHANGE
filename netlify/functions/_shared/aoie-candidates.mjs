// Shared candidate-contract retrieval + request auth/profile-resolution
// helpers, extracted from aoie-state-shadow.mjs so the LLM relevance worker
// (aoie-llm-relevance-run-background.mjs) can query the exact same
// MATCH_READY candidate set through the exact same canonical-view/
// direct-table-fallback path, instead of a second, drift-prone copy of this
// logic.
import {
  CANONICAL_VIEW, DIRECT_TABLE, buildCandidateQuery, isMissingCanonicalRelation,
} from './aoie-state-local.mjs';
import { env } from './natcorp-db.mjs';
import { loadProfileSession } from './natcorp-profile-session.mjs';

export const PAGE_SIZE = 1000;

export const dbHeaders = (key, extra = {}) => ({ apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json', ...extra });

export function sameOrigin(req) {
  const target = new URL(req.url);
  const origin = req.headers.get('origin');
  const referer = req.headers.get('referer');
  const fetchSite = req.headers.get('sec-fetch-site');
  if (origin && origin !== target.origin) return false;
  if (referer) { try { if (new URL(referer).origin !== target.origin) return false; } catch { return false; } }
  if (fetchSite && !['same-origin', 'none'].includes(fetchSite)) return false;
  return origin === target.origin || Boolean(referer) || fetchSite === 'same-origin';
}

export function authenticate(req) {
  const internal = env('AOIE_INTERNAL_TOKEN');
  if (internal && req.headers.get('x-aoie-token') === internal) return { mode: 'internal' };
  return sameOrigin(req) ? { mode: 'anonymous-same-origin' } : null;
}

export function normalizeStates(value) {
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
  'updated_at',
].join(',');

export function directQuery(states, nowIso) {
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

// Timeouts here were 20000/15000/15000 until 2026-08-25, when the LLM
// judging background worker (aoie-llm-relevance-run-background.mjs)
// repeatedly failed with "The operation was aborted due to timeout" at
// ~20.2-20.4s -- exactly fetchPaged's old 20000ms ceiling -- even though
// the identical query completed quickly seconds later when called
// synchronously from aoie-state-shadow.mjs. Background functions appear
// to have slower/colder outbound networking on this account than
// regular request-serving functions; raised across the board since the
// background worker has minutes of budget and the common case (a fast
// successful response) is unaffected either way.
export async function fetchPaged(url, key, relation, states, nowIso, canonical) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const built = canonical
      ? buildCandidateQuery({ states, nowIso, canonical: true, from, pageSize: PAGE_SIZE })
      : { query: directQuery(states, nowIso), range: `${from}-${from + PAGE_SIZE - 1}` };
    const response = await fetch(`${url}/rest/v1/${relation}?${built.query}`, {
      headers: dbHeaders(key, { Range: built.range }), signal: AbortSignal.timeout(60000),
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

export async function availableStates(url, key) {
  const states = new Set();
  for (let from = 0; ; from += PAGE_SIZE) {
    const response = await fetch(`${url}/rest/v1/${DIRECT_TABLE}?select=state_code&order=state_code.asc`, {
      headers: dbHeaders(key, { Range: `${from}-${from + PAGE_SIZE - 1}` }), signal: AbortSignal.timeout(45000),
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

export async function candidateRows(url, key, states, nowIso) {
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

export async function fetchJsonRows(url, key, relation, query) {
  const response = await fetch(`${url}/rest/v1/${relation}?${query}`, { headers: dbHeaders(key), signal: AbortSignal.timeout(45000) });
  if (!response.ok) throw new Error(`${relation} registry query failed: ${response.status}`);
  const rows = await response.json();
  return Array.isArray(rows) ? rows : [];
}

export async function fetchRegistry(url, key, states) {
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
  const registryResults = await Promise.allSettled([
    fetchJsonRows(url, key, 'pdas_publishers', publishers),
    fetchJsonRows(url, key, 'pdas_publisher_platforms', mappings),
    fetchJsonRows(url, key, 'pdas_procurement_platforms', platforms),
  ]);
  const rows = registryResults.map((result) => result.status === 'fulfilled' ? result.value : []);
  const errors = registryResults.flatMap((result) => result.status === 'rejected' ? [String(result.reason?.message || result.reason)] : []);
  return { publishers: rows[0], publisherPlatforms: rows[1], platforms: rows[2], degraded: errors.length > 0, errors };
}

export async function resolveProfile(req, payload, authMode) {
  if (authMode === 'internal' && payload?.profile && typeof payload.profile === 'object') {
    return { profile: payload.profile, session: null, source: 'internal-request' };
  }
  const session = await loadProfileSession(req);
  if (!session || session.discovery_status !== 'verified' || !Object.keys(session.verified_profile || {}).length) {
    return { profile: null, session, source: 'session' };
  }
  return { profile: session.verified_profile, session, source: 'verified-session' };
}
