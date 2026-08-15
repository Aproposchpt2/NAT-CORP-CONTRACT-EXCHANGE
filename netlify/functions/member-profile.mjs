import { db, json, sameOrigin } from './_shared/natcorp-db.mjs';

const emailOk = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
const safe = (value, max = 1000) => String(value ?? '').trim().slice(0, max);

export default async function handler(req) {
  if (req.method !== 'POST') return json(405, { ok: false, error: 'POST only' });
  if (!sameOrigin(req)) return json(403, { ok: false, error: 'Invalid request origin' });
  try {
    const { profile = {} } = await req.json();
    const email = String(profile.email || profile.contact_email || '').trim().toLowerCase();
    const businessName = safe(profile.business_name || profile.legal_name, 240);
    if (!emailOk(email) || !businessName) {
      return json(400, { ok: false, error: 'A valid email and business name are required.' });
    }
    const serviceStates = Array.isArray(profile.service_states) ? profile.service_states : [];
    const saved = { ...profile, email, contact_email: email, business_name: businessName };
    await db('natcorp_business_intakes', 'POST', '', [{
      opportunity_id: null,
      intake_kind: 'business_profile',
      status: 'submitted',
      contact_email: email,
      contact_name: safe(profile.contact_name, 220) || null,
      business_name: businessName,
      business_email: email,
      website: safe(profile.website, 700) || null,
      resident_state: safe(profile.state || serviceStates[0], 2).toUpperCase() || null,
      matching_scope: 'all_states',
      discovery_status: 'verified',
      intake_payload: saved,
      verified_profile: saved,
      verified_at: new Date().toISOString(),
      submitted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }], 'return=minimal');
    return json(200, { ok: true });
  } catch (error) {
    console.error('[member-profile]', error);
    return json(500, { ok: false, error: 'Your business profile could not be saved.' });
  }
}

export const config = { path: '/api/member-profile' };
