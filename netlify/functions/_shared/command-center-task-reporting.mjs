import { db, nowIso } from './natcorp-db.mjs';

const TASK_TYPES = new Set(['ACQUISITION','EXTRACTION']);

function taskType(value) {
  const type = String(value || '').trim().toUpperCase();
  if (!TASK_TYPES.has(type)) throw new Error('INVALID_TASK_TYPE');
  return type;
}

export async function activeTaskSession(value) {
  const type = taskType(value);
  const rows = await db('natcorp_task_sessions','GET',`?task_type=eq.${type}&status=eq.ACTIVE&select=*&order=started_at.desc&limit=1`);
  return rows?.[0] || null;
}

export async function startNewTaskSession(value) {
  const type = taskType(value);
  const stamp = nowIso();
  await db('natcorp_task_sessions','PATCH',`?task_type=eq.${type}&status=eq.ACTIVE`,{
    status:'CLOSED', closed_at:stamp, updated_at:stamp,
  },'return=minimal');
  const rows = await db('natcorp_task_sessions','POST','',[{
    task_type:type, status:'ACTIVE', started_at:stamp, updated_at:stamp,
  }],'return=representation');
  return rows?.[0] || null;
}

export async function ensureActiveTaskSession(value) {
  return (await activeTaskSession(value)) || startNewTaskSession(value);
}

export async function activeRunForTask(value) {
  const type = taskType(value);
  const table = type === 'ACQUISITION' ? 'natcorp_discovery_runs' : 'natcorp_extraction_runs';
  const rows = await db(table,'GET','?status=in.(QUEUED,RUNNING)&select=*&order=created_at.desc&limit=1');
  return rows?.[0] || null;
}

export async function runIsCancelled(type, runId) {
  const normalized = taskType(type);
  const table = normalized === 'ACQUISITION' ? 'natcorp_discovery_runs' : 'natcorp_extraction_runs';
  const rows = await db(table,'GET',`?id=eq.${encodeURIComponent(runId)}&select=status,cancel_requested_at&limit=1`);
  const row = rows?.[0];
  return !row || row.status === 'CANCELLED' || Boolean(row.cancel_requested_at);
}

export async function cancelActiveTask(value) {
  const type = taskType(value);
  const table = type === 'ACQUISITION' ? 'natcorp_discovery_runs' : 'natcorp_extraction_runs';
  const stamp = nowIso();
  const rows = await db(table,'GET','?status=in.(QUEUED,RUNNING)&select=*&order=created_at.desc&limit=1');
  const run = rows?.[0];
  if (!run) return null;
  await db(table,'PATCH',`?id=eq.${run.id}`,{
    status:'CANCELLED', cancel_requested_at:stamp, completed_at:stamp, updated_at:stamp,
    error_message:'Owner cancelled this task.',
  },'return=minimal');
  return { ...run, status:'CANCELLED', cancel_requested_at:stamp, completed_at:stamp };
}

function aggregateAcquisition(decisions, runs) {
  const summary = {
    candidate_failures:0, accepted:0, skipped:0, total_decisions:decisions.length,
    run_failures:runs.filter(r=>r.status==='FAILED').length,
    cancelled_runs:runs.filter(r=>r.status==='CANCELLED').length,
  };
  for (const item of decisions) {
    if (item.decision === 'ACCEPTED') summary.accepted += 1;
    else if (item.decision === 'SKIPPED') summary.skipped += 1;
    else if (item.decision === 'REJECTED') summary.candidate_failures += 1;
  }
  return summary;
}

function aggregateExtraction(runs) {
  return {
    run_failures:runs.filter(r=>r.status==='FAILED').length,
    cancelled_runs:runs.filter(r=>r.status==='CANCELLED').length,
    record_failures:runs.reduce((s,r)=>s+Number(r.failed||0),0),
    runs:runs.length,
  };
}

export async function taskReportingStatus() {
  const [activeRows,recentRows] = await Promise.all([
    db('natcorp_task_sessions','GET','?status=eq.ACTIVE&select=*&order=started_at.desc'),
    db('natcorp_task_sessions','GET','?select=*&order=started_at.desc&limit=30'),
  ]);
  const active = Object.fromEntries((activeRows||[]).map(r=>[r.task_type,r]));
  const acquisition = active.ACQUISITION || null;
  const extraction = active.EXTRACTION || null;
  const [acqRuns, decisions, extRuns] = await Promise.all([
    acquisition ? db('natcorp_discovery_runs','GET',`?task_session_id=eq.${acquisition.id}&select=*&order=created_at.desc&limit=20`) : [],
    acquisition ? db('natcorp_acquisition_candidate_decisions','GET',`?task_session_id=eq.${acquisition.id}&select=*&order=created_at.desc&limit=1000`) : [],
    extraction ? db('natcorp_extraction_runs','GET',`?task_session_id=eq.${extraction.id}&select=*&order=created_at.desc&limit=20`) : [],
  ]);
  return {
    active_sessions:active,
    recent_sessions:recentRows || [],
    current_reports:{
      ACQUISITION:{
        session:acquisition,
        runs:acqRuns || [],
        latest_run:acqRuns?.[0] || null,
        candidate_decisions:decisions || [],
        summary:aggregateAcquisition(decisions || [], acqRuns || []),
      },
      EXTRACTION:{
        session:extraction,
        runs:extRuns || [],
        latest_run:extRuns?.[0] || null,
        summary:aggregateExtraction(extRuns || []),
      },
    },
  };
}

export async function recordAcquisitionCandidateDecision({taskSessionId,runId,decision,stage,reasonCode=null,storageResult=null,candidate={},pathway={}}={}) {
  if (!runId) return null;
  try {
    const rows = await db('natcorp_acquisition_candidate_decisions','POST','',[{
      task_session_id:taskSessionId || null,
      run_id:runId,
      decision:String(decision || 'REJECTED').toUpperCase(),
      stage:String(stage || 'UNKNOWN').slice(0,120),
      reason_code:reasonCode ? String(reasonCode).slice(0,300) : null,
      storage_result:storageResult ? String(storageResult).slice(0,80) : null,
      publisher_name:candidate?.agency_name ? String(candidate.agency_name).slice(0,300) : null,
      solicitation_number:candidate?.solicitation_number ? String(candidate.solicitation_number).slice(0,200) : null,
      title:candidate?.title ? String(candidate.title).slice(0,500) : null,
      authoritative_detail_url:candidate?.authoritative_detail_url ? String(candidate.authoritative_detail_url).slice(0,2000) : null,
      pathway_id:pathway?.id ? String(pathway.id).slice(0,200) : null,
      pathway_name:pathway?.name ? String(pathway.name).slice(0,300) : null,
    }],'return=representation');
    return rows?.[0] || null;
  } catch (error) {
    console.error('[natcorp-task-reporting] decision persistence failed:', error instanceof Error ? error.message : error);
    return null;
  }
}
