'use strict';

const fs = require('fs');
const file = 'index.html';
let html = fs.readFileSync(file, 'utf8');

// One authoritative Analyze Fit public price representation.
html = html.replace(/\$79(?=\s*one-time)/gi, '$79.00');

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

// Phase 2B performance: expose the CSS hero to the preload scanner immediately.
const heroHref = '/headquarters.webp';
const heroPreload = `<link rel="preload" as="image" href="${heroHref}" type="image/webp" fetchpriority="high">`;
if (!html.includes(`url('${heroHref}')`) && !html.includes(`url("${heroHref}")`) && !html.includes(`url(${heroHref})`)) {
  throw new Error('NAT-CORP performance remediation: active homepage hero reference not found.');
}
if (!html.includes(heroPreload)) {
  if (!/<\/head>/i.test(html)) throw new Error('NAT-CORP performance remediation: closing head tag not found.');
  html = html.replace(/<\/head>/i, `${heroPreload}\n</head>`);
}

if (!html.includes(corporateId)) throw new Error('NAT-CORP entity remediation: corporate parent @id missing.');
if (!html.includes('"alternateName":"NAT-CORP"')) throw new Error('NAT-CORP entity remediation: alternateName missing.');
if (!html.includes('$79.00 one-time')) throw new Error('NAT-CORP entity remediation: Analyze Fit $79.00 visible price missing.');
if (/\$79(?=\s*one-time)/i.test(html)) throw new Error('NAT-CORP entity remediation: shorthand Analyze Fit $79 price remains.');
if ((html.match(/rel="preload" as="image" href="\/headquarters\.webp"/g) || []).length !== 1) throw new Error('NAT-CORP performance remediation: hero preload must appear exactly once.');

fs.writeFileSync(file, html, 'utf8');
console.log('[natcorp-entity-graph] PASS — entity graph, Analyze Fit $79.00 pricing, and high-priority hero preload are consistent.');
require('./apply-nonblocking-fonts.cjs');
