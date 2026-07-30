import { db, env, json, rpc, sameOrigin } from './_shared/natcorp-db.mjs';

const PUBLIC_BASE = () => (env('NATCORP_PUBLIC_BASE_URL') || 'https://natcorp.aproposgroupllc.com').replace(/\/$/, '');
const arr = (v) => Array.isArray(v) ? v : [];
const safe = (v) => String(v ?? '').trim();
const clip = (v, n = 7000) => String(v ?? '').slice(0, n);

function decode64url(value) {
  const b64 = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
  const binary = atob(b64);
  return new Uint8Array([...binary].map((c) => c.charCodeAt(0)));
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let out = 0; for (let i = 0; i < a.length; i++) out |= a[i] ^ b[i]; return out === 0;
}

async function verifyToken(token) {
  const secret = env('BC_VERIFY_SECRET') || env('NATCORP_INTERNAL_TOKEN_PRODUCTION') || env('NATCORP_INTERNAL_TOKEN');
  if (!secret) throw new Error('Continuation verification is not configured.');
  const [body, sigText] = safe(token).split('.');
  if (!body || !sigText) throw new Error('Invalid continuation token.');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const expected = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)));
  const supplied = decode64url(sigText);
  if (!timingSafeEqual(expected, supplied)) throw new Error('Invalid continuation signature.');
  const payload = JSON.parse(new TextDecoder().decode(decode64url(body)));
  if (!payload?.opportunity_id || !payload?.candidate_id || Number(payload.exp || 0) < Date.now()) throw new Error('Continuation token expired or incomplete.');
  return payload;
}

function extractResponseText(data) {
  if (typeof data?.output_text === 'string') return data.output_text;
  const out = [];
  for (const item of arr(data?.output)) if (item?.type === 'message') for (const c of arr(item.content)) if (c?.type === 'output_text' && c.text) out.push(c.text);
  return out.join('\n');
}

function parseJsonText(text) {
  const t = safe(text).replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
  try { return JSON.parse(t); } catch {}
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
  throw new Error('AI response was not valid JSON.');
}

async function openAIAnalyze(prompt) {
  const key = env('OPENAI_API_KEY');
  if (!key) throw new Error('OpenAI is unavailable.');
  const model = env('OPENAI_ANALYZE_FIT_MODEL') || env('OPENAI_MODEL') || 'gpt-5.6-terra';
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, input: [{ role: 'system', content: 'You are NAT-CORP\'s State and State-entity contract fit analyst. Compare Contract DNA with Business DNA using only contract-relevant factors. Never invent unavailable facts. Return only valid JSON.' }, { role: 'user', content: prompt }], max_output_tokens: 7500 }),
    signal: AbortSignal.timeout(110000),
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`OpenAI analysis failed (${response.status}): ${raw.slice(0, 500)}`);
  const data = JSON.parse(raw);
  return { provider: 'openai', model, analysis: parseJsonText(extractResponseText(data)) };
}

async function anthropicAnalyze(prompt) {
  const key = env('ANTHROPIC_API_KEY');
  if (!key) throw new Error('Anthropic is unavailable.');
  const model = env('ANTHROPIC_MODEL') || 'claude-sonnet-5';
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: 7500, system: 'You are NAT-CORP\'s State and State-entity contract fit analyst. Compare Contract DNA with Business DNA using only contract-relevant factors. Never invent unavailable facts. Return one valid JSON object only.', messages: [{ role: 'user', content: prompt }] }),
    signal: AbortSignal.timeout(110000),
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`Anthropic analysis failed (${response.status}): ${raw.slice(0, 500)}`);
  const data = JSON.parse(raw);
  const text = arr(data.content).map((x) => x.text || '').join('');
  return { provider: 'anthropic', model, analysis: parseJsonText(text) };
}

function normalizeAnalysis(v) {
  const score = Math.max(0, Math.min(100, Math.round(Number(v?.score) || 0)));
  let recommendation = safe(v?.recommendation).toUpperCase().replaceAll('-', '_').replaceAll(' ', '_');
  if (!['PURSUE','CONDITIONAL','DO_NOT_PURSUE'].includes(recommendation)) recommendation = score >= 75 ? 'PURSUE' : score >= 45 ? 'CONDITIONAL' : 'DO_NOT_PURSUE';
  return { ...v, score, recommendation };
}

async function loadDna(opportunityId) {
  const result = await rpc('natcorp_get_contract_dna', { p_opportunity_id: opportunityId });
  return Array.isArray(result) ? (result[0] || null) : (result || null);
}

async function loadPublicContext(payload) {
  const [opps, candidates, dnaRows, outreachRows] = await Promise.all([
    db('state_contract_opportunities', 'GET', `?id=eq.${encodeURIComponent(payload.opportunity_id)}&select=id,pdas_record_id,title,issuing_organization,issuing_department,state_code,response_deadline,description,procurement_type,notice_type,official_source_url,source_url,requirements`),
    db('natcorp_business_discovery_candidates', 'GET', `?candidate_id=eq.${encodeURIComponent(payload.candidate_id)}&select=*`),
    loadDna(payload.opportunity_id),
    db('natcorp_outreach_events', 'GET', `?candidate_id=eq.${encodeURIComponent(payload.candidate_id)}&select=*&order=created_at.desc&limit=1`),
  ]);
  const opportunity = opps?.[0];
  if (!opportunity) throw new Error('Opportunity is no longer available.');
  return { opportunity, candidate: candidates?.[0] || null, dna: dnaRows || null, outreach: outreachRows?.[0] || null };
}

async function recordDecision(payload, decision, responseText = '') {
  const cls = decision === 'not_interested' ? 'NOT_INTERESTED' : 'INTERESTED';
  const outreachRows = await db('natcorp_outreach_events', 'GET', `?candidate_id=eq.${encodeURIComponent(payload.candidate_id)}&select=*&order=created_at.desc&limit=1`);
  const outreach = outreachRows?.[0];
  if (outreach) await db('natcorp_outreach_events', 'PATCH', `?outreach_id=eq.${encodeURIComponent(outreach.outreach_id)}`, { status: 'replied', response_class: cls, response_text: safe(responseText) || null, replied_at: new Date().toISOString(), updated_at: new Date().toISOString() }, 'return=minimal');
  if (cls === 'INTERESTED') {
    const rows = await db('natcorp_business_discovery_candidates', 'PATCH', `?candidate_id=eq.${encodeURIComponent(payload.candidate_id)}`, { verification_status: 'interested', updated_at: new Date().toISOString() }, 'return=representation');
    return { response_class: cls, candidate: rows?.[0] || null };
  }
  try {
    const disposition = await rpc('natcorp_disposition_candidate', { p_candidate_id: payload.candidate_id, p_disposition: 'NOT_INTERESTED', p_response_text: safe(responseText) || 'Business declined through opportunity review.', p_source: 'public_response' });
    return { response_class: cls, disposition };
  } catch (e) {
    const existing = await db('natcorp_candidate_dispositions', 'GET', `?source_candidate_id=eq.${encodeURIComponent(payload.candidate_id)}&disposition=eq.NOT_INTERESTED&select=*&order=created_at.desc&limit=1`);
    if (existing?.length) return { response_class: cls, disposition: { status: 'already_processed', record: existing[0] } };
    throw e;
  }
}

async function submitIntake(payload, intakePayload) {
  const context = await loadPublicContext(payload);
  if (!context.candidate) throw new Error('Selected business is no longer active for this opportunity.');
  const record = {
    outreach_id: context.outreach?.outreach_id || null,
    opportunity_id: payload.opportunity_id,
    candidate_id: payload.candidate_id,
    status: 'submitted',
    contact_email: safe(intakePayload.contact_email) || context.candidate.contact_email || null,
    intake_payload: intakePayload,
    submitted_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const rows = await db('natcorp_business_intakes', 'POST', '', [record], 'return=representation');
  const intake = rows?.[0];
  if (!intake) throw new Error('Business intake could not be persisted.');
  const dna = await rpc('natcorp_build_business_dna', { p_intake_id: intake.intake_id });
  return { intake, business_dna: dna };
}

async function runAnalyzeFit(payload, intakeId) {
  const context = await loadPublicContext(payload);
  const intakeRows = await db('natcorp_business_intakes', 'GET', `?intake_id=eq.${encodeURIComponent(intakeId)}&opportunity_id=eq.${encodeURIComponent(payload.opportunity_id)}&select=*`);
  const intake = intakeRows?.[0];
  if (!intake?.business_profile_id) throw new Error('Business DNA must be completed before Analyze Fit.');
  const [profiles, capacity, qualifications, past] = await Promise.all([
    db('aoie_business_profiles', 'GET', `?id=eq.${encodeURIComponent(intake.business_profile_id)}&select=*`),
    db('aoie_business_capacity', 'GET', `?business_profile_id=eq.${encodeURIComponent(intake.business_profile_id)}&select=*`),
    db('aoie_business_qualifications', 'GET', `?business_profile_id=eq.${encodeURIComponent(intake.business_profile_id)}&select=*`),
    db('aoie_business_past_performance', 'GET', `?business_profile_id=eq.${encodeURIComponent(intake.business_profile_id)}&select=*`),
  ]);
  const runRows = await db('natcorp_analyze_fit_runs', 'POST', '', [{ intake_id: intake.intake_id, opportunity_id: payload.opportunity_id, candidate_id: payload.candidate_id, business_profile_id: intake.business_profile_id, contract_dna_id: context.dna?.id || null, status: 'running', started_at: new Date().toISOString() }], 'return=representation');
  const run = runRows?.[0];
  if (!run) throw new Error('Analyze Fit run could not be created.');
  const prompt = `Perform a detailed NAT-CORP Contract DNA ↔ Business DNA fit analysis for this State/State-entity opportunity. Evaluate only the requirements, capabilities, geography, licensing or professional qualifications, capacity, past performance, delivery conditions, deadlines, and other factors actually relevant to the supplied contract. Missing information must remain Unavailable or Unverified, not invented.\n\nCONTRACT DNA\n${JSON.stringify({ opportunity: context.opportunity, dna: context.dna }, null, 2)}\n\nBUSINESS DNA\n${JSON.stringify({ profile: profiles?.[0], capacity: capacity?.[0], qualifications: qualifications || [], past_performance: past || [], intake: intake.intake_payload }, null, 2)}\n\nReturn ONLY JSON exactly using these keys:\n{"score":0,"recommendation":"PURSUE|CONDITIONAL|DO_NOT_PURSUE","executive_summary":"","rationale":"","contract_requirements":[],"capability_alignment":[{"requirement":"","business_evidence":"","status":"ALIGNED|PARTIAL|GAP|UNVERIFIED","note":""}],"geographic_alignment":"","licensing_qualification_review":[],"capacity_delivery_review":[],"past_performance_review":[],"risks":[{"domain":"","level":"LOW|MEDIUM|HIGH|INFORMATION","finding":"","mitigation":""}],"unavailable_contract_details":[],"unavailable_business_details":[],"decision_conditions":[],"action_plan":[],"proposal_readiness":""}.`;
  let result, errors = [];
  try { result = await openAIAnalyze(prompt); } catch (e) { errors.push(e.message); }
  if (!result) try { result = await anthropicAnalyze(prompt); } catch (e) { errors.push(e.message); }
  if (!result) {
    await db('natcorp_analyze_fit_runs', 'PATCH', `?run_id=eq.${encodeURIComponent(run.run_id)}`, { status: 'failed', error_message: errors.join(' | ').slice(0, 1200), completed_at: new Date().toISOString(), updated_at: new Date().toISOString() }, 'return=minimal');
    throw new Error(`VAR: Analyze Fit providers failed. ${errors.join(' | ')}`);
  }
  const analysis = normalizeAnalysis(result.analysis);
  const updatedRows = await db('natcorp_analyze_fit_runs', 'PATCH', `?run_id=eq.${encodeURIComponent(run.run_id)}`, { status: 'completed', provider: result.provider, model: result.model, score: analysis.score, recommendation: analysis.recommendation, analysis, completed_at: new Date().toISOString(), updated_at: new Date().toISOString() }, 'return=representation');
  await db('natcorp_business_intakes', 'PATCH', `?intake_id=eq.${encodeURIComponent(intake.intake_id)}`, { status: 'analysis_complete', updated_at: new Date().toISOString() }, 'return=minimal');
  return updatedRows?.[0];
}

async function serviceRequest(payload, intakeId, serviceType, metadata = {}) {
  const intakeRows = await db('natcorp_business_intakes', 'GET', `?intake_id=eq.${encodeURIComponent(intakeId)}&opportunity_id=eq.${encodeURIComponent(payload.opportunity_id)}&select=*`);
  const intake = intakeRows?.[0];
  if (!intake) throw new Error('Intake not found.');
  const rows = await db('natcorp_service_requests', 'POST', '', [{ intake_id: intake.intake_id, opportunity_id: payload.opportunity_id, business_profile_id: intake.business_profile_id || null, service_type: serviceType, metadata }], 'return=representation');
  return rows?.[0];
}

async function subscriptionCheckout(payload, token, intakeId) {
  const request = await serviceRequest(payload, intakeId, 'CONTRACTOR_REPOSITORY_SUBSCRIPTION', { monthly_price: 29.99, currency: 'USD' });
  const stripeKey = env('STRIPE_SECRET_KEY');
  const priceId = env('STRIPE_NATCORP_CONTRACTOR_REPOSITORY_PRICE_ID');
  if (!stripeKey || !priceId) return { var: true, code: 'BILLING_NOT_CONFIGURED', request, message: 'The $29.99 Contractor Repository subscription workflow is built, but Stripe billing credentials are not configured on this site.' };
  const intakeRows = await db('natcorp_business_intakes', 'GET', `?intake_id=eq.${encodeURIComponent(intakeId)}&select=*`);
  const intake = intakeRows?.[0];
  const email = intake?.contact_email || safe(intake?.intake_payload?.contact_email);
  const form = new URLSearchParams();
  form.set('mode', 'subscription');
  form.set('line_items[0][price]', priceId);
  form.set('line_items[0][quantity]', '1');
  form.set('success_url', `${PUBLIC_BASE()}/opportunity-review.html?token=${encodeURIComponent(token)}&subscription=success`);
  form.set('cancel_url', `${PUBLIC_BASE()}/opportunity-review.html?token=${encodeURIComponent(token)}&subscription=canceled`);
  if (email) form.set('customer_email', email);
  form.set('metadata[intake_id]', intakeId);
  form.set('metadata[opportunity_id]', payload.opportunity_id);
  if (intake?.business_profile_id) form.set('metadata[business_profile_id]', intake.business_profile_id);
  form.set('metadata[service_request_id]', request.request_id);
  const response = await fetch('https://api.stripe.com/v1/checkout/sessions', { method: 'POST', headers: { Authorization: `Bearer ${stripeKey}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: form, signal: AbortSignal.timeout(30000) });
  const data = await response.json();
  if (!response.ok) throw new Error(`Stripe checkout failed (${response.status}): ${data.error?.message || 'unknown error'}`);
  return { request, checkout_url: data.url, checkout_session_id: data.id };
}

export default async function handler(req) {
  const url = new URL(req.url);
  const token = url.searchParams.get('token') || (req.method === 'POST' ? null : '');
  if (req.method === 'GET') {
    try {
      const payload = await verifyToken(token);
      return json(200, { ok: true, payload: { opportunity_id: payload.opportunity_id, candidate_id: payload.candidate_id, exp: payload.exp }, ...(await loadPublicContext(payload)) });
    } catch (e) { return json(401, { ok: false, error: e.message }); }
  }
  if (req.method !== 'POST') return json(405, { ok: false, error: 'GET or POST only.' });
  if (!sameOrigin(req)) return json(403, { ok: false, error: 'Same-origin request required.' });
  let body; try { body = await req.json(); } catch { return json(400, { ok: false, error: 'Invalid JSON.' }); }
  try {
    const rawToken = safe(body.token);
    const payload = await verifyToken(rawToken);
    const action = safe(body.action);
    if (action === 'record_decision') return json(200, { ok: true, result: await recordDecision(payload, safe(body.decision), body.response_text) });
    if (action === 'submit_intake') return json(200, { ok: true, result: await submitIntake(payload, body.intake || {}) });
    if (action === 'analyze_fit') return json(200, { ok: true, result: await runAnalyzeFit(payload, body.intake_id) });
    if (action === 'proposal_request') return json(200, { ok: true, result: await serviceRequest(payload, body.intake_id, 'CONTRACT_PROPOSAL_DEVELOPMENT', body.metadata || {}) });
    if (action === 'subscription_checkout') return json(200, { ok: true, result: await subscriptionCheckout(payload, rawToken, body.intake_id) });
    return json(400, { ok: false, error: `Unknown action: ${action}` });
  } catch (e) {
    console.error('[opportunity-response]', e);
    return json(500, { ok: false, error: e.message, var: /^VAR:/.test(e.message) });
  }
}

export const config = { path: '/api/opportunity-response', rateLimit: { windowLimit: 20, windowSize: 60, aggregateBy: ['ip','domain'] } };
