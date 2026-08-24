'use strict';

const fs = require('fs');

const file = 'index.html';
const opsCssFile = 'natcorp-ops-parity.css';
let html = fs.readFileSync(file, 'utf8');
const fontTagPattern = /<link\b(?=[^>]*href=["']https:\/\/fonts\.googleapis\.com\/css2\?)[^>]*>/i;
const match = html.match(fontTagPattern);

// OPS/APROPOS system-font mode intentionally uses Georgia + Arial and does not
// require a remote Google Fonts stylesheet. Validate that controlled contract
// explicitly instead of silently accepting a missing font dependency.
if (!match) {
  if (!html.includes(`href="/${opsCssFile}"`) && !html.includes(`href='/${opsCssFile}'`)) {
    throw new Error('Phase 2B font remediation: Google Fonts absent and OPS parity stylesheet not linked.');
  }
  if (!fs.existsSync(opsCssFile)) {
    throw new Error('Phase 2B font remediation: OPS parity stylesheet file not found.');
  }
  const opsCss = fs.readFileSync(opsCssFile, 'utf8');
  const hasGeorgia = /--display\s*:\s*Georgia/i.test(opsCss) || /font-family\s*:\s*Georgia/i.test(opsCss);
  const hasArial = /--body\s*:\s*Arial/i.test(opsCss) || /font(?:-family)?\s*:[^;]*Arial/i.test(opsCss);
  if (!hasGeorgia || !hasArial) {
    throw new Error('Phase 2B font remediation: OPS system-font contract requires Georgia headings and Arial interface text.');
  }
  if (/fonts\.googleapis\.com\/css2\?/i.test(html)) {
    throw new Error('Phase 2B font remediation: unexpected Google Fonts reference remains in OPS system-font mode.');
  }
  console.log('[phase2b-fonts] PASS — OPS system-font mode validated with Georgia headings and Arial interface text.');
  return;
}

const hrefMatch = match[0].match(/href=["']([^"']+)["']/i);
if (!hrefMatch) throw new Error('Phase 2B font remediation: Google Fonts href not found.');
const href = hrefMatch[1];
const asyncTag = `<link rel="stylesheet" href="${href}" media="print" onload="this.media='all'">`;
const fallback = `<noscript><link rel="stylesheet" href="${href}"></noscript>`;

if (!match[0].includes('media="print"')) {
  html = html.replace(match[0], `${asyncTag}\n  ${fallback}`);
} else if (!html.includes(fallback)) {
  html = html.replace(match[0], `${match[0]}\n  ${fallback}`);
}

if ((html.match(/fonts\.googleapis\.com\/css2\?/g) || []).length < 2) {
  throw new Error('Phase 2B font remediation: async stylesheet and noscript fallback are both required.');
}
if (!html.includes(asyncTag) || !html.includes(fallback)) {
  throw new Error('Phase 2B font remediation: non-render-blocking font contract not satisfied.');
}

fs.writeFileSync(file, html, 'utf8');
const published = fs.readFileSync(file, 'utf8');
if (!published.includes(asyncTag) || !published.includes(fallback)) {
  throw new Error('Phase 2B font remediation: publish artifact verification failed.');
}
console.log('[phase2b-fonts] PASS — homepage fonts retain the same Google families with non-render-blocking CSS and noscript fallback.');
