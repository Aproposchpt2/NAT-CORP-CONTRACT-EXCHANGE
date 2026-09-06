// Owner-approved acquisition cost-control policy:
// exactly ONE OpenAI Responses API call per publisher connector per owner-triggered run.
import { env } from './natcorp-db.mjs';
import { DISCOVERY_TARGET, MIN_CLOSING_DAYS } from './command-center-publisher-registry.mjs';
import { storeAcquiredOpportunity } from './command-center-acquisition.mjs';
import { recordAcquisitionCandidateDecision } from './command-center-task-reporting.mjs';

const DEFAULT_MODEL = 'gpt-5.5';
const MAX_CANDIDATES_PER_CALL = 50;
const MIN_CLOSING_MS = MIN_CLOSING_DAYS * 24 * 60 * 60 * 1000;

const ALLOWED_HOST_SUFFIXES = [
  '.gov','.edu','.us','.k12.ca.us','planetbids.com','bonfirehub.com','opengov.com','bidnetdirect.com',
  'publicpurchase.com','bidsync.com','periscopeholdings.com','jaggaer.com','sciquest.com','demandstar.com',
  'bpxplanroom.com','oregonbuys.gov','ngemnv.com','ionwave.net','cityofhenderson.com','cityofnorthlasvegas.com',
  'bcnv.org','lvmpd.com','harryreidairport.com','rtcsnv.com','lvcva.com','ccsd.net','lvvwd.com',
  'cleanwaterteam.com','southernnevadahealthdistrict.org','snvrha.org','umcsn.com','thelibrarydistrict.org',
  'hendersonlibraries.com','regionalflood.org'
];

const BROWSER_DEPENDENT_AUTHORITIES = Object.freeze({
  CAL_EPROCURE:Object.freeze({hosts:Object.freeze(['caleprocure.ca.gov']),allowed_statuses:Object.freeze([401,403,405])}),
});

function clean(value,max=1000){const text=String(value??'').replace(/\s+/g,' ').trim();return text?text.slice(0,max):null}
function outputText(message){if(typeof message?.output_text==='string')return message.output_text;return(message?.output||[]).flatMap(i=>i?.type==='message'?i.content||[]:[]).filter(p=>p?.type==='output_text').map(p=>p.text||'').join('\n')}
function citationUrls(message){return[...new Set((message?.output||[]).flatMap(i=>i?.type==='message'?i.content||[]:[]).flatMap(p=>p?.annotations||[]).filter(a=>a?.type==='url_citation'&&a.url).map(a=>a.url))]}
function canonicalUrl(value){const url=new URL(String(value||''));if(url.protocol!=='https:')throw new Error('AUTHORITATIVE_URL_MUST_USE_HTTPS');url.hash='';for(const key of[...url.searchParams.keys()])if(/^utm_|^(fbclid|gclid)$/i.test(key))url.searchParams.delete(key);return url.toString()}
function hostAllowed(hostname){const host=String(hostname||'').toLowerCase();return ALLOWED_HOST_SUFFIXES.some(s=>host===s.replace(/^\./,'')||host.endsWith(s))}
function browserDependentAccessAllowed(scopeId,hostname,status){const p=BROWSER_DEPENDENT_AUTHORITIES[String(scopeId||'').toUpperCase()];return Boolean(p&&p.hosts.includes(String(hostname||'').toLowerCase())&&p.allowed_statuses.includes(Number(status)))}

async function verifyPublicUrl(value,{scopeId=null}={}){
  const url=canonicalUrl(value),parsed=new URL(url);
  if(!hostAllowed(parsed.hostname))throw new Error('SOURCE_HOST_NOT_IN_PUBLIC_PROCUREMENT_ALLOWLIST');
  const response=await fetch(url,{method:'GET',redirect:'follow',headers:{'user-agent':'NatCorpContractExchange/1.0 (+https://natcorp.aproposgroupllc.com)',accept:'text/html,application/json,text/plain;q=0.8,*/*;q=0.5'},signal:AbortSignal.timeout(10000)});
  if(!response.ok){const allowed=browserDependentAccessAllowed(scopeId,parsed.hostname,response.status);await response.body?.cancel().catch(()=>{});if(allowed)return url;throw new Error(`AUTHORITATIVE_URL_HTTP_${response.status}`)}
  const finalUrl=canonicalUrl(response.url||url);if(!hostAllowed(new URL(finalUrl).hostname))throw new Error('SOURCE_REDIRECTED_OUTSIDE_ALLOWLIST');await response.body?.cancel().catch(()=>{});return finalUrl;
}

function validClosingDate(value){const date=new Date(String(value||''));if(!Number.isFinite(date.getTime()))throw new Error('CLOSING_DATE_NOT_ISO_8601');const remaining=date.getTime()-Date.now();if(remaining<=0)throw new Error('OPPORTUNITY_IS_EXPIRED_OR_SAME_DAY');if(remaining<MIN_CLOSING_MS)throw new Error(`OPPORTUNITY_HAS_LESS_THAN_${MIN_CLOSING_DAYS}_DAYS_REMAINING`);return date.toISOString()}

const RESPONSE_SCHEMA={type:'object',additionalProperties:false,properties:{opportunities:{type:'array',maxItems:MAX_CANDIDATES_PER_CALL,items:{type:'object',additionalProperties:false,properties:{title:{type:'string'},agency_name:{type:'string'},department_name:{type:['string','null']},solicitation_number:{type:['string','null']},source_opportunity_id:{type:['string','null']},description:{type:['string','null']},opportunity_type:{type:['string','null']},posted_at:{type:['string','null']},closes_at:{type:'string'},closing_timezone:{type:['string','null']},place_of_performance:{type:['string','null']},city:{type:['string','null']},state:{type:['string','null']},jurisdiction_level:{type:['string','null']},platform_name:{type:'string'},authoritative_detail_url:{type:'string'},electronic_submission_allowed:{type:['boolean','null']}},required:['title','agency_name','department_name','solicitation_number','source_opportunity_id','description','opportunity_type','posted_at','closes_at','closing_timezone','place_of_performance','city','state','jurisdiction_level','platform_name','authoritative_detail_url','electronic_submission_allowed']}}},required:['opportunities']};

async function discoverCandidates({apiKey,model,scope,target}){
  const limit=Math.max(1,Math.min(MAX_CANDIDATES_PER_CALL,Number(target)||DISCOVERY_TARGET));
  const prompt=`Today is ${new Date().toISOString()}. Act as the NatCorp Contract Exchange Acquisition Discovery Agent.\n\nASSIGNED PUBLISHER: ${scope.name}\nAPPROVED PUBLISHER ENTRY URL: ${scope.site_url}\nSINGLE-CALL LIMIT: ${limit} currently open opportunities\nMINIMUM RESPONSE WINDOW: ${MIN_CLOSING_DAYS} calendar days remaining\n\nOWNER-TRIGGERED COST CONTROL: This is the ONE and ONLY OpenAI discovery call for this publisher during this acquisition run. Search the publisher's authoritative current procurement ecosystem thoroughly in this response. Do not expect a second pass.\n\nStay inside the assigned publisher or its directly designated procurement platform. Return only currently open procurement opportunities with an authoritative future bidding/response deadline at least ${MIN_CLOSING_DAYS} days away. Preserve the actual issuing public entity. Do not acquire full solicitation packages. Do not bypass registration, authentication, CAPTCHA, payment, invitation, or access controls.\n\nReturn up to ${limit} unique opportunities. Use authoritative opportunity/detail URLs only. Exclude expired, cancelled, awarded, closed, not-yet-open, standing vendor-registration pages, surveys, and continuous pools without a real future deadline. Never fabricate missing fields; use null. Return structured data only.`;
  const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${apiKey}`},body:JSON.stringify({model,store:false,reasoning:{effort:'low'},tools:[{type:'web_search'}],input:[{role:'system',content:'You are a meticulous government procurement acquisition agent. This is a single-pass publisher search: maximize authoritative coverage in one response without fabricating records.'},{role:'user',content:prompt}],text:{format:{type:'json_schema',name:'contract_discovery_batch',strict:true,schema:RESPONSE_SCHEMA}},max_output_tokens:9000}),signal:AbortSignal.timeout(90000)});
  const raw=await response.text();if(!response.ok)throw new Error(`OPENAI_DISCOVERY_FAILED:${response.status}:${raw.slice(0,500)}`);const message=JSON.parse(raw),parsed=JSON.parse(outputText(message));return{candidates:Array.isArray(parsed.opportunities)?parsed.opportunities:[],citations:citationUrls(message),responseId:message.id||null};
}

export async function runOneCallOpenAIDiscovery({scope,target=DISCOVERY_TARGET,onProgress=async()=>{},stateName,runId,taskSessionId}={}){
  const apiKey=env('OPENAI_API_KEY');if(!apiKey)throw new Error('OPENAI_API_KEY is not configured.');if(!scope?.name||!scope?.site_url)throw new Error('PUBLISHER_LISTING_ENTRY_REQUIRED');
  const model=env('NATCORP_DISCOVERY_MODEL')||DEFAULT_MODEL;
  let created=0,updated=0,failed=0,totalListed=0;
  await onProgress({totalListed,processed:0,created,updated,failed,api_calls:0});
  const batch=await discoverCandidates({apiKey,model,scope,target});
  totalListed=batch.candidates.length;
  await onProgress({totalListed,processed:0,created,updated,failed,api_calls:1});
  const seen=new Set();
  for(const candidate of batch.candidates){
    try{
      const rawUrl=canonicalUrl(candidate.authoritative_detail_url);if(seen.has(rawUrl)){await recordAcquisitionCandidateDecision({taskSessionId,runId,decision:'SKIPPED',stage:'DEDUPE',reasonCode:'DUPLICATE_URL_IN_SINGLE_RESPONSE',candidate,pathway:scope});continue}seen.add(rawUrl);
      const url=await verifyPublicUrl(rawUrl,{scopeId:scope.id});
      const closesAt=validClosingDate(candidate.closes_at);
      if(!clean(candidate.title,500)||!clean(candidate.agency_name,300))throw new Error('TITLE_AND_AGENCY_REQUIRED');
      const result=await storeAcquiredOpportunity({candidate:{...candidate,closes_at:closesAt},url,evidence:{model,responseId:batch.responseId,citations:batch.citations,scope:scope.id,publisherName:scope.name,publisherSiteUrl:scope.site_url,platformName:scope.platform,stateName:stateName||scope.state,runId},stateName:stateName||scope.state,scope,runId});
      if(result==='created')created+=1;else updated+=1;
      await recordAcquisitionCandidateDecision({taskSessionId,runId,decision:'ACCEPTED',stage:'PERSISTENCE',storageResult:result,candidate:{...candidate,authoritative_detail_url:url},pathway:scope});
    }catch(error){failed+=1;await recordAcquisitionCandidateDecision({taskSessionId,runId,decision:'REJECTED',stage:'VALIDATION',reasonCode:error instanceof Error?error.message:String(error),candidate,pathway:scope});}
    await onProgress({totalListed,processed:created+updated,created,updated,failed,api_calls:1});
  }
  return{totalListed,processed:created+updated,created,updated,failed,apiCalls:1};
}
