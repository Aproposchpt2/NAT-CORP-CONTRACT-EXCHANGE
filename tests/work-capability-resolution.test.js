const test = require('node:test');
const assert = require('node:assert/strict');

async function mod() {
  return import('../netlify/functions/_shared/command-center-work-capability.mjs');
}

test('normalizes a subject-bound Work Capability profile', async () => {
  const { normalizeWorkCapabilityProfile } = await mod();
  const result = normalizeWorkCapabilityProfile({
    requested_work: 'Remove hazardous trees and grind stumps.',
    work_subjects: ['trees', 'stumps', 'Trees'],
    primary_work_actions: ['tree removal', 'stump grinding'],
    provider_domain: 'Arboriculture and tree care',
    matching_anchors: ['hazardous tree removal', 'stump grinding'],
    who_can_perform_work: 'A professional tree-service or arborist contractor.',
    provider_path: ['Grounds services', 'Tree care', 'Arborist / tree-service contractor'],
    required_service_capabilities: ['tree removal', 'stump grinding'],
    equivalent_service_language: ['arborist services'],
    related_provider_types: ['vegetation management contractor'],
    excluded_neighbor_types: ['general lawn mowing contractor', 'IT maintenance provider'],
    confidence: 'HIGH',
    reasoning: 'The principal subject is trees and stumps, not generic maintenance.',
  });
  assert.equal(result.provider_domain, 'Arboriculture and tree care');
  assert.deepEqual(result.work_subjects, ['trees', 'stumps']);
  assert.equal(result.confidence, 'HIGH');
  assert.match(result.who_can_perform_work, /tree-service|arborist/i);
});

test('rejects a profile without provider-domain protection', async () => {
  const { normalizeWorkCapabilityProfile } = await mod();
  assert.throws(() => normalizeWorkCapabilityProfile({
    work_subjects: ['network infrastructure'],
    primary_work_actions: ['maintenance'],
    matching_anchors: ['network maintenance'],
    who_can_perform_work: 'IT network services provider',
  }), /WORK_CAPABILITY_DOMAIN_REQUIRED/);
});

test('prompt explicitly forbids generic-verb cross-domain routing', async () => {
  const { workCapabilityPrompt } = await mod();
  const prompt = workCapabilityPrompt({
    title: 'Fleet Vehicle Preventive Maintenance',
    issuing_organization: 'City Fleet Services',
    procurement_type: 'RFP',
    description: 'Preventive maintenance and repair of municipal fleet vehicles.',
    requirements: { scope_summary: 'Maintain and repair passenger and light-duty fleet vehicles.' },
  });
  assert.match(prompt, /Generic actions.*MUST remain attached to their subject\/domain/i);
  assert.match(prompt, /mechanic repairs vehicles/i);
  assert.match(prompt, /NOT Contract DNA/i);
  assert.match(prompt, /Extracted scope summary: Maintain and repair passenger and light-duty fleet vehicles/i);
});
