'use strict';

const fs = require('fs');
const file = 'index.html';
let html = fs.readFileSync(file, 'utf8');

const match = html.match(/<script\s+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i);
if (!match) throw new Error('NAT-CORP entity remediation: JSON-LD block not found.');

const data = JSON.parse(match[1]);
const graph = Array.isArray(data['@graph']) ? data['@graph'] : [];
const orgId = 'https://natcorp.aproposgroupllc.com/#organization';
const corporateId = 'https://aproposgroupllc.com/#organization';
const org = graph.find(node => node && node['@id'] === orgId);
if (!org) throw new Error('NAT-CORP entity remediation: Organization node not found.');

org.name = 'National Corporate Contract Exchange';
org.alternateName = 'NAT-CORP';
org.parentOrganization = {
  '@type': 'Organization',
  '@id': corporateId,
  name: 'APROPOS Group LLC',
  url: 'https://aproposgroupllc.com/'
};

const replacement = `<script type="application/ld+json">${JSON.stringify(data)}</script>`;
html = html.replace(match[0], replacement);

if (!html.includes(corporateId)) throw new Error('NAT-CORP entity remediation: corporate parent @id missing.');
if (!html.includes('"alternateName":"NAT-CORP"')) throw new Error('NAT-CORP entity remediation: alternateName missing.');

fs.writeFileSync(file, html, 'utf8');
console.log('[natcorp-entity-graph] PASS — NAT-CORP is linked to the corporate APROPOS entity.');
