import { createHash, randomBytes } from 'node:crypto';
import { db, json, sameOrigin } from './_shared/natcorp-db.mjs';

const safe = (v, n = 2000) => String(v ?? '').trim().slice(0, n);
const allowedServices = new Set(['ANALYZE_FIT','PROPOSAL_DEVELOPMENT','CONTRACTOR_REPOSITORY_SUBSCRIPTION']);
const sha256 = (v) => createHash('sha256').update(String(v)).digest('hex');
const normalizeName = (v) => safe(v, 240).toLowerCase().replace(/[’']/g, '').replace(/\bs\b$/,'').replace(/[^a-z0-9]+/g, ' ').trim();

function validEmail(v) {
  const s = safe(v, 320);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : '';
}

function required(body, key, max = 500) {
  const value = safe(body?.[key], max);
  if (!value) throw new Error(`${key.replaceAll('_',' ')} is required.`);
  return value;
}

function referenceTokens(value) {
  return safe(value, 300)
    .split(/[^A-Za-z0-9-]+/)
    .filter((x) => /\d/.test(x) && x.length >= 5)
    .sort((a,b) => b.length - a.length)
    .slice(0, 5);
}

async function resolveAnalyzeFitContext(businessName, opportunityReference) {
  const target = normalizeName(businessName);
  const candidates = await db('natcorp_business_discovery_candidates', 'GET', '?select=candidate_id,opportunity_id,business_name,contact_name,contact_email,contact_phone,website,location,created_at&order=created_at.desc&limit=500');
  let candidate = (candidates || []).find((c) => normalizeName(c.business_name) === target) || null;
  let opportunity = null;

  if (candidate?.opportunity_id) {
    const rows = await db('state_contract_opportunities', 'GET', `?id=eq.${encodeURIComponent(candidate.opportunity_id)}&select=id,pdas_record_id,title,issuing_organization,issuing_department,state_code,response_deadline,procurement_type,official_source_url,source_url,natcorp_contract_dna_status`);
    opportunity = rows?.[0] || null;
  }

  if (!opportunity) {
    const tokens = referenceTokens(opportunityReference);
    const rows = await db('state_contract_opportunities', 'GET', '?status=eq.open&select=id,pdas_record_id,title,issuing_organization,issuing_department,state_code,response_deadline,procurement_type,official_source_url,source_url,natcorp_contract_dna_status&order=response_deadline.asc.nullslast&limit=500');
    opportunity = (rows || []).find((o) => {
      const hay = `${o.pdas_record_id || ''} ${o.title || ''}`.toLowerCase();
      return tokens.some((t) => hay.includes(t.toLowerCase()));
    }) || null;
    if (opportunity && !candidate) {
      candidate = (candidates || []).find((c) => c.opportunity_id === opportunity.id && normalizeName(c.business_name) === target) || null;
    }
  }

  let outreach = null;
  if (candidate?.candidate_id) {
    const rows = await db('natcorp_outreach_events', 'GET', `?candidate_id=eq.${encodeURIComponent(candidate.candidate_id)}&select=outreach_id,candidate_id,opportunity_id,business_name,contact_name,contact_email,status,response_class,created_at&order=created_at.desc&limit=1`);
    outreach = rows?.[0] || null;
  }

  return { candidate, opportunity, outreach };
}

async function submitReview(body) {
  const businessName = required(body, 'business_name', 220);
  const reviewText = required(body, 'review_text', 3000);
  if (reviewText.length < 20) throw new Error('Review must be at least 20 characters.');
  const email = validEmail(body.contact_email);
  if (!email) throw new Error('A valid contact email is required.');
  const rating = body.rating === '' || body.rating == null ? null : Number(body.rating);
  if (rating != null && (!Number.isInteger(rating) || rating < 1 || rating > 5)) throw new Error('Rating must be between 1 and 5.');
  const consent = body.consent_to_publish === true;
  const rows = await db('natcorp_business_reviews', 'POST', '', [{
    business_name: businessName,
    contact_name: safe(body.contact_name, 220) || null,
    contact_email: email,
    opportunity_reference: safe(body.opportunity_reference, 300) || null,
    rating,
    review_text: reviewText,
    consent_to_publish: consent,
    status: 'pending',
    source: 'opportunity_services_page'
  }], 'return=representation');
  return { review_id: rows?.[0]?.review_id, status: 'pending', message: 'Thank you. Your feedback has been received for review.' };
}

async function submitService(body) {
  const serviceType = safe(body.service_type, 80).toUpperCase();
  if (!allowedServices.has(serviceType)) throw new Error('Unsupported service request.');
  const businessName = required(body, 'business_name', 220);
  const email = validEmail(body.contact_email);
  if (!email) throw new Error('A valid contact email is required.');

  const baseMetadata = {
    source: 'opportunity_services_page',
    business_name: businessName,
    contact_name: safe(body.contact_name, 220) || null,
    contact_email: email,
    contact_phone: safe(body.contact_phone, 80) || null,
    opportunity_reference: safe(body.opportunity_reference, 300) || null,
    notes: safe(body.notes, 2000) || null,
    monthly_price: serviceType === 'CONTRACTOR_REPOSITORY_SUBSCRIPTION' ? 29.99 : null,
    currency: serviceType === 'CONTRACTOR_REPOSITORY_SUBSCRIPTION' ? 'USD' : null
  };

  let context = { candidate: null, opportunity: null, outreach: null };
  let accessToken = '';
  if (serviceType === 'ANALYZE_FIT') {
    context = await resolveAnalyzeFitContext(businessName, baseMetadata.opportunity_reference);
    if (!context.opportunity) throw new Error('The selected contract could not be resolved. Confirm the opportunity / contract reference and submit again.');
    accessToken = randomBytes(32).toString('base64url');
    baseMetadata.analyze_fit_access_hash = sha256(accessToken);
    baseMetadata.analyze_fit_access_expires_at = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
    baseMetadata.opportunity_id = context.opportunity.id;
    baseMetadata.candidate_id = context.candidate?.candidate_id || null;
    baseMetadata.outreach_id = context.outreach?.outreach_id || null;
  }

  const rows = await db('natcorp_service_requests', 'POST', '', [{
    intake_id: null,
    opportunity_id: context.opportunity?.id || null,
    business_profile_id: null,
    service_type: serviceType,
    status: 'requested',
    metadata: baseMetadata
  }], 'return=representation');
  const request = rows?.[0];
  if (!request) throw new Error('Service request could not be recorded.');

  return {
    request_id: request.request_id,
    service_type: serviceType,
    status: 'requested',
    next_url: serviceType === 'ANALYZE_FIT'
      ? `/analyze-fit-request?request=${encodeURIComponent(request.request_id)}&token=${encodeURIComponent(accessToken)}`
      : null,
    message: serviceType === 'ANALYZE_FIT'
      ? 'Your Analyze Fit request has been recorded. Continue to the precompleted contract-specific form to confirm your business information and create the report.'
      : serviceType === 'PROPOSAL_DEVELOPMENT'
        ? 'Your proposal development request has been recorded. APROPOS will use the submitted contact information to continue the engagement.'
        : 'Your Contractor Repository enrollment request has been recorded at $29.99 per month. Billing activation will be completed before the subscription becomes active.'
  };
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (req.method !== 'POST') return json(405, { ok: false, error: 'Method not allowed.' });
  if (!sameOrigin(req)) return json(403, { ok: false, error: 'Same-origin request required.' });
  try {
    const body = await req.json();
    if (safe(body?.website, 200)) return json(200, { ok: true, message: 'Received.' });
    const action = safe(body?.action, 80).toLowerCase();
    if (action === 'review') return json(200, { ok: true, ...(await submitReview(body)) });
    if (action === 'service') return json(200, { ok: true, ...(await submitService(body)) });
    return json(400, { ok: false, error: 'Unsupported action.' });
  } catch (error) {
    return json(400, { ok: false, error: safe(error?.message, 700) || 'Request could not be completed.' });
  }
}

export const config = { path: '/api/opportunity-services' };
