import { createHmac, timingSafeEqual } from 'node:crypto';
import { db, env, json } from './_shared/natcorp-db.mjs';

const safe=(v)=>String(v??'').trim();
function verifyStripe(raw,header,secret){
  const parts=Object.fromEntries(safe(header).split(',').map(x=>x.split('=')).filter(x=>x.length===2));
  const t=parts.t,v1=parts.v1;if(!t||!v1)throw new Error('Missing Stripe signature components.');
  if(Math.abs(Date.now()/1000-Number(t))>300)throw new Error('Stripe signature timestamp outside tolerance.');
  const expected=createHmac('sha256',secret).update(`${t}.${raw}`,'utf8').digest('hex');
  const a=Buffer.from(expected,'hex'),b=Buffer.from(v1,'hex');if(a.length!==b.length||!timingSafeEqual(a,b))throw new Error('Stripe signature mismatch.');
}
async function upsertMembership({businessProfileId,intakeId,customerId,subscriptionId,status}){
  const profile=(await db('aoie_business_profiles','GET',`?id=eq.${encodeURIComponent(businessProfileId)}&select=*`))?.[0]||{};
  const capacity=(await db('aoie_business_capacity','GET',`?business_profile_id=eq.${encodeURIComponent(businessProfileId)}&select=*`))?.[0]||{};
  const qualifications=await db('aoie_business_qualifications','GET',`?business_profile_id=eq.${encodeURIComponent(businessProfileId)}&select=qualification_name,qualification_type`);
  const past=await db('aoie_business_past_performance','GET',`?business_profile_id=eq.${encodeURIComponent(businessProfileId)}&select=project_title,client_name,project_description&limit=10`);
  const row={business_profile_id:businessProfileId,source_intake_id:intakeId||null,subscription_status:status,monthly_price:29.99,currency:'USD',capability_summary:profile.business_description||null,service_territory:profile.service_territory||{},qualification_summary:(qualifications||[]).map(x=>`${x.qualification_type}: ${x.qualification_name}`).join('; ')||null,capacity_summary:capacity.fulfillment_capacity||capacity.staffing_capacity||null,past_performance_summary:(past||[]).map(x=>`${x.project_title}${x.client_name?` — ${x.client_name}`:''}`).join('; ')||null,billing_customer_id:customerId||null,billing_subscription_id:subscriptionId||null,subscription_started_at:status==='active'?new Date().toISOString():null,last_profile_reviewed_at:new Date().toISOString(),updated_at:new Date().toISOString()};
  const existing=await db('natcorp_contractor_repository','GET',`?business_profile_id=eq.${encodeURIComponent(businessProfileId)}&select=membership_id`);
  if(existing?.[0])return (await db('natcorp_contractor_repository','PATCH',`?business_profile_id=eq.${encodeURIComponent(businessProfileId)}`,row,'return=representation'))?.[0];
  return (await db('natcorp_contractor_repository','POST','',[row],'return=representation'))?.[0];
}
export default async function handler(req){
  if(req.method!=='POST')return json(405,{ok:false,error:'POST only'});
  const webhookSecret=env('STRIPE_NATCORP_WEBHOOK_SECRET');if(!webhookSecret)return json(503,{ok:false,error:'NAT-CORP Stripe webhook is not configured.'});
  const raw=await req.text();let event;
  try{verifyStripe(raw,req.headers.get('stripe-signature'),webhookSecret);event=JSON.parse(raw);}catch(e){return json(400,{ok:false,error:`Invalid Stripe webhook: ${e.message}`});}
  try{
    if(event.type==='checkout.session.completed'){
      const s=event.data?.object||{};
      if(s.mode==='subscription'&&s.metadata?.business_profile_id){
        const membership=await upsertMembership({businessProfileId:s.metadata.business_profile_id,intakeId:s.metadata.intake_id||null,customerId:typeof s.customer==='string'?s.customer:s.customer?.id,subscriptionId:typeof s.subscription==='string'?s.subscription:s.subscription?.id,status:'active'});
        if(s.metadata.service_request_id)await db('natcorp_service_requests','PATCH',`?request_id=eq.${encodeURIComponent(s.metadata.service_request_id)}`,{status:'active',updated_at:new Date().toISOString(),metadata:{checkout_session_id:s.id}},'return=minimal');
        await db('natcorp_subscription_events','POST','',[{membership_id:membership?.membership_id||null,business_profile_id:s.metadata.business_profile_id,event_type:event.type,provider:'stripe',provider_event_id:event.id,payload:{checkout_session_id:s.id,subscription_id:s.subscription,customer_id:s.customer}}],'resolution=ignore-duplicates,return=minimal');
      }
    }
    if(['customer.subscription.updated','customer.subscription.deleted'].includes(event.type)){
      const s=event.data?.object||{},m=(await db('natcorp_contractor_repository','GET',`?billing_subscription_id=eq.${encodeURIComponent(s.id)}&select=*`))?.[0];
      if(m){const status=event.type==='customer.subscription.deleted'||['canceled','unpaid','incomplete_expired'].includes(s.status)?'canceled':['active','trialing'].includes(s.status)?'active':'past_due';await db('natcorp_contractor_repository','PATCH',`?membership_id=eq.${encodeURIComponent(m.membership_id)}`,{subscription_status:status,canceled_at:status==='canceled'?new Date().toISOString():null,updated_at:new Date().toISOString()},'return=minimal');await db('natcorp_subscription_events','POST','',[{membership_id:m.membership_id,business_profile_id:m.business_profile_id,event_type:event.type,provider:'stripe',provider_event_id:event.id,payload:{subscription_status:s.status}}],'resolution=ignore-duplicates,return=minimal');}
    }
    return json(200,{ok:true,received:event.type});
  }catch(e){console.error('[natcorp-subscription-webhook]',event?.type,e);return json(500,{ok:false,error:e.message});}
}
export const config={path:'/api/natcorp-subscription-webhook'};
