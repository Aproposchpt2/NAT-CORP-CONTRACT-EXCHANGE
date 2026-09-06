import { commandAuthorized, db, nowIso } from './_shared/natcorp-db.mjs';
import { getStatePublisherDefinedScope } from './_shared/command-center-state-publisher-defined.mjs';
import { runStatePublisherDefinedDiscoveryParity } from './_shared/command-center-publisher-runner-parity.mjs';
import { runIsCancelled } from './_shared/command-center-task-reporting.mjs';
import { ensureAcquisitionJob, updateAcquisitionJob } from './_shared/command-center-acquisition.mjs';
import { DISCOVERY_TARGET, STATE_NAME_TO_CODE } from './_shared/command-center-publisher-registry.mjs';

function report({runId,scope,coverage=[],totals={},completedAt=null,lastError=null}={}){
  const connectorErrors=coverage.filter(x=>x?.status==='SOURCE_ERROR_CONTINUED');
  return{report_version:'natcorp_acquisition_error_report_v2',generated_at:nowIso(),completed_at:completedAt,run_id:runId,state:scope?.state||null,state_code:STATE_NAME_TO_CODE[scope?.state]||null,scope_id:scope?.id||null,scope_name:scope?.name||null,source_platform:'PUBLISHER_DIRECTED_OPENAI_WEB_SEARCH',policy:'OWNER_TRIGGERED_ONE_OPENAI_CALL_PER_PUBLISHER',target_records:DISCOVERY_TARGET,totals:{listed:Number(totals.totalListed||0),processed:Number(totals.processed||0),created:Number(totals.created||0),updated:Number(totals.updated||0),failed:Number(totals.failed||0),connector_errors:connectorErrors.length,api_calls:Number(totals.apiCalls||0)},coverage_execution:coverage,last_error:lastError,historical_detail_available:true};
}

async function patchRun(id,patch){await db('natcorp_discovery_runs','PATCH',`?id=eq.${id}`,{...patch,updated_at:nowIso()},'return=minimal')}

export default async function handler(req){
  if(!commandAuthorized(req))return;
  let body;try{body=await req.json()}catch{return}
  const runId=String(body?.run_id||''),scope=getStatePublisherDefinedScope(body?.scope_id),taskSessionId=body?.task_session_id?String(body.task_session_id):null;
  if(!runId||!scope)return;
  const stateCode=STATE_NAME_TO_CODE[scope.state];
  const job=await ensureAcquisitionJob({stateCode,scope}).catch(()=>null);
  let latestCoverage=[],latestTotals={totalListed:0,processed:0,created:0,updated:0,failed:0,apiCalls:0};
  try{
    await patchRun(runId,{status:'RUNNING',started_at:nowIso(),error_message:null,activity:{stage:'STARTING',message:'Acquisition worker started.',last_activity_at:nowIso(),current_publisher:`${scope.state} Publisher Defined`,api_calls:0}});
    if(job)await updateAcquisitionJob(job.job_id,{enabled:true,job_status:'running',last_started_at:nowIso(),last_error:null});
    const summary=await runStatePublisherDefinedDiscoveryParity({scope,target:DISCOVERY_TARGET,runId,taskSessionId,shouldCancel:()=>runIsCancelled('ACQUISITION',runId),onProgress:async progress=>{
      latestCoverage=Array.isArray(progress.coverage_execution)?progress.coverage_execution:latestCoverage;
      latestTotals={totalListed:Number(progress.totalListed||0),processed:Number(progress.processed||0),created:Number(progress.created||0),updated:Number(progress.updated||0),failed:Number(progress.failed||0),apiCalls:Number(progress.apiCalls||0)};
      const activity={stage:progress.stage||'RUNNING',message:progress.message||'Acquisition running.',current_publisher:progress.current_publisher||null,current_family:progress.current_family||null,last_activity_at:nowIso(),api_calls:latestTotals.apiCalls,policy:'ONE_OPENAI_CALL_PER_PUBLISHER'};
      await patchRun(runId,{total_listed:latestTotals.totalListed,processed:latestTotals.processed,created:latestTotals.created,updated:latestTotals.updated,failed:latestTotals.failed,coverage_execution:latestCoverage,activity,error_report:report({runId,scope,coverage:latestCoverage,totals:latestTotals})});
      if(job)await updateAcquisitionJob(job.job_id,{last_records_discovered:latestTotals.totalListed,last_records_inserted:latestTotals.created,last_records_updated:latestTotals.updated,last_records_failed:latestTotals.failed,configuration:{scope_id:scope.id,publisher_id:scope.id,diagnostics:report({runId,scope,coverage:latestCoverage,totals:latestTotals})}});
    }});
    latestCoverage=summary.coverageExecution||latestCoverage;latestTotals={totalListed:Number(summary.totalListed||0),processed:Number(summary.processed||0),created:Number(summary.created||0),updated:Number(summary.updated||0),failed:Number(summary.failed||0),apiCalls:Number(summary.apiCalls||0)};
    const completedAt=nowIso();
    if(summary.cancelled){await patchRun(runId,{status:'CANCELLED',completed_at:completedAt,coverage_execution:latestCoverage,error_message:'Owner cancelled this task.',activity:{stage:'CANCELLED',message:'Owner cancellation completed.',last_activity_at:completedAt,api_calls:latestTotals.apiCalls},error_report:report({runId,scope,coverage:latestCoverage,totals:latestTotals,completedAt,lastError:'Owner cancelled this task.'})});if(job)await updateAcquisitionJob(job.job_id,{enabled:false,job_status:'paused',last_completed_at:completedAt,last_error:'Owner cancelled this task.'});return}
    const connectorErrors=latestCoverage.filter(x=>x?.status==='SOURCE_ERROR_CONTINUED').length;
    const status=connectorErrors?'FAILED':'COMPLETED',lastError=connectorErrors?`${connectorErrors} publisher connector${connectorErrors===1?'':'s'} failed during acquisition coverage.`:null;
    await patchRun(runId,{status,total_listed:latestTotals.totalListed,processed:latestTotals.processed,created:latestTotals.created,updated:latestTotals.updated,failed:latestTotals.failed,coverage_execution:latestCoverage,completed_at:completedAt,error_message:lastError,activity:{stage:'COMPLETE',message:lastError||'All assigned publisher connectors completed.',last_activity_at:completedAt,api_calls:latestTotals.apiCalls,policy:'ONE_OPENAI_CALL_PER_PUBLISHER'},error_report:report({runId,scope,coverage:latestCoverage,totals:latestTotals,completedAt,lastError})});
    if(job)await updateAcquisitionJob(job.job_id,{enabled:true,job_status:connectorErrors?'degraded':'healthy',last_records_discovered:latestTotals.totalListed,last_records_inserted:latestTotals.created,last_records_updated:latestTotals.updated,last_records_failed:latestTotals.failed,last_completed_at:completedAt,last_success_at:connectorErrors?job.last_success_at||null:completedAt,last_failure_at:connectorErrors?completedAt:job.last_failure_at||null,last_error:lastError,configuration:{scope_id:scope.id,publisher_id:scope.id,diagnostics:report({runId,scope,coverage:latestCoverage,totals:latestTotals,completedAt,lastError})}});
  }catch(error){const message=error instanceof Error?error.message.slice(0,700):'Discovery run failed.',completedAt=nowIso();await patchRun(runId,{status:'FAILED',completed_at:completedAt,error_message:message,coverage_execution:latestCoverage,activity:{stage:'FAILED',message,last_activity_at:completedAt,api_calls:latestTotals.apiCalls},error_report:report({runId,scope,coverage:latestCoverage,totals:latestTotals,completedAt,lastError:message})}).catch(()=>{});if(job)await updateAcquisitionJob(job.job_id,{job_status:'failed',last_completed_at:completedAt,last_failure_at:completedAt,last_error:message}).catch(()=>{})}
}
