'use strict';
/* PDAS — NevadaEPro acquisition core. Plain HTTP, no browser session needed:
   confirmed live 2026-08-27 that the "openBids=true" search page fully
   server-renders its results table (docId, organization, buyer, title,
   deadline, status) in the initial unauthenticated response. Detail pages
   fetch the same way. Runs fast and light compared to the Cal eProcure
   Playwright scraper because of that. */

const fs = require('fs');
const path = require('path');
const {
  LISTING_URL,
  DETAIL_URL,
  parseNevadaDateTime,
  parseListingRows,
  parseDetailHtml,
} = require('./lib/nevadaepro-normalize');

const OUT_FILE = path.join(__dirname, '..', 'nevadaepro.json');
const DETAIL_DELAY_MS = 800;
const USER_AGENT = 'Mozilla/5.0 (compatible; PDAS-Acquisition-Bot/1.0; +https://natcorp.aproposgroupllc.com)';

function argInt(name, dflt) {
  const match = process.argv.find(arg => arg.indexOf('--' + name + '=') === 0);
  return match ? parseInt(match.split('=')[1], 10) : dflt;
}

const DETAIL_LIMIT = argInt('detail-limit', 50);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fetchText(url) {
  const response = await fetch(url, { headers: { 'user-agent': USER_AGENT } });
  if (!response.ok) throw new Error(url + ' -> HTTP ' + response.status);
  return response.text();
}

function readExisting() {
  if (!fs.existsSync(OUT_FILE)) return { opportunities: [] };
  try {
    const data = JSON.parse(fs.readFileSync(OUT_FILE, 'utf8'));
    return { opportunities: Array.isArray(data.opportunities) ? data.opportunities : [] };
  } catch (_) {
    return { opportunities: [] };
  }
}

async function main() {
  const nowIso = new Date().toISOString();
  console.log('[scrape-nevadaepro] fetching listing…');
  const listingHtml = await fetchText(LISTING_URL);
  const rows = parseListingRows(listingHtml);
  console.log('[scrape-nevadaepro] ' + rows.length + ' open bid(s) found');

  const existing = readExisting();
  const byDocId = new Map(existing.opportunities.map(o => [o.doc_id, o]));

  let detailFetched = 0;
  const opportunities = [];
  for (const row of rows) {
    const prior = byDocId.get(row.docId);
    let detail = prior && prior.detail_fetched ? {
      scope: prior.scope, organization: prior.organization, contact_org: prior.contact_org,
      contact_email: prior.contact_email, contact_phone: prior.contact_phone,
      attachments: prior.attachments, detail_fetched: true,
    } : null;

    if (!detail && detailFetched < DETAIL_LIMIT) {
      try {
        await sleep(DETAIL_DELAY_MS);
        const detailHtml = await fetchText(DETAIL_URL(row.docId));
        detail = parseDetailHtml(detailHtml);
        detailFetched += 1;
        console.log('[scrape-nevadaepro] detail fetched for ' + row.docId + ' (' + detailFetched + '/' + DETAIL_LIMIT + ')');
      } catch (error) {
        console.log('[scrape-nevadaepro] detail fetch FAILED for ' + row.docId + ':', error.message);
        detail = null;
      }
    }

    opportunities.push({
      doc_id: row.docId,
      title: row.title,
      organization: (detail && detail.organization) || row.organization,
      contact_org: detail ? detail.contact_org : (prior ? prior.contact_org : null),
      buyer: row.buyer,
      status: row.status,
      contract_number: row.contractNumber,
      alternate_id: row.alternateId,
      bid_opening_date_raw: row.bidOpeningDateRaw,
      close_date: parseNevadaDateTime(row.bidOpeningDateRaw),
      scope: detail ? detail.scope : (prior ? prior.scope : null),
      contact_email: detail ? detail.contact_email : (prior ? prior.contact_email : null),
      contact_phone: detail ? detail.contact_phone : (prior ? prior.contact_phone : null),
      attachments: detail ? detail.attachments : (prior ? prior.attachments : []),
      detail_fetched: Boolean(detail),
      detail_url: DETAIL_URL(row.docId),
      first_seen_at: (prior && prior.first_seen_at) || nowIso,
      last_seen_at: nowIso,
      last_detail_fetched_at: detail ? nowIso : (prior ? prior.last_detail_fetched_at : null),
    });
  }

  fs.writeFileSync(OUT_FILE, JSON.stringify({ fetched_at: nowIso, source_url: LISTING_URL, opportunities }, null, 2));
  console.log('[scrape-nevadaepro] wrote ' + opportunities.length + ' opportunit' + (opportunities.length === 1 ? 'y' : 'ies') + ' (' + detailFetched + ' new detail fetch(es)) to ' + OUT_FILE);
}

if (require.main === module) {
  main().catch(error => {
    console.error('[scrape-nevadaepro] FATAL:', error.message);
    process.exitCode = 1;
  });
}

module.exports = { main };
