import { commandAuthorized, db, env, nowIso } from './_shared/natcorp-db.mjs';
import { explainOpportunity } from './_shared/command-center-extraction.mjs';
import { ACQUISITION_METHOD } from './_shared/command-center-acquisition.mjs';
import { runIsCancelled } from './_shared/command-center-task-reporting.mjs';

async function patchRun(id,patch){await db('natcorp_extraction_runs','PATCH',`?id=eq.${id}`,{...patch,updated_at:nowIso()},'return=minimal')}

export default async function handler(req){
  if(!commandAuthorized(req))return;
  let body;try{body=await req.json()}catch{return}
  const runId=String(body?.run_id||''),target=Math.max(1,Math.min(50,Number(body?.target_records)||25));
  if(!runId)return;
  const apiKey=env('OPENAI_API_KEY');if(!apiKey){await patchRun(runId,{status:'FAILED',error_message:'OPENAI_API_KEY is not configured.',completed_at:nowIso()}).catch(()=>{});return}
  try{
    await patchRun(runId,{status:'RUNNING',started_at:nowIso(),error_message:null,activity:{stage:'STARTING',message:'Extraction worker started.',last_activity_at:nowIso()}});
    const rows=(await db('state_contract_opportunities','GET',`?acquisition_method=eq.${ACQUISITION_METHOD}&requirements_extraction_status=eq.NOT_STARTED&select=*&order=first_seen_at.asc&limit=${target}`))||[];
    await patchRun(runId,{total_eligible:rows.length,activity:{stage:'RUNNING',message:`${rows.length} eligible records loaded.`,last_activity_at:nowIso()}});
    let succeeded=0,failed=0,processed=0;
    for(const opportunity of rows){
      if(await runIsCancelled('EXTRACTION',runId)){await patchRun(runId,{status:'CANCELLED',processed,succeeded,failed,completed_at:nowIso(),error_message:'Owner cancelled this task.',activity:{stage:'CANCELLED',message:'Owner cancellation completed before the next extraction call.',last_activity_at:nowIso()}});return}
      try{await explainOpportunity(opportunity,{apiKey,backfillDeadline:true});succeeded+=1}catch(error){failed+=1;await db('state_contract_opportunities','PATCH',`?id=eq.${opportunity.id}`,{requirements_extraction_status:'FAILED',updated_at:nowIso()},'return=minimal').catch(()=>{})}
      processed+=1;
      await patchRun(runId,{processed,succeeded,failed,activity:{stage:'RUNNING',message:`Processed ${processed} of ${rows.length} eligible contracts.`,last_activity_at:nowIso(),current_contract_id:opportunity.id,current_contract_title:opportunity.title||null}});
    }
    const completedAt=nowIso();await patchRun(runId,{status:failed?'FAILED':'COMPLETED',processed,succeeded,failed,completed_at:completedAt,error_message:failed?`${failed} contract extraction record${failed===1?'':'s'} failed.`:null,activity:{stage:'COMPLETE',message:failed?`Completed with ${failed} record failures.`:'Extraction task completed.',last_activity_at:completedAt}});
  }catch(error){await patchRun(runId,{status:'FAILED',completed_at:nowIso(),error_message:error instanceof Error?error.message:'Extraction run failed.',activity:{stage:'FAILED',message:error instanceof Error?error.message:'Extraction run failed.',last_activity_at:nowIso()}}).catch(()=>{})}
}
