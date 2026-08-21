'use strict';

const fs = require('fs');
const path = require('path');
const root = process.cwd();
const natcorp = 'https://natcorp.aproposgroupllc.com';

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['.git', 'node_modules', 'docs'].includes(entry.name)) return [];
      return walk(full);
    }
    return [full];
  });
}

const files = walk(root).filter(file => /\.(?:html|js|mjs|cjs)$/.test(file) && !file.includes(`${path.sep}scripts${path.sep}`));
for (const file of files) {
  let value = fs.readFileSync(file, 'utf8');
  value = value
    .replace(/https:\/\/ai4-product-purchasing\.ai4businesses\.org\/analyze-fit(?:\.html)?/gi, `${natcorp}/analyze-fit`)
    .replace(/https:\/\/ai4-product-purchasing\.ai4businesses\.org\/[A-Za-z0-9._~!$&'()*+,;=:@%/?#-]*/gi, `${natcorp}/intake`)
    .replaceAll('ai4-product-purchasing.ai4businesses.org/analyze-fit', 'natcorp.aproposgroupllc.com/analyze-fit');
  fs.writeFileSync(file, value, 'utf8');
}

const forbidden = [
  'capgenmkt.aproposgroupllc.com',
  'ngcc.aproposgroupllc.com',
  'businesscontracts.aproposgroupllc.com',
  'gcpdc.aproposgroupllc.com',
  'ai4websitedesign.com',
  'ai4-product-purchasing.ai4businesses.org',
];
const failures = [];
for (const file of files) {
  const value = fs.readFileSync(file, 'utf8');
  for (const token of forbidden) if (value.includes(token)) failures.push(`${path.relative(root, file)} contains retired property: ${token}`);
}

const analyzeFit = fs.readFileSync(path.join(root, 'netlify/functions/analyze-fit-service.mjs'), 'utf8');
if (analyzeFit.includes('ai4-product-purchasing.ai4businesses.org')) failures.push('Analyze Fit runtime still references retired purchasing property');
if (!analyzeFit.includes('natcorp.aproposgroupllc.com/analyze-fit')) failures.push('Analyze Fit runtime does not point users to current NAT-CORP Analyze Fit route');

if (failures.length) {
  console.error('[natcorp-live-property-allowlist] Validation failed:');
  failures.forEach(f => console.error(`- ${f}`));
  process.exit(1);
}
console.log('[natcorp-live-property-allowlist] PASS — public/runtime APROPOS routing is limited to approved live properties.');
