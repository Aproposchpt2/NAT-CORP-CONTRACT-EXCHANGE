'use strict';
const fs=require('fs');const path=require('path');const root=process.cwd();
const pages=[
['guides/index.html','https://natcorp.aproposgroupllc.com/guides/'],
['guides/state-local-government-contracts/index.html','https://natcorp.aproposgroupllc.com/guides/state-local-government-contracts/'],
['guides/sled-contract-opportunities/index.html','https://natcorp.aproposgroupllc.com/guides/sled-contract-opportunities/'],
['guides/vendor-registration-procurement-portals/index.html','https://natcorp.aproposgroupllc.com/guides/vendor-registration-procurement-portals/'],
['guides/cooperative-purchasing-state-local/index.html','https://natcorp.aproposgroupllc.com/guides/cooperative-purchasing-state-local/']];
const retired=['capgenmkt.aproposgroupllc.com','ngcc.aproposgroupllc.com','businesscontracts.aproposgroupllc.com','gcpdc.aproposgroupllc.com','cdc.aproposgroupllc.com','ai4-product-purchasing.ai4businesses.org'];
const failures=[];const sitemap=fs.readFileSync(path.join(root,'sitemap.xml'),'utf8');
for(const [file,url] of pages){const p=path.join(root,file);if(!fs.existsSync(p)){failures.push(`${file} missing`);continue;}const v=fs.readFileSync(p,'utf8');if(!v.includes(`<link rel="canonical" href="${url}">`))failures.push(`${file} canonical mismatch`);if(!v.includes('name="robots" content="index,follow'))failures.push(`${file} not indexable`);if(!v.includes('National Corporate Contract Exchange'))failures.push(`${file} missing current identity`);if(!v.includes('/intake'))failures.push(`${file} missing current conversion path`);if(!sitemap.includes(`<loc>${url}</loc>`))failures.push(`${file} missing sitemap entry`);for(const token of retired)if(v.includes(token))failures.push(`${file} contains retired property ${token}`);}
const hub=fs.readFileSync(path.join(root,'guides/index.html'),'utf8');for(const slug of ['state-local-government-contracts','sled-contract-opportunities','vendor-registration-procurement-portals','cooperative-purchasing-state-local'])if(!hub.includes(`/guides/${slug}/`))failures.push(`guide hub missing ${slug}`);
if(!hub.includes('https://federalcontractorportal.aproposgroupllc.com/'))failures.push('hub missing federal territory handoff');
if(failures.length){console.error('[natcorp-sled-wave1] Validation failed:');failures.forEach(f=>console.error(`- ${f}`));process.exit(1);}console.log('[natcorp-sled-wave1] PASS — guide hub + 4 SLED authority pages are canonical, indexable, sitemap-listed, current-property routed, and retired-property clean.');