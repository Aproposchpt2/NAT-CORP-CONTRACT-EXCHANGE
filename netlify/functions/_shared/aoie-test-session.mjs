import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

const encode = (value) => Buffer.from(value).toString('base64url');
const decode = (value) => Buffer.from(value, 'base64url').toString('utf8');
const sign = (secret, value) => createHmac('sha256', secret).update(value).digest('base64url');

export function issueAoieTestSession(secret, audience, ttlSeconds = 7200) {
  if (!secret) throw new Error('AOIE_SESSION_SECRET is not configured.');
  const now = Math.floor(Date.now() / 1000);
  const payload = encode(JSON.stringify({ typ: 'aoie-live-test', aud: audience, iat: now, exp: now + ttlSeconds, jti: randomUUID() }));
  return { token: `aoie_test.${payload}.${sign(secret, payload)}`, expires_at: new Date((now + ttlSeconds) * 1000).toISOString() };
}

export function verifyAoieTestSession(token, secret, audience, now = Math.floor(Date.now() / 1000)) {
  if (!secret || !token || !token.startsWith('aoie_test.')) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const expected = Buffer.from(sign(secret, parts[1]));
  const supplied = Buffer.from(parts[2]);
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
  let payload;
  try { payload = JSON.parse(decode(parts[1])); } catch { return null; }
  if (payload.typ !== 'aoie-live-test' || payload.aud !== audience || !payload.exp || payload.exp <= now) return null;
  return payload;
}

export function isSameSiteRequest(req) {
  const target = new URL(req.url);
  const origin = req.headers.get('origin');
  const referer = req.headers.get('referer');
  const fetchSite = req.headers.get('sec-fetch-site');
  if (origin && origin !== target.origin) return false;
  if (referer) {
    try { if (new URL(referer).origin !== target.origin) return false; } catch { return false; }
  }
  if (fetchSite && !['same-origin', 'same-site', 'none'].includes(fetchSite)) return false;
  return true;
}
