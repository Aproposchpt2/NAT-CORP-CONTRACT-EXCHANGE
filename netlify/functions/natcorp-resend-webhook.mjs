import { createHmac, timingSafeEqual } from 'node:crypto';
import { db, env, json, rpc } from './_shared/natcorp-db.mjs';

const safe=(v)=>String(v??'').trim();
function extractEmail(v){const s=safe(v);const m=s.match(/<([^>]+)>/);return safe(m?m[1]:s).toLowerCase();}
function verifySvix(raw,headers,secret){
  const id=safe(headers.get('svix-id')),ts=safe(headers.get('svix-timestamp')),sig=safe(headers.get('svix-signature'));
  if(!id||!ts||!sig)throw new Error('Missing Resend webhook signature headers.');
  if(Math.abs(Date.now()/1000-Number(ts))>300)throw new Error('Resend webhook timestamp outside tolerance.');
  const rawSecret=secret.startsWith('whsec_')?secret.slice(6):secret;
  const key=Buffer.from(rawSecret,'base64');
  const expected=createHmac('sha256',key).update(`${id}.${ts}.${raw}`,'utf8').digest();
  const signatures=sig.split(/\s+/).map(x=>x.trim()).filter(Boolean).map(x=>x.startsWith('v1,')?x.slice(3):x).filter(Boolean);
  for(const s of signatures){try{const got=Buffer.from(s,'base64');if(got.length===expected.length&&timingSafeEqual(got,expected))return;}catch{}}
  throw new Error('Resend webhook signature mismatch.');
}
function classifyRules(text){
  const t=safe(text).toLowerCase();
  if(/do not contact|don't contact|unsubscribe|remove me/.test(t))return 'DO_NOT_CONTACT';
  if(/not interested|no interest|decline|pass on|won't pursue|will not pursue|no thank/.test(t))return 'NOT_INTERESTED';
  if(/interested|would like to|want to pursue|we'll pursue|we will pursue|tell me more|please send|\byes\b/.test(t))return 'INTERESTED';
  if(/who are you|verify|legit|legitimate|apropos/.test(t))return 'TRUST_QUESTION';
  if(/contract|solicitation|deadline|scope|rfq|bid/.test(t))return 'CONTRACT_QUESTION';
  return 'UNKNOWN';
}
async function classifyAI(text){
  const key=env('OPENAI_API_KEY');if(!key)return 'UNKNOWN';
  const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({model:env('OPENAI_MODEL')||'gpt-5.6-terra',input:`Classify this business reply to a procurement opportunity outreach into exactly one label: INTERESTED, NOT_INTERESTED, CONTRACT_QUESTION, TRUST_QUESTION, DO_NOT_CONTACT, UNKNOWN. Return only the label. Reply:\n${safe(text).slice(0,5000)}`,max_output_tokens:40}),signal:AbortSignal.timeout(30000)});
  if(!response.ok)return 'UNKNOWN';const data=await response.json();let out=data.output_text||'';if(!out)for(const item of data.output||[])if(item.type==='message')for(const c of item.content||[])if(c.type==='output_text')out+=c.text||'';
  const cls=safe(out).toUpperCase().replace(/[^A-Z_]/g,'');return ['INTERESTED','NOT_INTERESTED','CONTRACT_QUESTION','TRUST_QUESTION','DO_NOT_CONTACT','UNKNOWN'].includes(cls)?cls:'UNKNOWN';
}
async function getReceivedEmail(emailId,apiKey){
  const r=await fetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}`,{headers:{Authorization:`Bearer ${apiKey}`,Accept:'application/json'},signal:AbortSignal.timeout(30000)});
  if(!r.ok)throw new Error(`Resend received-email retrieval failed (${r.status}).`);return r.json();
}
async function applyResponse(outreach,cls,text){
  await db('natcorp_outreach_events','PATCH',`?outreach_id=eq.${encodeURIComponent(outreach.outreach_id)}`,{status:'replied',response_class:cls,response_text:safe(text).slice(0,12000)||null,replied_at:new Date().toISOString(),updated_at:new Date().toISOString()},'return=minimal');
  if(['NOT_INTERESTED','DO_NOT_CONTACT'].includes(cls)&&outreach.candidate_id){
    try{return await rpc('natcorp_disposition_candidate',{p_candidate_id:outreach.candidate_id,p_disposition:cls,p_response_text:safe(text).slice(0,12000),p_source:'resend_inbound'});}catch(e){const existing=await db('natcorp_candidate_dispositions','GET',`?source_candidate_id=eq.${encodeURIComponent(outreach.candidate_id)}&select=*&order=created_at.desc&limit=1`);if(existing?.length)return {status:'already_processed'};throw e;}
  }
  if(cls==='INTERESTED'&&outreach.candidate_id)await db('natcorp_business_discovery_candidates','PATCH',`?candidate_id=eq.${encodeURIComponent(outreach.candidate_id)}`,{verification_status:'interested',updated_at:new Date().toISOString()},'return=minimal');
  return {status:'recorded'};
}
export default async function handler(req){
  if(req.method!=='POST')return json(405,{ok:false,error:'POST only'});
  const apiKey=env('RESEND_API_KEY'),secret=env('RESEND_WEBHOOK_SECRET');if(!apiKey||!secret)return json(503,{ok:false,error:'NAT-CORP inbound email webhook is not configured.'});
  const raw=await req.text();let event;try{verifySvix(raw,req.headers,secret);event=JSON.parse(raw);}catch(e){return json(400,{ok:false,error:`Invalid Resend webhook: ${e.message}`});}
  if(event.type!=='email.received')return json(200,{ok:true,ignored:event.type});
  try{
    const received=await getReceivedEmail(event.data?.email_id,apiKey);const email=received?.data||received;const from=extractEmail(email?.from||event.data?.from);const text=safe(email?.text||email?.html||'');
    if(!from)return json(200,{ok:true,ignored:'sender_missing'});
    const rows=await db('natcorp_outreach_events','GET',`?contact_email=ilike.${encodeURIComponent(from)}&status=in.(sent,delivered)&select=*&order=sent_at.desc.nullslast,created_at.desc&limit=1`);const outreach=rows?.[0];
    if(!outreach)return json(200,{ok:true,unmatched:true,from});
    let cls=classifyRules(text);if(cls==='UNKNOWN')cls=await classifyAI(text);const result=await applyResponse(outreach,cls,text);
    return json(200,{ok:true,outreach_id:outreach.outreach_id,response_class:cls,result});
  }catch(e){console.error('[natcorp-resend-webhook]',e);return json(500,{ok:false,error:e.message});}
}
export const config={path:'/api/natcorp-resend-webhook'};
