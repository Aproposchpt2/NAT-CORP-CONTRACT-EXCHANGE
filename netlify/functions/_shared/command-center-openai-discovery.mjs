// OpenAI web-search acquisition engine. Ported from APROPOS-CONTRACT-BRIEF's
// cbrief-openai-discovery.mjs (natcorp execution path), with the cbrief/natcorp
// project branch removed entirely: this site only ever has one target, so
// upsertCandidate() always stores into state_raw_records via
// command-center-acquisition.mjs's storeRawCandidate() -- there is no
// cbrief_contract_opportunities table on this site's Supabase project to branch
// away from.
import { env } from './natcorp-db.mjs';
import { DISCOVERY_TARGET, MIN_CLOSING_DAYS } from './command-center-publisher-registry.mjs';
import { storeRawCandidate } from './command-center-acquisition.mjs';

const DEFAULT_MODEL = 'gpt-5.5';
const MAX_PASSES = 6;
const CANDIDATES_PER_PASS = 15;
const MIN_CLOSING_MS = MIN_CLOSING_DAYS * 24 * 60 * 60 * 1000;

const ALLOWED_HOST_SUFFIXES = [
  '.gov', '.edu', '.us', '.k12.ca.us',
  'planetbids.com', 'bonfirehub.com', 'opengov.com', 'bidnetdirect.com',
  'publicpurchase.com', 'bidsync.com', 'periscopeholdings.com', 'jaggaer.com',
  'sciquest.com', 'demandstar.com', 'bpxplanroom.com', 'oregonbuys.gov',
  'ngemnv.com', 'ionwave.net',
  'cityofhenderson.com', 'cityofnorthlasvegas.com', 'bcnv.org',
  'lvmpd.com', 'harryreidairport.com', 'rtcsnv.com', 'lvcva.com', 'ccsd.net',
  'lvvwd.com', 'cleanwaterteam.com', 'southernnevadahealthdistrict.org',
  'snvrha.org', 'umcsn.com', 'thelibrarydistrict.org', 'hendersonlibraries.com',
  'regionalflood.org',
];

const BROWSER_DEPENDENT_AUTHORITIES = Object.freeze({
  CAL_EPROCURE: Object.freeze({
    hosts: Object.freeze(['caleprocure.ca.gov']),
    allowed_statuses: Object.freeze([401, 403, 405]),
  }),
});

function clean(value, max = 1000) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, max) : null;
}

function outputText(message) {
  if (typeof message?.output_text === 'string') return message.output_text;
  return (message?.output || []).flatMap((item) => item?.type === 'message' ? item.content || [] : [])
    .filter((part) => part?.type === 'output_text').map((part) => part.text || '').join('\n');
}

function citationUrls(message) {
  return [...new Set((message?.output || []).flatMap((item) => item?.type === 'message' ? item.content || [] : [])
    .flatMap((part) => part?.annotations || []).filter((a) => a?.type === 'url_citation' && a.url).map((a) => a.url))];
}

function canonicalUrl(value) {
  const url = new URL(String(value || ''));
  if (url.protocol !== 'https:') throw new Error('AUTHORITATIVE_URL_MUST_USE_HTTPS');
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) if (/^utm_|^(fbclid|gclid)$/i.test(key)) url.searchParams.delete(key);
  return url.toString();
}

function hostAllowed(hostname) {
  const host = String(hostname || '').toLowerCase();
  return ALLOWED_HOST_SUFFIXES.some((suffix) => host === suffix.replace(/^\./, '') || host.endsWith(suffix));
}

function browserDependentAccessAllowed(scopeId, hostname, status) {
  const policy = BROWSER_DEPENDENT_AUTHORITIES[String(scopeId || '').toUpperCase()];
  if (!policy) return false;
  const host = String(hostname || '').toLowerCase();
  return policy.hosts.includes(host) && policy.allowed_statuses.includes(Number(status));
}

export async function verifyPublicUrl(value, { scopeId = null } = {}) {
  const url = canonicalUrl(value);
  const parsed = new URL(url);
  if (!hostAllowed(parsed.hostname)) throw new Error('SOURCE_HOST_NOT_IN_PUBLIC_PROCUREMENT_ALLOWLIST');
  const response = await fetch(url, {
    method: 'GET', redirect: 'follow',
    headers: { 'user-agent': 'NatCorpContractExchange/1.0 (+https://natcorp.aproposgroupllc.com)', accept: 'text/html,application/json,text/plain;q=0.8,*/*;q=0.5' },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    const browserValidated = browserDependentAccessAllowed(scopeId, parsed.hostname, response.status);
    await response.body?.cancel().catch(() => {});
    if (browserValidated) return url;
    throw new Error(`AUTHORITATIVE_URL_HTTP_${response.status}`);
  }
  const finalUrl = canonicalUrl(response.url || url);
  if (!hostAllowed(new URL(finalUrl).hostname)) throw new Error('SOURCE_REDIRECTED_OUTSIDE_ALLOWLIST');
  await response.body?.cancel().catch(() => {});
  return finalUrl;
}

function validAcquisitionClosingDate(value) {
  const date = new Date(String(value || ''));
  if (!Number.isFinite(date.getTime())) throw new Error('CLOSING_DATE_NOT_ISO_8601');
  const remaining = date.getTime() - Date.now();
  if (remaining <= 0) throw new Error('OPPORTUNITY_IS_EXPIRED_OR_SAME_DAY');
  if (remaining < MIN_CLOSING_MS) throw new Error(`OPPORTUNITY_HAS_LESS_THAN_${MIN_CLOSING_DAYS}_DAYS_REMAINING`);
  return date.toISOString();
}

const RESPONSE_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    opportunities: {
      type: 'array', maxItems: CANDIDATES_PER_PASS,
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          title: { type: 'string' }, agency_name: { type: 'string' }, department_name: { type: ['string', 'null'] },
          solicitation_number: { type: ['string', 'null'] }, source_opportunity_id: { type: ['string', 'null'] },
          description: { type: ['string', 'null'] }, opportunity_type: { type: ['string', 'null'] },
          posted_at: { type: ['string', 'null'] }, closes_at: { type: 'string' }, closing_timezone: { type: ['string', 'null'] },
          place_of_performance: { type: ['string', 'null'] }, city: { type: ['string', 'null'] }, state: { type: ['string', 'null'] },
          jurisdiction_level: { type: ['string', 'null'] }, platform_name: { type: 'string' },
          authoritative_detail_url: { type: 'string' }, electronic_submission_allowed: { type: ['boolean', 'null'] },
        },
        required: ['title','agency_name','department_name','solicitation_number','source_opportunity_id','description','opportunity_type','posted_at','closes_at','closing_timezone','place_of_performance','city','state','jurisdiction_level','platform_name','authoritative_detail_url','electronic_submission_allowed'],
      },
    },
  },
  required: ['opportunities'],
};

async function discoverCandidates({ apiKey, model, scope, excludedUrls }) {
  const prompt = `Today is ${new Date().toISOString()}. Act as the NatCorp Contract Exchange Acquisition Discovery Agent.\n\nASSIGNED PUBLISHER: ${scope.name}\nAPPROVED PUBLISHER ENTRY URL: ${scope.site_url}\nCONTROLLED RUN TARGET: ${DISCOVERY_TARGET} qualified opportunity records\nMINIMUM RESPONSE WINDOW: ${MIN_CLOSING_DAYS} calendar days remaining\n\nStart at the approved publisher URL and use the publisher's current official procurement pages, opportunity index, public notices, public feeds, or any procurement/transaction system that the publisher itself directly designates. Remain within this assigned publisher. Do not widen the run to another public entity merely to reach the target.\n\nIMPORTANT CONTINUATION RULE:\nFailure to validate, extract, or acquire one candidate is NOT a stopping condition. Preserve/reject that candidate as appropriate, continue to the next candidate, and continue discovery until ${DISCOVERY_TARGET} qualified opportunity records have been acquired or the assigned publisher's authoritative current inventory has been exhausted. Individual failures do not count toward the ${DISCOVERY_TARGET}-record success target.\n\nFind up to ${CANDIDATES_PER_PASS} currently open contract opportunities for this assigned publisher that have at least ${MIN_CLOSING_DAYS} calendar days remaining before the authoritative response deadline.\n\nUse live web search only to navigate and validate the assigned publisher's official procurement ecosystem. Apply this authority hierarchy: official publisher opportunity index; official government opportunity detail or notice; officially designated procurement platform event; official public feed/open data. Do not bypass registration, authentication, CAPTCHA, payment, invitation, or access controls.\n\nWHAT TO ACQUIRE:\n- one public opportunity record per procurement event;\n- publisher/issuing entity;\n- solicitation or event ID;\n- title;\n- open status;\n- authoritative closing date/time;\n- authoritative opportunity/detail URL;\n- whatever public description or scope is visible;\n- public procurement platform/source context.\n\nDo NOT require complete solicitation-package acquisition. A clearly identified purchase with limited public detail is still a valid acquisition candidate; preserve the available facts and do not invent missing scope.\n\nHard rules:\n- Return only this assigned publisher's opportunities.\n- Return only opportunities whose authoritative deadline is at least ${MIN_CLOSING_DAYS} calendar days in the future.\n- Return the authoritative opportunity/detail URL, never a search-engine result or third-party article.\n- Exclude expired, cancelled, awarded, closed, not-yet-open, standing vendor-registration pages, surveys, and continuous pools without a real future deadline.\n- A failed candidate must be skipped without terminating the publisher run.\n- Do not invent unavailable fields; use null.\n- Do not return these already-seen URLs: ${excludedUrls.slice(-150).join(' | ') || 'none'}.\n\nReturn the requested structured data only.`;

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model, store: false, reasoning: { effort: 'low' }, tools: [{ type: 'web_search' }],
      input: [
        { role: 'system', content: `You are a meticulous government procurement acquisition agent. Stay inside the assigned verified publisher, use live authoritative public sources, never fabricate a contract record, and never stop the publisher run because one candidate fails. Continue until ${DISCOVERY_TARGET} qualified records are acquired or authoritative publisher inventory is exhausted.` },
        { role: 'user', content: prompt },
      ],
      text: { format: { type: 'json_schema', name: 'contract_discovery_batch', strict: true, schema: RESPONSE_SCHEMA } },
      max_output_tokens: 9000,
    }),
    signal: AbortSignal.timeout(90000),
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`OPENAI_DISCOVERY_FAILED:${response.status}:${raw.slice(0, 500)}`);
  const message = JSON.parse(raw);
  const parsed = JSON.parse(outputText(message));
  return { candidates: Array.isArray(parsed.opportunities) ? parsed.opportunities : [], citations: citationUrls(message), responseId: message.id || null };
}

async function upsertCandidate(candidate, evidence) {
  const url = await verifyPublicUrl(candidate.authoritative_detail_url, { scopeId: evidence.scope });
  const closesAt = validAcquisitionClosingDate(candidate.closes_at);
  const title = clean(candidate.title, 500);
  const agency = clean(candidate.agency_name, 300);
  if (!title || !agency) throw new Error('TITLE_AND_AGENCY_REQUIRED');

  return storeRawCandidate({
    candidate: { ...candidate, closes_at: closesAt },
    url,
    evidence,
    stateName: evidence.stateName,
    scope: { id: evidence.scope, name: evidence.publisherName, platform: evidence.platformName, site_url: evidence.publisherSiteUrl },
    runId: evidence.runId,
  });
}

export async function runOpenAIDiscovery({ scope, target = DISCOVERY_TARGET, onProgress = async () => {}, stateName, runId } = {}) {
  const apiKey = env('OPENAI_API_KEY');
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured.');
  if (!scope?.name || !scope?.site_url) throw new Error('PUBLISHER_LISTING_ENTRY_REQUIRED');
  const model = env('NATCORP_DISCOVERY_MODEL') || DEFAULT_MODEL;
  let created = 0, updated = 0, failed = 0, totalListed = 0;
  const excludedUrls = [];
  await onProgress({ totalListed, processed: 0, created, updated, failed });

  for (let pass = 0; pass < MAX_PASSES && created + updated < target; pass++) {
    const batch = await discoverCandidates({ apiKey, model, scope, pass, excludedUrls });
    totalListed += batch.candidates.length;
    if (!batch.candidates.length) continue;
    const eligible = [];
    for (const candidate of batch.candidates) {
      if (eligible.length >= target - created - updated) break;
      try {
        const rawUrl = canonicalUrl(candidate.authoritative_detail_url);
        if (excludedUrls.includes(rawUrl)) continue;
        excludedUrls.push(rawUrl);
        eligible.push(candidate);
      } catch (error) {
        failed++;
        console.error('[command-center-openai-discovery] candidate URL rejected; continuing:', error instanceof Error ? error.message : error);
      }
    }

    for (let offset = 0; offset < eligible.length; offset += 3) {
      await Promise.all(eligible.slice(offset, offset + 3).map(async (candidate) => {
        try {
          const result = await upsertCandidate(candidate, {
            model,
            responseId: batch.responseId,
            citations: batch.citations,
            scope: scope.id,
            publisherName: scope.name,
            publisherSiteUrl: scope.site_url,
            platformName: scope.platform,
            stateName: stateName || scope.state,
            runId,
          });
          if (result === 'created') created++; else updated++;
        } catch (error) {
          failed++;
          console.error('[command-center-openai-discovery] candidate rejected; continuing:', error instanceof Error ? error.message : error);
        }
        await onProgress({ totalListed, processed: created + updated, created, updated, failed });
      }));
    }
  }
  return { totalListed, processed: created + updated, created, updated, failed };
}
