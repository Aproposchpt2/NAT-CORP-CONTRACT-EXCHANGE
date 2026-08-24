import assert from 'node:assert/strict';
import {
  expandBusinessProfile,
  scoreStateLocalMatch,
} from '../netlify/functions/_shared/aoie-state-local.mjs';

function test(name, fn) {
  try {
    fn();
    console.log('PASS', name);
  } catch (error) {
    console.error('FAIL', name);
    throw error;
  }
}

const profile = expandBusinessProfile({
  business_name: 'Apropos Test Technologies LLC',
  keywords: ['cybersecurity', 'network infrastructure', 'managed services', 'project management'],
  core_competencies: ['systems integration', 'cloud security'],
  naics_codes: ['541512', '541519'],
  commodity_codes: ['20900'],
  unspsc_codes: ['81111801'],
  certifications: ['SBE', 'MBE'],
  licenses: [],
  service_states: ['CA', 'NV'],
  max_contract_value: 2_000_000,
});

const future = '2099-08-15T17:00:00-07:00';

test('exact UNSPSC and capability language produce a strong match', () => {
  const result = scoreStateLocalMatch(profile, {
    title: 'Managed Cybersecurity and Network Infrastructure Services',
    description: 'Systems integration, cloud security, monitoring, and managed services.',
    state_code: 'CA',
    unspsc_codes: ['81111801'],
    commodity_codes: ['20900'],
    response_deadline: future,
    estimated_value_max: 900000,
  });
  assert.equal(result.match_status, 'Strong Match');
  assert.ok(result.fit_score >= 80, JSON.stringify(result));
  assert.equal(result.hard_disqualifier, null);
});

test('related commodity family and semantic evidence produce a reviewable match', () => {
  const result = scoreStateLocalMatch(profile, {
    title: 'Enterprise Software Implementation and Technical Support',
    description: 'Implementation, data migration, help desk, and application support.',
    state_code: 'NV',
    commodity_codes: ['20910'],
    response_deadline: future,
  });
  assert.ok(result.fit_score >= 35, JSON.stringify(result));
  assert.notEqual(result.match_status, 'Not Recommended');
});

test('unrelated landscaping work is not recommended', () => {
  const result = scoreStateLocalMatch(profile, {
    title: 'Landscape Maintenance and Tree Trimming',
    description: 'Mowing, irrigation, and arborist services.',
    state_code: 'CA',
    commodity_codes: ['92000'],
    response_deadline: future,
  });
  assert.equal(result.match_status, 'Not Recommended');
});

test('Technology General code does not match window construction repair', () => {
  const technologyProfile = expandBusinessProfile({
    business_name: 'NAT-CORP IT Visitor',
    keywords: ['information technology', 'technology general'],
    services: ['Information Technology Services'],
    commodity_codes: ['519190', '91861'],
    service_states: ['CA'],
  });
  const result = scoreStateLocalMatch(technologyProfile, {
    title: 'Window Systems Repair - School for the Blind',
    issuing_organization: 'California Department of General Services (OBAS)',
    issuing_department: 'Construction - Goods & Services',
    notice_type: 'Upcoming Solicitation (not yet open)',
    state_code: 'CA',
    unspsc_codes: ['72152400'],
    commodity_codes: [],
    response_deadline: null,
  });
  assert.equal(result.match_status, 'Not Recommended', JSON.stringify(result));
  assert.equal(result.signal_scores.concept_alignment, 0, JSON.stringify(result));
  assert.ok(result.fit_score < 35, JSON.stringify(result));
});

test('expired opportunities are hard-disqualified', () => {
  const result = scoreStateLocalMatch(profile, {
    title: 'Cybersecurity Services',
    state_code: 'CA',
    commodity_codes: ['20900'],
    response_deadline: '2020-01-01',
  });
  assert.equal(result.hard_disqualifier, 'EXPIRED');
  assert.equal(result.fit_score, 0);
});

test('explicit geography outside declared service area is hard-disqualified', () => {
  const result = scoreStateLocalMatch(profile, {
    title: 'Network Infrastructure Services',
    state_code: 'AZ',
    commodity_codes: ['20900'],
    response_deadline: future,
  });
  assert.equal(result.hard_disqualifier, 'OUTSIDE_SERVICE_AREA');
});

test('exclusive certification requirement blocks an ineligible profile', () => {
  const result = scoreStateLocalMatch(profile, {
    title: 'DVBE Only Network Cabling Services',
    description: 'Participation is reserved exclusively for certified DVBE firms.',
    state_code: 'CA',
    commodity_codes: ['20900'],
    response_deadline: future,
  });
  assert.equal(result.hard_disqualifier, 'CERTIFICATION_REQUIREMENT_MISMATCH');
});

test('explicit contractor license requirement is flagged as a hard mismatch', () => {
  const result = scoreStateLocalMatch(profile, {
    title: 'Low Voltage Network Installation',
    description: 'Bidder must possess a valid C-7 contractor license.',
    state_code: 'CA',
    commodity_codes: ['20900'],
    response_deadline: future,
  });
  assert.equal(result.hard_disqualifier, 'LICENSE_REQUIREMENT_MISMATCH');
});

test('a single incidental capability-family collision alone is not recommended without corroboration', () => {
  // Confirmed live 2026-08-24 against a real business profile (Apropos Group
  // LLC): a software/AI government-tech company's own broad "other computer
  // related services" NAICS code (541519) legitimately falls under BOTH the
  // information_technology and cybersecurity_network ontology buckets, so it
  // gets tagged "cybersecurity_network" even though it does no literal
  // cyber/network-security work. A completely unrelated opportunity
  // (polygraph testing) that happens to carry a government commodity/UNSPSC
  // code from the same generic "security" family then collides on that same
  // bucket ID, with zero keyword overlap and zero declared-code overlap --
  // and was still surfaced as a 40% "Monitor" match with one vague reason
  // line. This must now be suppressed for lack of corroboration.
  const techProfile = expandBusinessProfile({
    business_name: 'Apropos Test Technologies LLC',
    keywords: ['software development', 'ai voice systems', 'crm'],
    core_competencies: ['procurement opportunity matching'],
    naics_codes: ['541512', '541519'],
    service_states: ['CA'],
  });
  const result = scoreStateLocalMatch(techProfile, {
    title: 'Polygraph Examination Services',
    description: 'Provide polygraph examination and investigative support services for county personnel screening.',
    state_code: 'CA',
    unspsc_codes: ['46152400'],
    response_deadline: future,
  });
  assert.equal(result.match_status, 'Not Recommended', JSON.stringify(result));
  assert.equal(result.evidence_corroborated, false, JSON.stringify(result));
  assert.ok(result.signal_scores.concept_alignment > 0, 'the concept collision should still be detected internally, just not enough alone');
});

test('a specific multi-word keyword phrase match is trusted alone, unlike a bare generic word', () => {
  // Confirmed live 2026-08-24 against the real CA inventory: a telecom
  // services master agreement offering "UC Cloud VoIP Services" / "Cloud
  // Contact Center Services" was wrongly suppressed for a business whose
  // declared capability is literally "unified communications & contact-
  // center systems" -- the ONLY signal was one specific keyword phrase
  // match, no codes on either side, so the blanket "any lone weak signal
  // needs corroboration" rule (correctly protecting against bare single
  // generic words like "debt") was also catching genuinely precise matches.
  const commsProfile = expandBusinessProfile({
    business_name: 'Apropos Test Technologies LLC',
    keywords: ['contact center services', 'unified communications'],
    service_states: ['CA'],
  });
  const result = scoreStateLocalMatch(commsProfile, {
    title: 'Telecommunications Services Master Agreement',
    description: 'Service Categories: Data Network Services, Secure Web Gateway Services, UC Cloud VoIP Services, Cloud Contact Center Services, SMS Outbound Text Message Solution.',
    state_code: 'CA',
    response_deadline: future,
  });
  assert.notEqual(result.match_status, 'Not Recommended', JSON.stringify(result));
  assert.equal(result.evidence_corroborated, true, JSON.stringify(result));
});

test('a thin or corrupted description does not hide a contract that has real extracted requirements', () => {
  // Confirmed live 2026-08-24: a real CA opportunity (LA County VSAP voting-
  // system enhancements) had a 111-character CORRUPTED description field
  // (unrendered scraper template code), while requirements.scope_of_work --
  // populated separately by APIE's package-acquisition pipeline from 20
  // real acquired documents -- held 13.7KB of genuine scope text. The
  // matcher was reading only `description`, so a contract with abundant
  // real, already-extracted content was invisible to every business
  // profile. A repo-wide check found this affects roughly half of all CA
  // "ready" candidates (49 of 98), not an isolated case.
  const techProfile = expandBusinessProfile({
    business_name: 'Apropos Test Technologies LLC',
    keywords: ['voting system software', 'election technology support'],
    service_states: ['CA'],
  });
  const result = scoreStateLocalMatch(techProfile, {
    title: 'Voting Solutions Enhancements and Support Services',
    description: 'File Attachment {{amend.AmendDate}} {{amend.AmendDesc}} {{amend.AttFileName}}',
    state_code: 'CA',
    response_deadline: future,
    requirements: {
      scope_of_work: [
        'The Contractor shall provide voting system software enhancements and ongoing election technology support for the County voting solution.',
      ],
    },
  });
  assert.notEqual(result.match_status, 'Not Recommended', JSON.stringify(result));
  assert.ok(result.explanation.matched_keywords.length > 0, JSON.stringify(result));
});

test('declared capacity prevents over-sized opportunity recommendations', () => {
  const result = scoreStateLocalMatch(profile, {
    title: 'Statewide Cybersecurity Operations Center',
    description: 'Managed security operations and systems integration.',
    state_code: 'CA',
    commodity_codes: ['20900'],
    response_deadline: future,
    estimated_value_max: 10_000_000,
  });
  assert.equal(result.hard_disqualifier, 'CAPACITY_EXCEEDED');
});

console.log('AOIE state/local matcher fixture suite complete.');
