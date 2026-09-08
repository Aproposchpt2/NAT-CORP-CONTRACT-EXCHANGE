// OpenAI-based contract relevance judgment.
//
// Replaces the retired keyword/ontology-bucket matcher as the actual relevance
// decision. NAT-CORP uses OpenAI as its sole active AI processing provider.

import { createHash } from 'node:crypto';

const VALID_TIERS = new Set(['Strong Match', 'Good Match', 'Review', 'Not Recommended']);
export const RELEVANCE_ENGINE_VERSION = 'aoie_llm_relevance_v2';
export const RELEVANCE_PROMPT_VERSION = 'semantic_evidence_v2';

// Stable fingerprint of every material business-side field that can affect
// semantic relevance. Any meaningful profile or matching-concept edit must
// invalidate cached verdicts so stale judgments cannot be reused.
export function profileFingerprint(profile = {}) {
  const sorted = (value) => [...(Array.isArray(value) ? value : [])].map((x) => String(x)).sort();
  const canonical = {
    engine_version: RELEVANCE_ENGINE_VERSION,
    prompt_version: RELEVANCE_PROMPT_VERSION,
    business_name: String(profile.business_name || '').trim(),
    services: sorted(profile.services),
    products: sorted(profile.products),
    capabilities: sorted(profile.capabilities),
    core_competencies: sorted(profile.core_competencies),
    industries: sorted(profile.industries),
    procurement_terms: sorted(profile.procurement_terms),
    relevant_markets: sorted(profile.relevant_markets),
    matching_concepts: sorted(profile.matching_concepts || profile.approved_matching_concepts),
    naics_candidates: sorted(profile.naics_candidates),
    unspsc_candidates: sorted(profile.unspsc_candidates),
    commodity_codes: sorted(profile.commodity_codes),
    summary: String(profile.summary || '').trim(),
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

function profileSummaryText(profile = {}) {
  const list = (label, value) => {
    const items = Array.isArray(value) ? value.filter(Boolean) : [];
    return items.length ? `${label}: ${items.join('; ')}` : '';
  };
  return [
    profile.business_name ? `Business: ${profile.business_name}` : '',
    profile.summary ? `Summary: ${profile.summary}` : '',
    list('Primary services', profile.services),
    list('Products', profile.products),
    list('Capabilities', profile.capabilities),
    list('Core competencies', profile.core_competencies),
    list('Industries served', profile.industries),
    list('Procurement terms', profile.procurement_terms),
    list('Relevant markets', profile.relevant_markets),
    list('Approved matching concepts', profile.matching_concepts || profile.approved_matching_concepts),
    list('Derived NAICS candidates', profile.naics_candidates),
  ].filter(Boolean).join('\n');
}

function requirementsText(requirements) {
  const r = requirements && typeof requirements === 'object' ? requirements : {};
  const section = (label, value) => {
    const items = Array.isArray(value) ? value.filter(Boolean) : [];
    return items.length ? `\n${label}:\n${items.map((x) => `- ${x}`).join('\n')}` : '';
  };
  return [
    section('Scope of work', r.scope_of_work),
    section('Mandatory requirements', r.mandatory_requirements),
    section('Evaluation factors', r.evaluation_factors),
  ].join('').trim();
}

function extractJsonObject(text = '') {
  const cleaned = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first < 0 || last <= first) throw new Error('RELEVANCE_JUDGMENT_JSON_NOT_FOUND');
  return JSON.parse(cleaned.slice(first, last + 1));
}

async function openaiMessage({ apiKey, model, prompt, fetchImpl = fetch, timeoutMs = 90000 }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error('RELEVANCE_JUDGMENT_TIMEOUT')), timeoutMs);
  try {
    const response = await fetchImpl('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        store: false,
        reasoning: { effort: 'low' },
        input: [
          { role: 'system', content: 'You are a meticulous government procurement analyst. Return one valid JSON object and never invent contract content that was not provided.' },
          { role: 'user', content: prompt },
        ],
        max_output_tokens: 3500,
      }),
      signal: controller.signal,
    });
    const bodyText = await response.text();
    if (!response.ok) throw new Error(`RELEVANCE_JUDGMENT_FAILED:${response.status}:${bodyText.slice(0, 500)}`);
    return JSON.parse(bodyText);
  } finally {
    clearTimeout(timeout);
  }
}

function responseText(message) {
  if (typeof message?.output_text === 'string') return message.output_text;
  const parts = [];
  for (const item of message?.output || []) {
    if (item?.type !== 'message') continue;
    for (const content of item.content || []) {
      if (content?.type === 'output_text' && content.text) parts.push(content.text);
    }
  }
  return parts.join('\n');
}

function normalizeVerdict(parsed) {
  const relevant = Boolean(parsed?.relevant);
  const tier = VALID_TIERS.has(parsed?.tier) ? parsed.tier : (relevant ? 'Review' : 'Not Recommended');
  const fitScore = Math.max(0, Math.min(100, Math.round(Number(parsed?.fit_score)) || 0));
  const reasoning = String(parsed?.reasoning || '').trim() || 'No reasoning was returned.';
  const evidence = Array.isArray(parsed?.evidence)
    ? parsed.evidence.filter((e) => e && typeof e === 'object' && e.quote).map((e) => ({ quote: String(e.quote).slice(0, 500), note: String(e.note || '').slice(0, 300) }))
    : [];
  const concerns = Array.isArray(parsed?.concerns) ? parsed.concerns.filter(Boolean).map((c) => String(c).slice(0, 300)) : [];
  const consistentRelevant = relevant && tier !== 'Not Recommended';
  return {
    relevant: consistentRelevant,
    tier: consistentRelevant ? tier : 'Not Recommended',
    fit_score: consistentRelevant ? fitScore : 0,
    reasoning,
    evidence,
    concerns,
  };
}

export async function judgeRelevance({ apiKey, model = 'gpt-5-mini', profile, opportunity, fetchImpl }) {
  if (!apiKey) throw new Error('OPENAI_API_KEY_REQUIRED');
  const reqText = requirementsText(opportunity.requirements);
  const hasRealContent = reqText.length >= 100 || String(opportunity.description || '').length >= 300;

  const prompt = `You are a government procurement analyst. Judge whether the contract below is a genuinely relevant business opportunity for the company described, the way an experienced human analyst would -- not by matching keywords, but by understanding what the contract actually requires and what the business actually does.\n\nBUSINESS PROFILE\n${profileSummaryText(profile)}\n\nCONTRACT\nTitle: ${opportunity.title || 'Untitled'}\nIssuing organization: ${opportunity.issuing_organization || 'Not provided'}\nProcurement type: ${opportunity.procurement_type || 'Not provided'}\n${hasRealContent ? requirementsText(opportunity.requirements) || `Description: ${String(opportunity.description || '').slice(0, 4000)}` : 'No substantive scope-of-work text is available for this contract -- only a title and minimal metadata.'}\n\nINSTRUCTIONS\n- A contract is relevant only if its actual scope of work genuinely aligns with evidence-supported capabilities of this business.\n- Semantic expansion may broaden terminology and conceptual representation, but it must never invent or broaden the contractor's actual capability.\n- Never alter, weaken, remove, replace, or invent a government requirement.\n- A word appearing in unrelated boilerplate does NOT make a contract relevant.\n- If substantive scope-of-work text is unavailable, do not guess relevance from an ambiguous title; prefer Not Recommended.\n- Cite specific contract evidence for a positive relevance judgment.\n- Do not recommend a contract merely because it superficially mentions technology, government, or business services.\n\nReturn ONLY one JSON object in exactly this shape:\n{\n  "relevant": true or false,\n  "tier": "Strong Match" | "Good Match" | "Review" | "Not Recommended",\n  "fit_score": integer 0-100 (0 if not relevant),\n  "reasoning": "one or two sentences explaining the judgment in plain language",\n  "evidence": [{"quote": "exact phrase from the contract text", "note": "why this phrase indicates genuine relevance"}],\n  "concerns": ["any real gaps or risks worth flagging before pursuit, or empty array"]\n}`;

  const result = await openaiMessage({ apiKey, model, prompt, fetchImpl });
  const parsed = extractJsonObject(responseText(result));
  return { ...normalizeVerdict(parsed), model, engine_version: RELEVANCE_ENGINE_VERSION, prompt_version: RELEVANCE_PROMPT_VERSION, judged_at: new Date().toISOString() };
}
