import { db, json, sameOrigin } from './_shared/natcorp-db.mjs';

const safe = (v, n = 2000) => String(v ?? '').trim().slice(0, n);
const allowedServices = new Set(['ANALYZE_FIT','PROPOSAL_DEVELOPMENT','CONTRACTOR_REPOSITORY_SUBSCRIPTION']);

function validEmail(v) {
  const s = safe(v, 320);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : '';
}

function required(body, key, max = 500) {
  const value = safe(body?.[key], max);
  if (!value) throw new Error(`${key.replaceAll('_',' ')} is required.`);
  return value;
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
  const rows = await db('natcorp_service_requests', 'POST', '', [{
    intake_id: null,
    opportunity_id: null,
    business_profile_id: null,
    service_type: serviceType,
    status: 'requested',
    metadata: {
      source: 'opportunity_services_page',
      business_name: businessName,
      contact_name: safe(body.contact_name, 220) || null,
      contact_email: email,
      contact_phone: safe(body.contact_phone, 80) || null,
      opportunity_reference: safe(body.opportunity_reference, 300) || null,
      notes: safe(body.notes, 2000) || null,
      monthly_price: serviceType === 'CONTRACTOR_REPOSITORY_SUBSCRIPTION' ? 29.99 : null,
      currency: serviceType === 'CONTRACTOR_REPOSITORY_SUBSCRIPTION' ? 'USD' : null
    }
  }], 'return=representation');
  return {
    request_id: rows?.[0]?.request_id,
    service_type: serviceType,
    status: 'requested',
    next_url: serviceType === 'ANALYZE_FIT' ? '/intake' : null,
    message: serviceType === 'ANALYZE_FIT'
      ? 'Your Analyze Fit request has been recorded. Continue to Business Intake to begin the assessment.'
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
