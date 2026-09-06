import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const discovery = readFileSync(new URL('../netlify/functions/_shared/command-center-openai-discovery.mjs', import.meta.url), 'utf8');
const extraction = readFileSync(new URL('../netlify/functions/_shared/command-center-extraction.mjs', import.meta.url), 'utf8');
const workCapability = readFileSync(new URL('../netlify/functions/_shared/command-center-work-capability.mjs', import.meta.url), 'utf8');
const acquisition = readFileSync(new URL('../netlify/functions/_shared/command-center-acquisition.mjs', import.meta.url), 'utf8');

test('owner acquisition policy limits OpenAI discovery to one call per publisher', () => {
  assert.match(discovery, /const MAX_PASSES = 1;/);
  assert.match(discovery, /single and only discovery call for this publisher/i);
  assert.doesNotMatch(discovery, /const MAX_PASSES = [2-9]/);
});

test('acquisition persistence deduplicates previously seen authoritative URLs', () => {
  assert.match(acquisition, /sourceFingerprint = await sha256\(url\)/);
  assert.match(acquisition, /source_fingerprint=eq\.\$\{sourceFingerprint\}/);
  assert.match(acquisition, /return 'updated'/);
});

test('extraction remains idempotent unless explicitly reprocessed', () => {
  assert.match(extraction, /if \(!force && opportunity\.requirements_extraction_status === 'COMPLETE'\)/);
  assert.match(extraction, /ALREADY_COMPLETE/);
});

test('Work Capability remains idempotent and force is explicit', () => {
  assert.match(workCapability, /if \(force \|\| !hasCurrentWorkCapability\(row\)\) targets\.push\(row\)/);
  assert.match(workCapability, /force = false/);
});
