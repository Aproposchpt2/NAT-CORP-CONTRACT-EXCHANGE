// LLM-based contract relevance judgment.
//
// Replaces the keyword/ontology-bucket matcher (aoie-state-scoring.mjs) as
// the actual relevance decision. See the migration comment in
// 20260824190000_aoie_llm_relevance_matching.sql for the full reasoning:
// substring matching cannot distinguish "this contract's core subject
// relates to X" from "the word X appears somewhere in this document" -- a
// regulatory-act citation or a standard confidentiality clause reads
// identically to a real subject-matter match to a keyword matcher. This
// module asks the model to actually read the business profile against the
// contract's real, extracted scope of work and reason about genuine fit,
// citing specific evidence -- the same way a human procurement analyst
// would, not pattern-matching strings.
//
// Moved from Anthropic (Claude Opus 5) to OpenAI 2026-08-25 -- Jeff's
// Anthropic account kept running out of API credits mid-judging (two real
// job failures the same night: one all-96-candidates-failed on a 400
// "credit balance too low", one earlier still stuck at 0 judged), while
// OPENAI_API_KEY on this same project was already funded and already
// proven working (capability-profile.mjs's website-discovery step uses it
// successfully). Judgment prompt/criteria/output shape are unchanged --
// only the vendor call and response parsing changed.

import { createHash } from 'node:crypto';

const VALID_TIERS = new Set(['Strong Match', 'Good Match', 'Review', 'Not Recommended']);

// Stable fingerprint of the parts of a profile that actually affect
// relevance judgment. A verdict is cached per (opportunity, fingerprint)
// pair -- this is what lets an unchanged profile skip re-judging contracts
// it's already been evaluated against, while a real profile edit
// (different services/capabilities/NAICS) correctly triggers fresh
// judgments.
export function profileFingerprint(profile = {}) {
  const canonical = {
    business_name: String(profile.business_name || '').trim(),
    services: [...(profile.services || [])].sort(),
    products: [...(profile.products || [])].sort(),
    capabilities: [...(profile.capabilities || [])].sort(),
    core_competencies: [...(profile.core_competencies || [])].sort(),
    industries: [...(profile.industries || [])].sort(),
    naics_candidates: [...(profile.naics_candidates || [])].sort(),
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
        // effort:'low' + a generous max_output_tokens -- matches
        // capability-profile.mjs's discoverWebsite() call, the only other
        // proven-working GPT-5 Responses-API call in this repo. Learned
        // live 2026-08-25: at effort:'medium' with max_output_tokens:1200,
        // every single candidate silently failed -- reasoning tokens count
        // against the same output budget on GPT-5 reasoning models, so a
        // higher effort at a tight budget can consume the whole thing on
        // hidden reasoning and leave nothing for the actual visible JSON,
        // which then fails extractJsonObject() with no output text at all.
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
  // A tier above "Not Recommended" without relevant:true, or vice versa, is
  // an internally inconsistent verdict -- treat it conservatively as not
  // relevant rather than trusting a contradictory response.
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

  const prompt = `You are a government procurement analyst. Judge whether the contract below is a genuinely relevant business opportunity for the company described, the way an experienced human analyst would -- not by matching keywords, but by understanding what the contract actually requires and what the business actually does.

BUSINESS PROFILE
${profileSummaryText(profile)}

CONTRACT
Title: ${opportunity.title || 'Untitled'}
Issuing organization: ${opportunity.issuing_organization || 'Not provided'}
Procurement type: ${opportunity.procurement_type || 'Not provided'}
${hasRealContent ? requirementsText(opportunity.requirements) || `Description: ${String(opportunity.description || '').slice(0, 4000)}` : 'No substantive scope-of-work text is available for this contract -- only a title and minimal metadata.'}

INSTRUCTIONS
- A contract is relevant only if its actual scope of work -- what the awarded vendor will be doing -- genuinely aligns with what this business does. A word appearing in unrelated boilerplate (a confidentiality clause, a regulatory-compliance citation like HIPAA/HITECH, a generic vendor-conduct requirement) does NOT make a contract relevant, even if that word also appears in the business profile.
- If no substantive scope-of-work text is available (title/metadata only), do not guess relevance from the title alone unless it is unambiguous -- prefer "Not Recommended" with fit_score 0 and say so in reasoning, rather than inferring content that was not provided.
- Cite specific evidence: quote the exact phrase(s) from the contract text that justify your judgment, and explain in your own words why that phrase indicates genuine relevance (or, if judging not-relevant, you may leave evidence empty).
- Do not recommend a contract just because it superficially mentions technology, government, or business services in general -- most government contracts do, regardless of subject.

Return ONLY a single JSON object, no markdown, no commentary, in exactly this shape:
{
  "relevant": true or false,
  "tier": "Strong Match" | "Good Match" | "Review" | "Not Recommended",
  "fit_score": integer 0-100 (0 if not relevant),
  "reasoning": "one or two sentences explaining the judgment in plain language",
  "evidence": [{"quote": "exact phrase from the contract text", "note": "why this phrase indicates genuine relevance"}],
  "concerns": ["any real gaps or risks worth flagging before pursuit, or empty array"]
}`;

  const result = await openaiMessage({ apiKey, model, prompt, fetchImpl });
  const parsed = extractJsonObject(responseText(result));
  return { ...normalizeVerdict(parsed), model, judged_at: new Date().toISOString() };
}
