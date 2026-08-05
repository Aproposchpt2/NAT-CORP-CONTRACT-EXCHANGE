import { createHmac } from 'node:crypto';
import { db, env, json, sameOrigin } from './_shared/natcorp-db.mjs';

const emailOk = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
const codeFor = (email, window) => String(Number.parseInt(createHmac('sha256', env('SUPABASE_SERVICE_ROLE_KEY') || env('SUPABASE_SERVICE_KEY')).update(`${email}:${window}`).digest('hex').slice(0, 10), 16) % 1000000).padStart(6, '0');

export default async function handler(req) {
  if (req.method !== 'POST') return json(405, { ok: false });
  if (!sameOrigin(req)) return json(403, { ok: false });
  try {
    const body = await req.json();
    const email = String(body.email || '').trim().toLowerCase();
    if (!emailOk(email)) return json(400, { ok: false, error: 'Enter a valid email address.' });
    const entitlement = await db('product_entitlements', 'GET', `?product_code=eq.natcorp&customer_email=eq.${encodeURIComponent(email)}&status=in.(trialing,active)&select=id&limit=1`);
    const profile = await db('natcorp_business_intakes', 'GET', `?contact_email=eq.${encodeURIComponent(email)}&select=intake_id&order=submitted_at.desc.nullslast,created_at.desc&limit=1`);
    if (entitlement?.length && profile?.length && env('RESEND_API_KEY')) {
      const code = codeFor(email, Math.floor(Date.now() / 600000));
      await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${env('RESEND_API_KEY')}`, 'Content-Type': 'application/json' }, body: JSON.stringify({
        from: env('RESEND_FROM_EMAIL') || 'Apropos Group LLC <noreply@aproposgroupllc.com>', to: [email],
        subject: 'Your NAT-CORP member login code',
        html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:24px"><h2>National Corporate Contract Exchange</h2><p>Your secure member login code is:</p><p style="font-size:34px;font-weight:800;letter-spacing:.18em">${code}</p><p>This code expires in 10 minutes.</p></div>`,
      }) });
    }
    return json(200, { ok: true });
  } catch (error) {
    console.error('[member-login-request]', error);
    return json(200, { ok: true });
  }
}

export const config = { path: '/api/member-login-request' };