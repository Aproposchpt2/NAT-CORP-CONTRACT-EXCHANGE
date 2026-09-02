import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { profileFingerprint, judgeRelevance, RELEVANCE_ENGINE_VERSION } from '../netlify/functions/_shared/aoie-llm-relevance.mjs';
import { resolveOwnerAuthority } from '../netlify/functions/_shared/aoie-candidates.mjs';
import { exactStateSetMatch, jobAuthorityMatches } from '../netlify/functions/aoie-state-shadow.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

const OWNER_A = '11111111-1111-4111-8111-111111111111';
const OWNER_B = '22222222-2222-4222-8222-222222222222';
const FINGERPRINT = 'same-semantic-profile';

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
  assert.doesNotMatch(endpoint, /\|\| \(rows \|\| \[\]\)\[0\] \|\| null/);
});

test('geographic job authority requires an exact normalized state set', () => {
  assert.equal(exactStateSetMatch(['CA', 'AZ', 'NV'], ['NV', 'CA', 'AZ']), true);
  assert.equal(exactStateSetMatch(['CA'], ['AZ', 'CA', 'NV']), false);
  assert.equal(exactStateSetMatch(['CA'], ['CA', 'NV']), false);
  assert.equal(exactStateSetMatch(['CA', 'NV'], ['CA']), false);
  assert.equal(exactStateSetMatch(['CA'], ['NV']), false);
  assert.equal(exactStateSetMatch(['ca', 'AZ', 'NV', 'CA'], ['NV', 'CA', 'AZ']), true);
});

test('invalid or empty geographic scope cannot inherit completion truth', () => {
  assert.equal(exactStateSetMatch(['CA'], []), false);
  assert.equal(exactStateSetMatch(['CA'], ['not-a-state']), false);
  assert.equal(exactStateSetMatch([], []), false);
});

test('same semantic profile and states remain isolated across different owners', () => {
  const ownerAJob = { owner_intake_id: OWNER_A, profile_fingerprint: FINGERPRINT, states: ['AZ', 'CA', 'NV'] };
  assert.equal(jobAuthorityMatches(ownerAJob, { ownerIntakeId: OWNER_B, fingerprint: FINGERPRINT, states: ['NV', 'CA', 'AZ'] }), false);
});

test('same owner same profile and same normalized states may reuse an authoritative job', () => {
  const job = { owner_intake_id: OWNER_A, profile_fingerprint: FINGERPRINT, states: ['AZ', 'CA', 'NV'] };
  assert.equal(jobAuthorityMatches(job, { ownerIntakeId: OWNER_A, fingerprint: FINGERPRINT, states: ['NV', 'AZ', 'CA'] }), true);
});

test('same owner with changed profile fingerprint cannot reuse old job authority', () => {
  const job = { owner_intake_id: OWNER_A, profile_fingerprint: FINGERPRINT, states: ['AZ', 'CA', 'NV'] };
  assert.equal(jobAuthorityMatches(job, { ownerIntakeId: OWNER_A, fingerprint: 'changed-profile', states: ['AZ', 'CA', 'NV'] }), false);
});

test('same owner with different geography cannot reuse old job authority', () => {
  const job = { owner_intake_id: OWNER_A, profile_fingerprint: FINGERPRINT, states: ['CA'] };
  assert.equal(jobAuthorityMatches(job, { ownerIntakeId: OWNER_A, fingerprint: FINGERPRINT, states: ['CA', 'NV'] }), false);
});

test('different owner and profile remain fully isolated and legacy ownerless jobs are non-authoritative', () => {
  const job = { owner_intake_id: OWNER_A, profile_fingerprint: 'owner-a-profile', states: ['CA'] };
  assert.equal(jobAuthorityMatches(job, { ownerIntakeId: OWNER_B, fingerprint: 'owner-b-profile', states: ['CA'] }), false);
  assert.equal(jobAuthorityMatches({ profile_fingerprint: FINGERPRINT, states: ['CA'] }, { ownerIntakeId: OWNER_A, fingerprint: FINGERPRINT, states: ['CA'] }), false);
});

test('semantic cache is reusable computation but customer verdict presentation is job-bound', () => {
  const worker = read('netlify/functions/aoie-llm-relevance-run-background.mjs');
  const endpoint = read('netlify/functions/aoie-state-shadow.mjs');
  assert.match(worker, /cachedVerdict\(opportunity\.id, job\.profile_fingerprint\)/);
  assert.match(worker, /linkVerdictToJob\(job, cached\)/);
  assert.match(worker, /linkVerdictToJob\(job, persisted\)/);
  assert.match(endpoint, /aoie_llm_relevance_job_verdicts/);
  assert.match(endpoint, /job_id=eq\./);
  assert.doesNotMatch(endpoint, /relevantVerdicts\(fingerprint\)/);
});

test('internal mode requires explicit trusted owner authority while browser authority comes from verified session', () => {
  const internalResolved = { profile: { business_name: 'Example Co' }, session: null };
  assert.equal(resolveOwnerAuthority(internalResolved, {}, 'internal'), null);
  assert.deepEqual(resolveOwnerAuthority(internalResolved, { owner_intake_id: OWNER_A }, 'internal'), {
    owner_intake_id: OWNER_A,
    source: 'trusted-internal-request',
  });
  const customerResolved = { session: { intake_id: OWNER_B } };
  assert.deepEqual(resolveOwnerAuthority(customerResolved, {}, 'anonymous-same-origin'), {
    owner_intake_id: OWNER_B,
    source: 'verified-session',
  });
});

test('owner authority migration is additive, preserves legacy jobs, and protects the server-only link table', () => {
  const migration = read('supabase/migrations/20260826192000_aoie_llm_relevance_owner_authority.sql');
  assert.match(migration, /add column if not exists owner_intake_id uuid/);
  assert.match(migration, /references public\.natcorp_business_intakes\(intake_id\)/);
  assert.match(migration, /aoie_llm_relevance_job_verdicts/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all .* anon, authenticated/);
  assert.doesNotMatch(migration, /delete from public\.aoie_llm_relevance_jobs/i);
});

test('browser profile injection remains forbidden while internal controlled profile input remains supported', () => {
  const candidates = read('netlify/functions/_shared/aoie-candidates.mjs');
  assert.match(candidates, /authMode === 'internal' && payload\?\.profile/);
  assert.match(candidates, /loadProfileSession\(req\)/);
  assert.match(candidates, /session\.discovery_status !== 'verified'/);
  assert.match(candidates, /source: 'verified-session'/);
  assert.match(candidates, /payload\?\.owner_intake_id/);
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