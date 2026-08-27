import { commandAuthorized, internalAuthorized, json, sameOrigin } from './_shared/natcorp-db.mjs';
import { compareLegacyAndAdmittedCounts, listCurrentDeliveries, recordShadowComparison } from './_shared/admitted-contract-control.mjs';

export default async function handler(req) {
  if (req.method !== 'GET' && req.method !== 'POST') return json(405, { ok: false, error: 'GET or POST only' });
  if (!sameOrigin(req) && !internalAuthorized(req) && !commandAuthorized(req)) {
    return json(403, { ok: false, error: 'Authorized NAT-CORP access required.' });
  }

  let body = {};
  if (req.method === 'POST') {
    try { body = await req.json(); }
    catch { return json(400, { ok: false, error: 'Invalid JSON request.' }); }
  }

  try {
    const url = new URL(req.url);
    const businessProfileId = body.business_profile_id || url.searchParams.get('business_profile_id') || null;
    const limit = body.limit || url.searchParams.get('limit') || 250;
    const [deliveries, comparison] = await Promise.all([
      listCurrentDeliveries({ businessProfileId, limit }),
      compareLegacyAndAdmittedCounts(),
    ]);
    const result = {
      ok: true,
      mode: 'shadow',
      customer_cutover: false,
      deliveries,
      comparison,
      generated_at: new Date().toISOString(),
    };
    await recordShadowComparison({ ...comparison, business_profile_id: businessProfileId, generated_at: result.generated_at });
    return json(200, result);
  } catch (error) {
    return json(503, {
      ok: false,
      mode: 'shadow',
      customer_cutover: false,
      code: 'ADMITTED_DELIVERY_SHADOW_ERROR',
      error: String(error?.message || error).slice(0, 700),
    });
  }
}

export const config = {
  path: '/api/natcorp-admitted-delivery-shadow',
  rateLimit: {
    windowLimit: 20,
    windowSize: 60,
    aggregateBy: ['ip', 'domain'],
  },
};
