import fs from 'node:fs';

const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(`SEO validation failed: ${message}`); };

const home = read('index.html');
const sitemap = read('sitemap.xml');
const robots = read('robots.txt');

assert(home.includes('<title>Find State & Local Government Contracts | NAT-CORP</title>'), 'homepage title not transformed');
assert(home.includes('name="robots" content="index,follow'), 'homepage robots meta missing');
assert(home.includes('twitter:card" content="summary_large_image"'), 'large social card metadata missing');
assert(home.includes('https://natcorp.aproposgroupllc.com/#service'), 'NAT-CORP Service schema missing');

for (const path of [
  'government-contracts/nevada/index.html',
  'government-contracts/california/index.html',
  'government-contracts/arizona/index.html',
  'resources/find-state-local-government-contracts/index.html'
]) {
  assert(fs.existsSync(new URL(`../${path}`, import.meta.url)), `${path} missing`);
}

for (const url of [
  '/government-contracts/nevada/',
  '/government-contracts/california/',
  '/government-contracts/arizona/',
  '/resources/find-state-local-government-contracts/'
]) assert(sitemap.includes(url), `${url} missing from sitemap`);

assert(!sitemap.includes('/board.html'), 'redirected/private board route must not be in sitemap');
assert(robots.includes('Disallow: /dashboard'), 'dashboard crawl exclusion missing');

console.log('NAT-CORP SEO validation passed.');
