const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

test('customer-facing flow does not use browser profile storage or URL profile handoff', () => {
  for (const file of ['welcome.html', 'profile-building.html', 'profile-review.html', 'aois-dashboard-preview.html', 'business-dna-builder-preview.html']) {
    const text = read(file);
    assert.doesNotMatch(text, /localStorage/i, `${file} must not use localStorage`);
    assert.doesNotMatch(text, /#profile=/i, `${file} must not pass profiles in URL fragments`);
  }
});

test('free-trial intake contains exactly the three approved identity fields', () => {
  const text = read('welcome.html');
  for (const id of ['contactName','businessName','businessEmail']) assert.match(text, new RegExp(`id="${id}"`));
  for (const retired of ['website','entityType','contactTitle','phone','dba','modeGrid','visitorEmail']) assert.doesNotMatch(text, new RegExp(`id="${retired}"`));
});

test('intake creates the server session and redirects directly to site access', () => {
  const text = read('welcome.html');
  assert.match(text, /await api\(payload\)/);
  assert.match(text, /location\.assign\('\/aois-dashboard-preview\.html'\)/);
  assert.doesNotMatch(text, /action:'discover'/);
  assert.doesNotMatch(text, /capability-profile-discover/);
});

test('profile build landing starts background Agent and shows persisted activity progress', () => {
  const text = read('profile-building.html');
  assert.match(text, /Nat-Corp is building/);
  assert.match(text, /Activity Progress/);
  assert.match(text, /capability-profile-discover/);
  assert.match(text, /fetch\(["']\/api\/capability-profile["']/);
  for (const stage of ['Website validation','Agent website search','Evidence review','Capability extraction','Business profile build','Ready for review']) {
    assert.match(text, new RegExp(stage));
  }
  assert.match(text, /Review My Business Profile/);
});

test('website discovery runs as a Netlify background function with real activity checkpoints', () => {
  const background = read('netlify/functions/capability-profile-discover-background.mjs');
  assert.match(background, /allowed_domains: \[domain\]/);
  assert.match(background, /setActivity\(session, 'website_validation'/);
  assert.match(background, /setActivity\(session, 'agent_search'/);
  assert.match(background, /setActivity\(session, 'evidence_review'/);
  assert.match(background, /setActivity\(session, 'capability_extraction'/);
  assert.match(background, /setActivity\(session, 'profile_build'/);
  assert.match(background, /stage: 'review_ready'/);
  assert.match(background, /discovery_status=in\.\(intake_created,failed\)/);
});

test('profile verification is a formal gate before dashboard', () => {
  const text = read('profile-review.html');
  assert.match(text, /Profile Is Correct/);
  assert.match(text, /Edit Profile/);
  assert.match(text, /action:\s*["']confirm["']/);
  assert.match(text, /\/member-login\?email=/);
});

test('onboarding creates immediate verified trial access without Stripe entitlement', () => {
  const endpoint = read('netlify/functions/capability-profile.mjs');
  assert.doesNotMatch(endpoint, /product_entitlements/);
  assert.match(endpoint, /trial_expires_at/);
  assert.match(endpoint, /discovery_status: 'verified'/);
  assert.match(endpoint, /verification_status: 'USER_SUBMITTED'/);
});

test('verified member login restores the permanent profile session', () => {
  const endpoint = read('netlify/functions/member-login-verify.mjs');
  const login = read('member-login.html');
  assert.match(endpoint, /discovery_status=eq\.verified/);
  assert.match(endpoint, /select=intake_id,verified_profile/);
  assert.match(endpoint, /issueProfileSession\(\)/);
  assert.match(endpoint, /profileSessionCookie\(profileSession\.token\)/);
  assert.match(login, /new URLSearchParams\(location\.search\)/);
  assert.match(login, /location\.assign\(["']\/aois-dashboard-preview\.html["']\)/);
});

test('dashboard exposes All States, Resident State, California, Arizona, and Nevada geography views', () => {
  const text = read('aois-dashboard-preview.html');
  assert.match(text, /<option value="all">\s*All States\s*<\/option>/);
  assert.match(text, /<option value="resident">\s*Resident State\s*<\/option>/);
  assert.match(text, /<option value="CA">\s*California\s*<\/option>/);
  assert.match(text, /<option value="AZ">\s*Arizona\s*<\/option>/);
  assert.match(text, /<option value="NV">\s*Nevada\s*<\/option>/);
  assert.match(text, /\['CA','AZ','NV'\]\.includes\(scope\)/);
  assert.doesNotMatch(text, /All selected states/);
});

test('intake supports the approved three-field form', () => {
  const text = read('welcome.html');
  for (const id of ['contactName','businessName','businessEmail']) {
    assert.match(text, new RegExp(`id="${id}"[^>]*name="${id}"`));
  }
  assert.doesNotMatch(text, /Business Website URL|id="website"/);
  assert.doesNotMatch(text, /onpaste=|addEventListener\(['"]paste|clipboardData/);
});

test('contract scope owns profile review in a drawer and removes the Type control', () => {
  const text = read('aois-dashboard-preview.html');
  assert.match(text, /id="contract-scope"/);
  assert.match(text, /id="reviewProfileButton"[^>]*>Review your profile<\/button>/);
  assert.match(text, /function openProfile\(\)/);
  assert.match(text, /drawerMode='profile'/);
  assert.match(text, /scrollIntoView\(\{block:'start',behavior:'smooth'\}\)/);
  assert.doesNotMatch(text, /id="typeFilter"|for="typeFilter"/);
  assert.doesNotMatch(text, /href="\/profile-review\.html">Review Profile/);
});

test('public dashboard does not expose internal matching and inventory cards', () => {
  const text = read('aois-dashboard-preview.html');
  for (const internalLabel of ['engineStatus','engineCopy','residentState','sourceStatus','Matching scope','Profile source','Inventory source','Geographic rule']) {
    assert.doesNotMatch(text, new RegExp(internalLabel));
  }
  assert.match(text, /<main class="layout"><section class="panel glass">/);
  assert.doesNotMatch(text, /<main class="layout">[\s\S]*?<aside>/);
});

test('server profile flow uses HttpOnly session cookie and verified profile authority', () => {
  const session = read('netlify/functions/_shared/natcorp-profile-session.mjs');
  const endpoint = read('netlify/functions/capability-profile.mjs');
  assert.match(session, /HttpOnly; Secure; SameSite=Lax/);
  assert.match(endpoint, /geographic_search_scope: 'all_states'/);
  assert.match(endpoint, /verification_status: 'USER_CONFIRMED'/);
});

test('direct APIE fallback uses package and match-readiness gates instead of legacy Nat-Corp QA labels', () => {
  // candidateRows() (the gate logic) was extracted from aoie-state-shadow.mjs
  // into the shared aoie-candidates.mjs module -- check both: the gates
  // themselves live in the shared file, the legacy-name ban still applies to
  // the endpoint that must not reintroduce it.
  const shared = read('netlify/functions/_shared/aoie-candidates.mjs');
  const endpoint = read('netlify/functions/aoie-state-shadow.mjs');
  assert.match(shared, /package_status: 'eq\.PACKAGE_COMPLETE'/);
  assert.match(shared, /requirements_extraction_status: 'eq\.COMPLETE'/);
  assert.match(shared, /match_readiness_status: 'eq\.MATCH_READY'/);
  assert.doesNotMatch(endpoint, /filterReleaseReadyOpportunities/);
});

test('optional registry enrichment cannot fail the complete AOIE evaluation', () => {
  // fetchRegistry() moved to the shared module in the same refactor.
  const text = read('netlify/functions/_shared/aoie-candidates.mjs');
  assert.match(text, /Promise\.allSettled/);
  assert.match(text, /degraded: errors\.length > 0/);
});

test('same-origin browser callers cannot inject an unverified request profile', () => {
  // resolveProfile() moved to the shared module in the same refactor.
  const text = read('netlify/functions/_shared/aoie-candidates.mjs');
  assert.match(text, /authMode === 'internal' && payload\?\.profile/);
  assert.match(text, /source: 'verified-session'/);
});
