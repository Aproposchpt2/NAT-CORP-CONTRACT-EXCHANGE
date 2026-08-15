import { db, env, json, rpc, commandAuthorized, sameOrigin } from './_shared/natcorp-db.mjs';
import { aproposLogoAttachment, assertActionableOpportunity } from './lib/apropos-brand.mjs';
import { buildFounderOutreach } from './lib/otf-founder-outreach.mjs';

const OPPORTUNITY_SERVICES_URL = 'https://natcorp.aproposgroupllc.com/opportunity-services';
const clip = (v, n = 5000) => String(v ?? '').slice(0, n);
const arr = (v) => Array.isArray(v) ? v : [];
const safe = (v) => String(v ?? '').trim();
const htmlEsc = (v) => safe(v).replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

function extractResponseText(data) {
  if (typeof data?.output_text === 'string') return data.output_text;
  const out = [];
  for (const item of arr(data?.output)) {
    if (item?.type !== 'message') continue;
    for (const content of arr(item.content)) if (content?.type === 'output_text' && content.text) out.push(content.text);
  }
  return out.join('\n');
}

function parseJsonText(text) {
  const t = safe(text).replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
  try { return JSON.parse(t); } catch {}
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
  throw new Error('AI response did not contain valid JSON.');
}

async function openAIWebJson(prompt) {
  const key = env('OPENAI_API_KEY');
  if (!key) throw new Error('OPENAI_API_KEY is unavailable for business discovery.');
  const model = env('OPENAI_DISCOVERY_MODEL') || env('OPENAI_MODEL') || 'gpt-5.6-terra';
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      tools: [{ type: 'web_search', search_context_size: 'high' }],
      input: [{ role: 'system', content: 'You are the NAT-CORP Business Discovery execution agent. Use web search. Follow the supplied Contract DNA and search rules exactly. Never seed a preselected company and never invent evidence.' }, { role: 'user', content: prompt }],
      max_output_tokens: 7000,
    }),
    signal: AbortSignal.timeout(115000),
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`OpenAI discovery failed (${response.status}): ${raw.slice(0, 500)}`);
  const data = JSON.parse(raw);
  return { model, data: parseJsonText(extractResponseText(data)), raw: data };
}

async function anthropicWebJson(prompt) {
  const key = env('ANTHROPIC_API_KEY');
  if (!key) throw new Error('ANTHROPIC_API_KEY is unavailable for business discovery.');
  const model = env('ANTHROPIC_DISCOVERY_MODEL') || env('ANTHROPIC_MODEL') || 'claude-sonnet-5';
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model, max_tokens: 7000,
      system: 'You are the NAT-CORP Business Discovery execution agent. Search current public sources. Follow the supplied Contract DNA and search rules exactly. Never seed a preselected company and never invent evidence. Return one valid JSON object only.',
      messages: [{ role: 'user', content: prompt }],
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 12 }]
    }),
    signal: AbortSignal.timeout(115000),
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`Anthropic discovery failed (${response.status}): ${raw.slice(0, 500)}`);
  const data = JSON.parse(raw);
  const text = arr(data.content).filter(x => x?.type === 'text').map(x => x.text || '').join('\n');
  return { model, data: parseJsonText(text), raw: data };
}

async function openAIJson(prompt) {
  const key = env('OPENAI_API_KEY');
  if (!key) throw new Error('OPENAI_API_KEY is unavailable.');
  const model = env('OPENAI_MODEL') || 'gpt-5.6-terra';
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, input: [{ role: 'system', content: 'Return only valid JSON. Use only supplied evidence. Never invent facts.' }, { role: 'user', content: prompt }], max_output_tokens: 5000 }),
    signal: AbortSignal.timeout(90000),
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`OpenAI failed (${response.status}): ${raw.slice(0, 500)}`);
  const data = JSON.parse(raw);
  return { model, data: parseJsonText(extractResponseText(data)) };
}

async function loadOpportunity(id) {
  const rows = await db('state_contract_opportunities', 'GET', `?id=eq.${encodeURIComponent(id)}&select=*`);
  if (!rows?.[0]) throw new Error('Opportunity not found.');
  return rows[0];
}

async function loadDna(opportunityId) {
  const result = await rpc('natcorp_get_contract_dna', { p_opportunity_id: opportunityId });
  return Array.isArray(result) ? (result[0] || null) : (result || null);
}

async function loadCandidate(candidateId) {
  const rows = await db('natcorp_business_discovery_candidates', 'GET', `?candidate_id=eq.${encodeURIComponent(candidateId)}&select=*`);
  if (!rows?.[0]) throw new Error('Business candidate not found.');
  return rows[0];
}

async function context(opportunityId) {
  const opportunity = await loadOpportunity(opportunityId);
  const [dnaRows, commandRows, dispositions, outreach, intakes, repository] = await Promise.all([
    loadDna(opportunityId),
    db('natcorp_business_discovery_commands', 'GET', `?opportunity_id=eq.${encodeURIComponent(opportunityId)}&select=*&order=created_at.desc`),
    db('natcorp_candidate_dispositions', 'GET', `?opportunity_id=eq.${encodeURIComponent(opportunityId)}&select=*&order=created_at.desc&limit=20`),
    db('natcorp_outreach_events', 'GET', `?opportunity_id=eq.${encodeURIComponent(opportunityId)}&select=*&order=created_at.desc&limit=20`),
    db('natcorp_business_intakes', 'GET', `?opportunity_id=eq.${encodeURIComponent(opportunityId)}&select=*&order=created_at.desc&limit=20`),
    db('natcorp_contractor_repository', 'GET', '?subscription_status=eq.active&select=membership_id,business_profile_id,capability_summary,service_territory,qualification_summary,capacity_summary,past_performance_summary,search_priority&order=search_priority.asc&limit=50'),
  ]);
  const activeCommand = commandRows?.find((x) => x.command_version === 'natcorp_business_discovery_v2') || commandRows?.[0] || null;
  const candidates = activeCommand ? await db('natcorp_business_discovery_candidates', 'GET', `?command_id=eq.${encodeURIComponent(activeCommand.command_id)}&select=*&order=discovery_rank.asc.nullslast,discovery_score.desc`) : [];
  const intakeIds = arr(intakes).map((x) => x.intake_id).filter(Boolean);
  let analyses = [];
  if (intakeIds.length) analyses = await db('natcorp_analyze_fit_runs', 'GET', `?intake_id=in.(${intakeIds.join(',')})&select=*&order=created_at.desc&limit=20`);
  return { opportunity, dna: dnaRows || null, commands: commandRows || [], active_command: activeCommand, candidates: candidates || [], dispositions: dispositions || [], outreach: outreach || [], intakes: intakes || [], analyses: analyses || [], repository_active_count: repository?.length || 0 };
}

function normalizeCandidates(payload) {
  const list = arr(payload?.candidates).slice(0, 8);
  return list.map((c, idx) => ({
    business_name: safe(c.business_name), website: safe(c.website) || 'Unavailable', location: safe(c.location) || 'Unavailable',
    contact_name: safe(c.contact_name), contact_email: safe(c.contact_email), contact_phone: safe(c.contact_phone), contact_source_url: safe(c.contact_source_url),
    capability_evidence: arr(c.capability_evidence).slice(0, 10), qualification_evidence: arr(c.qualification_evidence).slice(0, 8),
    past_performance_evidence: arr(c.past_performance_evidence).slice(0, 8), source_urls: arr(c.source_urls).slice(0, 12),
    contract_fit_notes: arr(c.contract_fit_notes).slice(0, 8), gaps_or_unverified_items: arr(c.gaps_or_unverified_items).slice(0, 8),
    discovery_rank: Number(c.discovery_rank) || idx + 1, discovery_score: Math.max(0, Math.min(100, Number(c.discovery_score) || 0)),
  })).filter((x) => x.business_name);
}

async function discoverBusinesses(commandId) {
  const rows = await db('natcorp_business_discovery_commands', 'GET', `?command_id=eq.${encodeURIComponent(commandId)}&select=*`);
  const command = rows?.[0];
  if (!command) throw new Error('Business discovery command not found.');
  const prompt = `Execute this NAT-CORP BUSINESS DISCOVERY command using live web search.\n\n${JSON.stringify(command.search_instructions, null, 2)}\n\nReturn ONLY JSON with this exact top-level structure:\n{"candidates":[{"business_name":"","website":"","location":"","contact_name":"","contact_email":"","contact_phone":"","contact_source_url":"","capability_evidence":[],"qualification_evidence":[],"past_performance_evidence":[],"source_urls":[],"contract_fit_notes":[],"gaps_or_unverified_items":[],"discovery_rank":1,"discovery_score":0}]}\n\nRequirements: return 5 legitimate businesses when possible; use official business/public-authority evidence; contact information is optional and must only be included when publicly supported; do not include directories as candidates; do not include any preselected company merely because it is known from prior context.`;
  let ai; const errors=[];
  try { ai = await openAIWebJson(prompt); } catch (e) { errors.push(e.message); }
  if (!ai) try { ai = await anthropicWebJson(prompt); } catch (e) { errors.push(e.message); }
  if (!ai) throw new Error(`VAR: Business Discovery providers failed. ${errors.join(' | ')}`);
  const candidates = normalizeCandidates(ai.data);
  if (candidates.length < 2) throw new Error(`VAR: Business Discovery produced only ${candidates.length} legitimate candidate(s).`);
  await rpc('natcorp_record_business_discovery_candidates', { p_command_id: commandId, p_candidates: candidates.map(({ contact_name, contact_email, contact_phone, contact_source_url, ...x }) => x) });
  for (const c of candidates) {
    if (!(c.contact_name || c.contact_email || c.contact_phone || c.contact_source_url)) continue;
    await db('natcorp_business_discovery_candidates', 'PATCH', `?command_id=eq.${encodeURIComponent(commandId)}&business_name=eq.${encodeURIComponent(c.business_name)}`, {
      contact_name: c.contact_name || null, contact_email: c.contact_email || null, contact_phone: c.contact_phone || null, contact_source_url: c.contact_source_url || null,
      contact_verified: Boolean(c.contact_email && c.contact_source_url), updated_at: new Date().toISOString(),
    }, 'return=minimal');
  }
  const stored = await db('natcorp_business_discovery_candidates', 'GET', `?command_id=eq.${encodeURIComponent(commandId)}&select=*&order=discovery_rank.asc.nullslast,discovery_score.desc`);
  const top = stored?.[0];
  if (!top) throw new Error('VAR: Candidate persistence returned no businesses.');
  const selected = await rpc('natcorp_select_business_discovery_candidate', { p_command_id: commandId, p_candidate_id: top.candidate_id });
  return { provider: 'openai_web_search', model: ai.model, candidates: stored, selected };
}

async function enrichContact(candidateId) {
  const c = await loadCandidate(candidateId);
  const prompt = `Use live web search to find PUBLIC business contact information suitable for a procurement opportunity introduction.\nBusiness: ${c.business_name}\nWebsite: ${c.website || 'Unavailable'}\nLocation: ${c.location || 'Unavailable'}\n\nPrefer the official business website/contact page and a named business-development, proposals, contracts, public-sector, or general business contact. Never invent an email. Return only JSON:\n{"contact_name":"","contact_email":"","contact_phone":"","contact_source_url":"","evidence_note":""}`;
  const ai = await openAIWebJson(prompt);
  const v = ai.data || {};
  const patch = { contact_name: safe(v.contact_name) || null, contact_email: safe(v.contact_email) || null, contact_phone: safe(v.contact_phone) || null, contact_source_url: safe(v.contact_source_url) || null, contact_verified: Boolean(safe(v.contact_email) && safe(v.contact_source_url)), updated_at: new Date().toISOString() };
  const rows = await db('natcorp_business_discovery_candidates', 'PATCH', `?candidate_id=eq.${encodeURIComponent(candidateId)}`, patch, 'return=representation');
  return { candidate: rows?.[0], evidence_note: safe(v.evidence_note), model: ai.model };
}

async function generateOutreach(candidateId) {
  const candidate = await loadCandidate(candidateId);
  const opportunity = await loadOpportunity(candidate.opportunity_id);
  assertActionableOpportunity(opportunity);
  const dna = await loadDna(candidate.opportunity_id);
  const email = buildFounderOutreach({ candidate, opportunity });
  const rows = await db('natcorp_outreach_events', 'POST', '', [{
    opportunity_id: opportunity.id,
    command_id: candidate.command_id,
    candidate_id: candidate.candidate_id,
    business_name: candidate.business_name,
    contact_name: candidate.contact_name || null,
    contact_email: candidate.contact_email || null,
    subject: email.subject,
    body_text: email.bodyText,
    status: 'draft',
    provider_payload: {
      contract_dna_id: dna?.id || null,
      email_html: email.bodyHtml,
      external_response_method: 'reply_email',
      opportunity_services_url: OPPORTUNITY_SERVICES_URL,
      internal_review_url_transmitted: false,
    }
  }], 'return=representation');
  return { outreach: rows?.[0] };
}

function resendFrom() {
  const configured = env('RESEND_FROM_EMAIL') || 'jmitchell@aproposgroupllc.com';
  const match = configured.match(/<([^>]+)>/);
  const email = match?.[1] || configured;
  return `APROPOS GROUP LLC <${email}>`;
}

async function sendOutreach(outreachId) {
  const rows = await db('natcorp_outreach_events', 'GET', `?outreach_id=eq.${encodeURIComponent(outreachId)}&select=*`);
  const o = rows?.[0];
  if (!o) throw new Error('Outreach event not found.');
  if (!o.contact_email) throw new Error('VAR: Selected business does not yet have a verified public contact email.');
  const opportunity = await loadOpportunity(o.opportunity_id);
  assertActionableOpportunity(opportunity);
  const html = safe(o.provider_payload?.email_html);
  if (!html) throw new Error('VAR: Branded HTML outreach payload is missing; send is blocked.');
  if (/opportunity-review|natcorp\.aproposgroupllc\.com\/(?:opportunity-fulfillment|opportunity-review)/i.test(`${o.body_text}\n${html}`)) {
    throw new Error('VAR: Internal NAT-CORP route detected in external outreach; send is blocked.');
  }
  const key = env('RESEND_API_KEY');
  if (!key) throw new Error('VAR: RESEND_API_KEY is not configured.');
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: resendFrom(),
      to: [o.contact_email],
      subject: o.subject,
      text: o.body_text,
      html,
      attachments: [aproposLogoAttachment()],
      reply_to: env('NATCORP_INBOUND_EMAIL') || 'jmitchell@aproposgroupllc.com',
      tags: [{ name: 'service', value: 'natcorp-otf' }, { name: 'outreach_id', value: o.outreach_id.replaceAll('-', '').slice(0, 32) }]
    }),
    signal: AbortSignal.timeout(30000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    await db('natcorp_outreach_events', 'PATCH', `?outreach_id=eq.${encodeURIComponent(outreachId)}`, { status: 'failed', provider_payload: { ...o.provider_payload, send_error: data }, updated_at: new Date().toISOString() }, 'return=minimal');
    throw new Error(`Resend failed (${response.status}): ${data.message || 'unknown error'}`);
  }
  const updated = await db('natcorp_outreach_events', 'PATCH', `?outreach_id=eq.${encodeURIComponent(outreachId)}`, { status: 'sent', provider_message_id: data.id || null, sent_at: new Date().toISOString(), provider_payload: { ...o.provider_payload, resend: data }, updated_at: new Date().toISOString() }, 'return=representation');
  return updated?.[0];
}

async function sendInterestedFollowup(o) {
  const prior = o?.provider_payload?.interested_followup;
  if (prior?.status === 'sent') return prior;
  if (!safe(o?.contact_email)) throw new Error('VAR: Interested response recorded, but no delivery email is available for the Opportunity Services handoff.');
  const key = env('RESEND_API_KEY');
  if (!key) throw new Error('VAR: Interested response recorded, but RESEND_API_KEY is unavailable for the Opportunity Services handoff.');
  const opportunity = await loadOpportunity(o.opportunity_id);
  const title = opportunity?.title || 'your government contract opportunity';
  const business = o.business_name || 'your business';
  const text = `Hello,\n\nThank you for letting APROPOS know that ${business} is interested in evaluating the contract opportunity: ${title}.\n\nYour next step is to open the NAT-CORP Opportunity Services page:\n${OPPORTUNITY_SERVICES_URL}\n\nFrom there you can continue with Analyze Fit, Contractor Repository enrollment, and voluntary feedback.\n\nJeff Mitchell\nFounder, APROPOS GROUP LLC\nNAT-CORP Procurement Intelligence`;
  const html = `<!doctype html><html><body style="margin:0;background:#f3f5f8;font-family:Arial,Helvetica,sans-serif;color:#14213d"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f5f8;padding:24px 12px"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#ffffff;border:1px solid #d9e0ea;border-radius:14px;overflow:hidden"><tr><td align="center" style="padding:28px 24px 14px"><img src="cid:apropos-group-logo" width="210" alt="APROPOS GROUP LLC" style="display:block;max-width:210px;width:100%;height:auto;border:0"></td></tr><tr><td style="padding:0 30px 30px;font-size:16px;line-height:1.55"><p>Hello,</p><p>Thank you for letting APROPOS know that <strong>${htmlEsc(business)}</strong> is interested in evaluating the contract opportunity:</p><p><strong>${htmlEsc(title)}</strong></p><p>Your next step is to continue through the NAT-CORP Opportunity Services page.</p><p><a href="${OPPORTUNITY_SERVICES_URL}" style="display:inline-block;background:#0d2a57;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:700">Continue to Opportunity Services</a></p><p>There you can continue with Analyze Fit, Contractor Repository enrollment, and voluntary feedback.</p><p style="margin-top:28px">Jeff Mitchell<br>Founder, APROPOS GROUP LLC<br>NAT-CORP Procurement Intelligence</p></td></tr></table></td></tr></table></body></html>`;
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: resendFrom(),
      to: [o.contact_email],
      subject: `Next step for ${business}: Opportunity Services`,
      text,
      html,
      attachments: [aproposLogoAttachment()],
      reply_to: env('NATCORP_INBOUND_EMAIL') || 'jmitchell@aproposgroupllc.com',
      tags: [{ name: 'service', value: 'natcorp-interest' }, { name: 'outreach_id', value: o.outreach_id.replaceAll('-', '').slice(0, 32) }]
    }),
    signal: AbortSignal.timeout(30000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`VAR: Interested response recorded, but Opportunity Services follow-up failed (${response.status}): ${data.message || 'unknown error'}`);
  const followup = { status: 'sent', provider_message_id: data.id || null, sent_at: new Date().toISOString(), opportunity_services_url: OPPORTUNITY_SERVICES_URL };
  await db('natcorp_outreach_events', 'PATCH', `?outreach_id=eq.${encodeURIComponent(o.outreach_id)}`, { provider_payload: { ...o.provider_payload, interested_followup: followup }, updated_at: new Date().toISOString() }, 'return=minimal');
  return followup;
}

async function recordResponse({ outreach_id, response_class, response_text }) {
  const rows = await db('natcorp_outreach_events', 'GET', `?outreach_id=eq.${encodeURIComponent(outreach_id)}&select=*`);
  const o = rows?.[0];
  if (!o) throw new Error('Outreach event not found.');
  const cls = safe(response_class).toUpperCase();
  const allowed = ['INTERESTED','NOT_INTERESTED','CONTRACT_QUESTION','TRUST_QUESTION','NO_RESPONSE','DO_NOT_CONTACT','UNKNOWN'];
  if (!allowed.includes(cls)) throw new Error('Invalid response classification.');
  await db('natcorp_outreach_events', 'PATCH', `?outreach_id=eq.${encodeURIComponent(outreach_id)}`, { status: 'replied', response_class: cls, response_text: safe(response_text) || null, replied_at: new Date().toISOString(), updated_at: new Date().toISOString() }, 'return=minimal');
  if (['NOT_INTERESTED','NO_RESPONSE','DO_NOT_CONTACT'].includes(cls) && o.candidate_id) {
    const disposition = await rpc('natcorp_disposition_candidate', { p_candidate_id: o.candidate_id, p_disposition: cls, p_response_text: safe(response_text) || null, p_source: 'outreach' });
    return { response_class: cls, disposition };
  }
  if (cls === 'INTERESTED' && o.candidate_id) {
    await db('natcorp_business_discovery_candidates', 'PATCH', `?candidate_id=eq.${encodeURIComponent(o.candidate_id)}`, { verification_status: 'interested', updated_at: new Date().toISOString() }, 'return=minimal');
    const followup = await sendInterestedFollowup(o);
    return { response_class: cls, followup, opportunity_services_url: OPPORTUNITY_SERVICES_URL };
  }
  return { response_class: cls };
}

async function repositorySearch(opportunityId) {
  const members = await db('natcorp_contractor_repository', 'GET', '?subscription_status=eq.active&select=*&order=search_priority.asc&limit=100');
  if (!members?.length) return { status: 'no_repository_contractors', matches: [] };
  const opportunity = await loadOpportunity(opportunityId);
  const dna = await loadDna(opportunityId);
  const prompt = `Rank active NAT-CORP Contractor Repository members against this Contract DNA using only contract-relevant capability evidence. Return JSON {"matches":[{"membership_id":"","score":0,"reason":""}]}. Contract: ${JSON.stringify({ title: opportunity.title, description: clip(opportunity.description, 6000), dna })}\nRepository: ${JSON.stringify(members.map((m) => ({ membership_id: m.membership_id, capability_summary: m.capability_summary, service_territory: m.service_territory, qualification_summary: m.qualification_summary, capacity_summary: m.capacity_summary, past_performance_summary: m.past_performance_summary })))}.`;
  const ai = await openAIJson(prompt);
  const matches = arr(ai.data?.matches).map((m) => ({ membership_id: safe(m.membership_id), score: Math.max(0, Math.min(100, Number(m.score) || 0)), reason: safe(m.reason) })).sort((a,b) => b.score - a.score);
  return { status: matches.some((m) => m.score >= 75) ? 'repository_match_found' : 'no_adequate_repository_match', matches, model: ai.model };
}

export default async function handler(req) {
  if (!commandAuthorized(req)) return json(401, { ok: false, error: 'Opportunity-to-Fulfillment operator authorization required.' });
  if (req.method === 'GET') {
    const url = new URL(req.url);
    const id = url.searchParams.get('opportunity_id');
    if (id) {
      try { return json(200, { ok: true, ...(await context(id)) }); } catch (e) { return json(500, { ok: false, error: e.message }); }
    }
    try {
      const rows = await db('state_contract_opportunities', 'GET', '?status=eq.open&response_deadline=gt.now()&select=id,pdas_record_id,title,issuing_organization,issuing_department,state_code,response_deadline,procurement_type,natcorp_contract_dna_status,official_source_url,source_url&order=response_deadline.asc.nullslast&limit=60');
      return json(200, { ok: true, opportunities: rows || [] });
    } catch (e) { return json(500, { ok: false, error: e.message }); }
  }
  if (req.method !== 'POST') return json(405, { ok: false, error: 'GET or POST only.' });
  if (!sameOrigin(req)) return json(403, { ok: false, error: 'Same-origin request required.' });
  let body; try { body = await req.json(); } catch { return json(400, { ok: false, error: 'Invalid JSON.' }); }
  const action = safe(body.action);
  try {
    if (action === 'build_dna') return json(200, { ok: true, result: await rpc('natcorp_build_contract_dna', { p_opportunity_ids: [body.opportunity_id] }) });
    if (action === 'create_search') return json(200, { ok: true, result: await rpc('natcorp_create_business_discovery_command', { p_opportunity_id: body.opportunity_id }) });
    if (action === 'repository_search') return json(200, { ok: true, result: await repositorySearch(body.opportunity_id) });
    if (action === 'discover_businesses') return json(200, { ok: true, result: await discoverBusinesses(body.command_id) });
    if (action === 'select_candidate') return json(200, { ok: true, result: await rpc('natcorp_select_business_discovery_candidate', { p_command_id: body.command_id, p_candidate_id: body.candidate_id }) });
    if (action === 'enrich_contact') return json(200, { ok: true, result: await enrichContact(body.candidate_id) });
    if (action === 'generate_outreach') return json(200, { ok: true, result: await generateOutreach(body.candidate_id) });
    if (action === 'send_outreach') return json(200, { ok: true, result: await sendOutreach(body.outreach_id) });
    if (action === 'record_response') return json(200, { ok: true, result: await recordResponse(body) });
    return json(400, { ok: false, error: `Unknown action: ${action}` });
  } catch (e) {
    console.error('[opportunity-fulfillment]', action, e);
    return json(500, { ok: false, error: e.message, var: /^VAR:/.test(e.message) });
  }
}

export const config = { path: '/api/opportunity-fulfillment' };
