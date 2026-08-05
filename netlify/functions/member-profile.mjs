import { db, json, sameOrigin } from './_shared/natcorp-db.mjs';

const emailOk = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());

export default async function handler(req) {
  if (req.method !== 'POST') return json(405, { ok: false, error: 'POST only' });
  if (!sameOrigin(req)) return json(403, { ok: false, error: 'Invalid request origin' });
  try {
    const { profile = {} } = await req.json();
    const email = String(profile.email || profile.contact_email || '').trim().toLowerCase();
    const businessName = String(profile.business_name || '').trim();
    if (!emailOk(email) || !businessName || !Array.isArray(profile.service_states)) {
      return json(400, { ok: false, error: 'A valid email and completed business profile are required.' });
    }
    const saved = { ...profile, email, contact_email: email, business_name: businessName };
    await db('natcorp_business_intakes', 'POST', '', [{
      status: 'submitted', contact_email: email, intake_payload: saved,
      submitted_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }], 'return=minimal');
    return json(200, { ok: true });
  } catch (error) {
    console.error('[member-profile]', error);
    return json(500, { ok: false, error: 'Your business profile could not be saved.' });
  }
}

export const config = { path: '/api/member-profile' };