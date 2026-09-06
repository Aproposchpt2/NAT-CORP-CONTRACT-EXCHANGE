// NatCorp Command Center -- ACB behavioral parity.
// Intentional project difference: canonical opportunity storage is state_contract_opportunities.
import { db, env, json, nowIso, commandAuthorized } from './_shared/natcorp-db.mjs';
import { DISCOVERY_TARGET, STATE_NAME_TO_CODE } from './_shared/command-center-publisher-registry.mjs';
import { getAcquisitionPublisherScope, listPublisherDefinedChildScopes, listStatePublisherDefinedScopes } from './_shared/command-center-state-publisher-defined.mjs';
import { extractionCoverage } from './_shared/command-center-extraction.mjs';
import { WORK_CAPABILITY_VERSION, workCapabilityStatus as getWorkCapabilityStatus } from './_shared/command-center-work-capability.mjs';
import { getJob, WORK_CAPABILITY_JOB_ID } from './_shared/command-center-jobs.mjs';
import { jobAsRunSummary } from './_shared/command-center-acquisition.mjs';
import { ensureActiveTaskSession, startNewTaskSession, activeRunForTask, cancelActiveTask, taskReportingStatus } from './_shared/command-center-task-reporting.mjs';

const EXTRACTION_TARGET=25,WORK_CAPABILITY_TARGET=25;

async function recentDiscoveryRuns(){return(await db('natcorp_discovery_runs','GET','?select=*&order=created_at.desc&limit=50'))||[]}
async function recentExtractionRuns(){return(await db('natcorp_extraction_runs','GET','?select=*&order=created_at.desc&limit=50'))||[]}

async function statusBundle(){
  const [discoveryRuns,extractionRuns,extraction,workCapability,taskReporting,workJob]=await Promise.all([
    recentDiscoveryRuns(),recentExtractionRuns(),extractionCoverage(),getWorkCapabilityStatus(),taskReportingStatus(),getJob(WORK_CAPABILITY_JOB_ID),
  ]);
  return{ok:true,retrieved_at:nowIso(),project:'natcorp',parity_reference:'ACB_COMMAND_CENTER',operational_pipeline:['CONTRACT_ACQUISITION','CONTRACT_EXTRACTION','WORK_CAPABILITY_V2'],acquisition_policy:{owner_triggered:true,openai_calls_per_publisher:1,automatic_retries:false,schedule:'NONE_OWNER_CONTROLLED',replenishment_basis:'OPPORTUNITY_EXPIRATION_OR_INVENTORY_DEPLETION'},discovery:{publishers:[...listStatePublisherDefinedScopes(),...listPublisherDefinedChildScopes()],target_records:DISCOVERY_TARGET,runs:discoveryRuns,selection_model:'STATE_OR_INDIVIDUAL_PUBLISHER_DEFINED'},extraction:{extracted:extraction.extracted,total:extraction.total,pending:extraction.pending},extraction_runs:{target_records:EXTRACTION_TARGET,runs:extractionRuns},work_capability:{mode:'WORK_CAPABILITY_V2',target_records:WORK_CAPABILITY_TARGET,total:workCapability.total,ready:workCapability.ready,pending:workCapability.pending,high:workCapability.high,moderate:workCapability.moderate,limited:workCapability.limited,current_version:WORK_CAPABILITY_VERSION,recent:workCapability.recent,last_run:jobAsRunSummary(workJob,WORK_CAPABILITY_TARGET)},errors:{discovery_runs:discoveryRuns.filter(r=>r.status==='FAILED'),extraction_runs:extractionRuns.filter(r=>r.status==='FAILED'),work_capability_runs:[jobAsRunSummary(workJob,WORK_CAPABILITY_TARGET)].filter(r=>r?.status==='FAILED'),profiles_with_errors:[]},task_reporting:taskReporting};
}

async function launchBackground(req,name,body){const url=new URL(`/.netlify/functions/${name}`,req.url);const key=req.headers.get('x-natcorp-command-key')||req.headers.get('x-dashboard-password')||'';return fetch(url,{method:'POST',headers:{'content-type':'application/json','x-natcorp-command-key':key},body:JSON.stringify(body)})}

export default async function handler(req){
  if(!commandAuthorized(req))return json(401,{ok:false,error:'Command center access denied.'});
  if(req.method==='GET'){try{return json(200,await statusBundle())}catch(error){console.error('[natcorp-command-center-parity]',error);return json(500,{ok:false,error:error instanceof Error?error.message:'Command center status failed.'})}}
  if(req.method!=='POST')return json(405,{ok:false,error:'GET or POST only.'});
  let payload;try{payload=await req.json()}catch{return json(400,{ok:false,error:'Invalid JSON.'})}
  const action=String(payload?.action||'');
  try{
    if(action==='start_new_task'){
      const type=String(payload.task_type||'').trim().toUpperCase();if(!['ACQUISITION','EXTRACTION'].includes(type))return json(400,{ok:false,error:'Start New Task supports ACQUISITION or EXTRACTION.'});
      const active=await activeRunForTask(type);if(active)return json(409,{ok:false,error:`Cannot start a new ${type.toLowerCase()} task while a run is ${active.status}.`,run:active});
      const session=await startNewTaskSession(type);return json(200,{ok:true,action,task_type:type,session});
    }
    if(action==='cancel_task'){
      const type=String(payload.task_type||'').trim().toUpperCase();if(!['ACQUISITION','EXTRACTION'].includes(type))return json(400,{ok:false,error:'Cancel supports ACQUISITION or EXTRACTION.'});
      const run=await cancelActiveTask(type);return json(200,{ok:true,action,task_type:type,run,message:run?'Cancellation recorded. The worker will stop before the next OpenAI call.':'No active run was found.'});
    }
    const apiKey=env('OPENAI_API_KEY');
    if(action==='launch_discovery'){
      if(!apiKey)return json(500,{ok:false,error:'OPENAI_API_KEY is not configured.'});
      if(await activeRunForTask('ACQUISITION'))return json(409,{ok:false,error:'An acquisition run is already active.'});
      const scope=getAcquisitionPublisherScope(payload.scope_id||payload.publisher_id);if(!scope)return json(400,{ok:false,error:'Select a Publisher Defined acquisition scope.'});
      const session=await ensureActiveTaskSession('ACQUISITION');const stateCode=STATE_NAME_TO_CODE[scope.state]||null;
      const created=await db('natcorp_discovery_runs','POST','',[{task_session_id:session?.id||null,scope_id:scope.id,state_code:stateCode,publisher_name:scope.name,platform_name:'PUBLISHER_DEFINED',status:'QUEUED',target_records:DISCOVERY_TARGET,activity:{stage:'QUEUED',message:'Owner-triggered acquisition queued.',last_activity_at:nowIso(),policy:'ONE_OPENAI_CALL_PER_PUBLISHER'}}],'return=representation');
      const run=created?.[0];if(!run)return json(500,{ok:false,error:'Discovery run could not be created.'});
      const queued=await launchBackground(req,'natcorp-acquisition-task-background',{run_id:run.id,scope_id:scope.id,task_session_id:session?.id||null});if(!queued.ok&&queued.status!==202){await db('natcorp_discovery_runs','PATCH',`?id=eq.${run.id}`,{status:'FAILED',completed_at:nowIso(),error_message:`Background launch returned HTTP ${queued.status}`},'return=minimal');return json(502,{ok:false,error:'Discovery background launch failed.'})}
      return json(202,{ok:true,action,run,policy:'ONE_OPENAI_CALL_PER_PUBLISHER'});
    }
    if(action==='launch_extraction'){
      if(!apiKey)return json(500,{ok:false,error:'OPENAI_API_KEY is not configured.'});if(await activeRunForTask('EXTRACTION'))return json(409,{ok:false,error:'An extraction run is already active.'});
      const session=await ensureActiveTaskSession('EXTRACTION');const target=Math.max(1,Math.min(50,Number(payload.limit)||EXTRACTION_TARGET));const created=await db('natcorp_extraction_runs','POST','',[{task_session_id:session?.id||null,status:'QUEUED',target_records:target,activity:{stage:'QUEUED',message:'Extraction queued.',last_activity_at:nowIso()}}],'return=representation');const run=created?.[0];if(!run)return json(500,{ok:false,error:'Extraction run could not be created.'});
      const queued=await launchBackground(req,'natcorp-extraction-task-background',{run_id:run.id,target_records:target,task_session_id:session?.id||null});if(!queued.ok&&queued.status!==202){await db('natcorp_extraction_runs','PATCH',`?id=eq.${run.id}`,{status:'FAILED',completed_at:nowIso(),error_message:`Background launch returned HTTP ${queued.status}`},'return=minimal');return json(502,{ok:false,error:'Extraction background launch failed.'})}
      return json(202,{ok:true,action,run});
    }
    if(action==='launch_work_capability'){
      if(!apiKey)return json(500,{ok:false,error:'OPENAI_API_KEY is not configured.'});const limit=Math.max(1,Math.min(100,Number(payload.limit)||WORK_CAPABILITY_TARGET)),force=payload.force===true;const queued=await launchBackground(req,'natcorp-work-capability-run-background',{limit,force});if(!queued.ok&&queued.status!==202)return json(502,{ok:false,error:`Work Capability background launch returned HTTP ${queued.status}.`});return json(202,{ok:true,action,batch_limit:limit,force,mode:'WORK_CAPABILITY_V2',run:{id:WORK_CAPABILITY_JOB_ID,status:'QUEUED',target_records:limit}});
    }
    return json(400,{ok:false,error:`Unknown action: ${action}`});
  }catch(error){console.error('[natcorp-command-center-parity]',action,error);return json(500,{ok:false,error:error instanceof Error?error.message:'Command failed.'})}
}
