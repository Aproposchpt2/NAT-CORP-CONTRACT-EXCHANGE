import { createHash, randomBytes } from 'node:crypto';
import { db, env, json, commandAuthorized, sameOrigin } from './_shared/natcorp-db.mjs';
import { aproposLogoAttachment } from './lib/apropos-brand.mjs';

const PUBLIC_BASE = () => (env('NATCORP_PUBLIC_BASE_URL') || 'https://natcorp.aproposgroupllc.com').replace(/\/$/, '');
const safe = (v, n = 4000) => String(v ?? '').trim().slice(0, n);
const esc = (v) => safe(v).replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const sha256 = (v) => createHash('sha256').update(String(v)).digest('hex');

function resendFrom() {
  const configured = env('RESEND_FROM_EMAIL') || 'jmitchell@aproposgroupllc.com';
  const match = configured.match(/<([^>]+)>/);
  return `APROPOS GROUP LLC <${match?.[1] || configured}>`;
}

function ownerEmail() {
  return safe(env('NATCORP_OWNER_EMAIL') || env('NATCORP_INBOUND_EMAIL') || 'jmitchell@aproposgroupllc.com', 320);
}

async function loadContext(outreachId) {
  const rows = await db('natcorp_outreach_events', 'GET', `?outreach_id=eq.${encodeURIComponent(outreachId)}&select=*`);
  const outreach = rows?.[0];
  if (!outreach) throw new Error('Outreach event not found.');
  if (safe(outreach.status).toLowerCase() !== 'sent') throw new Error('Owner Analyze Fit preparation requires a successfully sent outreach email.');
  if (!outreach.candidate_id || !outreach.opportunity_id) throw new Error('Outreach is missing contractor or contract linkage.');

  const [candidateRows, opportunityRows] = await Promise.all([
    db('natcorp_business_discovery_candidates', 'GET', `?candidate_id=eq.${encodeURIComponent(outreach.candidate_id)}&select=*`),
    db('state_contract_opportunities', 'GET', `?id=eq.${encodeURIComponent(outreach.opportunity_id)}&select=id,pdas_record_id,title,issuing_organization,issuing_department,state_code,response_deadline,procurement_type,official_source_url,source_url,natcorp_contract_dna_status`),
  ]);
  const candidate = candidateRows?.[0];
  const opportunity = opportunityRows?.[0];
  if (!candidate) throw new Error('Contractor candidate could not be loaded.');
  if (!opportunity) throw new Error('Selected contract could not be loaded.');
  return { outreach, candidate, opportunity };
}

async function createHandoff(context) {
  const prior = context.outreach?.provider_payload?.owner_analyze_fit_prepared;
  if (prior?.status === 'sent' && prior?.client_url && prior?.request_id) return prior;

  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
  const metadata = {
    source: 'otf_send_outreach_owner_preparation',
    handoff_state: 'prepared_pending_interest',
    business_name: context.candidate.business_name,
    contact_name: context.candidate.contact_name || context.outreach.contact_name || null,
    contact_email: context.candidate.contact_email || context.outreach.contact_email || null,
    contact_phone: context.candidate.contact_phone || null,
    website: context.candidate.website || null,
    location: context.candidate.location || null,
    opportunity_reference: context.opportunity.pdas_record_id || context.opportunity.id,
    opportunity_title: context.opportunity.title,
    issuing_organization: context.opportunity.issuing_organization || context.opportunity.issuing_department || null,
    response_deadline: context.opportunity.response_deadline || null,
    opportunity_id: context.opportunity.id,
    candidate_id: context.candidate.candidate_id,
    outreach_id: context.outreach.outreach_id,
    capability_evidence: context.candidate.capability_evidence || [],
    qualification_evidence: context.candidate.qualification_evidence || [],
    past_performance_evidence: context.candidate.past_performance_evidence || [],
    contract_fit_notes: context.candidate.contract_fit_notes || [],
    gaps_or_unverified_items: context.candidate.gaps_or_unverified_items || [],
    analyze_fit_access_hash: sha256(token),
    analyze_fit_access_expires_at: expiresAt,
  };

  const rows = await db('natcorp_service_requests', 'POST', '', [{
    intake_id: null,
    opportunity_id: context.opportunity.id,
    business_profile_id: null,
    service_type: 'ANALYZE_FIT',
    status: 'requested',
    metadata,
  }], 'return=representation');
  const request = rows?.[0];
  if (!request) throw new Error('Analyze Fit service request could not be prepared.');

  return {
    status: 'created',
    request_id: request.request_id,
    client_url: `${PUBLIC_BASE()}/analyze-fit-request?request=${encodeURIComponent(request.request_id)}&token=${encodeURIComponent(token)}`,
    expires_at: expiresAt,
  };
}

async function emailOwner(context, handoff) {
  if (handoff.status === 'sent') return handoff;
  const key = env('RESEND_API_KEY');
  if (!key) throw new Error('RESEND_API_KEY is unavailable for the owner notification.');
  const to = ownerEmail();
  if (!to) throw new Error('NAT-CORP owner notification email is not configured.');

  const business = context.candidate.business_name || context.outreach.business_name || 'Contractor';
  const title = context.opportunity.title || 'Selected contract';
  const reference = context.opportunity.pdas_record_id || context.opportunity.id;
  const issuer = context.opportunity.issuing_organization || context.opportunity.issuing_department || 'Unavailable';
  const deadline = context.opportunity.response_deadline ? new Date(context.opportunity.response_deadline).toLocaleString('en-US') : 'Unavailable';

  const text = `NAT-CORP Outreach Sent — Analyze Fit Link Prepared\n\nThe contractor outreach email was sent successfully. Keep this link ready and forward it only after the contractor confirms interest.\n\nContractor: ${business}\nContact: ${context.candidate.contact_name || context.outreach.contact_name || 'Unavailable'}\nEmail: ${context.candidate.contact_email || context.outreach.contact_email || 'Unavailable'}\nPhone: ${context.candidate.contact_phone || 'Unavailable'}\n\nContract: ${title}\nReference: ${reference}\nIssuing organization: ${issuer}\nResponse deadline: ${deadline}\n\nClient-safe Analyze Fit URL:\n${handoff.client_url}`;

  const html = `<!doctype html><html><body style="margin:0;background:#f3f5f8;font-family:Arial,Helvetica,sans-serif;color:#14213d"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f5f8;padding:24px 12px"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:680px;background:#fff;border:1px solid #d9e0ea;border-radius:14px;overflow:hidden"><tr><td align="center" style="padding:26px 24px 12px"><img src="cid:apropos-group-logo" width="210" alt="APROPOS GROUP LLC" style="display:block;max-width:210px;width:100%;height:auto;border:0"></td></tr><tr><td style="padding:0 30px 30px;font-size:15px;line-height:1.55"><p style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#56709a;font-weight:700">NAT-CORP Owner Preparation</p><h1 style="font-family:Georgia,serif;color:#0d2a57;font-size:28px;line-height:1.15">Outreach sent. Analyze Fit link prepared.</h1><p>The contractor outreach email was sent successfully. Keep this link ready and forward it only after the contractor confirms interest.</p><p><strong>Contractor:</strong> ${esc(business)}<br><strong>Contact:</strong> ${esc(context.candidate.contact_name || context.outreach.contact_name || 'Unavailable')}<br><strong>Email:</strong> ${esc(context.candidate.contact_email || context.outreach.contact_email || 'Unavailable')}<br><strong>Phone:</strong> ${esc(context.candidate.contact_phone || 'Unavailable')}</p><p><strong>Contract:</strong> ${esc(title)}<br><strong>Reference:</strong> ${esc(reference)}<br><strong>Issuing organization:</strong> ${esc(issuer)}<br><strong>Response deadline:</strong> ${esc(deadline)}</p><p><a href="${handoff.client_url}" style="display:inline-block;background:#0d2a57;color:#fff;text-decoration:none;padding:13px 18px;border-radius:8px;font-weight:700">Open Prepared Analyze Fit Link</a></p><p style="font-size:12px;color:#66758a;word-break:break-all">${esc(handoff.client_url)}</p></td></tr></table></td></tr></table></body></html>`;

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: resendFrom(),
      to: [to],
      subject: `Outreach sent — Analyze Fit link prepared: ${business}`,
      text,
      html,
      attachments: [aproposLogoAttachment()],
      reply_to: to,
      tags: [
        { name: 'service', value: 'natcorp-owner-prep' },
        { name: 'outreach_id', value: context.outreach.outreach_id.replaceAll('-', '').slice(0, 32) },
      ],
    }),
    signal: AbortSignal.timeout(30000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Owner preparation email failed (${response.status}): ${data.message || 'unknown error'}`);

  const completed = { ...handoff, status: 'sent', owner_email: to, provider_message_id: data.id || null, sent_at: new Date().toISOString() };
  await db('natcorp_outreach_events', 'PATCH', `?outreach_id=eq.${encodeURIComponent(context.outreach.outreach_id)}`, {
    provider_payload: { ...(context.outreach.provider_payload || {}), owner_analyze_fit_prepared: completed },
    updated_at: new Date().toISOString(),
  }, 'return=minimal');
  return completed;
}

export default async function handler(req) {
  if (!commandAuthorized(req)) return json(401, { ok: false, error: 'Opportunity-to-Fulfillment operator authorization required.' });
  if (req.method !== 'POST') return json(405, { ok: false, error: 'POST only.' });
  if (!sameOrigin(req)) return json(403, { ok: false, error: 'Same-origin request required.' });
  try {
    const body = await req.json();
    const outreachId = safe(body?.outreach_id, 100);
    if (!outreachId) throw new Error('outreach_id is required.');
    const context = await loadContext(outreachId);
    const prepared = await createHandoff(context);
    const completed = await emailOwner(context, prepared);
    return json(200, { ok: true, handoff: completed });
  } catch (error) {
    console.error('[owner-analyze-fit-prep]', error);
    return json(500, { ok: false, error: safe(error?.message, 700) || 'Owner Analyze Fit preparation failed.' });
  }
}

export const config = { path: '/api/owner-analyze-fit-prep' };
