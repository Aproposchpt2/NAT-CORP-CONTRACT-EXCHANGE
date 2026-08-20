import { env, json, sameOrigin } from './_shared/natcorp-db.mjs';
import { loadProfileSession, publicProfileSession } from './_shared/natcorp-profile-session.mjs';

const safe = (v, n = 4000) => String(v ?? '').trim().slice(0, n);

function resendFrom() {
  const configured = env('RESEND_FROM_EMAIL') || 'jmitchell@aproposgroupllc.com';
  const match = configured.match(/<([^>]+)>/);
  const email = match?.[1] || configured;
  return `APROPOS GROUP LLC <${email}>`;
}

function ownerEmail() {
  return safe(env('NATCORP_OWNER_EMAIL') || env('NATCORP_INBOUND_EMAIL') || 'jmitchell@aproposgroupllc.com', 320);
}

export default async function handler(req) {
  if (!sameOrigin(req)) return json(403, { ok: false, error: 'Invalid request origin.' });
  if (req.method !== 'POST') return json(405, { ok: false, error: 'POST only.' });

  let payload;
  try { payload = await req.json(); } catch { return json(400, { ok: false, error: 'Invalid JSON.' }); }
  const comment = safe(payload?.comment, 4000);
  if (comment.length < 3) return json(400, { ok: false, error: 'Enter a comment before sending.' });

  // Optional context -- feedback works even if the visitor has no active
  // business-profile session, but attaches it when one exists so Jeff can
  // see which review this is about without asking.
  let context = null;
  try {
    const session = await loadProfileSession(req);
    if (session) context = publicProfileSession(session);
  } catch { /* feedback still sends without session context */ }

  const key = env('RESEND_API_KEY');
  if (key) {
    const lines = [
      'Advisor feedback received on NAT-CORP.',
      '',
      comment,
      '',
      '---',
      context ? `Business under review: ${context.business_name || 'Unavailable'}` : 'No active business-profile session at time of feedback.',
      context?.website ? `Website: ${context.website}` : null,
      context?.business_email ? `Contact on file: ${context.business_email}` : null,
    ].filter(Boolean).join('\n');

    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: resendFrom(),
        to: [ownerEmail()],
        subject: `Advisor feedback: ${context?.business_name || 'NAT-CORP review'}`,
        text: lines,
        tags: [{ name: 'service', value: 'natcorp-advisor-feedback' }],
      }),
      signal: AbortSignal.timeout(20000),
    }).catch((error) => console.error('[advisor-feedback] Resend send failed', error));
  }

  return json(200, { ok: true });
}

export const config = {
  path: '/api/advisor-feedback',
  rateLimit: { windowLimit: 10, windowSize: 60, aggregateBy: ['ip'] },
};
