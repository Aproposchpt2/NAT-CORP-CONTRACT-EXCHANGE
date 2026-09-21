import { env } from './natcorp-db.mjs';

const FEED_URL='https://bdms.aproposgroupllc.com/api/contract-distribution-feed';
const STATE_CODE={California:'CA',Nevada:'NV',Arizona:'AZ'};
const SUPPORTED_STATES=['CA','NV','AZ'];

const text=v=>String(v??'').trim();
const arr=v=>Array.isArray(v)?v:[];
const asTextArray=v=>Array.isArray(v)?v.map(x=>typeof x==='string'?x:JSON.stringify(x)).filter(Boolean):[];

export async function loadCanonicalDistribution(){
  const token=text(env('CBRIEF_DISTRIBUTION_SYNC_TOKEN'));
  if(!token)throw new Error('CBRIEF_DISTRIBUTION_SYNC_TOKEN is not configured.');
  const rows=[];
  for(let page=1;;page++){
    const u=new URL(FEED_URL);
    u.searchParams.set('states',SUPPORTED_STATES.join(','));
    u.searchParams.set('current','true');
    u.searchParams.set('page',String(page));
    u.searchParams.set('page_size','1000');
    const r=await fetch(u,{headers:{authorization:`Bearer ${token}`,accept:'application/json'},signal:AbortSignal.timeout(60000)});
    const data=await r.json().catch(()=>({}));
    if(!r.ok||!data.ok)throw new Error(data.error||`Canonical distribution feed failed (${r.status}).`);
    rows.push(...arr(data.opportunities));
    if(page>=Number(data.total_pages||1))break;
  }
  return rows;
}

export function toLegacyCompatibilityRow(c){
  const stateCode=STATE_CODE[text(c.state)];
  if(!stateCode)return null;
  const scope=text(c.scope_summary);
  const description=text(c.description);
  if(!scope||!description)return null;
  const sourceUrl=text(c.authoritative_detail_url||c.authoritative_response_url);
  if(!sourceUrl)return null;
  return {
    id:c.id,
    pdas_record_id:`CBRIEF-${String(c.id).replaceAll('-','')}`,
    state_code:stateCode,
    jurisdiction_type:text(c.source_type||'public').toLowerCase(),
    jurisdiction_name:text(c.state),
    issuing_organization:text(c.agency_name)||'Public Agency',
    issuing_department:text(c.department_name)||null,
    source_platform:'cbrief_canonical',
    source_record_id:String(c.id),
    source_url:sourceUrl,
    official_source_url:sourceUrl,
    solicitation_number:text(c.solicitation_number)||null,
    title:text(c.title)||'Untitled opportunity',
    description,
    procurement_type:text(c.opportunity_type)||null,
    notice_type:text(c.opportunity_type)||null,
    status:'open',
    posted_at:c.posted_at||null,
    response_deadline:c.closes_at||null,
    prebid_datetime:c.prebid_at||null,
    question_deadline:c.questions_due_at||null,
    place_of_performance_city:text(c.city)||null,
    place_of_performance_state:stateCode,
    place_of_performance_zip:text(c.zip_code)||null,
    estimated_value_min:c.estimated_value_min??null,
    estimated_value_max:c.estimated_value_max??null,
    contact_name:text(c.buyer_name)||null,
    contact_email:text(c.buyer_email)||null,
    naics_codes:asTextArray(c.naics_codes),
    nigp_codes:asTextArray(c.nigp_codes),
    unspsc_codes:[],
    commodity_codes:asTextArray(c.commodity_codes),
    set_asides:text(c.set_aside_type)?[text(c.set_aside_type)]:[],
    certifications_required:[],
    keywords:[],
    document_urls:[],
    classifications:{canonical_source:'public.cbrief_distribution_ready_opportunities'},
    requirements:{scope_summary:scope,description},
    raw_source_payload:{canonical_source:'public.cbrief_distribution_ready_opportunities',cbrief_id:c.id,cbrief_updated_at:c.updated_at||null},
    source_fingerprint:`cbrief:${c.id}`,
    content_fingerprint:null,
    duplicate_of:null,
    amendment_count:0,
    is_latest_version:true,
    last_verified_at:c.last_verified_at||null,
    acquisition_method:'CBRIEF_CANONICAL_SYNC',
    ingestion_run_id:`CBRIEF_SYNC_${new Date().toISOString().slice(0,13)}`,
    requirements_extraction_status:'COMPLETE',
    qa_status:'verified',
    updated_at:new Date().toISOString(),
  };
}
