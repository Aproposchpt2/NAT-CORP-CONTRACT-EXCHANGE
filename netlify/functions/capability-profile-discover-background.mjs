import { db, env, nowIso, sameOrigin } from './_shared/natcorp-db.mjs';
import {
  asArray,
  loadProfileSession,
  sameBusinessDomain,
  safe,
} from './_shared/natcorp-profile-session.mjs';

const PROFILE_VERSION = 'natcorp_web_capability_v1';

function uniqueStrings(values, max = 40) {
  return [...new Set(asArray(values).map((value) => safe(typeof value === 'object' ? value?.name : value, 240)).filter(Boolean))].slice(0, max);
}

function evidenceItems(values, domain, max = 30) {
  const result = [];
  for (const raw of asArray(values).slice(0, max * 2)) {
    const name = safe(raw?.name || raw?.capability || raw?.service || raw?.product, 240);
    if (!name) continue;
    const sourceUrl = safe(raw?.source_url, 700);
    if (sourceUrl && !sameBusinessDomain(sourceUrl, domain)) continue;
    result.push({
      name,
      evidence: safe(raw?.evidence || raw?.basis, 1200),
      source_url: sourceUrl || null,
      confidence: ['HIGH', 'MEDIUM', 'LOW'].includes(safe(raw?.confidence).toUpperCase()) ? safe(raw?.confidence).toUpperCase() : 'MEDIUM',
    });
    if (result.length >= max) break;
  }
  return result;
}

function classificationItems(values, domain, max = 20) {
  const seen = new Set();
  const out = [];
  for (const raw of asArray(values)) {
    const code = safe(raw?.code, 12).replace(/[^0-9]/g, '');
    if (code.length < 2 || code.length > 8 || seen.has(code)) continue;
    const sourceUrl = safe(raw?.source_url, 700);
    if (sourceUrl && !sameBusinessDomain(sourceUrl, domain)) continue;
    seen.add(code);
    out.push({
      code,
      description: safe(raw?.description, 300),
      basis: safe(raw?.basis || raw?.evidence, 1000),
      source_url: sourceUrl || null,
      confidence: ['HIGH', 'MEDIUM', 'LOW'].includes(safe(raw?.confidence).toUpperCase()) ? safe(raw?.confidence).toUpperCase() : 'MEDIUM',
      authority: 'DERIVED',
    });
    if (out.length >= max) break;
  }
  return out;
}

function extractResponseText(data) {
  if (typeof data?.output_text === 'string') return data.output_text;
  const parts = [];
  for (const item of asArray(data?.output)) {
    if (item?.type !== 'message') continue;
    for (const content of asArray(item.content)) {
      if (content?.type === 'output_text' && content.text) parts.push(content.text);
    }
  }
  return parts.join('\n');
}

function parseJsonText(text) {
  const value = safe(text, 30000).replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
  try { return JSON.parse(value); } catch {}
  const start = value.indexOf('{');
  const end = value.lastIndexOf('}');
  if (start >= 0 && end > start) return JSON.parse(value.slice(start, end + 1));
  throw new Error('Website discovery did not return valid structured data.');
}

async function discoverWebsite(session) {
  const key = env('OPENAI_API_KEY');
  if (!key) throw new Error('Business website discovery is unavailable because the OpenAI API is not configured.');
  const domain = session.canonical_domain;
  if (!domain) throw new Error('The business website domain is unavailable.');
  const model = env('OPENAI_CAPABILITY_DISCOVERY_MODEL') || 'gpt-5-mini';
  const prompt = `NAT-CORP WEBSITE CAPABILITY DISCOVERY\n\nBusiness submitted name: ${session.business_name}\nOfficial website: ${session.website}\nOfficial domain: ${domain}\n\nMission: understand what this business actually provides so NAT-CORP can build a contract-search capability profile. Use ONLY pages on the allowed official business domain. Prefer homepage, services, capabilities, products, solutions, industries, markets, about, projects/portfolio, government/public-sector, certifications, and other relevant internal pages. Never infer a capability solely because it is common in the industry. Never invent services, products, licenses, certifications, customers, locations, NAICS codes, or source URLs. If evidence is insufficient, say so.\n\nFor every service, product, capability, and core competency, retain a short evidence statement and the official source URL. Resident state may be returned only when the official site provides credible business-location evidence. NAICS values are recommendations derived from website evidence; they are never authoritative company-supplied codes unless the site explicitly states them.\n\nReturn ONLY JSON using this exact shape:\n{\n  "business_identity":{"confirmed_name":"","summary":"","resident_state":"","resident_city":"","location_source_url":""},\n  "services":[{"name":"","evidence":"","source_url":"","confidence":"HIGH|MEDIUM|LOW"}],\n  "products":[{"name":"","evidence":"","source_url":"","confidence":"HIGH|MEDIUM|LOW"}],\n  "capabilities":[{"name":"","evidence":"","source_url":"","confidence":"HIGH|MEDIUM|LOW"}],\n  "core_competencies":[{"name":"","evidence":"","source_url":"","confidence":"HIGH|MEDIUM|LOW"}],\n  "industries":[],\n  "procurement_terms":[],\n  "naics_candidates":[{"code":"","description":"","basis":"","source_url":"","confidence":"HIGH|MEDIUM|LOW"}],\n  "source_urls":[],\n  "discovery_confidence":"HIGH|MEDIUM|LOW",\n  "insufficient_evidence":false\n}`;

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      store: false,
      reasoning: { effort: 'low' },
      input: [
        { role: 'system', content: 'Use current public web evidence from the allowed business domain only. Return one valid JSON object and never invent evidence.' },
        { role: 'user', content: prompt },
      ],
      tools: [{ type: 'web_search', filters: { allowed_domains: [domain] }, search_context_size: 'low' }],
      max_output_tokens: 3500,
    }),
    signal: AbortSignal.timeout(90000),
  });

  const raw = await response.text();
  if (!response.ok) throw new Error(`Business website discovery failed (${response.status}): ${raw.slice(0, 450)}`);
  const parsed = parseJsonText(extractResponseText(JSON.parse(raw)));
  const identity = parsed?.business_identity || {};
  const locationSource = sameBusinessDomain(identity.location_source_url, domain) ? safe(identity.location_source_url, 700) : null;
  const state = safe(identity.resident_state, 2).toUpperCase();
  const residentState = /^[A-Z]{2}$/.test(state) ? state : null;
  const sourceUrls = uniqueStrings(asArray(parsed?.source_urls).filter((url) => sameBusinessDomain(url, domain)), 30);
  const services = evidenceItems(parsed?.services, domain);
  const products = evidenceItems(parsed?.products, domain);
  const capabilities = evidenceItems(parsed?.capabilities, domain);
  const coreCompetencies = evidenceItems(parsed?.core_competencies, domain);
  const confidenceLabel = ['HIGH', 'MEDIUM', 'LOW'].includes(safe(parsed?.discovery_confidence).toUpperCase()) ? safe(parsed.discovery_confidence).toUpperCase() : 'MEDIUM';
  const evidenceCount = services.length + products.length + capabilities.length + coreCompetencies.length;

  return {
    profile_version: PROFILE_VERSION,
    business_name: safe(identity.confirmed_name, 240) || session.business_name,
    submitted_business_name: session.business_name,
    website: session.website,
    canonical_domain: domain,
    summary: safe(identity.summary, 1600),
    resident_state: residentState,
    resident_city: safe(identity.resident_city, 160) || null,
    location_source_url: locationSource,
    services,
    products,
    capabilities,
    core_competencies: coreCompetencies,
    industries: uniqueStrings(parsed?.industries, 30),
    procurement_terms: uniqueStrings(parsed?.procurement_terms, 60),
    naics_candidates: classificationItems(parsed?.naics_candidates, domain),
    source_urls: sourceUrls,
    discovery_confidence: confidenceLabel,
    insufficient_evidence: Boolean(parsed?.insufficient_evidence) || evidenceCount === 0,
    evidence_count: evidenceCount,
    discovered_at: nowIso(),
    model,
  };
}

export default async function handler(req) {
  if (req.method !== 'POST' || !sameOrigin(req)) return;
  const session = await loadProfileSession(req);
  if (!session) return;
  if (session.discovery_status === 'verified') return;
  if (session.discovery_status === 'review_ready' && session.draft_profile?.profile_version === PROFILE_VERSION) return;

  await db('natcorp_business_intakes', 'PATCH', `?intake_id=eq.${encodeURIComponent(session.intake_id)}`, {
    discovery_status: 'discovering',
    last_error: null,
    updated_at: nowIso(),
  }, 'return=minimal');

  try {
    const draft = await discoverWebsite(session);
    const evidence = [
      ...draft.services,
      ...draft.products,
      ...draft.capabilities,
      ...draft.core_competencies,
    ].filter((item) => item.source_url || item.evidence);

    await db('natcorp_business_intakes', 'PATCH', `?intake_id=eq.${encodeURIComponent(session.intake_id)}`, {
      discovery_status: 'review_ready',
      draft_profile: draft,
      discovery_evidence: evidence,
      resident_state: draft.resident_state,
      last_error: null,
      updated_at: nowIso(),
    }, 'return=minimal');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Business website discovery failed.';
    await db('natcorp_business_intakes', 'PATCH', `?intake_id=eq.${encodeURIComponent(session.intake_id)}`, {
      discovery_status: 'failed',
      last_error: safe(message, 1200),
      updated_at: nowIso(),
    }, 'return=minimal').catch(() => {});
    console.error('[capability-profile-discover-background]', error);
  }
}

export const config = {
  path: '/api/capability-profile-discover',
};
