'use strict';
/* PDAS — NevadaEPro (nevadaepro.com, PrimeFaces/JSF "BSO" bid board) acquisition
   normalize helpers. Unlike Cal eProcure, the open-bids search results table is
   fully server-rendered in the initial HTML response (confirmed live 2026-08-27:
   a plain unauthenticated GET returns every open-bid row, no session/ViewState
   submission or JS execution required) -- so this source needs plain HTTP
   fetch + regex extraction, not a Playwright session. Nevada shares California's
   Pacific-Time DST rule, so date math reuses caleprocure-normalize's helper
   rather than reimplementing it. */

const { normalizeSpace, californiaOffsetMinutes, hashJson } = require('./caleprocure-normalize');

const LISTING_URL = 'https://nevadaepro.com/bso/view/search/external/advancedSearchBid.xhtml?openBids=true';
const DETAIL_URL = docId => 'https://nevadaepro.com/bso/external/bidDetail.sda?docId=' + encodeURIComponent(docId) + '&external=true&parentUrl=close';

function stripTags(html) {
  return normalizeSpace(String(html || '').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&#39;/g, "'").replace(/&quot;/g, '"'));
}

/* Nevada's "Bid Opening Date" column is 24-hour "MM/DD/YYYY HH:MM:SS", always
   Pacific local time -- no AM/PM marker, which caleprocure-normalize's date
   parser doesn't handle (it requires an AM/PM token to capture a time at all). */
function parseNevadaDateTime(raw) {
  const text = normalizeSpace(raw);
  const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;
  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const offsetMinutes = californiaOffsetMinutes(year, month, day);
  const utcMillis = Date.UTC(year, month - 1, day, hour, minute, Number(match[6] || 0)) - (offsetMinutes * 60000);
  return new Date(utcMillis).toISOString();
}

/* Extracts every row from the "openBids=true" search results <tbody>. Column
   order (confirmed live 2026-08-27, 12 <td> cells per row):
   0 Bid Solicitation # (link, docId)  1 Bid Solicitation # (hidden dup)
   2 Organization Name                3 Contract # (visible)
   4 Contract # (hidden dup)          5 Buyer
   6 Description                      7 Bid Opening Date
   8 Bid Holder List                  9 Awarded Vendor(s)
   10 Status                          11 Alternate Id
   PrimeFaces re-renders this table for other searches/filters, so this is
   read defensively: any row missing a docId is skipped rather than throwing. */
function parseListingRows(html) {
  const bodyMatch = html.match(/id="bidSearchResultsForm:bidResultId_data"[^>]*>([\s\S]*?)<\/tbody>/);
  if (!bodyMatch) return [];
  const body = bodyMatch[1];
  const rows = [];
  const rowRe = /<tr[^>]*data-ri="\d+"[^>]*>([\s\S]*?)<\/tr>/g;
  let rowMatch;
  while ((rowMatch = rowRe.exec(body))) {
    const cells = [];
    const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/g;
    let cellMatch;
    while ((cellMatch = cellRe.exec(rowMatch[1]))) cells.push(cellMatch[1]);
    if (cells.length < 12) continue;
    const docIdLinkMatch = cells[0].match(/docId=([^&"]+)/);
    const docId = docIdLinkMatch ? decodeURIComponent(docIdLinkMatch[1]) : stripTags(cells[1]);
    if (!docId) continue;
    rows.push({
      docId,
      organization: stripTags(cells[2]),
      contractNumber: stripTags(cells[3]) || null,
      buyer: stripTags(cells[5]),
      title: stripTags(cells[6]),
      bidOpeningDateRaw: stripTags(cells[7]),
      status: stripTags(cells[10]),
      alternateId: stripTags(cells[11]) || null,
    });
  }
  return rows;
}

/* Detail page (bidDetail.sda) is also plain server-rendered HTML. Layout
   confirmed against a real live page 2026-08-27 (43ADG-S3982) by fetching and
   reading the actual HTML directly -- the first version of this function was
   written from field *names* seen in an old manually-captured Supabase record
   without confirming the real markup, and it silently produced wrong data
   (grabbed attachment file names as the scope, and a Google Fonts CSS URL
   fragment as the contact email) on its first real test run. Every pattern
   below was verified against real fetched HTML before being trusted.

   Notably: the long narrative "scope of work" text (e.g. "The contractor
   shall fabricate and install new hardware...") does NOT live in this page's
   HTML at all -- it's inside the "Scope of Work" PDF attachment. This
   function does not fabricate that field; `scope` stays null until PDF
   attachment parsing is built (pdf-parse is already a repo dependency, but
   downloadFile() is a JS form-post, not a plain GET, so fetching the actual
   PDF bytes needs its own investigation -- not done here). */
function parseDetailHtml(html) {
  const billToMatch = html.match(/Bill To:\s*([^<]+?)<br/i);
  const emailMatch = html.match(/Email:\s*([\w.+-]+@[\w.-]+\.\w+)/i);
  const phoneMatch = html.match(/Phone:\s*(\(\d{3}\)\s*\d{3}-\d{4})/i);
  const orgMatch = html.match(/Organization:<\/td>\s*<td[^>]*>\s*([^<]+?)\s*<\/td>/i);

  const attachments = [];
  const attRe = /downloadFile\('(\d+)'\);"[\s\S]{0,120}?class="link-01">([^<]+)<\/a>/g;
  let attMatch;
  const seenAttachments = new Set();
  while ((attMatch = attRe.exec(html))) {
    if (seenAttachments.has(attMatch[1])) continue;
    seenAttachments.add(attMatch[1]);
    attachments.push({ file_nbr: attMatch[1], name: stripTags(attMatch[2]) });
  }

  return {
    scope: null,
    organization: orgMatch ? stripTags(orgMatch[1]) : null,
    contact_org: billToMatch ? stripTags(billToMatch[1]) : null,
    contact_email: emailMatch ? emailMatch[1] : null,
    contact_phone: phoneMatch ? phoneMatch[1] : null,
    attachments,
    detail_fetched: true,
  };
}

module.exports = {
  LISTING_URL,
  DETAIL_URL,
  stripTags,
  parseNevadaDateTime,
  parseListingRows,
  parseDetailHtml,
  hashJson,
};
