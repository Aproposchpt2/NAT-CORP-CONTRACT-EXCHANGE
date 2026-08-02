import { db, json, commandAuthorized, sameOrigin } from './_shared/natcorp-db.mjs';

const safe = (v, n = 4000) => String(v ?? '').trim().slice(0, n);

export default async function handler(req) {
  if (!commandAuthorized(req)) return json(401, { ok: false, error: 'Opportunity-to-Fulfillment operator authorization required.' });
  if (req.method !== 'POST') return json(405, { ok: false, error: 'POST only.' });
  if (!sameOrigin(req)) return json(403, { ok: false, error: 'Same-origin request required.' });

  try {
    const body = await req.json();
    const outreachId = safe(body?.outreach_id, 100);
    const responseText = safe(body?.response_text, 4000) || null;
    if (!outreachId) throw new Error('outreach_id is required.');

    const rows = await db('natcorp_outreach_events', 'GET', `?outreach_id=eq.${encodeURIComponent(outreachId)}&select=*`);
    const outreach = rows?.[0];
    if (!outreach) throw new Error('Outreach event not found.');

    const updatedRows = await db('natcorp_outreach_events', 'PATCH', `?outreach_id=eq.${encodeURIComponent(outreachId)}`, {
      status: 'replied',
      response_class: 'INTERESTED',
      response_text: responseText,
      replied_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, 'return=representation');

    if (outreach.candidate_id) {
      await db('natcorp_business_discovery_candidates', 'PATCH', `?candidate_id=eq.${encodeURIComponent(outreach.candidate_id)}`, {
        verification_status: 'interested',
        updated_at: new Date().toISOString(),
      }, 'return=minimal');
    }

    const handoff = outreach.provider_payload?.owner_analyze_fit_prepared || outreach.provider_payload?.owner_analyze_fit_handoff || null;
    return json(200, {
      ok: true,
      response_class: 'INTERESTED',
      outreach: updatedRows?.[0] || null,
      handoff_prepared: Boolean(handoff?.client_url),
      owner_handoff: handoff ? {
        status: handoff.status || 'prepared',
        expires_at: handoff.expires_at || null,
      } : null,
    });
  } catch (error) {
    console.error('[otf-record-interest]', error);
    return json(500, { ok: false, error: safe(error?.message, 700) || 'Interested response could not be recorded.' });
  }
}

export const config = { path: '/api/otf-record-interest' };
