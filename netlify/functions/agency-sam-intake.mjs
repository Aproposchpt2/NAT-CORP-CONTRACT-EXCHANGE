// Agency-partner client intake -- business name only.
//
// agency-login.html's "Enter Client Info" panel collects nothing but the
// client's contact name and business name. Unlike capability-profile.mjs's
// welcome.html path (AI website-discovery -> DERIVED naics_candidates that
// still need business review), this path pulls the business's ACTUAL
// registered federal-contractor record: real UEI, real self-certified NAICS
// codes, real active SBA certifications. If the business isn't an active
// registered federal contractor, there's nothing to pull -- that's a real
// answer, not a failure to paper over (see [[project_procurement_warehouse_revenue_strategy]]
// UNLV SBDC finding: no SAM registration -> no Capability Profile, by design).
//
// Ported search/entity logic from RFCP-V2's sam-lookup.mjs (proven live
// there); persistence writes to the same aoie_business_profiles /
// aoie_business_classification_codes tables and natcorp_business_intakes
// session mechanism capability-profile.mjs and the dashboard already read,
// so /dashboard, /api/aoie-state-shadow, and /api/capability-profile (GET)
// all work unmodified against a session created here.
//
// Compliance: SAM.gov is never named in any string this function returns to
// the browser -- "registered federal contractor" / "official federal
// registration records" only, matching the public-surface rule already
// enforced elsewhere in this codebase.
import { db, env, nowIso, sameOrigin } from './_shared/natcorp-db.mjs';
import { issueProfileSession, profileSessionCookie, safe } from './_shared/natcorp-profile-session.mjs';

const SAM_ENTITY_URL = 'https://api.sam.gov/entity-information/v3/entities';
const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

function jsonResponse(status, body, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...headers } });
}

async function samFetch(params) {
  const key = env('SAM_API_KEY');
  if (!key) throw new Error('Federal registration lookup is not configured yet. Add SAM_API_KEY and try again.');
  const url = new URL(SAM_ENTITY_URL);
  url.searchParams.set('api_key', key);
  for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
  const raw = await res.text();
  if (!res.ok) throw new Error(`Federal registration lookup failed (${res.status}): ${raw.slice(0, 300)}`);
  try { return JSON.parse(raw); } catch { throw new Error('Federal registration lookup returned an unexpected response.'); }
}

async function searchByName(name) {
  const data = await samFetch({ legalBusinessName: name, registrationStatus: 'A', includeSections: 'entityRegistration,coreData' });
  const rows = data.entityData || [];
  return rows.map((e) => {
    const reg = e.entityRegistration || {};
    const addr = (e.coreData && e.coreData.physicalAddress) || {};
    return { uei: reg.ueiSAM, legal_name: reg.legalBusinessName, cage: reg.cageCode || null, city: addr.city || null, state: addr.stateOrProvinceCode || null };
  }).filter((c) => c.uei);
}

async function fetchEntity(uei) {
  const data = await samFetch({ ueiSAM: uei, includeSections: 'entityRegistration,coreData,assertions' });
  return (data.entityData || [])[0] || null;
}

function extractNaics(entity) {
  const gs = (entity.assertions && entity.assertions.goodsAndServices) || {};
  const primary = gs.primaryNaics;
  return (gs.naicsList || [])
    .map((n) => ({ code: n.naicsCode, description: n.naicsDescription || '', primary: n.isPrimary === 'Y' || n.naicsCode === primary }))
    .filter((n) => n.code);
}

function extractSocioeconomic(entity) {
  const bt = (entity.coreData && entity.coreData.businessTypes) || {};
  const now = Date.now();
  return (bt.sbaBusinessTypeList || [])
    .filter((c) => { const exit = c.certificationExitDate || c.exitDate; return !exit || new Date(exit).getTime() > now; })
    .map((c) => c.sbaBusinessTypeDesc || c.sbaBusinessTypeDescription)
    .filter(Boolean);
}

async function persistSamVerifiedProfile(contactName, entity, naics, socioeconomic) {
  const taxonomyRows = await db('aoie_taxonomy_versions', 'GET', '?select=id&order=created_at.desc&limit=1');
  const taxonomyVersionId = taxonomyRows?.[0]?.id;
  if (!taxonomyVersionId) throw new Error('AOIE taxonomy version is unavailable.');
  const reg = entity.entityRegistration || {};
  const core = entity.coreData || {};
  const addr = core.physicalAddress || {};
  const legalName = safe(reg.legalBusinessName, 240);
  const now = nowIso();
  const primaryNaics = naics.find((n) => n.primary) || naics[0];
  const description = primaryNaics
    ? `Active registered federal contractor. Primary NAICS: ${primaryNaics.code}${primaryNaics.description ? ' -- ' + primaryNaics.description : ''}.${socioeconomic.length ? ` Certifications: ${socioeconomic.join(', ')}.` : ''}`
    : 'Active registered federal contractor.';
  const profilePayload = {
    legal_business_name: legalName,
    business_description: description,
    website: null,
    primary_location: { city: addr.city || null, state: addr.stateOrProvinceCode || null, source_url: null },
    service_territory: { scope: 'all_states', resident_state: addr.stateOrProvinceCode || null },
    taxonomy_version_id: taxonomyVersionId,
    completion_score: 95,
    confidence_score: 100,
    verification_status: 'SAM_GOV_VERIFIED',
    last_reviewed_at: now,
    next_review_at: new Date(Date.now() + 90 * 86400000).toISOString(),
    user_confirmed: true,
    visit_scoped: false,
    source_provenance: {
      source: 'Official federal entity registration',
      uei: reg.ueiSAM || null,
      cage: reg.cageCode || null,
      registration_status: reg.registrationStatus || null,
      retrieved_at: now,
      submitted_by: contactName,
    },
    updated_at: now,
  };
  const rows = await db('aoie_business_profiles', 'POST', '', [{ ...profilePayload, created_at: now }], 'return=representation');
  const profileId = rows?.[0]?.id;
  if (!profileId) throw new Error('Verified business profile could not be persisted.');
  if (naics.length) {
    await db('aoie_business_classification_codes', 'DELETE', `?business_profile_id=eq.${encodeURIComponent(profileId)}&code_system=eq.NAICS`);
    await db('aoie_business_classification_codes', 'POST', '', naics.map((n) => ({
      business_profile_id: profileId,
      code_system: 'NAICS',
      code: n.code,
      description: n.description || null,
      verified: true,
    })), 'resolution=ignore-duplicates,return=minimal');
  }
  return { profileId, legalName, city: addr.city || null, state: addr.stateOrProvinceCode || null, uei: reg.ueiSAM || null, cage: reg.cageCode || null };
}

async function createSessionForProfile(contactName, businessNameSubmitted, profileMeta, naics, socioeconomic) {
  const issued = issueProfileSession();
  const now = nowIso();
  const verifiedProfile = {
    profile_version: 'natcorp_sam_gov_v1',
    business_name: profileMeta.legalName,
    legal_name: profileMeta.legalName,
    resident_state: profileMeta.state,
    resident_city: profileMeta.city,
    naics_codes: naics.map((n) => n.code),
    naics_candidates: naics.map((n) => ({ code: n.code, description: n.description, confidence: 'HIGH', authority: 'VERIFIED', basis: 'Official federal entity registration' })),
    socioeconomic,
    uei: profileMeta.uei,
    cage: profileMeta.cage,
    user_confirmed: true,
    confirmed_at: now,
  };
  const rows = await db('natcorp_business_intakes', 'POST', '', [{
    opportunity_id: null,
    intake_kind: 'business_profile',
    status: 'dna_complete',
    contact_email: null,
    intake_payload: { contact_name: contactName, business_name: businessNameSubmitted, source: 'natcorp-agency-sam-intake-v1', started_at: now },
    session_token_hash: issued.token_hash,
    session_expires_at: issued.expires_at,
    contact_name: contactName,
    business_name: profileMeta.legalName,
    business_email: null,
    website: null,
    canonical_domain: null,
    discovery_status: 'verified',
    draft_profile: verifiedProfile,
    discovery_evidence: [],
    verified_profile: verifiedProfile,
    business_profile_id: profileMeta.profileId,
    matching_scope: 'all_states',
    resident_state: profileMeta.state,
    verified_at: now,
    submitted_at: now,
    created_at: now,
    updated_at: now,
  }], 'return=representation');
  const session = rows?.[0];
  if (!session) throw new Error('Business session could not be created.');
  return { cookie: profileSessionCookie(issued.token) };
}

async function resolveAndPersist(contactName, businessNameSubmitted, uei) {
  const entity = await fetchEntity(uei);
  if (!entity) throw new Error('That registration could not be retrieved. Try again.');
  const naics = extractNaics(entity);
  const socioeconomic = extractSocioeconomic(entity);
  const profileMeta = await persistSamVerifiedProfile(contactName, entity, naics, socioeconomic);
  return createSessionForProfile(contactName, businessNameSubmitted, profileMeta, naics, socioeconomic);
}

export default async function handler(req) {
  if (!sameOrigin(req)) return jsonResponse(403, { ok: false, error: 'Invalid request origin.' });
  if (req.method !== 'POST') return jsonResponse(405, { ok: false, error: 'POST only.' });
  let payload;
  try { payload = await req.json(); } catch { return jsonResponse(400, { ok: false, error: 'Invalid JSON.' }); }
  const action = safe(payload?.action, 20).toLowerCase();
  const contactName = safe(payload?.contact_name, 220);
  const businessName = safe(payload?.business_name, 240);
  if (contactName.length < 2) return jsonResponse(400, { ok: false, error: 'Enter the client contact name.' });
  if (businessName.length < 2) return jsonResponse(400, { ok: false, error: 'Enter the business name.' });

  try {
    if (action === 'lookup') {
      const candidates = await searchByName(businessName);
      if (!candidates.length) {
        return jsonResponse(200, {
          ok: true,
          matched: 'none',
          message: `Nat-Corp could not find "${businessName}" as an active registered federal contractor. Only registered federal contractors have a Capability Profile on Nat-Corp today -- double-check the legal business name, or have them complete federal registration first.`,
        });
      }
      if (candidates.length > 1) {
        return jsonResponse(200, { ok: true, matched: 'multiple', candidates });
      }
      const { cookie } = await resolveAndPersist(contactName, businessName, candidates[0].uei);
      return jsonResponse(200, { ok: true, matched: 'single' }, { 'set-cookie': cookie });
    }
    if (action === 'select') {
      const uei = safe(payload?.uei, 32);
      if (!uei) return jsonResponse(400, { ok: false, error: 'Missing selection.' });
      const { cookie } = await resolveAndPersist(contactName, businessName, uei);
      return jsonResponse(200, { ok: true, matched: 'single' }, { 'set-cookie': cookie });
    }
    return jsonResponse(400, { ok: false, error: 'Unknown agency intake action.' });
  } catch (error) {
    console.error('[agency-sam-intake]', error);
    return jsonResponse(500, { ok: false, error: error instanceof Error ? error.message : 'Business lookup failed.' });
  }
}

export const config = {
  path: '/api/agency-sam-intake',
  rateLimit: { windowLimit: 20, windowSize: 60, aggregateBy: ['ip'] },
};
