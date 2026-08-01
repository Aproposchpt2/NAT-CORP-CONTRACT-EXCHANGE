import { createHash, timingSafeEqual } from 'node:crypto';
import { db, env, json, sameOrigin } from './_shared/natcorp-db.mjs';
import { aproposLogoAttachment } from './lib/apropos-brand.mjs';
import { buildAnalyzeFitDocx, analyzeFitDocxFilename, normalizeAnalyzeFitAnalysis } from './lib/analyze-fit-docx.mjs';

const safe = (v, n = 12000) => String(v ?? '').trim().slice(0, n);
const sha256 = (v) => createHash('sha256').update(String(v)).digest('hex');
const htmlEsc = (v) => safe(v).replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

function validEmail(v) {
  const s = safe(v, 320);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : '';
}
function tokenMatches(token, expectedHash) {
  const actual = Buffer.from(sha256(token), 'hex');
  const expected = Buffer.from(safe(expectedHash, 128), 'hex');
  return actual.length === expected.length && actual.length > 0 && timingSafeEqual(actual, expected);
}
async function loadRequest(requestId, token) {
  if (!requestId || !token) throw new Error('Analyze Fit access link is incomplete.');
  const rows = await db('natcorp_service_requests', 'GET', `?request_id=eq.${encodeURIComponent(requestId)}&service_type=eq.ANALYZE_FIT&select=*`);
  const request = rows?.[0];
  if (!request) throw new Error('Analyze Fit request was not found.');
  if (!tokenMatches(token, request.metadata?.analyze_fit_access_hash)) throw new Error('Analyze Fit access link is invalid.');
  const expiresAt = request.metadata?.analyze_fit_access_expires_at;
  if (expiresAt && new Date(expiresAt).getTime() < Date.now()) throw new Error('Analyze Fit access link has expired.');
  return request;
}
async function loadPayload(request) {
  const runId = request.metadata?.analyze_fit_run_id;
  if (!runId) throw new Error('Analyze Fit report has not been generated yet.');
  const opportunityId = request.opportunity_id || request.metadata?.opportunity_id;
  const [opportunities, runs, reports, profiles] = await Promise.all([
    db('state_contract_opportunities', 'GET', `?id=eq.${encodeURIComponent(opportunityId)}&select=id,pdas_record_id,title,issuing_organization,issuing_department,state_code,response_deadline,procurement_type,description,official_source_url,source_url,natcorp_contract_dna_status`),
    db('natcorp_analyze_fit_runs', 'GET', `?run_id=eq.${encodeURIComponent(runId)}&select=*`),
    db('natcorp_analyze_fit_reports', 'GET', `?analyze_fit_run_id=eq.${encodeURIComponent(runId)}&select=*`),
    request.business_profile_id ? db('aoie_business_profiles', 'GET', `?id=eq.${encodeURIComponent(request.business_profile_id)}&select=*`) : Promise.resolve([]),
  ]);
  const opportunity = opportunities?.[0];
  const run = runs?.[0];
  if (!opportunity) throw new Error('Selected contract could not be loaded.');
  if (!run || run.status !== 'completed') throw new Error('Analyze Fit report is not complete.');
  const analysis = normalizeAnalyzeFitAnalysis(run.analysis || {});
  return {
    request_id: request.request_id,
    business: {
      business_name: request.metadata?.confirmed_profile?.business_name || profiles?.[0]?.legal_business_name || request.metadata?.business_name || 'Business',
      contact_name: request.metadata?.confirmed_profile?.contact_name || request.metadata?.contact_name || null,
      contact_email: validEmail(request.metadata?.confirmed_profile?.contact_email || request.metadata?.contact_email),
    },
    opportunity: {
      id: opportunity.id,
      pdas_record_id: opportunity.pdas_record_id,
      title: opportunity.title,
      issuing_organization: opportunity.issuing_organization,
      issuing_department: opportunity.issuing_department,
      state_code: opportunity.state_code,
      response_deadline: opportunity.response_deadline,
      procurement_type: opportunity.procurement_type,
      description: opportunity.description,
      official_source_url: opportunity.official_source_url || opportunity.source_url,
      natcorp_contract_dna_status: opportunity.natcorp_contract_dna_status,
    },
    report: reports?.[0] || null,
    run: {
      run_id: run.run_id,
      status: run.status,
      score: analysis.score,
      recommendation: analysis.recommendation,
      analysis,
      provider: run.provider,
      model: run.model,
      completed_at: run.completed_at,
    },
    delivery: request.metadata?.analyze_fit_docx_delivery || null,
  };
}
function resendFrom() {
  const configured = env('RESEND_FROM_EMAIL') || 'jmitchell@aproposgroupllc.com';
  const match = configured.match(/<([^>]+)>/);
  return `APROPOS GROUP LLC <${match?.[1] || configured}>`;
}
function reportEmail({ payload, reportUrl }) {
  const business = payload.business?.business_name || 'your business';
  const contact = payload.business?.contact_name ? ` ${payload.business.contact_name}` : '';
  const title = payload.opportunity?.title || 'Selected Contract';
  const recommendation = safe(payload.run?.recommendation).replaceAll('_',' ');
  const score = payload.run?.score ?? 'Unavailable';
  const text = `Hello${contact},\n\nYour NAT-CORP Contract-Specific Analyze Fit report for ${business} is complete.\n\nContract: ${title}\nAnalyze Fit Score: ${score}%\nRecommendation: ${recommendation}\n\nThe formal APROPOS Word report is attached. You may open the immediate HTML report here:\n${reportUrl}\n\nOpen the Word document to print it or save it as a PDF.\n\nAPROPOS GROUP LLC / NAT-CORP is not the issuing government agency and does not guarantee eligibility, responsiveness, award, or contract performance. Verify all findings against the complete official solicitation and current business records.\n\nJeff Mitchell\nFounder, APROPOS GROUP LLC\nNAT-CORP Procurement Intelligence`;
  const html = `<!doctype html><html><body style="margin:0;background:#f3f5f8;font-family:Arial,Helvetica,sans-serif;color:#14213d"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f5f8;padding:24px 12px"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:680px;background:#ffffff;border:1px solid #d9e0ea;border-radius:14px;overflow:hidden"><tr><td align="center" style="padding:26px 24px 12px"><img src="cid:apropos-group-logo" width="190" alt="APROPOS GROUP LLC" style="display:block;max-width:190px;width:100%;height:auto;border:0"></td></tr><tr><td style="padding:0 30px 30px;font-size:16px;line-height:1.58"><div style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#876413;font-weight:700">NAT-CORP · Analyze Fit</div><h1 style="font-family:Georgia,serif;color:#103478;font-size:28px;line-height:1.15;margin:8px 0 18px">Your contract-specific report is complete.</h1><p>Hello${htmlEsc(contact)},</p><p>The formal APROPOS Word report for <strong>${htmlEsc(business)}</strong> is attached.</p><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f6f8fb;border:1px solid #e0e6ee;border-radius:10px;margin:18px 0"><tr><td style="padding:16px"><strong>Contract:</strong> ${htmlEsc(title)}<br><strong>Analyze Fit Score:</strong> ${htmlEsc(score)}%<br><strong>Recommendation:</strong> ${htmlEsc(recommendation)}</td></tr></table><p><a href="${htmlEsc(reportUrl)}" style="display:inline-block;background:#103478;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:700">Open Immediate HTML Report</a></p><p>Open the attached Word document to print the report or save it as a PDF.</p><p style="font-size:13px;color:#66758a;border-top:1px solid #e1e6ee;padding-top:16px">APROPOS GROUP LLC / NAT-CORP is not the issuing government agency and does not guarantee eligibility, responsiveness, award, or contract performance. Verify all findings against the complete official solicitation and current business records.</p><p style="margin-top:24px">Jeff Mitchell<br>Founder, APROPOS GROUP LLC<br>NAT-CORP Procurement Intelligence</p></td></tr></table></td></tr></table></body></html>`;
  return { text, html };
}
async function sendDocxEmail({ request, payload, token, force, origin }) {
  const existing = request.metadata?.analyze_fit_docx_delivery;
  if (!force && existing?.status === 'sent') return { ...existing, duplicate_suppressed: true };
  const recipient = validEmail(payload.business?.contact_email);
  if (!recipient) throw new Error('A valid confirmed client email is required before the DOCX report can be sent.');
  const buffer = buildAnalyzeFitDocx(payload);
  const fileName = analyzeFitDocxFilename(payload);
  const reportUrl = `${origin}/analyze-fit-report?request=${encodeURIComponent(request.request_id)}&token=${encodeURIComponent(token)}`;
  const body = reportEmail({ payload, reportUrl });
  const key = env('RESEND_API_KEY');
  if (!key) throw new Error('RESEND_API_KEY is not configured for Analyze Fit report delivery.');
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: resendFrom(),
      to: [recipient],
      subject: `Your NAT-CORP Analyze Fit Report — ${payload.business.business_name}`,
      text: body.text,
      html: body.html,
      attachments: [aproposLogoAttachment(), { filename: fileName, content: buffer.toString('base64') }],
      reply_to: env('NATCORP_INBOUND_EMAIL') || 'jmitchell@aproposgroupllc.com',
      tags: [{ name: 'service', value: 'natcorp-analyze-fit' }, { name: 'request_id', value: request.request_id.replaceAll('-', '').slice(0, 32) }],
    }),
    signal: AbortSignal.timeout(45000),
  });
  const data = await response.json().catch(() => ({}));
  const delivery = response.ok
    ? { status:'sent', recipient, file_name:fileName, provider_message_id:data.id||null, sent_at:new Date().toISOString() }
    : { status:'failed', recipient, file_name:fileName, error:data.message||`HTTP ${response.status}`, attempted_at:new Date().toISOString() };
  await db('natcorp_service_requests', 'PATCH', `?request_id=eq.${encodeURIComponent(request.request_id)}`, {
    metadata: { ...(request.metadata || {}), analyze_fit_docx_delivery: delivery },
  }, 'return=minimal');
  if (!response.ok) throw new Error(`DOCX email delivery failed (${response.status}): ${delivery.error}`);
  return delivery;
}

export default async function handler(req) {
  if (!sameOrigin(req)) return json(403, { ok:false, error:'Same-origin NAT-CORP access required.' });
  try {
    const url = new URL(req.url);
    if (req.method === 'GET') {
      const requestId = safe(url.searchParams.get('request'), 80);
      const token = safe(url.searchParams.get('token'), 300);
      const mode = safe(url.searchParams.get('mode'), 40) || 'report';
      const request = await loadRequest(requestId, token);
      const payload = await loadPayload(request);
      if (mode === 'report') return json(200, { ok:true, ...payload, docx_file_name:analyzeFitDocxFilename(payload) });
      if (mode === 'docx') {
        const buffer = buildAnalyzeFitDocx(payload);
        const fileName = analyzeFitDocxFilename(payload);
        return new Response(buffer, { status:200, headers:{
          'content-type':'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'content-disposition':`attachment; filename="${fileName}"`,
          'content-length':String(buffer.length),
          'cache-control':'private, no-store, max-age=0',
          'x-content-type-options':'nosniff',
        }});
      }
      if (mode === 'status') return json(200, { ok:true, delivery:payload.delivery, docx_file_name:analyzeFitDocxFilename(payload) });
      return json(400, { ok:false, error:'Unsupported Analyze Fit delivery mode.' });
    }
    if (req.method !== 'POST') return json(405, { ok:false, error:'GET or POST only.' });
    const body = await req.json();
    const requestId = safe(body.request_id, 80);
    const token = safe(body.token, 300);
    const request = await loadRequest(requestId, token);
    const payload = await loadPayload(request);
    const action = safe(body.action, 80).toLowerCase();
    if (action === 'email_report') {
      const origin = new URL(req.url).origin;
      const delivery = await sendDocxEmail({ request, payload, token, force:body.force === true, origin });
      return json(200, { ok:true, delivery });
    }
    return json(400, { ok:false, error:'Unsupported Analyze Fit delivery action.' });
  } catch (error) {
    console.error('[analyze-fit-delivery]', error);
    return json(400, { ok:false, error:safe(error?.message, 1000) || 'Analyze Fit delivery could not be completed.' });
  }
}

export const config = {
  path: '/api/analyze-fit-delivery',
  rateLimit: { windowLimit: 30, windowSize: 60, aggregateBy: ['ip','domain'] },
};
