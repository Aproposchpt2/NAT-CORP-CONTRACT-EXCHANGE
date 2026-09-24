// NAT-CORP self-serve contract search -- replaces the old AI-capability-
// matching gate (Business Intake -> Website Discovery -> Verify Profile ->
// fit-score matches) with the same user-select taxonomy pattern already
// live on BDMS's Advisor Contract Search Portal and BODA's Licensed
// Business Workspace: Industry -> Service Category -> Work Type + keyword/
// state/agency/closing/posted filters, zero AI relevance scoring.
//
// NAT-CORP's own Supabase project (judislfknmhofcgzyozc) is SEPARATE from
// BDMS/BODA's (pwvstaigtdrccirdvqka), which is where
// cbrief_distribution_ready_opportunities and
// cbrief_contract_taxonomy_assignments actually live -- NAT-CORP has no
// direct DB credentials for that project. It does already have a working,
// established bridge: CBRIEF_DISTRIBUTION_SYNC_TOKEN, used by
// cbrief-distribution-source.mjs to sync that same canonical data into
// NAT-CORP's own state_contract_opportunities table. This reuses that
// exact bridge (BDMS's /api/contract-distribution-feed, now extended to
// also carry industry/service_category/work_type) instead of opening a
// second, separately-provisioned cross-project connection.
//
// Access model: NAT-CORP members are already paid/trial subscribers by the
// time they reach this page (the /intake form issues a verified session
// immediately -- there is no further paywall tier here), so unlike BODA's
// vendor-licensed-search.mjs this returns full contract detail directly:
// no teaser reduction, no locked fields.
import { env } from './_shared/natcorp-db.mjs';
import { loadProfileSession } from './_shared/natcorp-profile-session.mjs';
import { dedupeRows } from './_shared/cbrief-open-contract-dedupe.mjs';
import { parseNonTaxonomyFilters, applyNonTaxonomyFilters, normalizeState, dateValue as filterDateValue } from './_shared/cbrief-open-contract-filters.mjs';

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });

const clean = (v, max = 5000) => String(v ?? '').trim().slice(0, max);
const dateValue = v => { const d = v ? new Date(v) : null; return d && !Number.isNaN(d.valueOf()) ? d.valueOf() : null; };

const DISTRIBUTION_FEED_URL = 'https://bdms.aproposgroupllc.com/api/contract-distribution-feed';
const SUPPORTED_STATES = ['California', 'Nevada', 'Arizona'];
const UNCATEGORIZED = '__uncategorized__';
const FEED_PAGE_SIZE = 1000;
const MAX_RESULT_PAGE_SIZE = 25;

async function distributionReadyRows() {
  const token = clean(env('CBRIEF_DISTRIBUTION_SYNC_TOKEN'));
  if (!token) throw new Error('Contract search service is unavailable.');
  const rows = [];
  for (let page = 1; ; page++) {
    const u = new URL(DISTRIBUTION_FEED_URL);
    u.searchParams.set('states', SUPPORTED_STATES.join(','));
    u.searchParams.set('current', 'true');
    u.searchParams.set('page', String(page));
    u.searchParams.set('page_size', String(FEED_PAGE_SIZE));
    const r = await fetch(u, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' }, signal: AbortSignal.timeout(45000) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.ok) { console.error('[natcorp-contract-search] distribution feed', r.status, data?.error); throw new Error('Contract repository is temporarily unavailable.'); }
    rows.push(...(Array.isArray(data.opportunities) ? data.opportunities : []));
    if (page >= Number(data.total_pages || 1)) break;
  }
  return rows;
}

const INDUSTRY_ORDER = [
  'Construction & Public Works','Water, Wastewater & Utilities','Transportation, Roads & Mobility',
  'Architecture, Engineering & Planning','Facilities, Maintenance & Skilled Trades',
  'Information Technology, Software & Digital','Professional, Consulting & Administrative',
  'Health & Medical Services','Human, Housing & Community Services','Public Safety, Security & Emergency',
  'Environmental, Waste & Land Services','Vehicles, Fleet & Heavy Equipment','Goods, Supplies & General Materials',
  'Food, Catering & Concessions','Legal Services','Financial, Insurance & Real Estate',
  'Education, Training & Workforce','Arts, Media, Marketing & Communications','Energy & Power',
  'Records, Document & Information Services','Parks, Recreation & Events','Industrial, Chemical & Laboratory Products'
];
const ALLOWED_INDUSTRIES = new Set(INDUSTRY_ORDER);

function buildTree(triples) {
  const map = new Map(INDUSTRY_ORDER.map(name => [name, { name, count: 0, service_categories: new Map() }]));
  for (const t of triples) {
    const i = map.get(t.industry); if (!i) continue;
    i.count++;
    if (!i.service_categories.has(t.service_category)) i.service_categories.set(t.service_category, { name: t.service_category, count: 0, work_types: new Map() });
    const s = i.service_categories.get(t.service_category);
    s.count++;
    s.work_types.set(t.work_type, (s.work_types.get(t.work_type) || 0) + 1);
  }
  return INDUSTRY_ORDER.map(name => map.get(name)).map(i => ({
    name: i.name, count: i.count,
    service_categories: [...i.service_categories.values()]
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .map(s => ({
        name: s.name, count: s.count,
        work_types: [...s.work_types.entries()].map(([name, count]) => ({ name, count }))
          .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      }))
  }));
}

// Full detail -- NAT-CORP members are already subscribers by the time they
// reach this endpoint, so unlike BODA's teaserOpportunity() nothing here is
// held back server-side. Taxonomy now arrives merged onto the row directly
// (contract-distribution-feed.mjs joins it server-side on BDMS's end).
function fullOpportunity(row) {
  const t = (row.industry && row.service_category && row.work_type) ? row : {};
  const daysLeft = (() => {
    const v = filterDateValue(row.closes_at);
    return v == null ? null : Math.ceil((v - Date.now()) / 86400000);
  })();
  return {
    id: row.id,
    title: row.title || 'Untitled opportunity',
    description: row.description || null,
    scope_summary: row.scope_summary || null,
    agency: row.agency_name || 'Public Agency',
    department: row.department_name || null,
    category_path: [t.industry, t.service_category, t.work_type].filter(Boolean).join(' › ') || 'Not yet categorized',
    status: row.status === 'open' ? 'Open' : (row.status || 'Open'),
    opportunity_type: row.opportunity_type || null,
    location: [row.city, normalizeState(row.state)].filter(Boolean).join(', ') || null,
    state: normalizeState(row.state) || null,
    solicitation_number: row.solicitation_number || row.alternate_id || null,
    posted_at: row.posted_at || null,
    closes_at: row.closes_at || null,
    days_left: daysLeft,
    estimated_value_min: row.estimated_value_min || null,
    estimated_value_max: row.estimated_value_max || null,
    naics_codes: row.naics_codes || [],
    nigp_codes: row.nigp_codes || [],
    psc_codes: row.psc_codes || [],
    commodity_codes: row.commodity_codes || [],
    authoritative_detail_url: row.authoritative_detail_url || null,
    authoritative_response_url: row.authoritative_response_url || null,
    last_verified_at: row.last_verified_at || null
  };
}

const tiebreak = (a, b) => clean(a.id).localeCompare(clean(b.id));
function sortRows(rows, sort) {
  if (sort === 'closing_latest') return rows.sort((a, b) => (dateValue(b.closes_at) ?? -Infinity) - (dateValue(a.closes_at) ?? -Infinity) || tiebreak(a, b));
  if (sort === 'newest') return rows.sort((a, b) => (dateValue(b.posted_at) ?? 0) - (dateValue(a.posted_at) ?? 0) || tiebreak(a, b));
  if (sort === 'agency') return rows.sort((a, b) => clean(a.agency_name).localeCompare(clean(b.agency_name)) || tiebreak(a, b));
  return rows.sort((a, b) => (dateValue(a.closes_at) ?? Infinity) - (dateValue(b.closes_at) ?? Infinity) || tiebreak(a, b));
}

export default async function handler(req) {
  const url = new URL(req.url);
  const action = url.searchParams.get('action');

  try {
    const session = await loadProfileSession(req);
    if (!session) return json({ ok: false, error: 'Sign in required.' }, 401);

    if (req.method === 'GET' && action === 'taxonomy') {
      const filters = parseNonTaxonomyFilters(url.searchParams);
      const source = await distributionReadyRows();
      const validRow = r => ALLOWED_INDUSTRIES.has(clean(r.industry)) && clean(r.service_category) && clean(r.work_type);
      const assignedIds = new Set(source.filter(validRow).map(r => clean(r.id)).filter(Boolean));

      const matchingRows = applyNonTaxonomyFilters(dedupeRows(source, assignedIds), filters);
      const categorizedTriples = [];
      let uncategorizedCount = 0;
      for (const row of matchingRows) {
        if (validRow(row)) categorizedTriples.push({ industry: clean(row.industry), service_category: clean(row.service_category), work_type: clean(row.work_type) });
        else uncategorizedCount++;
      }
      return json({
        ok: true,
        industries: buildTree(categorizedTriples),
        uncategorized: { key: UNCATEGORIZED, name: 'Not Yet Categorized', count: uncategorizedCount }
      });
    }

    if (req.method === 'GET' && action === 'search') {
      const filters = parseNonTaxonomyFilters(url.searchParams);
      const sort = clean(url.searchParams.get('sort')) || 'closing_soonest';
      const page = Math.max(1, Math.min(2000, Number(url.searchParams.get('page')) || 1));
      const pageSize = Math.max(10, Math.min(MAX_RESULT_PAGE_SIZE, Number(url.searchParams.get('page_size')) || 25));
      const industryRaw = clean(url.searchParams.get('industry'));
      const isUncategorized = industryRaw === UNCATEGORIZED;
      const industry = isUncategorized ? '' : industryRaw;
      const serviceCategory = clean(url.searchParams.get('service_category'));
      const workType = clean(url.searchParams.get('work_type'));
      const taxonomyFiltering = Boolean(industry || serviceCategory || workType || isUncategorized);

      const source = await distributionReadyRows();
      const validRow = r => ALLOWED_INDUSTRIES.has(clean(r.industry)) && clean(r.service_category) && clean(r.work_type);
      const assignedIds = new Set(source.filter(validRow).map(r => clean(r.id)).filter(Boolean));
      const matchesTaxonomy = row => (!industry || clean(row.industry) === industry) && (!serviceCategory || clean(row.service_category) === serviceCategory) && (!workType || clean(row.work_type) === workType);

      let rows;
      if (isUncategorized) rows = dedupeRows(source.filter(row => !validRow(row)));
      else if (taxonomyFiltering) rows = dedupeRows(source.filter(row => validRow(row) && matchesTaxonomy(row)), assignedIds);
      else rows = dedupeRows(source, assignedIds);
      rows = applyNonTaxonomyFilters(rows, filters);
      sortRows(rows, sort);

      const total = rows.length, start = (page - 1) * pageSize;
      const selected = rows.slice(start, start + pageSize).map(row => fullOpportunity(row));
      const agencies = [...new Set(rows.map(row => clean(row.agency_name)).filter(Boolean))].sort((a, b) => a.localeCompare(b));
      const states = [...new Set(rows.map(row => normalizeState(row.state)).filter(Boolean))].sort();

      return json({
        ok: true, page, page_size: pageSize, total, total_pages: Math.max(1, Math.ceil(total / pageSize)),
        filters: { states, agencies }, opportunities: selected
      });
    }

    return json({ ok: false, error: 'Unknown action.' }, 400);
  } catch (error) {
    console.error('[natcorp-contract-search]', error);
    return json({ ok: false, error: 'Contract search could not be completed.' }, 500);
  }
}

export const config = { path: '/api/natcorp-contract-search' };
