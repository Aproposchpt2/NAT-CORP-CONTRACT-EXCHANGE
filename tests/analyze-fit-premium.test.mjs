import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=(path)=>fs.readFileSync(path,'utf8');
const files={
  publicSite:read('index.html'),
  intake:read('welcome.html'),
  profileReview:read('profile-review.html'),
  legacyBusinessIntake:read('business-dna-builder-preview.html'),
  dashboard:read('aois-dashboard-preview.html'),
  analyzeFit:read('analyze-fit-v2.html'),
  netlify:read('netlify.toml'),
  aoieFunction:read('netlify/functions/aoie-state-shadow.mjs'),
  capabilityFunction:read('netlify/functions/capability-profile.mjs'),
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
  ['Profile Review',files.profileReview],
  ['Legacy Business Intake Redirect',files.legacyBusinessIntake],
  ['Dashboard',files.dashboard],
  ['Analyze Fit',files.analyzeFit],
]) compileInlineScripts(name,html);

// Analyze Fit remains protected as a six-page executive decision report. These are
// the headings actually rendered by the current implementation on main.
for(const title of [
  'Executive Decision Summary',
  'Fit Analysis',
  'Risk Assessment',
  'Proposal Development Plan',
  'Executive Recommendation',
]) assert.ok(files.analyzeFit.includes(title),`Missing current Analyze Fit page: ${title}`);

// Protect the underlying assessment domains even when the visible report uses
// executive-friendly page titles rather than one heading per JSON field.
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
assert.ok(files.publicSite.includes('A Shared Commitment to Economic Opportunity.'),'Protected second-section messaging must remain present.');

// Approved business-first intake contract.
for(const id of ['contactName','businessName','businessEmail','website','visitorEmail']){
  assert.match(files.intake,new RegExp(`id="${id}"`),`Intake missing approved field ${id}`);
}
for(const retired of ['entityType','contactTitle','phone','dba','modeGrid']){
  assert.doesNotMatch(files.intake,new RegExp(`id="${retired}"`),`Retired questionnaire field returned: ${retired}`);
}
assert.ok(files.intake.includes('/api/capability-profile'),'Intake must use the server-side capability-profile endpoint.');
assert.ok(files.intake.includes("action:'start'"),'Intake must create a server-side business session.');
assert.ok(files.intake.includes("action:'discover'"),'Intake must launch website capability discovery.');
assert.ok(files.intake.includes('/profile-review.html'),'Intake must continue to formal profile verification.');

// Mandatory verification/edit gate before matching.
assert.ok(files.profileReview.includes('Profile Is Correct'),'Profile Review must expose the confirmation gate.');
assert.ok(files.profileReview.includes('Edit Profile'),'Profile Review must allow correction of derived website data.');
assert.ok(files.profileReview.includes("action:'confirm'"),'Profile Review must persist explicit user confirmation.');
assert.ok(files.profileReview.includes("location.assign('/dashboard')"),'Verified profile must continue to the dashboard.');
assert.ok(files.legacyBusinessIntake.includes('/profile-review.html'),'Retired Business DNA route must redirect into the verified profile flow.');

// Dashboard is server-profile-backed and capability-first across inventory.
assert.ok(files.dashboard.includes('/api/capability-profile'),'Dashboard must load the verified server-side Business Capability Profile.');
assert.ok(files.dashboard.includes('/api/aoie-state-shadow'),'Dashboard must use the live AOIE endpoint.');
assert.ok(files.dashboard.includes('<option value="all">All States</option>'),'Dashboard must expose All States.');
assert.ok(files.dashboard.includes('<option value="resident">Resident State</option>'),'Dashboard must expose Resident State.');
assert.ok(!files.dashboard.includes('All selected states'),'Legacy selected-state geography must remain retired.');
assert.ok(files.dashboard.includes("scope:'all'"),'Dashboard must request capability matching across all current APIE states first.');

// Browser state may never become profile authority in the redesigned customer path.
for(const [name,content] of Object.entries({
  Intake:files.intake,
  'Profile Review':files.profileReview,
  'Legacy Business Intake Redirect':files.legacyBusinessIntake,
  Dashboard:files.dashboard,
})){
  assert.ok(!/\b(?:localStorage|sessionStorage)\b/.test(content),`${name} must not use browser storage.`);
  assert.ok(!/#profile=/.test(content),`${name} must not pass a profile through the URL.`);
  assert.ok(!/document\.cookie/.test(content),`${name} must not create a browser-authored cookie.`);
}

// Server-side session/security contract.
assert.ok(files.profileSession.includes('HttpOnly; Secure; SameSite=Lax'),'Profile session cookie must remain HttpOnly, Secure and SameSite=Lax.');
assert.ok(files.profileSession.includes("createHash('sha256')"),'Only a hash of the opaque session token may be stored server-side.');
assert.ok(files.capabilityFunction.includes('allowed_domains: [domain]'),'Website discovery must stay constrained to the submitted official domain.');
assert.ok(files.capabilityFunction.includes("verification_status: 'USER_CONFIRMED'"),'Confirmed AOIE profile must preserve user authority.');
assert.ok(files.capabilityFunction.includes("geographic_search_scope: 'all_states'"),'Verified matching scope must remain all-states capability-first.');
assert.ok(files.capabilityFunction.includes("reasoning: { effort: 'low' }"),'Website discovery must retain bounded low-reasoning latency configuration.');
assert.ok(files.capabilityFunction.includes("search_context_size: 'low'"),'Website discovery must retain bounded web-search context.');
assert.ok(files.capabilityFunction.includes('AbortSignal.timeout(45000)'),'Website discovery must fail inside the hosting execution window.');

// Same-origin browser callers may match only the verified session profile.
assert.ok(files.aoieFunction.includes("authMode === 'internal' && payload?.profile"),'Only authorized internal AOIE calls may inject a request profile.');
assert.ok(files.aoieFunction.includes("source: 'verified-session'"),'Browser matching must identify the verified-session profile source.');
assert.ok(files.aoieFunction.includes("package_status: 'eq.PACKAGE_COMPLETE'"),'Direct APIE fallback must require complete packages.');
assert.ok(files.aoieFunction.includes("requirements_extraction_status: 'eq.COMPLETE'"),'Direct APIE fallback must require complete requirements extraction.');
assert.ok(files.aoieFunction.includes("match_readiness_status: 'eq.MATCH_READY'"),'Direct APIE fallback must require MATCH_READY inventory.');
assert.ok(files.aoieFunction.includes('legacy_natcorp_qa_release_filter_applied: false'),'Obsolete Nat-Corp QA labels must not exclude valid APIE match-ready contracts.');
assert.ok(files.aoieFunction.includes('resident_state_is_presentation_filter: true'),'Resident State must remain a presentation filter after capability matching.');

// Analyze Fit itself remains live and fail-closed; it is no longer a required
// profile-handoff step in the redesigned dashboard journey.
assert.ok(files.analyzeFit.includes('/api/analyze-fit-state'),'Analyze Fit must use the live assessment endpoint.');
assert.ok(files.analyzeFit.includes('Business-to-Contract Fit Assessment'),'Analyze Fit report identity must remain present.');
assert.ok(files.analyzeFunction.includes('rateLimit'),'Analyze Fit must retain a platform rate limit.');
assert.ok(files.aoieFunction.includes('rateLimit'),'AOIE must retain a platform rate limit.');
assert.ok(files.capabilityFunction.includes('rateLimit'),'Capability Profile must retain a platform rate limit.');
assert.ok(files.businessAgent.includes("path: '/api/business-profile-agent'"),'Legacy Business Profile Agent endpoint must remain addressable for retained workflows.');
assert.ok(files.businessAgent.includes('rateLimit'),'Business Profile Agent must retain a platform rate limit.');

const retiredFunctions=[
  'netlify/functions/analyze-fit-ca.js',
  'netlify/functions/extract-profile-ca.js',
  'netlify/functions/proposal-writer-ca.js',
  'netlify/functions/pdas-dashboard.js',
  'netlify/functions/cal-pipeline.js',
  'netlify/functions/cal-detail.js',
  'netlify/functions/aois-advisor.js',
  'netlify/functions/aois-advisor.mjs',
  'netlify/functions/send-login-code.js',
  'netlify/functions/verify-login-code.js',
  'netlify/functions/bc-member-verify.js',
];
for(const path of retiredFunctions)assert.equal(fs.existsSync(path),false,`${path} must remain retired.`);

console.log('Nat-Corp verified capability journey and Analyze Fit regression suite complete.');
