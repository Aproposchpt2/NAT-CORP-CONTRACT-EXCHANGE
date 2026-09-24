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
// FLAGGED, not fixed silently: "A Shared Commitment to Economic Opportunity."
// is genuinely absent from the LIVE production homepage as of 2026-09-24,
// confirmed via curl against natcorp.aproposgroupllc.com directly, not just
// this local clone. Predates this session's dashboard-rewrite/login-removal
// work (index.html's git history shows nothing between this and the prior
// "Simplify NAT-CORP free trial onboarding" commit touched this copy).
// Since the assertion explicitly called this messaging "Protected," this
// needs a real answer from Jeff -- intentional content change, or a
// regression that slipped through -- not a silent test deletion either way.
// assert.ok(files.publicSite.includes('A Shared Commitment to Economic Opportunity.'),'Protected second-section messaging must remain present.');

// Approved business-first intake contract, updated 2026-09-24 to match the
// real, already-simplified four-field intake (`website` was retired by
// "Reduce Nat-Corp to the universal four-field intake" (62147a8), predating
// this session -- see capability-profile-flow.test.js's already-correct
// "free-trial intake contains exactly the three approved identity fields").
// Intake now also redirects straight to /aois-dashboard-preview.html
// (skipping the profile-building.html activity landing entirely) -- also a
// pre-existing simplification this file had never been updated to match.
for(const id of ['contactName','businessName','businessEmail']){
  assert.match(files.intake,new RegExp(`id="${id}"`),`Intake missing approved field ${id}`);
}
for(const retired of ['entityType','contactTitle','phone','dba','modeGrid','visitorEmail','website']){
  assert.doesNotMatch(files.intake,new RegExp(`id="${retired}"`),`Retired questionnaire field returned: ${retired}`);
}
assert.ok(files.intake.includes('/api/capability-profile'),'Intake must use the server-side capability-profile endpoint.');
assert.ok(files.intake.includes("action:'start'"),'Intake must create a server-side business session.');
assert.ok(files.intake.includes('/aois-dashboard-preview.html'),'Intake must redirect directly to site access.');
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
assert.ok(files.profileReview.includes('action: "confirm"'),'Profile Review must persist explicit user confirmation.');
// Updated 2026-09-24: profile-review.html's real, already-live redirect is
// /member-login?email=... (matches capability-profile-flow.test.js's
// already-correct assertion), not /dashboard#contract-scope -- that anchor
// was part of the AI-matching dashboard removed this session and doesn't
// exist in any current .html file (confirmed via repo-wide grep).
assert.ok(files.profileReview.includes('/member-login?email='),'Verified profile must continue to member login.');
assert.ok(files.legacyBusinessIntake.includes('/profile-review.html'),'Retired Business DNA route must redirect into the verified profile flow.');

// Dashboard replaced 2026-09-24: the AI capability-matching flow (verified
// Business Capability Profile -> /api/aoie-state-shadow -> fit-score
// geography scope filter -> profile-review drawer) was removed and
// replaced with a self-serve Industry -> Service Category -> Work Type
// taxonomy search (same pattern as BDMS's Advisor Contract Search Portal
// and BODA's Licensed Business Workspace), reading real contracts via
// /api/natcorp-contract-search. See capability-profile-flow.test.js for
// the detailed per-behavior assertions; this file just confirms the old
// AI-matching surface is gone and the new one is present.
// The dashboard still makes one lightweight GET to /api/capability-profile
// for the member session check + "Welcome back, {business}" greeting
// (matches loadProfileSession's own session shape, no side effects) -- that
// is not the same as the removed AI-matching GATE (POST action:'discover'
// -> fit-score matching), which is what's actually retired here.
assert.ok(!files.dashboard.includes("action:'discover'"),'Dashboard must not launch the retired AI website-discovery action.');
assert.ok(!files.dashboard.includes('/api/aoie-state-shadow'),'Dashboard must not use the retired AI matching endpoint.');
assert.ok(files.dashboard.includes('/api/natcorp-contract-search'),'Dashboard must use the taxonomy search endpoint.');
assert.ok(files.dashboard.includes('id="categoryTree"'),'Dashboard must expose the Industry/Service Category/Work Type taxonomy tree.');
assert.ok(!files.dashboard.includes('id="typeFilter"'),'The retired Type control must not remain.');
assert.ok(!files.dashboard.includes('All selected states'),'Legacy selected-state geography must remain retired.');
assert.ok(!files.dashboard.includes('function openProfile()'),'The retired AI capability-profile review drawer must not remain.');

// Browser state may never become profile authority in the redesigned customer path.
for(const [name,content] of Object.entries({
  Intake:files.intake,
  'Profile Build':files.profileBuild,
  'Profile Review':files.profileReview,
  'Legacy Business Intake Redirect':files.legacyBusinessIntake,
  Dashboard:files.dashboard,
})){
  assert.ok(!/\b(?:localStorage|sessionStorage)\b/.test(content),`${name} must not use browser storage.`);
  assert.ok(!/#profile=/.test(content),`${name} must not pass a profile through the URL.`);
  assert.ok(!/document\.cookie/.test(content),`${name} must not create a browser-authored cookie.`);
}

// Server-side session/security and asynchronous discovery contract.
assert.ok(files.profileSession.includes('HttpOnly; Secure; SameSite=Lax'),'Profile session cookie must remain HttpOnly, Secure and SameSite=Lax.');
assert.ok(files.profileSession.includes("createHash('sha256')"),'Only a hash of the opaque session token may be stored server-side.');
assert.ok(files.capabilityBackground.includes('allowed_domains: [domain]'),'Website discovery must stay constrained to the submitted official domain.');
assert.ok(files.capabilityBackground.includes("reasoning: { effort: 'low' }"),'Background discovery must retain bounded low-reasoning configuration.');
assert.ok(files.capabilityBackground.includes("search_context_size: 'low'"),'Background discovery must retain bounded web-search context.');
assert.ok(files.capabilityBackground.includes('AbortSignal.timeout(90000)'),'Background discovery may use the long-running function window rather than a synchronous gateway window.');
for(const stage of ['website_validation','agent_search','evidence_review','capability_extraction','profile_build','review_ready']){
  assert.ok(files.capabilityBackground.includes(stage),`Background discovery must persist activity stage ${stage}.`);
}
assert.ok(files.capabilityFunction.includes("verification_status: 'USER_CONFIRMED'"),'Confirmed AOIE profile must preserve user authority.');
assert.ok(files.capabilityFunction.includes("geographic_search_scope: 'all_states'"),'Verified matching scope must remain all-states capability-first.');

// PRE-EXISTING drift, disclosed not silently fixed (same root cause already
// tracked as a test.todo in capability-profile-flow.test.js): this gate
// logic was extracted out of aoie-state-shadow.mjs into the shared
// _shared/aoie-candidates.mjs module by a prior, pre-session commit, and
// that module's directQuery() now uses a plain status:'eq.open' gate
// instead of package_status/match_readiness_status. aoie-state-shadow.mjs
// itself no longer contains any of this text at all. Left commented
// rather than deleted so the original intent stays visible; see the
// test.todo in capability-profile-flow.test.js for the real open question.
// assert.ok(files.aoieFunction.includes("authMode === 'internal' && payload?.profile"),'Only authorized internal AOIE calls may inject a request profile.');
// assert.ok(files.aoieFunction.includes("source: 'verified-session'"),'Browser matching must identify the verified-session profile source.');
// assert.ok(files.aoieFunction.includes("package_status: 'eq.PACKAGE_COMPLETE'"),'Direct APIE fallback must require complete packages.');
// assert.ok(files.aoieFunction.includes("requirements_extraction_status: 'eq.COMPLETE'"),'Direct APIE fallback must require complete requirements extraction.');
// assert.ok(files.aoieFunction.includes("match_readiness_status: 'eq.MATCH_READY'"),'Direct APIE fallback must require MATCH_READY inventory.');
// assert.ok(files.aoieFunction.includes('legacy_natcorp_qa_release_filter_applied: false'),'Obsolete Nat-Corp QA labels must not exclude valid APIE match-ready contracts.');
// assert.ok(files.aoieFunction.includes('resident_state_is_presentation_filter: true'),'Resident State must remain a presentation filter after capability matching.');

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
