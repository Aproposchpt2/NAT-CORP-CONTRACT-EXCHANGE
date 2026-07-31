import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFounderOutreach } from '../netlify/functions/lib/otf-founder-outreach.mjs';

test('founder outreach removes verification URL and internal routes',()=>{
  const email=buildFounderOutreach({candidate:{business_name:'Example Business',contact_name:'Unavailable',contract_fit_notes:['Capability alignment confirmed.']},opportunity:{title:'Open Contract',issuing_organization:'Example Agency',response_deadline:'2099-08-04T18:00:00Z'}});
  assert.match(email.bodyText,/I am Jeff Mitchell, Founder of APROPOS GROUP LLC/);
  assert.match(email.bodyText,/There is no charge for this opportunity introduction/);
  assert.match(email.bodyText,/reply directly to this email with "Interested\."/);
  assert.match(email.bodyText,/feedback is voluntary/i);
  assert.doesNotMatch(email.bodyText,/aproposgroupllc\.com\/verify/i);
  assert.doesNotMatch(email.bodyHtml,/aproposgroupllc\.com\/verify/i);
  assert.doesNotMatch(email.bodyText,/opportunity-review|opportunity-fulfillment/i);
  assert.equal(email.bodyText.startsWith('Hello,\n'),true);
});
