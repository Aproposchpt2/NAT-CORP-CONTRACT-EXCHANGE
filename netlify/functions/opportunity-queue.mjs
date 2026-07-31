import { db, json, commandAuthorized } from './_shared/natcorp-db.mjs';

const safe = (v) => String(v ?? '').trim();
const boolParam = (url, name, fallback) => {
  const raw = url.searchParams.get(name);
  if (raw === null) return fallback;
  return ['1','true','yes','on'].includes(String(raw).toLowerCase());
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
    const mode = safe(url.searchParams.get('mode') || 'unprocessed').toLowerCase();
    const state = safe(url.searchParams.get('state') || 'ALL').toUpperCase();
    const excludeProcessed = boolParam(url, 'exclude_processed', mode === 'unprocessed');
    const excludeEnrichment = boolParam(url, 'exclude_enrichment', true);
    const excludeOutreach = boolParam(url, 'exclude_outreach', true);

    const [opportunities, commands, outreach] = await Promise.all([
      db('state_contract_opportunities', 'GET', '?status=eq.open&response_deadline=gt.now()&select=id,pdas_record_id,title,issuing_organization,issuing_department,state_code,response_deadline,procurement_type,natcorp_contract_dna_status,official_source_url,source_url,created_at,updated_at&order=response_deadline.asc.nullslast&limit=500'),
      db('natcorp_business_discovery_commands', 'GET', '?select=opportunity_id&limit=5000'),
      db('natcorp_outreach_events', 'GET', '?select=opportunity_id,status&limit=5000'),
    ]);

    const processedIds = new Set((commands || []).map((x) => x.opportunity_id).filter(Boolean));
    const outreachIds = new Set((outreach || []).map((x) => x.opportunity_id).filter(Boolean));
    const now = Date.now();

    let rows = (opportunities || []).filter((o) => {
      if (!o?.response_deadline || new Date(o.response_deadline).getTime() <= now) return false;
      if (state !== 'ALL' && String(o.state_code || '').toUpperCase() !== state) return false;
      if (excludeOutreach && outreachIds.has(o.id)) return false;
      if (excludeEnrichment && String(o.natcorp_contract_dna_status || '').toLowerCase() === 'enrichment_required') return false;
      if (excludeProcessed) {
        const dna = String(o.natcorp_contract_dna_status || '').toLowerCase();
        if (processedIds.has(o.id) || outreachIds.has(o.id) || dna === 'complete' || dna === 'enrichment_required') return false;
      }
      return true;
    });

    if (mode === 'newest') {
      rows.sort((a, b) => new Date(b.created_at || b.updated_at || 0) - new Date(a.created_at || a.updated_at || 0));
    } else if (mode === 'random') {
      rows = shuffle(rows);
    } else {
      rows.sort((a, b) => new Date(a.response_deadline || 0) - new Date(b.response_deadline || 0));
    }

    rows = rows.slice(0, 60);
    return json(200, {
      ok: true,
      queue: {
        mode,
        state,
        exclude_processed: excludeProcessed,
        exclude_enrichment: excludeEnrichment,
        exclude_outreach: excludeOutreach,
        returned: rows.length,
      },
      opportunities: rows,
    });
  } catch (e) {
    console.error('[opportunity-queue]', e);
    return json(500, { ok: false, error: e.message });
  }
}

export const config = { path: '/api/opportunity-queue' };
