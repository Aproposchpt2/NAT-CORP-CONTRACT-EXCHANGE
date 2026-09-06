import { runOneCallOpenAIDiscovery } from './command-center-openai-discovery-one-call.mjs';

function coverageEntry(child){return{scope_id:child.id,family:child.vendor_name||child.platform||child.name,source_name:child.name,scope_type:child.scope_type,assigned_entities:(child.publishers||[]).map(p=>({id:p.id,name:p.name})),assigned_entity_count:(child.publishers||[]).length,status:'PENDING',started_at:null,completed_at:null,listed:0,qualified:0,created:0,updated:0,rejected:0,api_calls:0,error:null}}

export async function runStatePublisherDefinedDiscoveryParity({scope,target=50,runId,taskSessionId,onProgress=async()=>{},shouldCancel=async()=>false}={}){
  if(scope?.scope_type!=='STATE_PUBLISHER_DEFINED'||!scope?.child_scopes?.length)throw new Error('STATE_PUBLISHER_DEFINED_SCOPE_REQUIRED');
  const totals={totalListed:0,processed:0,created:0,updated:0,failed:0,apiCalls:0};
  const coverageExecution=scope.child_scopes.map(coverageEntry);
  const emit=async(extra={})=>onProgress({...totals,coverage_execution:coverageExecution,...extra});
  await emit({stage:'STARTING',current_publisher:`${scope.state} Publisher Defined`,current_family:null});

  for(let index=0;index<scope.child_scopes.length;index+=1){
    if(await shouldCancel()){
      await emit({stage:'CANCELLED',message:'Owner cancellation received before the next publisher call.'});
      return{...totals,coverageExecution,cancelled:true};
    }
    const child=scope.child_scopes[index],evidence=coverageExecution[index],base={...totals};
    const familyName=child.vendor_name||child.platform||child.name;
    evidence.status='SEARCHING';evidence.started_at=new Date().toISOString();
    await emit({stage:'SEARCHING',current_publisher:child.name,current_family:familyName,message:`Searching ${child.name} with the single owner-authorized OpenAI call.`});
    try{
      const summary=await runOneCallOpenAIDiscovery({scope:child,target,runId,taskSessionId,stateName:scope.state,onProgress:async(progress)=>{
        totals.totalListed=base.totalListed+Number(progress.totalListed||0);totals.processed=base.processed+Number(progress.processed||0);totals.created=base.created+Number(progress.created||0);totals.updated=base.updated+Number(progress.updated||0);totals.failed=base.failed+Number(progress.failed||0);totals.apiCalls=base.apiCalls+Number(progress.api_calls||0);
        evidence.listed=Number(progress.totalListed||0);evidence.qualified=Number(progress.processed||0);evidence.created=Number(progress.created||0);evidence.updated=Number(progress.updated||0);evidence.rejected=Number(progress.failed||0);evidence.api_calls=Number(progress.api_calls||0);
        await emit({stage:'SEARCHING',current_publisher:child.name,current_family:familyName,message:`Processing ${child.name}. One OpenAI discovery call maximum.`});
      }});
      totals.totalListed=base.totalListed+Number(summary.totalListed||0);totals.processed=base.processed+Number(summary.processed||0);totals.created=base.created+Number(summary.created||0);totals.updated=base.updated+Number(summary.updated||0);totals.failed=base.failed+Number(summary.failed||0);totals.apiCalls=base.apiCalls+Number(summary.apiCalls||0);
      evidence.listed=Number(summary.totalListed||0);evidence.qualified=Number(summary.processed||0);evidence.created=Number(summary.created||0);evidence.updated=Number(summary.updated||0);evidence.rejected=Number(summary.failed||0);evidence.api_calls=Number(summary.apiCalls||0);evidence.status='SEARCHED';
    }catch(error){totals.failed+=1;evidence.status='SOURCE_ERROR_CONTINUED';evidence.error=error instanceof Error?error.message.slice(0,500):String(error||'Unknown source error').slice(0,500);}
    evidence.completed_at=new Date().toISOString();
    await emit({stage:'PUBLISHER_COMPLETE',current_publisher:child.name,current_family:familyName,message:`Completed ${child.name}.`});
  }
  return{...totals,coverageExecution,cancelled:false};
}
