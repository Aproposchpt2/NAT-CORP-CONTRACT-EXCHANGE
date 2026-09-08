// Shared candidate-contract retrieval + request auth/profile-resolution
// helpers, extracted from aoie-state-shadow.mjs so the LLM relevance worker
// (aoie-llm-relevance-run-background.mjs) can query the exact same
// MATCH_READY candidate set through the exact same path, instead of a
// second, drift-prone copy of this logic.
//
// Used to attempt a canonical view (aoie_opportunity_candidates_v1) before
// falling back to this direct table on every single call -- removed
// 2026-08-28 after confirming live that view never existed in the
// database at all. Query state_contract_opportunities directly now.
import { DIRECT_TABLE } from './aoie-state-local.mjs';
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

export function normalizeOwnerIntakeId(value) {
  const raw = String(value || '').trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(raw) ? raw : '';
}

export function resolveOwnerAuthority(resolved, payload = {}, authMode = '') {
  if (authMode === 'internal') {
    const ownerIntakeId = normalizeOwnerIntakeId(payload?.owner_intake_id);
    return ownerIntakeId ? { owner_intake_id: ownerIntakeId, source: 'trusted-internal-request' } : null;
  }
  const ownerIntakeId = normalizeOwnerIntakeId(resolved?.session?.intake_id);
  return ownerIntakeId ? { owner_intake_id: ownerIntakeId, source: 'verified-session' } : null;
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

export async function fetchPaged(url, key, relation, states, nowIso) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const query = directQuery(states, nowIso);
    const range = `${from}-${from + PAGE_SIZE - 1}`;
    const response = await fetch(`${url}/rest/v1/${relation}?${query}`, {
      headers: dbHeaders(key, { Range: range }), signal: AbortSignal.timeout(60000),
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
  const rows = await fetchPaged(url, key, DIRECT_TABLE, states, nowIso);
  return { rows, relation: DIRECT_TABLE, mode: 'direct-table' };
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
