import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { profileFingerprint, judgeRelevance, RELEVANCE_ENGINE_VERSION } from '../netlify/functions/_shared/aoie-llm-relevance.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

test('semantic profile fingerprint is order-stable but changes for material semantic edits', () => {
  const base = {
    business_name: 'Example Co',
    services: ['Cloud hosting', 'Cybersecurity'],
    procurement_terms: ['managed services'],
    relevant_markets: ['public sector'],
    matching_concepts: ['infrastructure modernization'],
    naics_candidates: ['541512'],
    summary: 'Technology services company',
  };
  const reordered = { ...base, services: [...base.services].reverse() };
  assert.equal(profileFingerprint(base), profileFingerprint(reordered));
  assert.notEqual(profileFingerprint(base), profileFingerprint({ ...base, procurement_terms: ['managed services', 'IT operations'] }));
  assert.notEqual(profileFingerprint(base), profileFingerprint({ ...base, relevant_markets: ['public sector', 'education'] }));
  assert.notEqual(profileFingerprint(base), profileFingerprint({ ...base, matching_concepts: ['infrastructure modernization', 'data center operations'] }));
});

test('relevance judgment uses OpenAI Responses API and returns explainable verdict', async () => {
  let calledUrl = '';
  const fetchImpl = async (url, options) => {
    calledUrl = String(url);
    const body = JSON.parse(options.body);
    assert.equal(body.model, 'gpt-5-mini');
    assert.match(JSON.stringify(body), /Semantic expansion may broaden terminology/);
    return {
      ok: true,
      text: async () => JSON.stringify({ output_text: JSON.stringify({ relevant: true, tier: 'Good Match', fit_score: 78, reasoning: 'The scope aligns with managed infrastructure services.', evidence: [{ quote: 'managed hosting and infrastructure operations', note: 'Direct scope alignment' }], concerns: [] }) }),
    };
  };
  const verdict = await judgeRelevance({
    apiKey: 'test-key',
    model: 'gpt-5-mini',
    profile: { business_name: 'Example Co', services: ['managed infrastructure services'] },
    opportunity: { title: 'Infrastructure Operations', issuing_organization: 'Test Agency', procurement_type: 'RFP', requirements: { scope_of_work: ['Provide managed hosting and infrastructure operations for agency systems and support ongoing platform availability.'] }, description: 'x'.repeat(350) },
    fetchImpl,
  });
  assert.equal(calledUrl, 'https://api.openai.com/v1/responses');
  assert.equal(verdict.relevant, true);
  assert.equal(verdict.fit_score, 78);
  assert.equal(verdict.engine_version, RELEVANCE_ENGINE_VERSION);
  assert.ok(verdict.evidence.length > 0);
});

test('matching worker cannot mark a partial candidate review completed', () => {
  const worker = read('netlify/functions/aoie-llm-relevance-run-background.mjs');
  assert.match(worker, /if \(judged !== candidates\.length\)/);
  assert.match(worker, /status: 'FAILED'/);
  assert.match(worker, /Partial contract review:/);
  assert.match(worker, /status: 'COMPLETED', judged_candidates: judged/);
  assert.match(worker, /Number\(match\.judged_candidates \|\| 0\) !== Number\(match\.total_candidates \|\| 0\)/);
});

test('missing durable relevance job is queued rather than reported as a zero-match completion', () => {
  const endpoint = read('netlify/functions/aoie-state-shadow.mjs');
  assert.match(endpoint, /status: job\?\.status \|\| 'QUEUED'/);
  assert.match(endpoint, /durable_job_created: Boolean\(job\)/);
});

test('browser profile injection remains forbidden while internal controlled profile input remains supported', () => {
  const candidates = read('netlify/functions/_shared/aoie-candidates.mjs');
  assert.match(candidates, /authMode === 'internal' && payload\?\.profile/);
  assert.match(candidates, /loadProfileSession\(req\)/);
  assert.match(candidates, /session\.discovery_status !== 'verified'/);
  assert.match(candidates, /source: 'verified-session'/);
});

test('OpenAI-only runtime guard blocks Anthropic configuration', async () => {
  process.env.ANTHROPIC_API_KEY = 'must-not-be-visible';
  process.env.ANTHROPIC_MODEL = 'must-not-be-visible';
  const mod = await import(`../netlify/functions/_shared/natcorp-db.mjs?openaiOnly=${Date.now()}`);
  assert.equal(mod.env('ANTHROPIC_API_KEY'), '');
  assert.equal(mod.env('ANTHROPIC_MODEL'), '');
});

test('active relevance and state Analyze Fit processing do not call Anthropic endpoints', () => {
  const relevance = read('netlify/functions/_shared/aoie-llm-relevance.mjs');
  const worker = read('netlify/functions/aoie-llm-relevance-run-background.mjs');
  const stateFit = read('netlify/functions/analyze-fit-state.mjs');
  assert.doesNotMatch(relevance, /api\.anthropic\.com|anthropicAnalyze/);
  assert.doesNotMatch(worker, /api\.anthropic\.com|anthropicAnalyze/);
  assert.doesNotMatch(stateFit, /api\.anthropic\.com|anthropicAnalyze/);
});
