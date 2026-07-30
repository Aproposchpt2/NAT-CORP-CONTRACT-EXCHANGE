import { deflateRawSync } from 'node:zlib';
import { db, env } from './_shared/natcorp-db.mjs';

const safe=(v)=>String(v??'').trim();
const arr=(v)=>Array.isArray(v)?v:[];
const xml=(v)=>safe(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');

function decode64url(value){const b64=value.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-value.length%4)%4);return Buffer.from(b64,'base64');}
function timingSafeEqual(a,b){if(a.length!==b.length)return false;let x=0;for(let i=0;i<a.length;i++)x|=a[i]^b[i];return x===0;}
async function verifyToken(token){
  const secret=env('BC_VERIFY_SECRET')||env('NATCORP_INTERNAL_TOKEN_PRODUCTION')||env('NATCORP_INTERNAL_TOKEN');
  if(!secret)throw new Error('Continuation verification is not configured.');
  const [body,sigText]=safe(token).split('.'); if(!body||!sigText)throw new Error('Invalid continuation token.');
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const expected=Buffer.from(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(body))); const supplied=decode64url(sigText);
  if(!timingSafeEqual(expected,supplied))throw new Error('Invalid continuation signature.');
  const payload=JSON.parse(decode64url(body).toString('utf8')); if(!payload?.opportunity_id||!payload?.candidate_id||Number(payload.exp||0)<Date.now())throw new Error('Continuation token expired or incomplete.');
  return payload;
}

let CRC_TABLE;
function crc32(buf){
  if(!CRC_TABLE){CRC_TABLE=Array.from({length:256},(_,n)=>{let c=n;for(let k=0;k<8;k++)c=(c&1)?0xEDB88320^(c>>>1):c>>>1;return c>>>0;});}
  let c=0xFFFFFFFF;for(const b of buf)c=CRC_TABLE[(c^b)&0xFF]^(c>>>8);return (c^0xFFFFFFFF)>>>0;
}
function dosDateTime(d=new Date()){
  const year=Math.max(1980,d.getFullYear());
  const time=((d.getHours()&31)<<11)|((d.getMinutes()&63)<<5)|((Math.floor(d.getSeconds()/2))&31);
  const date=(((year-1980)&127)<<9)|(((d.getMonth()+1)&15)<<5)|(d.getDate()&31);
  return {time,date};
}
function zip(entries){
  const locals=[],centrals=[]; let offset=0; const dt=dosDateTime();
  for(const [name,content] of entries){
    const nameBuf=Buffer.from(name,'utf8'), raw=Buffer.isBuffer(content)?content:Buffer.from(content,'utf8');
    const compressed=deflateRawSync(raw,{level:6}), crc=crc32(raw);
    const local=Buffer.alloc(30); local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt16LE(0,6);local.writeUInt16LE(8,8);local.writeUInt16LE(dt.time,10);local.writeUInt16LE(dt.date,12);local.writeUInt32LE(crc,14);local.writeUInt32LE(compressed.length,18);local.writeUInt32LE(raw.length,22);local.writeUInt16LE(nameBuf.length,26);local.writeUInt16LE(0,28);
    locals.push(local,nameBuf,compressed);
    const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50,0);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(0,8);central.writeUInt16LE(8,10);central.writeUInt16LE(dt.time,12);central.writeUInt16LE(dt.date,14);central.writeUInt32LE(crc,16);central.writeUInt32LE(compressed.length,20);central.writeUInt32LE(raw.length,24);central.writeUInt16LE(nameBuf.length,28);central.writeUInt16LE(0,30);central.writeUInt16LE(0,32);central.writeUInt16LE(0,34);central.writeUInt16LE(0,36);central.writeUInt32LE(0,38);central.writeUInt32LE(offset,42);
    centrals.push(central,nameBuf); offset+=local.length+nameBuf.length+compressed.length;
  }
  const centralBuf=Buffer.concat(centrals), localBuf=Buffer.concat(locals), end=Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(0,4);end.writeUInt16LE(0,6);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(centralBuf.length,12);end.writeUInt32LE(localBuf.length,16);end.writeUInt16LE(0,20);
  return Buffer.concat([localBuf,centralBuf,end]);
}

const p=(text,{bold=false,color='26364D',size=22,center=false,after=120}={})=>`<w:p><w:pPr>${center?'<w:jc w:val="center"/>':''}<w:spacing w:after="${after}"/></w:pPr><w:r><w:rPr>${bold?'<w:b/>':''}<w:color w:val="${color}"/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr><w:t xml:space="preserve">${xml(text||'Unavailable')}</w:t></w:r></w:p>`;
const heading=(text,level=1)=>p(text,{bold:true,color:'0F2A6A',size:level===1?32:26,after:160});
const bullet=(text)=>`<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr><w:spacing w:after="80"/></w:pPr><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>${xml(text)}</w:t></w:r></w:p>`;
const label=(k,v)=>`<w:p><w:pPr><w:spacing w:after="70"/></w:pPr><w:r><w:rPr><w:b/><w:color w:val="0F2A6A"/><w:sz w:val="20"/></w:rPr><w:t>${xml(k)}: </w:t></w:r><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>${xml(v||'Unavailable')}</w:t></w:r></w:p>`;
function listSection(title,items){return heading(title,2)+(arr(items).length?arr(items).map(x=>bullet(typeof x==='string'?x:JSON.stringify(x))).join(''):p('Unavailable'));}
function tableCell(text,head=false){return `<w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/>${head?'<w:shd w:fill="0F2A6A"/>':''}</w:tcPr><w:p><w:r><w:rPr>${head?'<w:b/><w:color w:val="FFFFFF"/>':''}<w:sz w:val="18"/></w:rPr><w:t>${xml(text||'Unavailable')}</w:t></w:r></w:p></w:tc>`;}
function evidenceTable(items){
  const rows=[['Requirement','Business Evidence','Status','Note'],...arr(items).map(x=>[x.requirement,x.business_evidence,x.status,x.note])];
  return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders><w:top w:val="single" w:sz="4" w:color="D7DFEA"/><w:left w:val="single" w:sz="4" w:color="D7DFEA"/><w:bottom w:val="single" w:sz="4" w:color="D7DFEA"/><w:right w:val="single" w:sz="4" w:color="D7DFEA"/><w:insideH w:val="single" w:sz="4" w:color="D7DFEA"/><w:insideV w:val="single" w:sz="4" w:color="D7DFEA"/></w:tblBorders></w:tblPr>${rows.map((r,i)=>`<w:tr>${r.map(v=>tableCell(v,i===0)).join('')}</w:tr>`).join('')}</w:tbl>`;
}
function makeDocx({opp,intake,profile,run}){
  const a=run.analysis||{}, rec=run.recommendation||a.recommendation||'CONDITIONAL';
  const recColor=rec==='PURSUE'?'166534':rec==='DO_NOT_PURSUE'?'9B2C2C':'92400E';
  let body='';
  body+=p('APROPOS GROUP LLC',{bold:true,color:'0F2A6A',size:30,center:true,after:70});
  body+=p('NAT-CORP — DETAILED ANALYZE FIT',{bold:true,color:'0F2A6A',size:42,center:true,after:70});
  body+=p('State & State-Entity Opportunity Pursuit Assessment',{color:'5E6B7D',size:23,center:true,after:300});
  body+=label('Prepared For',profile.legal_business_name||intake.intake_payload?.business_name);
  body+=label('Opportunity',opp.title); body+=label('Issuing Organization',opp.issuing_organization||opp.issuing_department);
  body+=label('Response Deadline',opp.response_deadline?new Date(opp.response_deadline).toLocaleString('en-US'):'Unavailable');
  body+=label('Report ID',run.run_id);body+=label('Contract DNA',run.contract_dna_id);body+=label('Business DNA',run.business_profile_id);
  body+=p(`FIT SCORE  ${run.score ?? a.score ?? 0} / 100`,{bold:true,color:'0F2A6A',size:38,center:true,after:90});
  body+=p(rec.replaceAll('_',' '),{bold:true,color:recColor,size:31,center:true,after:300});
  body+=heading('Executive Decision Summary')+p(a.executive_summary)+p(a.rationale);
  body+=listSection('Contract Requirements',a.contract_requirements);
  body+=heading('Capability Evidence Ledger',2)+(arr(a.capability_alignment).length?evidenceTable(a.capability_alignment):p('Unavailable'));
  body+=heading('Geographic Alignment',2)+p(a.geographic_alignment);
  body+=listSection('Licensing & Qualification Review',a.licensing_qualification_review);
  body+=listSection('Capacity & Delivery Review',a.capacity_delivery_review);
  body+=listSection('Past Performance Review',a.past_performance_review);
  body+=heading('Risk Register',2)+(arr(a.risks).length?arr(a.risks).map(r=>bullet(`${safe(r.domain)||'Risk'} — ${safe(r.level)||'INFORMATION'}: ${safe(r.finding)||'Unavailable'} Mitigation: ${safe(r.mitigation)||'Unavailable'}`)).join(''):p('Unavailable'));
  body+=listSection('Unavailable Contract Details',a.unavailable_contract_details);
  body+=listSection('Unavailable Business Details',a.unavailable_business_details);
  body+=listSection('Decision Conditions',a.decision_conditions);
  body+=listSection('Pursuit Action Plan',a.action_plan);
  body+=heading('Proposal Readiness',2)+p(a.proposal_readiness);
  body+=heading('Official Source',2)+p(opp.official_source_url||opp.source_url);
  body+=p('Important: This report is procurement decision support prepared by APROPOS GROUP LLC. APROPOS is not the issuing government agency and does not guarantee responsiveness, award, or contract performance.',{color:'5E6B7D',size:18,after:120});
  const document=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const styles=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Aptos" w:hAnsi="Aptos"/><w:sz w:val="20"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults></w:styles>`;
  const numbering=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:tabs><w:tab w:val="num" w:pos="720"/></w:tabs><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`;
  const contentTypes=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`;
  const rels=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`;
  const docRels=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>`;
  const now=new Date().toISOString();
  const core=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>NAT-CORP Detailed Analyze Fit</dc:title><dc:creator>APROPOS GROUP LLC</dc:creator><cp:lastModifiedBy>APROPOS GROUP LLC</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`;
  const app=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>APROPOS NAT-CORP</Application></Properties>`;
  return zip([['[Content_Types].xml',contentTypes],['_rels/.rels',rels],['word/document.xml',document],['word/styles.xml',styles],['word/numbering.xml',numbering],['word/_rels/document.xml.rels',docRels],['docProps/core.xml',core],['docProps/app.xml',app]]);
}

export default async function handler(req){
  if(req.method!=='GET')return new Response('GET only',{status:405});
  const url=new URL(req.url),token=url.searchParams.get('token'),runId=url.searchParams.get('run_id');
  try{
    const payload=await verifyToken(token); if(!runId)throw new Error('Analyze Fit run ID required.');
    const runRows=await db('natcorp_analyze_fit_runs','GET',`?run_id=eq.${encodeURIComponent(runId)}&opportunity_id=eq.${encodeURIComponent(payload.opportunity_id)}&candidate_id=eq.${encodeURIComponent(payload.candidate_id)}&status=eq.completed&select=*`);
    const run=runRows?.[0]; if(!run)throw new Error('Completed Analyze Fit run not found.');
    const [oppRows,intakeRows,profileRows]=await Promise.all([
      db('state_contract_opportunities','GET',`?id=eq.${encodeURIComponent(payload.opportunity_id)}&select=id,pdas_record_id,title,issuing_organization,issuing_department,response_deadline,official_source_url,source_url`),
      db('natcorp_business_intakes','GET',`?intake_id=eq.${encodeURIComponent(run.intake_id)}&select=*`),
      db('aoie_business_profiles','GET',`?id=eq.${encodeURIComponent(run.business_profile_id)}&select=*`),
    ]);
    const opp=oppRows?.[0]||{},intake=intakeRows?.[0]||{},profile=profileRows?.[0]||{};
    const buffer=makeDocx({opp,intake,profile,run});
    const rawName=`NATCORP_Analyze_Fit_${safe(profile.legal_business_name||'Business').replace(/[^A-Za-z0-9]+/g,'_')}_${safe(opp.pdas_record_id||opp.id).replace(/[^A-Za-z0-9]+/g,'_')}_${new Date().toISOString().slice(0,10)}.docx`;
    const existing=await db('natcorp_analyze_fit_reports','GET',`?analyze_fit_run_id=eq.${encodeURIComponent(run.run_id)}&select=*`);
    if(!existing?.length)await db('natcorp_analyze_fit_reports','POST','',[{analyze_fit_run_id:run.run_id,opportunity_id:payload.opportunity_id,business_profile_id:run.business_profile_id,report_version:'NATCORP-OTF-ANALYZE-FIT-v1',file_name:rawName}], 'return=minimal');
    return new Response(buffer,{status:200,headers:{'content-type':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','content-disposition':`attachment; filename="${rawName}"`,'cache-control':'no-store'}});
  }catch(e){console.error('[opportunity-report]',e);return new Response(JSON.stringify({ok:false,error:e.message}),{status:401,headers:{'content-type':'application/json','cache-control':'no-store'}});}
}
export const config={path:'/api/opportunity-report'};
