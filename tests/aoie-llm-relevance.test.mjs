import test from 'node:test';
import assert from 'node:assert/strict';
import { judgeRelevance, profileFingerprint } from '../netlify/functions/_shared/aoie-llm-relevance.mjs';

// Mocks the OpenAI Responses API shape (moved off Anthropic 2026-08-25 --
// see _shared/aoie-llm-relevance.mjs for why).
function fakeFetch(responseBody) {
  return async () => ({
    ok: true,
    status: 200,
    async text() {
      return JSON.stringify({ output_text: JSON.stringify(responseBody) });
    },
  });
}

const profile = {
  business_name: 'Apropos Group LLC',
  services: ['Procurement Intelligence / Opportunity Discovery'],
  capabilities: ['AI Voice Systems / Conversational AI for inbound call handling', 'Government Technology — custom software, AI, data engineering, cloud integrations'],
  core_competencies: ['Procurement opportunity matching and decision intelligence'],
  industries: ['Government / Public Sector'],
  naics_candidates: ['541511', '541512'],
};

const opportunity = {
  title: 'Voting Solutions Enhancements and Support Services',
  issuing_organization: 'County of Los Angeles',
  procurement_type: 'RFSQ',
  requirements: {
    scope_of_work: ['The Contractor shall provide voting system software enhancements and ongoing election technology support.'],
  },
};

test('a genuinely relevant judgment is returned in the expected shape', async () => {
  const verdict = await judgeRelevance({
    apiKey: 'test',
    profile,
    opportunity,
    fetchImpl: fakeFetch({
      relevant: true,
      tier: 'Good Match',
      fit_score: 72,
      reasoning: 'The contract requires custom voting system software support, matching the business\'s government technology capability.',
      evidence: [{ quote: 'voting system software enhancements', note: 'Direct alignment with custom software/government technology capability.' }],
      concerns: ['Confirm election-system security clearance requirements.'],
    }),
  });
  assert.equal(verdict.relevant, true);
  assert.equal(verdict.tier, 'Good Match');
  assert.equal(verdict.fit_score, 72);
  assert.equal(verdict.evidence.length, 1);
  assert.equal(verdict.concerns.length, 1);
});

test('an internally inconsistent verdict (relevant=true, tier=Not Recommended) is treated conservatively', async () => {
  const verdict = await judgeRelevance({
    apiKey: 'test',
    profile,
    opportunity,
    fetchImpl: fakeFetch({
      relevant: true,
      tier: 'Not Recommended',
      fit_score: 60,
      reasoning: 'Contradictory model output.',
    }),
  });
  assert.equal(verdict.relevant, false, 'a contradictory response must not be trusted as relevant');
  assert.equal(verdict.tier, 'Not Recommended');
  assert.equal(verdict.fit_score, 0);
});

test('an invalid tier string falls back to a safe default based on relevant', async () => {
  const verdict = await judgeRelevance({
    apiKey: 'test',
    profile,
    opportunity,
    fetchImpl: fakeFetch({ relevant: true, tier: 'Excellent Fit!!', fit_score: 90, reasoning: 'x' }),
  });
  assert.equal(verdict.tier, 'Review', 'an unrecognized tier string should not be trusted verbatim');
});

test('malformed evidence/concerns fields degrade to empty arrays rather than throwing', async () => {
  const verdict = await judgeRelevance({
    apiKey: 'test',
    profile,
    opportunity,
    fetchImpl: fakeFetch({ relevant: false, tier: 'Not Recommended', fit_score: 0, reasoning: 'x', evidence: 'not an array', concerns: null }),
  });
  assert.deepEqual(verdict.evidence, []);
  assert.deepEqual(verdict.concerns, []);
});

test('profile fingerprint is stable for identical content and changes with real edits', () => {
  const a = profileFingerprint(profile);
  const b = profileFingerprint({ ...profile, services: [...profile.services] });
  assert.equal(a, b, 'identical profile content must fingerprint identically');

  const edited = profileFingerprint({ ...profile, services: [...profile.services, 'A new declared service'] });
  assert.notEqual(a, edited, 'a real profile edit must change the fingerprint so it gets re-judged');
});

console.log('AOIE LLM relevance judgment fixture suite complete.');
