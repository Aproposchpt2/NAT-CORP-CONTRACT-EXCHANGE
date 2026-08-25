import { db, env, json, sameOrigin } from './_shared/natcorp-db.mjs';

// Gates the "ADVISOR LOGIN" entry point (advisor-login.html) and the
// agency-outreach entry point (agency-login.html) with shared promo codes,
// each independently time-limited via its own *_CODE_EXPIRES so access
// doesn't stay open indefinitely if a code gets shared beyond its intended
// audience. This does not gate welcome.html itself -- that page has no
// auth of its own today (confirmed 2026-08-20) -- it only gates the
// presented "front door" a given audience is meant to use.
//
// Two independent codes, added 2026-08-24 so the ACP agency-outreach
// campaign gets its own code (AGENCY_PROMO_CODE) without touching or
// expiring Albert's team's existing advisor code (ADVISOR_PROMO_CODE) --
// they must be able to change/expire on completely separate schedules.
function codeEntries() {
  return [
    { code: env('ADVISOR_PROMO_CODE'), expiresRaw: env('ADVISOR_CODE_EXPIRES') },
    { code: env('AGENCY_PROMO_CODE'), expiresRaw: env('AGENCY_CODE_EXPIRES') },
  ].filter((entry) => entry.code);
}

function isExpired(expiresRaw) {
  if (!expiresRaw) return false;
  const expires = new Date(expiresRaw);
  if (Number.isNaN(expires.getTime())) return false;
  return Date.now() > expires.getTime();
}

export default async function handler(req) {
  if (!sameOrigin(req)) return json(403, { ok: false, error: 'Invalid request origin.' });
  if (req.method !== 'POST') return json(405, { ok: false, error: 'POST only.' });

  const entries = codeEntries();
  if (!entries.length) return json(500, { ok: false, error: 'Access is not configured.' });

  let payload;
  try { payload = await req.json(); } catch { return json(400, { ok: false, error: 'Invalid JSON.' }); }
  // Case-insensitive: a code like "AGUNLV" or "AGENCY30" reads like
  // something typed in lowercase or mixed case, which would otherwise
  // fail with no hint why.
  const supplied = String(payload?.code ?? '').trim().toUpperCase();

  const matched = entries.find((entry) => entry.code.trim().toUpperCase() === supplied);
  if (!matched) return json(401, { ok: false, error: 'Incorrect access code.' });
  if (isExpired(matched.expiresRaw)) return json(401, { ok: false, error: 'This access code has expired.' });

  // Agency-login.html's 3-field form supplies name/agency_name; advisor-
  // login.html's single-field form doesn't, so this only ever logs
  // agency-flow redemptions -- Albert's team's usage is untracked here,
  // same as before. A logging failure must never block a valid login.
  const name = String(payload?.name ?? '').trim();
  const agencyName = String(payload?.agency_name ?? '').trim();
  if (name && agencyName) {
    await db('natcorp_agency_pilot_logins', 'POST', '', [{ name, agency_name: agencyName, code_used: supplied }], 'return=minimal').catch((error) => {
      console.error('[advisor-access] agency login-tracking insert failed', error);
    });
  }

  return json(200, { ok: true });
}

export const config = {
  path: '/api/advisor-access',
  rateLimit: { windowLimit: 20, windowSize: 60, aggregateBy: ['ip'] },
};
