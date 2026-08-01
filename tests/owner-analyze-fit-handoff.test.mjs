import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const endpoint = fs.readFileSync(new URL('../netlify/functions/owner-analyze-fit-handoff.mjs', import.meta.url), 'utf8');
const page = fs.readFileSync(new URL('../netlify/functions/opportunity-fulfillment-page.mjs', import.meta.url), 'utf8');

test('owner handoff creates a scoped contract-specific Analyze Fit URL', () => {
  assert.match(endpoint, /service_type: 'ANALYZE_FIT'/);
  assert.match(endpoint, /analyze-fit-request\?request=/);
  assert.match(endpoint, /analyze_fit_access_hash/);
  assert.match(endpoint, /candidate_id/);
  assert.match(endpoint, /opportunity_id/);
  assert.match(endpoint, /outreach_id/);
});

test('interested OTF response triggers owner handoff email creation', () => {
  assert.match(page, /record_response/);
  assert.match(page, /INTERESTED/);
  assert.match(page, /\/api\/owner-analyze-fit-handoff/);
});
