import { buildAnalyzeFitDocx, analyzeFitDocxFilename } from './lib/analyze-fit-docx.mjs';

const JSON_HEADERS={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"};
const json=(status,body)=>new Response(JSON.stringify(body),{status,headers:JSON_HEADERS});
function sameOrigin(req){const target=new URL(req.url),origin=req.headers.get('origin'),referer=req.headers.get('referer'),site=req.headers.get('sec-fetch-site');if(origin&&origin!==target.origin)return false;if(referer){try{if(new URL(referer).origin!==target.origin)return false}catch{return false}}if(site&&!['same-origin','none'].includes(site))return false;return origin===target.origin||Boolean(referer)||site==='same-origin'}

export default async function handler(req){
  if(req.method!=='POST')return json(405,{ok:false,error:'POST only'});
  if(!sameOrigin(req))return json(403,{ok:false,error:'Same-origin Analyze Fit access required.'});
  let body;try{body=await req.json()}catch{return json(400,{ok:false,error:'Invalid JSON request.'})}
  const bid=body.bid||{},profile=body.profile||{},analysis=body.analysis||{};
  if(!bid.title)return json(400,{ok:false,error:'Opportunity title required.'});
  if(!(profile.business_name||profile.legal_name||profile.company_name))return json(400,{ok:false,error:'Business profile name required.'});
  if(!analysis||typeof analysis!=='object')return json(400,{ok:false,error:'Analyze Fit assessment required.'});
  try{
    const payload={report_standard:body.report_standard||'APROPOS-ANALYZE-FIT-READABLE-v2',bid,profile,analysis};
    const document=buildAnalyzeFitDocx(payload),filename=analyzeFitDocxFilename(payload);
    return new Response(document,{status:200,headers:{'content-type':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','content-disposition':`attachment; filename="${filename}"`,'content-length':String(document.length),'cache-control':'no-store, private','x-content-type-options':'nosniff'}});
  }catch(error){console.error('[analyze-fit-docx]',error);return json(500,{ok:false,error:'The Word report could not be generated.'})}
}
export const config={path:'/api/analyze-fit-docx',rateLimit:{windowLimit:10,windowSize:60,aggregateBy:['ip','domain']}};
