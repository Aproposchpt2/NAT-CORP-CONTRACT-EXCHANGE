import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('admitted-contract control fails closed and requires evidence', async () => {
  const source = await read('netlify/functions/_shared/admitted-contract-control.mjs');
  for (const token of [
    'ADMITTED_CONTRACT_ID_REQUIRED',
    'NOT_ADMITTED',
    'ADMISSION_REVOKED',
    'CONTRACT_SUPERSEDED',
    'CONTRACT_EXPIRED',
    'OFFICIAL_SOURCE_EVIDENCE_INVALID',
    'CONTACT_EVIDENCE_INVALID',
    'SCOPE_EVIDENCE_INVALID',
    'REQUIREMENTS_EVIDENCE_INVALID',
    'ADMISSION_EVALUATION_REQUIRED',
    'ADMISSION_POLICY_REQUIRED',
  ]) assert.match(source, new RegExp(token));
  assert.match(source, /admitted_contracts_current/);
  assert.match(source, /apios_natcorp_delivery_current_v2/);
  assert.doesNotMatch(source, /natcorp_release_status\s*=\s*['"]eligible/);
});

test('Analyze Fit admitted entry point validates before legacy analysis', async () => {
  const source = await read('netlify/functions/analyze-fit-admitted-state.mjs');
  const validation = source.indexOf('requireCurrentAdmission');
  const execution = source.indexOf('legacyAnalyzeFit(legacyRequest)');
  assert.ok(validation >= 0 && execution > validation);
  assert.match(source, /CANDIDATE_ADMISSION_MISMATCH/);
});

test('NAT-CORP delivery endpoint is shadow-only and admitted-view backed', async () => {
  const source = await read('netlify/functions/natcorp-admitted-delivery-shadow.mjs');
  assert.match(source, /mode:\s*'shadow'/);
  assert.match(source, /customer_cutover:\s*false/);
  assert.match(source, /listCurrentDeliveries/);
  assert.match(source, /compareLegacyAndAdmittedCounts/);
});
