const safe=(v)=>String(v??'').trim();
const esc=(v)=>safe(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');

function normalizeContactName(value){
  const name=safe(value);
  if(!name || /^(?:unavailable|unknown|n\/?a|not available|none)$/i.test(name)) return '';
  return name;
}

export function buildFounderOutreach({candidate,opportunity}){
  const contactName=normalizeContactName(candidate?.contact_name);
  const greeting=contactName?`Hello ${contactName},`:'Hello,';
  const business=candidate?.business_name||'your business';
  const title=opportunity?.title||'Public Contract Opportunity';
  const issuer=opportunity?.issuing_organization||opportunity?.issuing_department||'See official source';
  const deadline=opportunity?.response_deadline?new Date(opportunity.response_deadline).toLocaleString('en-US',{timeZone:'America/Los_Angeles',dateStyle:'medium',timeStyle:'short'})+' PT':'See official solicitation';
  const fit=Array.isArray(candidate?.contract_fit_notes)?candidate.contract_fit_notes.slice(0,2).join(' '):'';
  const rationale=fit||'Your published services and experience appear aligned with the work described in the contract.';
  const subject=`Open government contract opportunity identified for ${business}`;

  const bodyText=`${greeting}

I am Jeff Mitchell, Founder of APROPOS GROUP LLC. I am a startup business owner, and my first project is developing an unconventional procurement agency that connects open government contracts with businesses that appear capable of performing the work.

I identified an open contract that appears aligned with ${business}'s published capabilities.

Opportunity: ${title}
Issuing Organization: ${issuer}
Response Deadline: ${deadline}
Why your business was identified: ${rationale}

There is no charge for this opportunity introduction.

If you are interested in evaluating this opportunity, reply directly to this email with "Interested." If you are not interested, simply reply and let me know.

As an early-stage business, APROPOS would also value your honest feedback after you have had an opportunity to use the service. Your feedback is voluntary and does not affect access to this opportunity or any APROPOS service.

Jeff Mitchell
Founder, APROPOS GROUP LLC
NAT-CORP Procurement Intelligence`;

  const bodyHtml=`<!doctype html><html><body style="margin:0;background:#f3f5f8;font-family:Arial,Helvetica,sans-serif;color:#14213d"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f5f8;padding:24px 12px"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#ffffff;border:1px solid #d9e0ea;border-radius:14px;overflow:hidden"><tr><td align="center" style="padding:28px 24px 14px"><img src="cid:apropos-group-logo" width="210" alt="APROPOS GROUP LLC" style="display:block;max-width:210px;width:100%;height:auto;border:0"></td></tr><tr><td style="padding:0 30px 30px;font-size:16px;line-height:1.55"><p>${esc(greeting)}</p><p>I am <strong>Jeff Mitchell, Founder of APROPOS GROUP LLC</strong>. I am a startup business owner, and my first project is developing an unconventional procurement agency that connects open government contracts with businesses that appear capable of performing the work.</p><p>I identified an open contract that appears aligned with <strong>${esc(business)}</strong>'s published capabilities.</p><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f6f8fb;border-radius:10px;margin:18px 0"><tr><td style="padding:16px"><strong>Opportunity:</strong> ${esc(title)}<br><strong>Issuing Organization:</strong> ${esc(issuer)}<br><strong>Response Deadline:</strong> ${esc(deadline)}<br><strong>Why your business was identified:</strong> ${esc(rationale)}</td></tr></table><p><strong>There is no charge for this opportunity introduction.</strong></p><p>If you are interested in evaluating this opportunity, <strong>reply directly to this email with “Interested.”</strong> If you are not interested, simply reply and let me know.</p><p style="font-size:14px;color:#5f6f85">As an early-stage business, APROPOS would also value your honest feedback after you have had an opportunity to use the service. Your feedback is voluntary and does not affect access to this opportunity or any APROPOS service.</p><p style="margin-top:28px">Jeff Mitchell<br>Founder, APROPOS GROUP LLC<br>NAT-CORP Procurement Intelligence</p></td></tr></table></td></tr></table></body></html>`;

  return {subject,bodyText,bodyHtml};
}
