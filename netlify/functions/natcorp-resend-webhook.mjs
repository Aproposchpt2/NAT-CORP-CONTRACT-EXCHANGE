import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { db, env, json, rpc } from './_shared/natcorp-db.mjs';
import { aproposLogoAttachment } from './lib/apropos-brand.mjs';

const NATCORP_SITE_URL = 'https://natcorp.aproposgroupllc.com';
const INTERNAL_EMAIL = 'jmitchell@aproposgroupllc.com';
const safe = (v, n = 12000) => String(v ?? '').trim().slice(0, n);
const htmlEsc = (v) => safe(v).replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const sha256 = (v) => createHash('sha256').update(String(v)).digest('hex');

function validEmail(v) {
  const s = safe(v, 320);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : '';
}

function extractEmail(v) {
  const s = safe(v, 500);
  const m = s.match(/<([^>]+)>/);
  return safe(m ? m[1] : s, 320).toLowerCase();
}

function resendFrom() {
  const configured = env('RESEND_FROM_EMAIL') || INTERNAL_EMAIL;
  const match = configured.match(/<([^>]+)>/);
  const email = match?.[1] || configured;
  return `APROPOS GROUP LLC <${email}>`;
}

function verifySvix(raw, headers, secret) {
  const id = safe(headers.get('svix-id'), 300);
  const ts = safe(headers.get('svix-timestamp'), 80);
  const sig = safe(headers.get('svix-signature'), 2000);
  if (!id || !ts || !sig) throw new Error('Missing Resend webhook signature headers.');
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) throw new Error('Resend webhook timestamp outside tolerance.');
  const rawSecret = secret.startsWith('whsec_') ? secret.slice(6) : secret;
  const key = Buffer.from(rawSecret, 'base64');
  const expected = createHmac('sha256', key).update(`${id}.${ts}.${raw}`, 'utf8').digest();
  const signatures = sig.split(/\s+/).map((x) => x.trim()).filter(Boolean).map((x) => x.startsWith('v1,') ? x.slice(3) : x).filter(Boolean);
  for (const signature of signatures) {
    try {
      const got = Buffer.from(signature, 'base64');
      if (got.length === expected.length && timingSafeEqual(got, expected)) return;
    } catch {}
  }
  throw new Error('Resend webhook signature mismatch.');
}

function classifyRules(text) {
  const t = safe(text).toLowerCase();
  if (/do not contact|don't contact|unsubscribe|remove me/.test(t)) return 'DO_NOT_CONTACT';
  if (/not interested|no interest|decline|pass on|won't pursue|will not pursue|no thank/.test(t)) return 'NOT_INTERESTED';
  if (/interested|would like to|want to pursue|we'll pursue|we will pursue|tell me more|please send|\byes\b/.test(t)) return 'INTERESTED';
  if (/who are you|verify|legit|legitimate|apropos/.test(t)) return 'TRUST_QUESTION';
  if (/contract|solicitation|deadline|scope|rfq|bid/.test(t)) return 'CONTRACT_QUESTION';
  return 'UNKNOWN';
}

async function classifyAI(text) {
  const key = env('OPENAI_API_KEY');
  if (!key) return 'UNKNOWN';
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: env('OPENAI_MODEL') || 'gpt-5.6-terra',
      input: `Classify this business reply to a procurement opportunity outreach into exactly one label: INTERESTED, NOT_INTERESTED, CONTRACT_QUESTION, TRUST_QUESTION, DO_NOT_CONTACT, UNKNOWN. Return only the label. Reply:\n${safe(text, 5000)}`,
      max_output_tokens: 40,
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) return 'UNKNOWN';
  const data = await response.json();
  let out = data.output_text || '';
  if (!out) for (const item of data.output || []) if (item.type === 'message') for (const c of item.content || []) if (c.type === 'output_text') out += c.text || '';
  const cls = safe(out, 80).toUpperCase().replace(/[^A-Z_]/g, '');
  return ['INTERESTED','NOT_INTERESTED','CONTRACT_QUESTION','TRUST_QUESTION','DO_NOT_CONTACT','UNKNOWN'].includes(cls) ? cls : 'UNKNOWN';
}

async function getReceivedEmail(emailId, apiKey) {
  const response = await fetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`Resend received-email retrieval failed (${response.status}).`);
  return response.json();
}

async function applyResponse(outreach, cls, text) {
  const now = new Date().toISOString();
  await db('natcorp_outreach_events', 'PATCH', `?outreach_id=eq.${encodeURIComponent(outreach.outreach_id)}`, {
    status: 'replied',
    response_class: cls,
    response_text: safe(text) || null,
    replied_at: now,
    updated_at: now,
  }, 'return=minimal');
  outreach.status = 'replied';
  outreach.response_class = cls;
  outreach.response_text = safe(text) || null;
  outreach.replied_at = now;

  if (['NOT_INTERESTED','DO_NOT_CONTACT'].includes(cls) && outreach.candidate_id) {
    try {
      return await rpc('natcorp_disposition_candidate', {
        p_candidate_id: outreach.candidate_id,
        p_disposition: cls,
        p_response_text: safe(text),
        p_source: 'resend_inbound',
      });
    } catch (error) {
      const existing = await db('natcorp_candidate_dispositions', 'GET', `?source_candidate_id=eq.${encodeURIComponent(outreach.candidate_id)}&select=*&order=created_at.desc&limit=1`);
      if (existing?.length) return { status: 'already_processed' };
      throw error;
    }
  }

  if (cls === 'INTERESTED' && outreach.candidate_id) {
    await db('natcorp_business_discovery_candidates', 'PATCH', `?candidate_id=eq.${encodeURIComponent(outreach.candidate_id)}`, {
      verification_status: 'interested',
      updated_at: now,
    }, 'return=minimal');
  }
  return { status: 'recorded' };
}

async function loadInterestedContext(outreach) {
  const [candidateRows, opportunityRows] = await Promise.all([
    outreach.candidate_id
      ? db('natcorp_business_discovery_candidates', 'GET', `?candidate_id=eq.${encodeURIComponent(outreach.candidate_id)}&select=*`)
      : Promise.resolve([]),
    outreach.opportunity_id
      ? db('state_contract_opportunities', 'GET', `?id=eq.${encodeURIComponent(outreach.opportunity_id)}&select=*`)
      : Promise.resolve([]),
  ]);
  const candidate = candidateRows?.[0] || null;
  const opportunity = opportunityRows?.[0] || null;
  if (!opportunity) throw new Error('Interested response was recorded, but the associated contract could not be loaded.');
  return { candidate, opportunity };
}

async function persistHandoff(outreach, handoff) {
  const providerPayload = {
    ...(outreach.provider_payload || {}),
    interested_analyze_fit: handoff,
  };
  await db('natcorp_outreach_events', 'PATCH', `?outreach_id=eq.${encodeURIComponent(outreach.outreach_id)}`, {
    provider_payload: providerPayload,
    updated_at: new Date().toISOString(),
  }, 'return=minimal');
  outreach.provider_payload = providerPayload;
  return handoff;
}

async function createInterestedAnalyzeFitLink(outreach, context) {
  const existing = outreach.provider_payload?.interested_analyze_fit;
  if (existing?.request_id && existing?.access_url) return { ...existing };

  const contactEmail = validEmail(outreach.contact_email || context.candidate?.contact_email);
  if (!contactEmail) throw new Error('Interested response was recorded, but no valid business delivery email is available.');

  const accessToken = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
  const businessName = safe(outreach.business_name || context.candidate?.business_name, 220) || 'Interested Business';
  const opportunityReference = safe(`${context.opportunity.pdas_record_id || ''} — ${context.opportunity.title || ''}`, 300);
  const metadata = {
    source: 'resend_interested_reply',
    business_name: businessName,
    contact_name: safe(outreach.contact_name || context.candidate?.contact_name, 220) || null,
    contact_email: contactEmail,
    contact_phone: safe(context.candidate?.contact_phone, 80) || null,
    opportunity_reference: opportunityReference || null,
    notes: 'Automatically created after the business replied Interested to an APROPOS NAT-CORP opportunity introduction.',
    analyze_fit_access_hash: sha256(accessToken),
    analyze_fit_access_expires_at: expiresAt,
    opportunity_id: context.opportunity.id,
    candidate_id: outreach.candidate_id || context.candidate?.candidate_id || null,
    outreach_id: outreach.outreach_id,
    interested_reply_received_at: outreach.replied_at || new Date().toISOString(),
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
  if (!request) throw new Error('Interested response was recorded, but the personalized Analyze Fit request could not be created.');

  const nextUrl = `/analyze-fit-request?request=${encodeURIComponent(request.request_id)}&token=${encodeURIComponent(accessToken)}`;
  const handoff = {
    status: 'link_created',
    request_id: request.request_id,
    access_url: `${NATCORP_SITE_URL}${nextUrl}`,
    expires_at: expiresAt,
    created_at: new Date().toISOString(),
    client_email: { status: 'pending' },
    internal_email: { status: 'pending' },
  };
  await persistHandoff(outreach, handoff);
  return handoff;
}

async function sendResendEmail(payload) {
  const apiKey = env('RESEND_API_KEY');
  if (!apiKey) throw new Error('RESEND_API_KEY is unavailable.');
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Resend failed (${response.status}): ${data.message || 'unknown error'}`);
  return data;
}

function clientEmail({ outreach, opportunity, handoff }) {
  const business = safe(outreach.business_name, 220) || 'your business';
  const contact = safe(outreach.contact_name, 220);
  const greeting = contact ? `Hello ${contact},` : 'Hello,';
  const title = safe(opportunity.title, 700) || 'the identified government contract opportunity';
  const issuer = safe(opportunity.issuing_organization || opportunity.issuing_department, 300) || 'See official solicitation';
  const deadline = opportunity.response_deadline
    ? new Date(opportunity.response_deadline).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', dateStyle: 'medium', timeStyle: 'short' }) + ' PT'
    : 'See official solicitation';
  const subject = `Your personalized Analyze Fit link — ${business}`;
  const text = `${greeting}\n\nThank you for confirming that ${business} is interested in evaluating this opportunity.\n\nContract: ${title}\nIssuing Organization: ${issuer}\nResponse Deadline: ${deadline}\n\nContinue to your secure, precompleted Analyze Fit workflow:\n${handoff.access_url}\n\nThe link expires on ${new Date(handoff.expires_at).toLocaleDateString('en-US')}. Confirm the business information to generate the immediate HTML report. The branded Word report will then be emailed and available for download.\n\nJeff Mitchell\nFounder, APROPOS GROUP LLC\nNAT-CORP Procurement Intelligence`;
  const html = `<!doctype html><html><body style="margin:0;background:#f3f5f8;font-family:Arial,Helvetica,sans-serif;color:#14213d"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f5f8;padding:24px 12px"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:680px;background:#ffffff;border:1px solid #d9e0ea;border-radius:14px;overflow:hidden"><tr><td align="center" style="padding:28px 24px 14px"><img src="cid:apropos-group-logo" width="210" alt="APROPOS GROUP LLC" style="display:block;max-width:210px;width:100%;height:auto;border:0"></td></tr><tr><td style="padding:0 30px 32px;font-size:16px;line-height:1.58"><p>${htmlEsc(greeting)}</p><p>Thank you for confirming that <strong>${htmlEsc(business)}</strong> is interested in evaluating this opportunity.</p><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f6f8fb;border-radius:10px;margin:18px 0"><tr><td style="padding:16px"><strong>Contract:</strong> ${htmlEsc(title)}<br><strong>Issuing Organization:</strong> ${htmlEsc(issuer)}<br><strong>Response Deadline:</strong> ${htmlEsc(deadline)}</td></tr></table><p>Your secure, precompleted Analyze Fit workflow is ready.</p><p><a href="${htmlEsc(handoff.access_url)}" style="display:inline-block;background:#0d2a57;color:#ffffff;text-decoration:none;padding:13px 19px;border-radius:8px;font-weight:700">Open Personalized Analyze Fit</a></p><p style="font-size:14px;color:#526176">This link expires on ${htmlEsc(new Date(handoff.expires_at).toLocaleDateString('en-US'))}. Confirm the business information to generate the immediate HTML report. The branded Word report will then be emailed and available for download.</p><p style="margin-top:28px">Jeff Mitchell<br>Founder, APROPOS GROUP LLC<br>NAT-CORP Procurement Intelligence</p></td></tr></table></td></tr></table></body></html>`;
  return { subject, text, html };
}

function internalEmail({ outreach, opportunity, handoff }) {
  const business = safe(outreach.business_name, 220) || 'Interested Business';
  const title = safe(opportunity.title, 700) || 'Government contract opportunity';
  const issuer = safe(opportunity.issuing_organization || opportunity.issuing_department, 300) || 'Unavailable';
  const contactEmail = validEmail(outreach.contact_email) || 'Unavailable';
  const deadline = opportunity.response_deadline
    ? new Date(opportunity.response_deadline).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', dateStyle: 'medium', timeStyle: 'short' }) + ' PT'
    : 'Unavailable';
  const responseText = safe(outreach.response_text, 1500) || 'Interested';
  const subject = `INTERESTED — ${business} — Personalized Analyze Fit link ready`;
  const text = `Jeff,\n\nNAT-CORP received an INTERESTED response. A personalized Analyze Fit request has been created immediately.\n\nBusiness: ${business}\nContact: ${safe(outreach.contact_name, 220) || 'Unavailable'}\nClient Email: ${contactEmail}\nContract: ${title}\nIssuing Organization: ${issuer}\nResponse Deadline: ${deadline}\nOutreach ID: ${outreach.outreach_id}\nService Request ID: ${handoff.request_id}\n\nPersonalized Analyze Fit report workflow:\n${handoff.access_url}\n\nClient response:\n${responseText}\n\nThe same personalized link has been sent to the client. The link expires on ${new Date(handoff.expires_at).toLocaleDateString('en-US')}.`;
  const html = `<!doctype html><html><body style="margin:0;background:#f3f5f8;font-family:Arial,Helvetica,sans-serif;color:#14213d"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f5f8;padding:24px 12px"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:700px;background:#ffffff;border:1px solid #d9e0ea;border-radius:14px;overflow:hidden"><tr><td align="center" style="padding:24px 24px 12px"><img src="cid:apropos-group-logo" width="180" alt="APROPOS GROUP LLC" style="display:block;max-width:180px;width:100%;height:auto;border:0"></td></tr><tr><td style="padding:0 30px 32px;font-size:15px;line-height:1.55"><p><strong>NAT-CORP received an INTERESTED response.</strong></p><p>A personalized Analyze Fit request was created immediately for this business and contract.</p><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f6f8fb;border-radius:10px;margin:18px 0"><tr><td style="padding:16px"><strong>Business:</strong> ${htmlEsc(business)}<br><strong>Contact:</strong> ${htmlEsc(safe(outreach.contact_name, 220) || 'Unavailable')}<br><strong>Client Email:</strong> ${htmlEsc(contactEmail)}<br><strong>Contract:</strong> ${htmlEsc(title)}<br><strong>Issuing Organization:</strong> ${htmlEsc(issuer)}<br><strong>Response Deadline:</strong> ${htmlEsc(deadline)}<br><strong>Outreach ID:</strong> ${htmlEsc(outreach.outreach_id)}<br><strong>Service Request ID:</strong> ${htmlEsc(handoff.request_id)}</td></tr></table><p><a href="${htmlEsc(handoff.access_url)}" style="display:inline-block;background:#0d2a57;color:#ffffff;text-decoration:none;padding:13px 19px;border-radius:8px;font-weight:700">Open Personalized Analyze Fit</a></p><p><strong>Client response:</strong><br>${htmlEsc(responseText)}</p><p style="font-size:13px;color:#526176">The same personalized link has been sent to the client. It expires on ${htmlEsc(new Date(handoff.expires_at).toLocaleDateString('en-US'))}.</p></td></tr></table></td></tr></table></body></html>`;
  return { subject, text, html };
}

async function sendInterestedAnalyzeFitHandoff(outreach) {
  const context = await loadInterestedContext(outreach);
  let handoff = await createInterestedAnalyzeFitLink(outreach, context);
  const errors = [];

  if (handoff.client_email?.status !== 'sent') {
    try {
      const message = clientEmail({ outreach, opportunity: context.opportunity, handoff });
      const sent = await sendResendEmail({
        from: resendFrom(),
        to: [validEmail(outreach.contact_email || context.candidate?.contact_email)],
        subject: message.subject,
        text: message.text,
        html: message.html,
        attachments: [aproposLogoAttachment()],
        reply_to: env('NATCORP_INBOUND_EMAIL') || INTERNAL_EMAIL,
        tags: [
          { name: 'service', value: 'natcorp-analyze-fit' },
          { name: 'outreach_id', value: outreach.outreach_id.replaceAll('-', '').slice(0, 32) },
        ],
      });
      handoff = {
        ...handoff,
        status: 'client_sent',
        client_email: { status: 'sent', provider_message_id: sent.id || null, sent_at: new Date().toISOString() },
      };
      await persistHandoff(outreach, handoff);
    } catch (error) {
      handoff = { ...handoff, client_email: { status: 'failed', error: safe(error.message, 700), failed_at: new Date().toISOString() } };
      await persistHandoff(outreach, handoff);
      errors.push(`client delivery: ${error.message}`);
    }
  }

  if (handoff.internal_email?.status !== 'sent') {
    try {
      const message = internalEmail({ outreach, opportunity: context.opportunity, handoff });
      const internalAddress = validEmail(env('NATCORP_INTERNAL_EMAIL')) || INTERNAL_EMAIL;
      const sent = await sendResendEmail({
        from: resendFrom(),
        to: [internalAddress],
        subject: message.subject,
        text: message.text,
        html: message.html,
        attachments: [aproposLogoAttachment()],
        reply_to: validEmail(outreach.contact_email) || env('NATCORP_INBOUND_EMAIL') || INTERNAL_EMAIL,
        tags: [
          { name: 'service', value: 'natcorp-interested-alert' },
          { name: 'outreach_id', value: outreach.outreach_id.replaceAll('-', '').slice(0, 32) },
        ],
      });
      handoff = {
        ...handoff,
        status: handoff.client_email?.status === 'sent' ? 'delivered' : 'internal_sent',
        internal_email: { status: 'sent', provider_message_id: sent.id || null, sent_at: new Date().toISOString(), to: internalAddress },
      };
      await persistHandoff(outreach, handoff);
    } catch (error) {
      handoff = { ...handoff, internal_email: { status: 'failed', error: safe(error.message, 700), failed_at: new Date().toISOString() } };
      await persistHandoff(outreach, handoff);
      errors.push(`internal delivery: ${error.message}`);
    }
  }

  if (errors.length) throw new Error(`Interested Analyze Fit handoff incomplete. ${errors.join(' | ')}`);
  return handoff;
}

export default async function handler(req) {
  if (req.method !== 'POST') return json(405, { ok: false, error: 'POST only' });
  const apiKey = env('RESEND_API_KEY');
  const secret = env('RESEND_WEBHOOK_SECRET');
  if (!apiKey || !secret) return json(503, { ok: false, error: 'NAT-CORP inbound email webhook is not configured.' });

  const raw = await req.text();
  let event;
  try {
    verifySvix(raw, req.headers, secret);
    event = JSON.parse(raw);
  } catch (error) {
    return json(400, { ok: false, error: `Invalid Resend webhook: ${error.message}` });
  }
  if (event.type !== 'email.received') return json(200, { ok: true, ignored: event.type });

  try {
    const received = await getReceivedEmail(event.data?.email_id, apiKey);
    const email = received?.data || received;
    const from = extractEmail(email?.from || event.data?.from);
    const text = safe(email?.text || email?.html || '');
    if (!from) return json(200, { ok: true, ignored: 'sender_missing' });

    const rows = await db('natcorp_outreach_events', 'GET', `?contact_email=ilike.${encodeURIComponent(from)}&status=in.(sent,delivered,replied)&select=*&order=sent_at.desc.nullslast,created_at.desc&limit=1`);
    const outreach = rows?.[0];
    if (!outreach) return json(200, { ok: true, unmatched: true, from });

    let cls = classifyRules(text);
    if (cls === 'UNKNOWN') cls = await classifyAI(text);
    const result = await applyResponse(outreach, cls, text);
    const handoff = cls === 'INTERESTED' ? await sendInterestedAnalyzeFitHandoff(outreach) : null;
    return json(200, {
      ok: true,
      outreach_id: outreach.outreach_id,
      response_class: cls,
      result,
      interested_analyze_fit: handoff,
    });
  } catch (error) {
    console.error('[natcorp-resend-webhook]', error);
    return json(500, { ok: false, error: safe(error.message, 900) });
  }
}

export const config = { path: '/api/natcorp-resend-webhook' };
