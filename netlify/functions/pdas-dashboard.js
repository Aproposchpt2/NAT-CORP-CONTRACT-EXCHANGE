'use strict';

const CORS={
  'Content-Type':'application/json',
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Methods':'GET, OPTIONS',
  'Access-Control-Allow-Headers':'Content-Type'
};
const SB=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
const KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SERVICE_KEY||'';
const PAGE=1000;

function headers(extra){return Object.assign({apikey:KEY,authorization:'Bearer '+KEY,accept:'application/json'},extra||{});}
async function page(path,query,from){
  const q=new URLSearchParams(query||{});
  const r=await fetch(`${SB}/rest/v1/${path}?${q}`,{headers:headers({Range:`${from}-${from+PAGE-1}`}),signal:AbortSignal.timeout(20000)});
  if(!r.ok)throw new Error(`${path} HTTP ${r.status}: ${(await r.text().catch(()=>'' )).slice(0,240)}`);
  const data=await r.json();return Array.isArray(data)?data:[];
}
async function all(path,query){const out=[];for(let from=0;;from+=PAGE){const rows=await page(path,query,from);out.push(...rows);if(rows.length<PAGE)break;}return out;}
function countBy(rows,key){return rows.reduce((a,r)=>{const k=String(r[key]||'Unknown');a[k]=(a[k]||0)+1;return a;},{});}
function sorted(obj){return Object.entries(obj).map(([name,count])=>({name,count})).sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name));}
function isCurrent(status){return ['open','active','posted','upcoming','forecasted','open_continuous'].includes(String(status||'').toLowerCase());}

exports.handler=async event=>{
  if(event.httpMethod==='OPTIONS')return{statusCode:204,headers:CORS,body:''};
  if(event.httpMethod!=='GET')return{statusCode:405,headers:CORS,body:JSON.stringify({ok:false,error:'GET only'})};
  try{
    if(!SB||!KEY)throw new Error('Supabase environment variables are not configured.');
    const [opportunities,publishers,jobs,runs]=await Promise.all([
      all('state_contract_opportunities',{select:'state_code,source_platform,status,issuing_organization,first_seen_at,last_seen_at,created_at,is_latest_version,duplicate_of'}),
      all('pdas_publishers',{select:'publisher_id,state_code,organization_name,research_status,monitoring_status'}),
      all('pdas_acquisition_jobs',{select:'job_id,job_name,state_code,source_platform,publisher_id,enabled,job_status,last_success_at,last_failure_at,next_scheduled_at,last_records_discovered,last_records_inserted,last_records_updated,last_records_failed,consecutive_failures,last_error,updated_at',order:'updated_at.desc'}),
      all('pdas_acquisition_runs',{select:'run_id,job_id,ingestion_run_id,trigger_type,run_status,started_at,completed_at,runtime_ms,records_discovered,records_inserted,records_updated,records_failed,error_message,created_at',order:'started_at.desc',limit:'25'})
    ]);
    const latest=opportunities.filter(r=>r.is_latest_version!==false&&!r.duplicate_of);
    const current=latest.filter(r=>isCurrent(r.status));
    const states=sorted(countBy(latest,'state_code'));
    const sources=sorted(countBy(latest,'source_platform'));
    const statuses=sorted(countBy(latest,'status'));
    const organizations=sorted(countBy(latest,'issuing_organization')).slice(0,12);
    const publisherStates=sorted(countBy(publishers,'state_code'));
    const activeJobs=jobs.filter(j=>j.enabled!==false);
    const healthyJobs=activeJobs.filter(j=>['succeeded','success','idle','scheduled'].includes(String(j.job_status||'').toLowerCase()));
    const failedJobs=activeJobs.filter(j=>String(j.job_status||'').toLowerCase()==='failed');
    const latestSuccess=runs.find(r=>String(r.run_status||'').toLowerCase()==='succeeded'||String(r.run_status||'').toLowerCase()==='success')||null;
    const latestRun=runs[0]||null;
    const dayAgo=Date.now()-86400000;
    const added24h=latest.filter(r=>Date.parse(r.first_seen_at||r.created_at||0)>=dayAgo).length;
    const response={
      ok:true,
      generated_at:new Date().toISOString(),
      tables:{opportunities:'public.state_contract_opportunities',publishers:'public.pdas_publishers',jobs:'public.pdas_acquisition_jobs',runs:'public.pdas_acquisition_runs'},
      summary:{
        total_opportunities:latest.length,
        current_opportunities:current.length,
        added_last_24h:added24h,
        publisher_count:publishers.length,
        active_job_count:activeJobs.length,
        healthy_job_count:healthyJobs.length,
        failed_job_count:failedJobs.length
      },
      states,sources,statuses,organizations,publisher_states:publisherStates,
      jobs:jobs.slice(0,20),
      recent_runs:runs.slice(0,12),
      latest_run:latestRun,
      latest_success:latestSuccess
    };
    return{statusCode:200,headers:CORS,body:JSON.stringify(response)};
  }catch(error){return{statusCode:500,headers:CORS,body:JSON.stringify({ok:false,error:error.message})};}
};
