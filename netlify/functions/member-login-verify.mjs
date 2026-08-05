import { createHmac, timingSafeEqual } from 'node:crypto';
import { db, env, json, sameOrigin } from './_shared/natcorp-db.mjs';

const codeFor = (email, window) => String(Number.parseInt(createHmac('sha256', env('SUPABASE_SERVICE_ROLE_KEY') || env('SUPABASE_SERVICE_KEY')).update(`${email}:${window}`).digest('hex').slice(0, 10), 16) % 1000000).padStart(6, '0');
const equal = (a, b) => { const left = Buffer.from(String(a)); const right = Buffer.from(String(b)); return left.length === right.length && timingSafeEqual(left, right); };

export default async function handler(req) {
  if (req.method !== 'POST') return json(405, { ok: false, error: 'POST only' });
  if (!sameOrigin(req)) return json(403, { ok: false, error: 'Invalid request origin' });
  try {
    const body = await req.json();
    const email = String(body.email || '').trim().toLowerCase();
    const code = String(body.code || '').trim();
    const window = Math.floor(Date.now() / 600000);
    if (!/^\d{6}$/.test(code) || ![window, window - 1].some((value) => equal(code, codeFor(email, value)))) return json(401, { ok: false, error: 'Invalid or expired code.' });
    const entitlement = await db('product_entitlements', 'GET', `?product_code=eq.natcorp&customer_email=eq.${encodeURIComponent(email)}&status=in.(trialing,active)&select=id&limit=1`);
    if (!entitlement?.length) return json(403, { ok: false, error: 'No active NAT-CORP membership was found.' });
    const rows = await db('natcorp_business_intakes', 'GET', `?contact_email=eq.${encodeURIComponent(email)}&select=intake_payload&order=submitted_at.desc.nullslast,created_at.desc&limit=1`);
    const profile = rows?.[0]?.intake_payload;
    if (!profile?.business_name || !Array.isArray(profile?.service_states)) return json(404, { ok: false, error: 'No saved business profile was found. Complete Business Intake first.' });
    return json(200, { ok: true, profile });
  } catch (error) {
    console.error('[member-login-verify]', error);
    return json(500, { ok: false, error: 'Member login is temporarily unavailable.' });
  }
}

export const config = { path: '/api/member-login-verify' };