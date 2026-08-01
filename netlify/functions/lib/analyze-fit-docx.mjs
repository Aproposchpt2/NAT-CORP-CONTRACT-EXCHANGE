import { deflateRawSync } from 'node:zlib';
import { aproposLogoAttachment } from './apropos-brand.mjs';

const arr = (v) => Array.isArray(v) ? v : [];
const safe = (v, n = 12000) => String(v ?? '').trim().slice(0, n);
const xml = (v) => safe(v).replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&apos;' }[c]));
const cleanFilename = (v) => safe(v, 140).replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '') || 'Analyze-Fit';

const unavailable = (v) => /^(?:unavailable|unknown|not available|not identified|none|n\/?a|unverified|)$/i.test(safe(v));
const scalarText = (v) => {
  if (v == null) return '';
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return safe(v);
  if (Array.isArray(v)) return v.map(scalarText).filter(Boolean).join('; ');
  if (typeof v === 'object') return Object.entries(v).map(([k,val]) => `${label(k)}: ${scalarText(val)}`).filter((x) => !x.endsWith(': ')).join('; ');
  return safe(v);
};
const label = (v) => safe(v).replaceAll('_',' ').replace(/\b\w/g, (c) => c.toUpperCase());
const hasSubstance = (items) => arr(items).some((item) => {
  if (typeof item === 'string') return !unavailable(item);
  if (!item || typeof item !== 'object') return false;
  return Object.values(item).some((v) => typeof v === 'string' ? !unavailable(v) : Array.isArray(v) ? v.length > 0 : Boolean(v));
});
const uniqueStrings = (items) => [...new Set(arr(items).map(scalarText).map(safe).filter((x) => x && !unavailable(x)))];

export function normalizeAnalyzeFitAnalysis(input = {}) {
  const a = structuredClone(input || {});
  let score = Math.max(0, Math.min(100, Math.round(Number(a.score) || 0)));
  let recommendation = safe(a.recommendation).toUpperCase().replaceAll('-', '_').replaceAll(' ', '_');
  if (!['PURSUE','CONDITIONAL','DO_NOT_PURSUE'].includes(recommendation)) recommendation = score >= 75 ? 'PURSUE' : score >= 45 ? 'CONDITIONAL' : 'DO_NOT_PURSUE';

  const capability = arr(a.capability_alignment);
  const statuses = capability.map((x) => safe(x?.status).toUpperCase());
  const hasGap = statuses.includes('GAP');
  const hasPartial = statuses.some((x) => ['PARTIAL','UNVERIFIED'].includes(x));
  const highRisk = arr(a.risks).some((x) => safe(x?.level).toUpperCase() === 'HIGH');
  const capacityMissing = !hasSubstance(a.capacity_delivery_review);
  const licensingMissing = !hasSubstance(a.licensing_qualification_review);
  const pastMissing = !hasSubstance(a.past_performance_review);
  const contractUnknowns = uniqueStrings(a.unavailable_contract_details);
  const businessUnknowns = uniqueStrings(a.unavailable_business_details);
  const materialUnknowns = contractUnknowns.length + businessUnknowns.length;
  const guardrails = [];

  if (hasGap) {
    score = Math.min(score, highRisk ? 44 : 59);
    recommendation = highRisk ? 'DO_NOT_PURSUE' : 'CONDITIONAL';
    guardrails.push('One or more contract requirements are recorded as capability gaps.');
  } else if (hasPartial) {
    score = Math.min(score, 74);
    if (recommendation === 'PURSUE') recommendation = 'CONDITIONAL';
    guardrails.push('One or more capability requirements remain partial or unverified.');
  }
  if (highRisk) {
    score = Math.min(score, 59);
    if (recommendation === 'PURSUE') recommendation = 'CONDITIONAL';
    guardrails.push('The risk register contains at least one high-risk finding.');
  }
  if (capacityMissing) {
    score = Math.min(score, 84);
    if (recommendation === 'PURSUE') recommendation = 'CONDITIONAL';
    guardrails.push('Staffing, capacity, scheduling, or delivery evidence has not been verified.');
  }
  if (licensingMissing) {
    score = Math.min(score, 84);
    if (recommendation === 'PURSUE') recommendation = 'CONDITIONAL';
    guardrails.push('Licensing or qualification evidence has not been fully verified.');
  }
  if (pastMissing) {
    score = Math.min(score, 88);
    if (recommendation === 'PURSUE' && score < 85) recommendation = 'CONDITIONAL';
    guardrails.push('Contract-relevant past-performance evidence is limited or unavailable.');
  }
  if (materialUnknowns) {
    score = Math.min(score, materialUnknowns >= 3 ? 79 : 89);
    if (recommendation === 'PURSUE' && score < 85) recommendation = 'CONDITIONAL';
    guardrails.push('Material contract or business details remain unavailable and require verification.');
  }
  score = Math.min(score, 95);

  const conditions = uniqueStrings(a.decision_conditions);
  const actions = uniqueStrings(a.action_plan);
  if (capacityMissing) {
    conditions.push('Verify staffing, workload, schedule, subcontracting, and delivery capacity before committing to pursue.');
    actions.push('Complete a delivery-capacity review against the solicitation schedule and anticipated workload.');
  }
  if (licensingMissing) {
    conditions.push('Verify every required professional license, registration, certification, and responsible-person requirement.');
    actions.push('Create a solicitation compliance matrix for licenses, certifications, forms, and mandatory attachments.');
  }
  if (materialUnknowns) {
    conditions.push('Resolve all material unavailable contract and business details against the official solicitation and current business records.');
    actions.push('Review the complete official solicitation, amendments, attachments, and submission instructions.');
  }
  if (!actions.length) actions.push('Confirm the official solicitation, amendments, deadline, and submission method before proposal development begins.');

  let executive = safe(a.executive_summary);
  let rationale = safe(a.rationale);
  if (recommendation !== 'PURSUE' || guardrails.length) {
    executive = executive
      .replace(/meets all critical requirements/ig, 'shows strong alignment with several identified requirements')
      .replace(/aligns perfectly/ig, 'shows strong alignment')
      .replace(/fully meets/ig, 'appears to align with')
      .replace(/shows strong alignment with several identified requirements and shows strong alignment with/ig, 'shows strong alignment with several identified requirements and appears relevant to');
    const note = `Final pursuit approval remains subject to verification of: ${guardrails.join(' ')}`;
    if (!rationale.toLowerCase().includes('final pursuit approval')) rationale = [rationale, note].filter(Boolean).join(' ');
  }

  const proposalReadiness = recommendation === 'DO_NOT_PURSUE'
    ? 'NOT READY — resolve disqualifying gaps before proposal development.'
    : recommendation === 'CONDITIONAL'
      ? 'CONDITIONALLY READY — complete the listed decision conditions before proposal development.'
      : 'READY — proceed only after confirming the official solicitation and current business evidence.';

  return {
    ...a,
    score,
    recommendation,
    executive_summary: executive,
    rationale,
    decision_conditions: [...new Set(conditions)],
    action_plan: [...new Set(actions)],
    proposal_readiness: proposalReadiness,
    evidence_guardrails: [...new Set(guardrails)],
  };
}

const wRun = (text, { bold=false, color='', size=21, italics=false } = {}) => {
  const props = [bold ? '<w:b/>' : '', italics ? '<w:i/>' : '', color ? `<w:color w:val="${color}"/>` : '', size ? `<w:sz w:val="${size}"/><w:szCs w:val="${size}"/>` : ''].join('');
  return `<w:r><w:rPr>${props}</w:rPr><w:t xml:space="preserve">${xml(text)}</w:t></w:r>`;
};
const paragraph = (text='', opts={}) => {
  const { style='', bold=false, color='', size=21, align='', before=0, after=100, keep=false, italics=false } = opts;
  const pPr = [style ? `<w:pStyle w:val="${style}"/>` : '', align ? `<w:jc w:val="${align}"/>` : '', `<w:spacing w:before="${before}" w:after="${after}"/>`, keep ? '<w:keepNext/>' : ''].join('');
  return `<w:p><w:pPr>${pPr}</w:pPr>${wRun(text,{bold,color,size,italics})}</w:p>`;
};
const richParagraph = (runs=[], opts={}) => {
  const { style='', align='', before=0, after=100, keep=false } = opts;
  const pPr = [style ? `<w:pStyle w:val="${style}"/>` : '', align ? `<w:jc w:val="${align}"/>` : '', `<w:spacing w:before="${before}" w:after="${after}"/>`, keep ? '<w:keepNext/>' : ''].join('');
  return `<w:p><w:pPr>${pPr}</w:pPr>${runs.map((r) => wRun(r.text, r)).join('')}</w:p>`;
};
const bullet = (text) => `<w:p><w:pPr><w:pStyle w:val="ListBullet"/><w:spacing w:after="70"/></w:pPr>${wRun(text,{size:20})}</w:p>`;
const heading = (text, level=1) => paragraph(text,{style:`Heading${level}`,keep:true,before:180,after:90});
const cellProps = ({ width=0, shade='', valign='center', borders=true }={}) => `<w:tcPr>${width?`<w:tcW w:w="${width}" w:type="dxa"/>`:''}${shade?`<w:shd w:fill="${shade}"/>`:''}<w:vAlign w:val="${valign}"/>${borders?'':'<w:tcBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/></w:tcBorders>'}</w:tcPr>`;
const cell = (content, opts={}) => `<w:tc>${cellProps(opts)}${content || paragraph('')}</w:tc>`;
const row = (cells, { header=false, allowSplit=false }={}) => `<w:tr><w:trPr>${header?'<w:tblHeader/>':''}${allowSplit?'':'<w:cantSplit/>'}</w:trPr>${cells.join('')}</w:tr>`;
const table = (rows, widths=[], { noBorders=false, width=9638 }={}) => `<w:tbl><w:tblPr><w:tblW w:w="${width}" w:type="dxa"/><w:tblLayout w:type="fixed"/>${noBorders?'<w:tblBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/></w:tblBorders>':'<w:tblBorders><w:top w:val="single" w:sz="4" w:color="D8E1ED"/><w:left w:val="single" w:sz="4" w:color="D8E1ED"/><w:bottom w:val="single" w:sz="4" w:color="D8E1ED"/><w:right w:val="single" w:sz="4" w:color="D8E1ED"/><w:insideH w:val="single" w:sz="3" w:color="D8E1ED"/><w:insideV w:val="single" w:sz="3" w:color="D8E1ED"/></w:tblBorders>'}</w:tblPr><w:tblGrid>${widths.map((w)=>`<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>${rows.join('')}</w:tbl>`;

function imageDrawing() {
  return `<w:p><w:pPr><w:jc w:val="left"/><w:spacing w:after="0"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="1150000" cy="860000"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="1" name="APROPOS GROUP LLC Logo" descr="APROPOS GROUP LLC logo"/><wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="0" name="apropos-group-logo.jpg"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdLogo"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1150000" cy="860000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
}

function displayItems(items) {
  const values = arr(items);
  if (!values.length) return paragraph('Unavailable / not identified in current evidence.', { italics:true, color:'66758A' });
  return values.map((item) => {
    if (typeof item === 'string') return bullet(item);
    const entries = Object.entries(item || {}).filter(([,v]) => scalarText(v));
    if (!entries.length) return '';
    const titleEntry = entries.find(([k]) => ['requirement','title','action','condition','description','project_title','area','domain'].includes(k));
    const titleText = titleEntry ? scalarText(titleEntry[1]) : scalarText(item);
    const detail = entries.filter(([k]) => !titleEntry || k !== titleEntry[0]).map(([k,v]) => `${label(k)}: ${scalarText(v)}`).join(' | ');
    return richParagraph([{text:`• ${titleText}`,bold:true,size:20},{text:detail?` — ${detail}`:'',size:20}],{after:70});
  }).join('') || paragraph('Unavailable / not identified in current evidence.', { italics:true, color:'66758A' });
}

function capabilityTable(items) {
  const values = arr(items);
  if (!values.length) return paragraph('No capability alignment records returned.', { italics:true, color:'66758A' });
  const rows = [row([
    cell(paragraph('Requirement',{bold:true,color:'FFFFFF',size:19,after:0}),{width:2300,shade:'103478'}),
    cell(paragraph('Status',{bold:true,color:'FFFFFF',size:19,after:0}),{width:1100,shade:'103478'}),
    cell(paragraph('Business Evidence',{bold:true,color:'FFFFFF',size:19,after:0}),{width:3800,shade:'103478'}),
    cell(paragraph('Analyst Note',{bold:true,color:'FFFFFF',size:19,after:0}),{width:2438,shade:'103478'})
  ],{header:true})];
  values.forEach((x, i) => rows.push(row([
    cell(paragraph(safe(x?.requirement)||'Requirement',{size:19,after:0}),{width:2300,shade:i%2?'F8FAFC':'FFFFFF'}),
    cell(paragraph(safe(x?.status)||'UNVERIFIED',{bold:true,size:18,color:safe(x?.status).toUpperCase()==='ALIGNED'?'176C45':safe(x?.status).toUpperCase()==='GAP'?'962F2F':'9B6300',after:0}),{width:1100,shade:i%2?'F8FAFC':'FFFFFF'}),
    cell(paragraph(safe(x?.business_evidence)||'Unavailable',{size:19,after:0}),{width:3800,shade:i%2?'F8FAFC':'FFFFFF'}),
    cell(paragraph(safe(x?.note)||'—',{size:19,after:0}),{width:2438,shade:i%2?'F8FAFC':'FFFFFF'})
  ])));
  return table(rows,[2300,1100,3800,2438]);
}

function riskTable(items) {
  const values = arr(items);
  if (!values.length) return paragraph('No risks returned.', { italics:true, color:'66758A' });
  const rows = [row([
    cell(paragraph('Risk Domain',{bold:true,color:'FFFFFF',size:19,after:0}),{width:1700,shade:'103478'}),
    cell(paragraph('Level',{bold:true,color:'FFFFFF',size:19,after:0}),{width:900,shade:'103478'}),
    cell(paragraph('Finding',{bold:true,color:'FFFFFF',size:19,after:0}),{width:3600,shade:'103478'}),
    cell(paragraph('Mitigation',{bold:true,color:'FFFFFF',size:19,after:0}),{width:3438,shade:'103478'})
  ],{header:true})];
  values.forEach((x,i)=>rows.push(row([
    cell(paragraph(safe(x?.domain)||'Risk',{size:19,after:0}),{width:1700,shade:i%2?'F8FAFC':'FFFFFF'}),
    cell(paragraph(safe(x?.level)||'INFORMATION',{bold:true,size:18,after:0}),{width:900,shade:i%2?'F8FAFC':'FFFFFF'}),
    cell(paragraph(safe(x?.finding)||'Unavailable',{size:19,after:0}),{width:3600,shade:i%2?'F8FAFC':'FFFFFF'}),
    cell(paragraph(safe(x?.mitigation)||'Unavailable',{size:19,after:0}),{width:3438,shade:i%2?'F8FAFC':'FFFFFF'})
  ])));
  return table(rows,[1700,900,3600,3438]);
}

function detailsTable(items, columns) {
  const values = arr(items);
  if (!values.length) return paragraph('Unavailable / not identified in current evidence.', { italics:true, color:'66758A' });
  const widths = columns.map((c) => c.width);
  const rows = [row(columns.map((c) => cell(paragraph(c.label,{bold:true,color:'FFFFFF',size:19,after:0}),{width:c.width,shade:'103478'})),{header:true})];
  values.forEach((item,i) => {
    const obj = typeof item === 'string' ? { description:item } : (item || {});
    rows.push(row(columns.map((c) => {
      const val = c.keys.map((k)=>obj[k]).find((v)=>scalarText(v)) ?? '';
      return cell(paragraph(scalarText(val)||'—',{size:19,after:0}),{width:c.width,shade:i%2?'F8FAFC':'FFFFFF'});
    })));
  });
  return table(rows,widths);
}

function metadataTable(payload, analysis) {
  const o=payload.opportunity||{}, r=payload.report||{};
  const completed = payload.run?.completed_at ? new Date(payload.run.completed_at).toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'}) : 'Unavailable';
  const deadline = o.response_deadline ? new Date(o.response_deadline).toLocaleString('en-US',{timeZone:'America/Los_Angeles',dateStyle:'medium',timeStyle:'short'})+' PT' : 'Unavailable';
  const rows=[
    row([cell(paragraph('Issuing Organization',{bold:true,color:'66758A',size:17,after:0}),{width:2400,shade:'F3F6FA'}),cell(paragraph(o.issuing_organization||o.issuing_department||'Unavailable',{bold:true,size:19,after:0}),{width:7218})]),
    row([cell(paragraph('State / Deadline',{bold:true,color:'66758A',size:17,after:0}),{width:2400,shade:'F3F6FA'}),cell(paragraph(`${o.state_code||'—'} · ${deadline}`,{bold:true,size:19,after:0}),{width:7218})]),
    row([cell(paragraph('Record / Completed',{bold:true,color:'66758A',size:17,after:0}),{width:2400,shade:'F3F6FA'}),cell(paragraph(`${o.pdas_record_id||o.id||'Unavailable'} · ${completed}`,{bold:true,size:19,after:0}),{width:7218})]),
    row([cell(paragraph('Report Standard',{bold:true,color:'66758A',size:17,after:0}),{width:2400,shade:'F3F6FA'}),cell(paragraph(r.report_version||'NATCORP-OTF-ANALYZE-FIT-v1',{bold:true,size:19,after:0}),{width:7218})])
  ];
  return table(rows,[2400,7218]);
}

function scoreTable(analysis) {
  const rec = analysis.recommendation.replaceAll('_',' ');
  const rows=[row([
    cell(paragraph(`${analysis.score}%`,{bold:true,color:'103478',size:32,align:'center',after:20})+paragraph('ANALYZE FIT SCORE',{bold:true,color:'66758A',size:15,align:'center',after:0}),{width:3200,shade:'F8FAFC'}),
    cell(paragraph(rec,{bold:true,color:analysis.recommendation==='PURSUE'?'176C45':analysis.recommendation==='DO_NOT_PURSUE'?'962F2F':'9B6300',size:27,align:'center',after:20})+paragraph('PURSUIT RECOMMENDATION',{bold:true,color:'66758A',size:15,align:'center',after:0}),{width:3200,shade:'F8FAFC'}),
    cell(paragraph(analysis.proposal_readiness.split('—')[0].trim(),{bold:true,color:'103478',size:24,align:'center',after:20})+paragraph('PROPOSAL READINESS',{bold:true,color:'66758A',size:15,align:'center',after:0}),{width:3238,shade:'F8FAFC'})
  ])];
  return table(rows,[3200,3200,3238]);
}

function documentXml(payload) {
  const analysis = normalizeAnalyzeFitAnalysis(payload.run?.analysis || {});
  const o=payload.opportunity||{}, b=payload.business||{};
  const recommendation=analysis.recommendation.replaceAll('_',' ');
  const headerRows=[row([
    cell(imageDrawing(),{width:2200,borders:false}),
    cell(
      paragraph('NAT-CORP',{bold:true,color:'D5B15A',size:18,after:30})+
      paragraph('CONTRACT-SPECIFIC ANALYZE FIT REPORT',{bold:true,color:'103478',size:30,after:60})+
      paragraph(`Prepared for ${b.business_name||'Business'}`,{color:'53637A',size:20,after:0}),
      {width:7438,borders:false,valign:'center'}
    )
  ])];

  const body=[];
  body.push(table(headerRows,[2200,7438],{noBorders:true}));
  body.push(paragraph(o.title||'Selected Contract',{style:'Title',before:120,after:80}));
  body.push(paragraph(`Recommendation: ${recommendation}`,{bold:true,color:analysis.recommendation==='PURSUE'?'176C45':analysis.recommendation==='DO_NOT_PURSUE'?'962F2F':'9B6300',size:24,after:160}));
  body.push(metadataTable(payload,analysis));
  body.push(paragraph('Important: APROPOS GROUP LLC / NAT-CORP is not the issuing government agency. Verify this assessment against the complete official solicitation, amendments, deadlines, and current business records before any commitment or submission.',{size:16,color:'66758A',italics:true,before:80,after:80}));
  body.push(paragraph('',{after:40}));
  body.push(scoreTable(analysis));
  body.push(paragraph(analysis.proposal_readiness,{bold:true,color:'103478',size:18,align:'center',before:60,after:80}));
  body.push(heading('Executive Assessment',1));
  body.push(paragraph(analysis.executive_summary||'Unavailable',{size:21,after:100}));
  body.push(paragraph(analysis.rationale||'Unavailable',{size:20,color:'53637A',after:100}));
  if (arr(analysis.evidence_guardrails).length) {
    body.push(heading('Evidence and Decision Guardrails',2));
    body.push(displayItems(analysis.evidence_guardrails));
  }
  body.push(heading('Contract Requirements',1));
  body.push(displayItems(analysis.contract_requirements));
  body.push(heading('Geographic Alignment',1));
  body.push(paragraph(analysis.geographic_alignment||'Unavailable',{size:20}));
  body.push(heading('Capability Alignment',1));
  body.push(capabilityTable(analysis.capability_alignment));
  body.push(heading('Licensing and Qualification Review',1));
  body.push(detailsTable(analysis.licensing_qualification_review,[
    {label:'Requirement',keys:['requirement','qualification','description'],width:2500},
    {label:'Status',keys:['status','level'],width:1100},
    {label:'Business Evidence',keys:['business_evidence','evidence','finding'],width:3600},
    {label:'Note',keys:['note','mitigation','comments'],width:2438},
  ]));
  body.push(heading('Capacity and Delivery Review',1));
  body.push(detailsTable(analysis.capacity_delivery_review,[
    {label:'Area',keys:['area','requirement','description'],width:2300},
    {label:'Status',keys:['status','level'],width:1100},
    {label:'Evidence / Finding',keys:['business_evidence','evidence','finding'],width:3800},
    {label:'Note / Mitigation',keys:['note','mitigation','comments'],width:2438},
  ]));
  body.push(heading('Past Performance Review',1));
  body.push(detailsTable(analysis.past_performance_review,[
    {label:'Project / Experience',keys:['project_title','description','project','experience'],width:3000},
    {label:'Status',keys:['status','relevance'],width:1600},
    {label:'Contract-Relevant Evidence',keys:['business_evidence','evidence','finding','note'],width:5038},
  ]));
  body.push(heading('Risk Register',1));
  body.push(riskTable(analysis.risks));
  body.push(heading('Unavailable Contract Details',1));
  body.push(displayItems(analysis.unavailable_contract_details));
  body.push(heading('Unavailable Business Details',1));
  body.push(displayItems(analysis.unavailable_business_details));
  body.push(heading('Decision Conditions',1));
  body.push(displayItems(analysis.decision_conditions));
  body.push(heading('Recommended Action Plan',1));
  body.push(displayItems(analysis.action_plan));

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${body.join('')}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="360" w:footer="360" w:gutter="0"/><w:footerReference w:type="default" r:id="rIdFooter"/></w:sectPr></w:body></w:document>`;
}

const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Aptos" w:hAnsi="Aptos" w:eastAsia="Aptos"/><w:sz w:val="21"/><w:szCs w:val="21"/><w:color w:val="203047"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="100" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="120" w:after="80"/></w:pPr><w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia"/><w:b/><w:color w:val="103478"/><w:sz w:val="34"/><w:szCs w:val="34"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:pageBreakBefore w:val="0"/><w:spacing w:before="220" w:after="90"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia"/><w:b/><w:color w:val="103478"/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="160" w:after="70"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia"/><w:b/><w:color w:val="56709A"/><w:sz w:val="23"/><w:szCs w:val="23"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="ListBullet"><w:name w:val="List Bullet"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="420" w:hanging="220"/><w:spacing w:after="70"/></w:pPr></w:style></w:styles>`;
const footerXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="60" w:after="0"/></w:pPr>${wRun('APROPOS GROUP LLC · NAT-CORP · CONFIDENTIAL · Page ',{color:'66758A',size:16})}<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>${wRun('1',{color:'66758A',size:16})}<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:ftr>`;

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i=0;i<8;i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds()/2);
  const dosDate = ((year-1980) << 9) | ((date.getMonth()+1) << 5) | date.getDate();
  return { dosTime, dosDate };
}
function zip(files) {
  const locals=[]; const centrals=[]; let offset=0;
  const {dosTime,dosDate}=dosDateTime();
  for (const file of files) {
    const name=Buffer.from(file.name); const raw=Buffer.isBuffer(file.data)?file.data:Buffer.from(file.data);
    const method=file.store?0:8; const compressed=method===0?raw:deflateRawSync(raw,{level:9}); const crc=crc32(raw);
    const local=Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50,0); local.writeUInt16LE(20,4); local.writeUInt16LE(0,6); local.writeUInt16LE(method,8); local.writeUInt16LE(dosTime,10); local.writeUInt16LE(dosDate,12); local.writeUInt32LE(crc,14); local.writeUInt32LE(compressed.length,18); local.writeUInt32LE(raw.length,22); local.writeUInt16LE(name.length,26); local.writeUInt16LE(0,28);
    locals.push(local,name,compressed);
    const central=Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50,0); central.writeUInt16LE(20,4); central.writeUInt16LE(20,6); central.writeUInt16LE(0,8); central.writeUInt16LE(method,10); central.writeUInt16LE(dosTime,12); central.writeUInt16LE(dosDate,14); central.writeUInt32LE(crc,16); central.writeUInt32LE(compressed.length,20); central.writeUInt32LE(raw.length,24); central.writeUInt16LE(name.length,28); central.writeUInt16LE(0,30); central.writeUInt16LE(0,32); central.writeUInt16LE(0,34); central.writeUInt16LE(0,36); central.writeUInt32LE(0,38); central.writeUInt32LE(offset,42);
    centrals.push(central,name);
    offset += local.length + name.length + compressed.length;
  }
  const centralData=Buffer.concat(centrals); const end=Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50,0); end.writeUInt16LE(0,4); end.writeUInt16LE(0,6); end.writeUInt16LE(files.length,8); end.writeUInt16LE(files.length,10); end.writeUInt32LE(centralData.length,12); end.writeUInt32LE(offset,16); end.writeUInt16LE(0,20);
  return Buffer.concat([...locals,centralData,end]);
}

export function buildAnalyzeFitDocx(payload) {
  const logo = Buffer.from(aproposLogoAttachment().content, 'base64');
  const coreDate = new Date().toISOString();
  const files = [
    {name:'[Content_Types].xml',data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpg" ContentType="image/jpeg"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`},
    {name:'_rels/.rels',data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`},
    {name:'word/document.xml',data:documentXml(payload)},
    {name:'word/styles.xml',data:stylesXml},
    {name:'word/footer1.xml',data:footerXml},
    {name:'word/_rels/document.xml.rels',data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdLogo" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/apropos-group-logo.jpg"/><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rIdFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>`},
    {name:'word/media/apropos-group-logo.jpg',data:logo,store:true},
    {name:'docProps/core.xml',data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xml(payload.opportunity?.title||'NAT-CORP Analyze Fit Report')}</dc:title><dc:subject>Contract-Specific Analyze Fit Report</dc:subject><dc:creator>APROPOS GROUP LLC</dc:creator><cp:lastModifiedBy>APROPOS GROUP LLC / NAT-CORP</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${coreDate}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${coreDate}</dcterms:modified></cp:coreProperties>`},
    {name:'docProps/app.xml',data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>APROPOS NAT-CORP</Application><Company>APROPOS GROUP LLC</Company></Properties>`},
  ];
  return zip(files);
}

export function analyzeFitDocxFilename(payload) {
  const business=payload.business?.business_name||'Business';
  const record=payload.opportunity?.pdas_record_id||payload.opportunity?.id||'Contract';
  return `APROPOS_Analyze_Fit_${cleanFilename(business)}_${cleanFilename(record)}.docx`;
}
