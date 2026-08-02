import { db, json, commandAuthorized } from './_shared/natcorp-db.mjs';

const safe = (v) => String(v ?? '').trim();
const intParam = (url, name, fallback, min, max) => {
  const raw = Number(url.searchParams.get(name));
  if (!Number.isFinite(raw)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(raw)));
};
const shuffle = (rows) => {
  const a = [...rows];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

export default async function handler(req) {
  if (!commandAuthorized(req)) return json(401, { ok: false, error: 'Opportunity-to-Fulfillment operator authorization required.' });
  if (req.method !== 'GET') return json(405, { ok: false, error: 'GET only.' });

  try {
    const url = new URL(req.url);
    const mode = safe(url.searchParams.get('mode') || 'deadline').toLowerCase();
    const state = safe(url.searchParams.get('state') || 'ALL').toUpperCase();
    const pageSize = intParam(url, 'page_size', 30, 1, 30);
    const page = intParam(url, 'page', 1, 1, 1000);

    // Retrieve the canonical table set without PostgREST status/deadline predicates.
    // Production validation showed those URL predicates collapsing the result to one row.
    // Eligibility is applied deterministically below.
    const opportunities = await db(
      'state_contract_opportunities',
      'GET',
      '?select=id,pdas_record_id,title,issuing_organization,issuing_department,state_code,status,response_deadline,procurement_type,natcorp_contract_dna_status,official_source_url,source_url,created_at,updated_at&order=response_deadline.asc.nullslast&limit=1000'
    );

    const now = Date.now();
    let rows = (opportunities || []).filter((o) => {
      if (String(o?.status || '').trim().toLowerCase() !== 'open') return false;
      if (!o?.response_deadline || new Date(o.response_deadline).getTime() <= now) return false;
      if (state !== 'ALL' && String(o.state_code || '').toUpperCase() !== state) return false;
      return true;
    });

    if (mode === 'newest') {
      rows.sort((a, b) => new Date(b.created_at || b.updated_at || 0) - new Date(a.created_at || a.updated_at || 0));
    } else if (mode === 'random') {
      rows = shuffle(rows);
    } else {
      rows.sort((a, b) => new Date(a.response_deadline || 0) - new Date(b.response_deadline || 0));
    }

    const total = rows.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const effectivePage = Math.min(page, totalPages);
    const offset = (effectivePage - 1) * pageSize;
    const pagedRows = rows.slice(offset, offset + pageSize);

    return json(200, {
      ok: true,
      queue: {
        mode,
        state,
        returned: pagedRows.length,
        total,
        page: effectivePage,
        page_size: pageSize,
        total_pages: totalPages,
        range_start: total ? offset + 1 : 0,
        range_end: total ? offset + pagedRows.length : 0,
        has_previous: effectivePage > 1,
        has_next: effectivePage < totalPages,
      },
      opportunities: pagedRows,
    });
  } catch (e) {
    console.error('[opportunity-queue]', e);
    return json(500, { ok: false, error: e.message });
  }
}

export const config = { path: '/api/opportunity-queue' };
