import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=(path)=>fs.readFileSync(path,'utf8');
const files={
  publicSite:read('index.html'),
  intake:read('welcome.html'),
  profileBuild:read('profile-building.html'),
  profileReview:read('profile-review.html'),
  legacyBusinessIntake:read('business-dna-builder-preview.html'),
  dashboard:read('aois-dashboard-preview.html'),
  analyzeFit:read('analyze-fit-v2.html'),
  netlify:read('netlify.toml'),
  aoieFunction:read('netlify/functions/aoie-state-shadow.mjs'),
  capabilityFunction:read('netlify/functions/capability-profile.mjs'),
  capabilityBackground:read('netlify/functions/capability-profile-discover-background.mjs'),
  profileSession:read('netlify/functions/_shared/natcorp-profile-session.mjs'),
  analyzeFunction:read('netlify/functions/analyze-fit-state.mjs'),
  businessAgent:read('netlify/functions/business-profile-agent.mjs'),
};

function compileInlineScripts(name,html){
  const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map(match=>match[1])
    .filter(script=>script.trim());
  assert.ok(scripts.length,`${name} must contain an executable inline script.`);
  for(const script of scripts)new Function(script);
}

for(const [name,html] of [
  ['Intake',files.intake],
  ['Profile Build',files.profileBuild],
  ['Profile Review',files.profileReview],
  ['Legacy Business Intake Redirect',files.legacyBusinessIntake],
  ['Dashboard',files.dashboard],
  ['Analyze Fit',files.analyzeFit],
]) compileInlineScripts(name,html);

for(const title of [
  'Executive Decision Summary',
  'Fit Analysis',
  'Risk Assessment',
  'Proposal Development Plan',
  'Executive Recommendation',
]) assert.ok(files.analyzeFit.includes(title),`Missing current Analyze Fit page: ${title}`);

for(const field of [
  'strategic_alignment',
  'eligibility',
  'capability_evidence',
  'competitive_position',
  'risks',
  'decision_conditions',
  'action_plan',
  'documents_needed',
  'questions_for_buyer',
  'source_notes',
]) assert.ok(files.analyzeFit.includes(field),`Analyze Fit no longer consumes required assessment field: ${field}`);

assert.ok(files.publicSite.includes('Opportunity Builds Business. Business Builds Community.'),'Protected public Hero messaging must remain present.');
assert.ok(files.publicSite.includes('Extend the Services You Already Provide.'),'Protected Community Business Development messaging must remain present.');

// Approved business-first intake contract. Intake must finish quickly and hand off
// to the activity landing; it must not hold the browser open for website discovery.
// visitorEmail is optional server-side (capability-profile.mjs) but was deliberately
// dropped from the frontend form by "Reduce Nat-Corp to the universal four-field
// intake" (62147a8) -- not expected on the page.
for(const id of ['contactName','businessName','businessEmail','website']){
  assert.match(files.intake,new RegExp(`id="${id}"`),`Intake missing approved field ${id}`);
}
for(const retired of ['entityType','contactTitle','phone','dba','modeGrid','visitorEmail']){
  assert.doesNotMatch(files.intake,new RegExp(`id="${retired}"`),`Retired questionnaire field returned: ${retired}`);
}
assert.ok(files.intake.includes('/api/capability-profile'),'Intake must use the server-side capability-profile endpoint.');
assert.ok(files.intake.includes("action:'start'"),'Intake must create a server-side business session.');
assert.ok(files.intake.includes('/profile-building.html'),'Intake must redirect to the profile-build activity landing.');
assert.ok(!files.intake.includes("action:'discover'"),'Intake must not synchronously launch website discovery.');
assert.ok(!files.intake.includes('/api/capability-profile-discover'),'Intake must not queue discovery before the customer reaches the activity landing.');

// Landing page owns the async discovery launch and live activity presentation.
assert.ok(files.profileBuild.includes('Nat-Corp is building'),'Profile Build must tell the customer the profile is being built.');
assert.ok(files.profileBuild.includes('Activity Progress'),'Profile Build must expose the activity progress meter.');
assert.ok(files.profileBuild.includes('/api/capability-profile-discover'),'Profile Build must start the background discovery Agent.');
assert.ok(files.profileBuild.includes('/api/capability-profile'),'Profile Build must poll the server-side profile session.');
assert.ok(files.profileBuild.includes('Review My Business Profile'),'Profile Build must stop at the customer review control point.');

// Mandatory verification/edit gate before matching.
assert.ok(files.profileReview.includes('Profile Is Correct'),'Profile Review must expose the confirmation gate.');
assert.ok(files.profileReview.includes('Edit Profile'),'Profile Review must allow correction of derived website data.');
assert.ok(files.profileReview.includes("action:'confirm'"),'Profile Review must persist explicit user confirmation.');
assert.ok(files.profileReview.includes("location.assign('/dashboard#contract-scope')"),'Verified profile must continue directly to the contract scope band.');
assert.ok(files.legacyBusinessIntake.includes('/profile-review.html'),'Retired Business DNA route must redirect into the verified profile flow.');

// Dashboard is server-profile-backed and capability-first across inventory.
assert.ok(files.dashboard.includes('/api/capability-profile'),'Dashboard must load the verified server-side Business Capability Profile.');
assert.ok(files.dashboard.includes('/api/aoie-state-shadow'),'Dashboard must use the live AOIE endpoint.');
assert.ok(/<option value="all">\s*All States\s*<\/option>/.test(files.dashboard),'Dashboard must expose All States.');
assert.ok(/<option value="resident">\s*Resident State\s*<\/option>/.test(files.dashboard),'Dashboard must expose Resident State.');
assert.ok(/<option value="CA">\s*California\s*<\/option>/.test(files.dashboard),'Dashboard must expose California.');
assert.ok(/<option value="AZ">\s*Arizona\s*<\/option>/.test(files.dashboard),'Dashboard must expose Arizona.');
assert.ok(/<option value="NV">\s*Nevada\s*<\/option>/.test(files.dashboard),'Dashboard must expose Nevada.');
assert.ok(files.dashboard.includes('Review your profile'),'Dashboard must expose the profile review drawer control.');
assert.ok(!files.dashboard.includes('id="scopeType"'),'Dashboard must not restore the removed Type scope control.');
assert.ok(!files.dashboard.includes('Candidate Universe'),'Public dashboard must not expose internal candidate-universe cards.');
assert.ok(!files.dashboard.includes('Matching Engine'),'Public dashboard must not expose internal matching-engine cards.');

// The verified business profile must stay server authoritative throughout matching.
assert.ok(files.profileSession.includes('HttpOnly; Secure; SameSite=Lax'),'Profile session cookie must be HttpOnly and secure.');
assert.ok(files.aoieFunction.includes('resolveProfile(req, payload || {}, auth.mode)'),'AOIE must resolve the verified profile through shared server authority.');
assert.ok(files.analyzeFunction.includes('loadProfileSession(req)'),'Analyze Fit must load the verified profile session server-side.');

// APIE release boundary remains authoritative.
for(const gate of [
  "package_status: 'eq.PACKAGE_COMPLETE'",
  "package_failed_count: 'eq.0'",
  "requirements_extraction_status: 'eq.COMPLETE'",
  "match_readiness_status: 'eq.MATCH_READY'",
]) assert.ok(read('netlify/functions/_shared/aoie-candidates.mjs').includes(gate),`APIE release gate missing: ${gate}`);

console.log('Analyze Fit premium regression suite complete.');