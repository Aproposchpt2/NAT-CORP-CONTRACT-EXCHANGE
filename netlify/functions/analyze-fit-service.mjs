import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { db, env, json, rpc, sameOrigin } from './_shared/natcorp-db.mjs';

// Credit gate -- 2026-08-15, revised same day when Jeff changed the pricing
// model: subscriptions no longer include any Analyze Fit credit at all
// (unlimited contract downloads only), so this no longer checks for an
// active subscription -- every report, subscriber or not, is a separate
// $79 purchase (one flat price shared with NGCC; the purchasing hub's
// offer page asks the buyer which platform, carried through Stripe as
// client_reference_id, so the webhook grants to the right product_code).
// Just a direct balance check against product_code='natcorp' here (this
// file only runs on NAT-CORP, so that's hardcoded).
const CREDIT_PRODUCT = 'natcorp';
async function creditBalance(email, product) {
  const rows = await db('analyze_fit_credit_ledger', 'GET', `?customer_email=eq.${encodeURIComponent(email)}&product_code=eq.${product}&select=credit_delta`);
  return (Array.isArray(rows) ? rows : []).reduce((sum, r) => sum + Number(r.credit_delta || 0), 0);
}
// reason is a DB-enforced CHECK-constrained enum (trial_grant, monthly_grant,
// additional_purchase, usage, admin_adjustment, partner_grant,
// refund_reversal) -- consumption/refund detail goes in metadata, not reason.
async function consumeCredit(email, product, opportunityId) {
  return db('analyze_fit_credit_ledger', 'POST', '', [{
    customer_email: email.toLowerCase().trim(), product_code: product, credit_delta: -1,
    reason: 'usage', metadata: { opportunity_id: opportunityId },
  }], 'return=minimal');
}
async function refundCredit(email, product, opportunityId, refundFor) {
  try {
    await db('analyze_fit_credit_ledger', 'POST', '', [{
      customer_email: email.toLowerCase().trim(), product_code: product, credit_delta: 1,
      reason: 'refund_reversal', metadata: { opportunity_id: opportunityId, refund_for: refundFor },
    }], 'return=minimal');
  } catch { /* best-effort refund -- don't let this mask the original error */ }
}

const safe = (v, n = 7000) => String(v ?? '').trim().slice(0, n);
const arr = (v) => Array.isArray(v) ? v : [];
const nowIso = () => new Date().toISOString();
const sha256 = (v) => createHash('sha256').update(String(v)).digest('hex');
const normalizeName = (v) => safe(v, 240).toLowerCase().replace(/[’']/g, '').replace(/\bs\b$/,'').replace(/[^a-z0-9]+/g, ' ').trim();
const cleanFilename = (v) => safe(v, 120).replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g,'') || 'Analyze-Fit';

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
  const expectedHash = request.metadata?.analyze_fit_access_hash;
  if (!tokenMatches(token, expectedHash)) throw new Error('Analyze Fit access link is invalid.');
  const expiresAt = request.metadata?.analyze_fit_access_expires_at;
  if (expiresAt && new Date(expiresAt).getTime() < Date.now()) throw new Error('Analyze Fit access link has expired.');
  return request;
}

async function loadContext(request) {
  const opportunityId = request.opportunity_id || request.metadata?.opportunity_id;
  const candidateId = request.metadata?.candidate_id || null;
  const outreachId = request.metadata?.outreach_id || null;
  const [opportunities, candidates, outreach, dna] = await Promise.all([
    opportunityId ? db('state_contract_opportunities', 'GET', `?id=eq.${encodeURIComponent(opportunityId)}&select=*`) : Promise.resolve([]),
    candidateId ? db('natcorp_business_discovery_candidates', 'GET', `?candidate_id=eq.${encodeURIComponent(candidateId)}&select=*`) : Promise.resolve([]),
    outreachId ? db('natcorp_outreach_events', 'GET', `?outreach_id=eq.${encodeURIComponent(outreachId)}&select=*`) : Promise.resolve([]),
    opportunityId ? rpc('natcorp_get_contract_dna', { p_opportunity_id: opportunityId }) : Promise.resolve(null),
  ]);
  const opportunity = opportunities?.[0] || null;
  if (!opportunity) throw new Error('The selected contract could not be loaded for Analyze Fit.');
  const candidate = candidates?.[0] || null;
  const outreachRecord = outreach?.[0] || null;
  const contractDna = Array.isArray(dna) ? (dna[0] || null) : dna;
  return { opportunity, candidate, outreach: outreachRecord, contract_dna: contractDna };
}

function locationParts(candidate, opportunity) {
  const text = safe(candidate?.location, 180);
  const m = text.match(/^(.+?),\s*([A-Z]{2})(?:\s|$)/);
  return { city: m?.[1] || '', state: m?.[2] || safe(opportunity?.state_code, 2) };
}

function defaultProfile(request, context) {
  const m = request.metadata || {};
  const c = context.candidate || {};
  const loc = locationParts(c, context.opportunity);
  const capabilities = arr(c.capability_evidence).map((x) => safe(x, 900)).filter(Boolean);
  const qualifications = arr(c.qualification_evidence).map((x) => safe(x, 900)).filter(Boolean);
  const pastPerformance = arr(c.past_performance_evidence).map((x) => safe(x, 1600)).filter(Boolean);
  const fitNotes = arr(c.contract_fit_notes).map((x) => safe(x, 1200)).filter(Boolean);
  return {
    business_name: safe(c.business_name || m.business_name, 220),
    contact_name: safe(m.contact_name || c.contact_name, 220),
    contact_email: validEmail(m.contact_email || c.contact_email),
    contact_phone: safe(m.contact_phone || c.contact_phone, 80),
    website: safe(c.website, 500),
    city: loc.city,
    state: loc.state,
    service_states: loc.state ? [loc.state] : [],
    capabilities,
    qualification_evidence: qualifications,
    past_performance: pastPerformance,
    contract_fit_notes: fitNotes,
    notes: safe(m.notes, 2000),
  };
}

function publicContext(request, context) {
  const o = context.opportunity;
  return {
    request_id: request.request_id,
    status: request.status,
    business: defaultProfile(request, context),
    opportunity: {
      id: o.id,
      pdas_record_id: o.pdas_record_id,
      title: o.title,
      issuing_organization: o.issuing_organization,
      issuing_department: o.issuing_department,
      state_code: o.state_code,
      response_deadline: o.response_deadline,
      procurement_type: o.procurement_type,
      description: o.description,
      official_source_url: o.official_source_url || o.source_url,
      natcorp_contract_dna_status: o.natcorp_contract_dna_status,
    },
    contract_dna_available: Boolean(context.contract_dna),
    candidate_id: context.candidate?.candidate_id || null,
    outreach_id: context.outreach?.outreach_id || null,
  };
}

function intakePayload(profile) {
  const capabilities = arr(profile.capabilities).map((x) => safe(x, 1200)).filter(Boolean).slice(0, 16);
  const qualificationEvidence = arr(profile.qualification_evidence).map((x) => safe(x, 1200)).filter(Boolean).slice(0, 16);
  const pastPerformance = arr(profile.past_performance).map((x) => safe(x, 1800)).filter(Boolean).slice(0, 12);
  const serviceStates = arr(profile.service_states).map((x) => safe(x, 2).toUpperCase()).filter(Boolean).slice(0, 20);
  const businessName = safe(profile.business_name, 220);
  const email = validEmail(profile.contact_email);
  if (!businessName) throw new Error('Business name is required.');
  if (!email) throw new Error('A valid contact email is required.');
  return {
    business_name: businessName,
    legal_business_name: businessName,
    contact_name: safe(profile.contact_name, 220) || null,
    contact_email: email,
    contact_phone: safe(profile.contact_phone, 80) || null,
    website: safe(profile.website, 500) || null,
    city: safe(profile.city, 160) || null,
    state: safe(profile.state, 2).toUpperCase() || null,
    service_states: serviceStates,
    service_territory: { states: serviceStates },
    business_description: capabilities.join('; ') || safe(profile.notes, 2000) || null,
    capabilities: capabilities.join('; ') || null,
    capability_evidence: capabilities,
    qualifications: qualificationEvidence.map((name) => ({ type: 'CONTRACT_RELEVANT', name })),
    qualification_evidence: qualificationEvidence,
    past_performance: pastPerformance.map((text, i) => ({ project_title: `Relevant experience ${i + 1}`, project_description: text })),
    contract_fit_notes: arr(profile.contract_fit_notes).map((x) => safe(x, 1200)).filter(Boolean).slice(0, 12),
    notes: safe(profile.notes, 2000) || null,
    source: 'NAT-CORP contract-specific Analyze Fit confirmation',
    confirmed_at: nowIso(),
  };
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
  const model = env('OPENAI_ANALYZE_FIT_MODEL') || env('OPENAI_MODEL') || 'gpt-4o-mini';
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      input: [
        { role: 'system', content: 'You are NAT-CORP\'s State and State-entity contract fit analyst. Compare Contract DNA with Business DNA using only contract-relevant evidence. Never invent unavailable facts. Return only valid JSON.' },
        { role: 'user', content: prompt },
      ],
      max_output_tokens: 7500,
    }),
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
  const model = env('ANTHROPIC_MODEL') || 'claude-sonnet-4-6';
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      max_tokens: 7500,
      system: 'You are NAT-CORP\'s State and State-entity contract fit analyst. Compare Contract DNA with Business DNA using only contract-relevant evidence. Never invent unavailable facts. Return one valid JSON object only.',
      messages: [{ role: 'user', content: prompt }],
    }),
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

async function runAnalysis(context, intake) {
  const [profiles, capacity, qualifications, past] = await Promise.all([
    db('aoie_business_profiles', 'GET', `?id=eq.${encodeURIComponent(intake.business_profile_id)}&select=*`),
    db('aoie_business_capacity', 'GET', `?business_profile_id=eq.${encodeURIComponent(intake.business_profile_id)}&select=*`),
    db('aoie_business_qualifications', 'GET', `?business_profile_id=eq.${encodeURIComponent(intake.business_profile_id)}&select=*`),
    db('aoie_business_past_performance', 'GET', `?business_profile_id=eq.${encodeURIComponent(intake.business_profile_id)}&select=*`),
  ]);
  const prompt = `Perform a detailed NAT-CORP Contract DNA ↔ Business DNA fit analysis for this State/State-entity opportunity. Evaluate only requirements, capabilities, geography, licensing or professional qualifications, capacity, past performance, delivery conditions, deadlines, and other factors actually relevant to the supplied contract. Missing information must remain Unavailable or Unverified, not invented.\n\nCONTRACT DNA\n${JSON.stringify({ opportunity: context.opportunity, dna: context.contract_dna }, null, 2)}\n\nBUSINESS DNA\n${JSON.stringify({ profile: profiles?.[0], capacity: capacity?.[0], qualifications: qualifications || [], past_performance: past || [], intake: intake.intake_payload }, null, 2)}\n\nReturn ONLY JSON exactly using these keys:\n{"score":0,"recommendation":"PURSUE|CONDITIONAL|DO_NOT_PURSUE","executive_summary":"","rationale":"","contract_requirements":[],"capability_alignment":[{"requirement":"","business_evidence":"","status":"ALIGNED|PARTIAL|GAP|UNVERIFIED","note":""}],"geographic_alignment":"","licensing_qualification_review":[],"capacity_delivery_review":[],"past_performance_review":[],"risks":[{"domain":"","level":"LOW|MEDIUM|HIGH|INFORMATION","finding":"","mitigation":""}],"unavailable_contract_details":[],"unavailable_business_details":[],"decision_conditions":[],"action_plan":[],"proposal_readiness":""}.`;
  let result = null;
  const errors = [];
  try { result = await openAIAnalyze(prompt); } catch (e) { errors.push(e.message); }
  if (!result) try { result = await anthropicAnalyze(prompt); } catch (e) { errors.push(e.message); }
  if (!result) throw new Error(`Analyze Fit providers failed. ${errors.join(' | ')}`);
  return { ...result, analysis: normalizeAnalysis(result.analysis) };
}

async function submitAndAnalyze(request, context, profile) {
  const deadline = context.opportunity?.response_deadline ? new Date(context.opportunity.response_deadline).getTime() : 0;
  if (deadline && deadline <= Date.now()) throw new Error('The selected contract response deadline has passed. Analyze Fit generation is blocked for this opportunity.');
  const payload = intakePayload(profile || {});

  const balance = await creditBalance(payload.contact_email, CREDIT_PRODUCT);
  if (balance < 1) throw new Error('No Analyze Fit report credits available. Purchase a report ($79) at ai4-product-purchasing.ai4businesses.org/analyze-fit to continue.');
  await consumeCredit(payload.contact_email, CREDIT_PRODUCT, context.opportunity.id);

  let intake, run;
  try {
    const intakeRows = await db('natcorp_business_intakes', 'POST', '', [{
      outreach_id: context.outreach?.outreach_id || request.metadata?.outreach_id || null,
      opportunity_id: context.opportunity.id,
      candidate_id: context.candidate?.candidate_id || request.metadata?.candidate_id || null,
      business_profile_id: request.business_profile_id || null,
      status: 'submitted',
      contact_email: payload.contact_email,
      intake_payload: payload,
      submitted_at: nowIso(),
      updated_at: nowIso(),
    }], 'return=representation');
    intake = intakeRows?.[0];
    if (!intake) throw new Error('Business confirmation could not be recorded.');

    const dnaResult = await rpc('natcorp_build_business_dna', { p_intake_id: intake.intake_id });
    const dnaProfileId = dnaResult?.business_profile_id || dnaResult?.[0]?.business_profile_id;
    const refreshed = await db('natcorp_business_intakes', 'GET', `?intake_id=eq.${encodeURIComponent(intake.intake_id)}&select=*`);
    intake = refreshed?.[0] || { ...intake, business_profile_id: dnaProfileId || intake.business_profile_id };
    if (!intake.business_profile_id) throw new Error('Business DNA could not be completed.');

    const runRows = await db('natcorp_analyze_fit_runs', 'POST', '', [{
      intake_id: intake.intake_id,
      opportunity_id: context.opportunity.id,
      candidate_id: context.candidate?.candidate_id || request.metadata?.candidate_id || null,
      business_profile_id: intake.business_profile_id,
      contract_dna_id: context.contract_dna?.id || null,
      status: 'running',
      started_at: nowIso(),
    }], 'return=representation');
    run = runRows?.[0];
    if (!run) throw new Error('Analyze Fit run could not be created.');
  } catch (error) {
    await refundCredit(payload.contact_email, CREDIT_PRODUCT, context.opportunity.id, 'refund_setup_failed');
    throw error;
  }

  try {
    const result = await runAnalysis(context, intake);
    const analysis = result.analysis;
    const completedRows = await db('natcorp_analyze_fit_runs', 'PATCH', `?run_id=eq.${encodeURIComponent(run.run_id)}`, {
      status: 'completed',
      provider: result.provider,
      model: result.model,
      score: analysis.score,
      recommendation: analysis.recommendation,
      analysis,
      completed_at: nowIso(),
      updated_at: nowIso(),
    }, 'return=representation');
    const completed = completedRows?.[0] || { ...run, status: 'completed', analysis };
    await db('natcorp_business_intakes', 'PATCH', `?intake_id=eq.${encodeURIComponent(intake.intake_id)}`, { status: 'analysis_complete', updated_at: nowIso() }, 'return=minimal');

    const reportName = `${cleanFilename(payload.business_name)}-${cleanFilename(context.opportunity.pdas_record_id || context.opportunity.title)}-Analyze-Fit.html`;
    const contentHash = sha256(JSON.stringify({ opportunity_id: context.opportunity.id, business_profile_id: intake.business_profile_id, analysis }));
    const reportRows = await db('natcorp_analyze_fit_reports', 'POST', '', [{
      analyze_fit_run_id: completed.run_id,
      opportunity_id: context.opportunity.id,
      business_profile_id: intake.business_profile_id,
      report_version: 'NATCORP-OTF-ANALYZE-FIT-v1',
      file_name: reportName,
      content_hash: contentHash,
      generated_at: nowIso(),
    }], 'return=representation');

    const newMetadata = {
      ...(request.metadata || {}),
      confirmed_profile: payload,
      intake_id: intake.intake_id,
      analyze_fit_run_id: completed.run_id,
      analyze_fit_report_id: reportRows?.[0]?.report_id || null,
      analyzed_at: nowIso(),
    };
    await db('natcorp_service_requests', 'PATCH', `?request_id=eq.${encodeURIComponent(request.request_id)}`, {
      intake_id: intake.intake_id,
      opportunity_id: context.opportunity.id,
      business_profile_id: intake.business_profile_id,
      status: 'closed',
      metadata: newMetadata,
    }, 'return=minimal');

    return {
      run_id: completed.run_id,
      report_id: reportRows?.[0]?.report_id || null,
      intake_id: intake.intake_id,
      score: analysis.score,
      recommendation: analysis.recommendation,
      next_url: `/analyze-fit-report?request=${encodeURIComponent(request.request_id)}`,
    };
  } catch (error) {
    await db('natcorp_analyze_fit_runs', 'PATCH', `?run_id=eq.${encodeURIComponent(run.run_id)}`, {
      status: 'failed',
      error_message: safe(error?.message, 1200),
      completed_at: nowIso(),
      updated_at: nowIso(),
    }, 'return=minimal').catch(() => {});
    await refundCredit(payload.contact_email, CREDIT_PRODUCT, context.opportunity.id, 'refund_analysis_failed');
    throw error;
  }
}

async function reportPayload(request, context) {
  const runId = request.metadata?.analyze_fit_run_id;
  if (!runId) throw new Error('Analyze Fit report has not been generated yet.');
  const [runs, reports, profiles] = await Promise.all([
    db('natcorp_analyze_fit_runs', 'GET', `?run_id=eq.${encodeURIComponent(runId)}&select=*`),
    db('natcorp_analyze_fit_reports', 'GET', `?analyze_fit_run_id=eq.${encodeURIComponent(runId)}&select=*`),
    request.business_profile_id ? db('aoie_business_profiles', 'GET', `?id=eq.${encodeURIComponent(request.business_profile_id)}&select=*`) : Promise.resolve([]),
  ]);
  const run = runs?.[0];
  if (!run || run.status !== 'completed') throw new Error('Analyze Fit report is not complete.');
  return {
    request_id: request.request_id,
    business: {
      business_name: request.metadata?.confirmed_profile?.business_name || profiles?.[0]?.legal_business_name || request.metadata?.business_name,
      contact_name: request.metadata?.contact_name || null,
    },
    opportunity: publicContext(request, context).opportunity,
    report: reports?.[0] || null,
    run: {
      run_id: run.run_id,
      status: run.status,
      score: run.score,
      recommendation: run.recommendation,
      analysis: run.analysis,
      provider: run.provider,
      model: run.model,
      completed_at: run.completed_at,
    },
  };
}

export default async function handler(req) {
  if (!sameOrigin(req)) return json(403, { ok: false, error: 'Same-origin NAT-CORP access required.' });
  try {
    const url = new URL(req.url);
    if (req.method === 'GET') {
      const requestId = safe(url.searchParams.get('request'), 80);
      const token = safe(url.searchParams.get('token'), 300);
      const mode = safe(url.searchParams.get('mode'), 40) || 'context';
      const request = await loadRequest(requestId, token);
      const context = await loadContext(request);
      if (mode === 'report') return json(200, { ok: true, ...(await reportPayload(request, context)) });
      return json(200, { ok: true, ...publicContext(request, context) });
    }
    if (req.method !== 'POST') return json(405, { ok: false, error: 'GET or POST only.' });
    const body = await req.json();
    const request = await loadRequest(safe(body.request_id, 80), safe(body.token, 300));
    const context = await loadContext(request);
    const action = safe(body.action, 80).toLowerCase();
    if (action === 'submit_and_analyze') return json(200, { ok: true, result: await submitAndAnalyze(request, context, body.profile || {}) });
    return json(400, { ok: false, error: 'Unsupported Analyze Fit action.' });
  } catch (error) {
    console.error('[analyze-fit-service]', error);
    return json(400, { ok: false, error: safe(error?.message, 900) || 'Analyze Fit request could not be completed.' });
  }
}

export const config = {
  path: '/api/analyze-fit-service',
  rateLimit: { windowLimit: 12, windowSize: 60, aggregateBy: ['ip','domain'] },
};
