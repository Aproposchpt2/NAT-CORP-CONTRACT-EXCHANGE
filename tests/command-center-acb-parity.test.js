const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('NatCorp Command Center routes to ACB-parity surface and endpoint', () => {
  const redirects = read('_redirects');
  assert.match(redirects, /\/command-center\.html \/command-center-v4\.html 200!/);
  assert.match(redirects, /\/api\/natcorp-command-center \/\.netlify\/functions\/natcorp-command-center-parity 200!/);
});

test('Command Center exposes ACB-equivalent task controls and telemetry', () => {
  const html = read('command-center-v4.html');
  for (const phrase of ['Start a New Task','Cancel Running Task','Live Acquisition Process Meter','Publisher Coverage Execution Log','Current Task Report','Download Error Report']) {
    assert.ok(html.includes(phrase), `missing ${phrase}`);
  }
});

test('Owner acquisition policy is exactly one OpenAI discovery call per publisher', () => {
  const engine = read('netlify/functions/_shared/command-center-openai-discovery-one-call.mjs');
  const runner = read('netlify/functions/_shared/command-center-publisher-runner-parity.mjs');
  assert.equal((engine.match(/fetch\('https:\/\/api\.openai\.com\/v1\/responses'/g) || []).length, 1);
  assert.ok(!engine.includes('MAX_PASSES'));
  assert.ok(runner.includes('runOneCallOpenAIDiscovery'));
  assert.ok(runner.includes('shouldCancel'));
});

test('ACB-parity task reporting is persistent and task scoped', () => {
  const migration = read('supabase/migrations/20260906153000_natcorp_command_center_acb_parity_task_reporting.sql');
  for (const table of ['natcorp_task_sessions','natcorp_discovery_runs','natcorp_extraction_runs','natcorp_acquisition_candidate_decisions']) {
    assert.ok(migration.includes(table), `missing ${table}`);
  }
  const endpoint = read('netlify/functions/natcorp-command-center-parity.mjs');
  assert.ok(endpoint.includes("action==='start_new_task'"));
  assert.ok(endpoint.includes("action==='cancel_task'"));
  assert.ok(endpoint.includes('ONE_OPENAI_CALL_PER_PUBLISHER'));
});

test('Extraction and Work Capability remain idempotent by default', () => {
  const extraction = read('netlify/functions/_shared/command-center-extraction.mjs');
  const work = read('netlify/functions/_shared/command-center-work-capability.mjs');
  assert.ok(extraction.includes("requirements_extraction_status === 'COMPLETE'"));
  assert.ok(extraction.includes('!force'));
  assert.ok(work.includes('!hasCurrentWorkCapability'));
  assert.ok(work.includes('force = false'));
});
