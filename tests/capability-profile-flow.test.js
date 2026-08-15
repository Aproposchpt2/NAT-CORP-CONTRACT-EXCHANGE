const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

test('customer-facing flow does not use browser profile storage or URL profile handoff', () => {
  for (const file of ['welcome.html', 'profile-review.html', 'aois-dashboard-preview.html', 'business-dna-builder-preview.html']) {
    const text = read(file);
    assert.doesNotMatch(text, /localStorage/i, `${file} must not use localStorage`);
    assert.doesNotMatch(text, /#profile=/i, `${file} must not pass profiles in URL fragments`);
  }
});

test('intake contains only approved business identity fields', () => {
  const text = read('welcome.html');
  for (const id of ['contactName','businessName','businessEmail','website','visitorEmail']) assert.match(text, new RegExp(`id="${id}"`));
  for (const retired of ['entityType','contactTitle','phone','dba','modeGrid']) assert.doesNotMatch(text, new RegExp(`id="${retired}"`));
});

test('profile verification is a formal gate before dashboard', () => {
  const text = read('profile-review.html');
  assert.match(text, /Profile Is Correct/);
  assert.match(text, /Edit Profile/);
  assert.match(text, /action:'confirm'/);
  assert.match(text, /location\.assign\('\/dashboard'\)/);
});

test('dashboard exposes only All States and Resident State geography views', () => {
  const text = read('aois-dashboard-preview.html');
  assert.match(text, /<option value="all">All States<\/option>/);
  assert.match(text, /<option value="resident">Resident State<\/option>/);
  assert.doesNotMatch(text, /All selected states/);
});

test('server profile flow uses HttpOnly session cookie and official-domain web discovery', () => {
  const session = read('netlify/functions/_shared/natcorp-profile-session.mjs');
  const endpoint = read('netlify/functions/capability-profile.mjs');
  assert.match(session, /HttpOnly; Secure; SameSite=Lax/);
  assert.match(endpoint, /allowed_domains: \[domain\]/);
  assert.match(endpoint, /geographic_search_scope: 'all_states'/);
  assert.match(endpoint, /verification_status: 'USER_CONFIRMED'/);
});

test('direct APIE fallback uses package and match-readiness gates instead of legacy Nat-Corp QA labels', () => {
  const text = read('netlify/functions/aoie-state-shadow.mjs');
  assert.match(text, /package_status: 'eq\.PACKAGE_COMPLETE'/);
  assert.match(text, /requirements_extraction_status: 'eq\.COMPLETE'/);
  assert.match(text, /match_readiness_status: 'eq\.MATCH_READY'/);
  assert.doesNotMatch(text, /filterReleaseReadyOpportunities/);
});

test('same-origin browser callers cannot inject an unverified request profile', () => {
  const text = read('netlify/functions/aoie-state-shadow.mjs');
  assert.match(text, /authMode === 'internal' && payload\?\.profile/);
  assert.match(text, /source: 'verified-session'/);
});
