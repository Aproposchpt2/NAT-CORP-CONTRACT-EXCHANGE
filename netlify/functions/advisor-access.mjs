import { env, json, sameOrigin } from './_shared/natcorp-db.mjs';

// Gates the "ADVISOR LOGIN" entry point (advisor-login.html) with a shared
// promo code, time-limited via ADVISOR_CODE_EXPIRES so access doesn't stay
// open indefinitely if the code gets shared beyond the intended reviewers.
// This does not gate welcome.html itself -- that page has no auth of its
// own today (confirmed 2026-08-20) -- it only gates the presented "front
// door" a reviewer is meant to use.
export default async function handler(req) {
  if (!sameOrigin(req)) return json(403, { ok: false, error: 'Invalid request origin.' });
  if (req.method !== 'POST') return json(405, { ok: false, error: 'POST only.' });

  const required = env('ADVISOR_PROMO_CODE');
  if (!required) return json(500, { ok: false, error: 'Advisor access is not configured.' });

  let payload;
  try { payload = await req.json(); } catch { return json(400, { ok: false, error: 'Invalid JSON.' }); }
  // Case-insensitive: a code like "AGUNLV" reads like something a reviewer
  // could easily type in lowercase or mixed case, which would otherwise
  // fail with no hint why.
  const supplied = String(payload?.code ?? '').trim().toUpperCase();

  const expiresRaw = env('ADVISOR_CODE_EXPIRES');
  if (expiresRaw) {
    const expires = new Date(expiresRaw);
    if (!Number.isNaN(expires.getTime()) && Date.now() > expires.getTime()) {
      return json(401, { ok: false, error: 'This access code has expired.' });
    }
  }

  if (supplied !== required.trim().toUpperCase()) return json(401, { ok: false, error: 'Incorrect access code.' });
  return json(200, { ok: true });
}

export const config = {
  path: '/api/advisor-access',
  rateLimit: { windowLimit: 20, windowSize: 60, aggregateBy: ['ip'] },
};
