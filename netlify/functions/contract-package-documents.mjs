// contract-package-documents.mjs -- 2026-08-15. Serves the real, already-
// acquired solicitation package for an opportunity (contract_package_documents
// + Supabase Storage) so the "Opportunity Review" drawer can show the actual
// package instead of redirecting the customer out to the publisher's site --
// Jeff's directive: we already have the full contract, and sending a
// customer away is the one thing that can never put an upsell in front of
// them. Documents are served via short-lived signed Storage URLs (never the
// service-role key itself) so this stays safe to call from the browser.
import { db, env, json, sameOrigin } from './_shared/natcorp-db.mjs';
import { loadProfileSession } from './_shared/natcorp-profile-session.mjs';

const safe = (v, n = 200) => String(v ?? '').trim().slice(0, n);

const DOCUMENT_TYPE_LABEL = {
  RFP: 'Request for Proposal',
  RFQ: 'Request for Quote',
  RFSQ: 'Request for Statement of Qualifications',
  EVALUATION: 'Evaluation Criteria',
  Q_AND_A: 'Questions & Answers',
  AMENDMENT: 'Amendment',
  ADDENDUM: 'Addendum',
  ATTACHMENT: 'Attachment',
  SCOPE_OF_WORK: 'Scope of Work',
  OTHER: 'Supporting Document',
};

// download: falsy = inline view (opens in the browser's own PDF viewer,
// which has its own print control); a filename string = forces
// Content-Disposition: attachment. IMPORTANT, found by testing this live
// and getting no Content-Disposition header at all: `download` is NOT a
// field in the /sign POST body (confirmed via Supabase's own docs after
// the first attempt shipped silently broken -- the API just ignored the
// unrecognized body field) -- it's a query parameter appended to the
// *resulting* signed URL itself, alongside its own `token=` param. The
// plain HTML `download` attribute doesn't work cross-origin either (Storage
// is a different origin than natcorp.aproposgroupllc.com), so this has to
// happen in the URL Supabase hands back, not in the link markup.
async function signedUrl(bucket, path, { expiresIn = 600, download = null } = {}) {
  const base = env('SUPABASE_URL').replace(/\/$/, '');
  const key = env('SUPABASE_SERVICE_ROLE_KEY') || env('SUPABASE_SERVICE_KEY');
  const encodedPath = String(path || '').split('/').map(encodeURIComponent).join('/');
  const res = await fetch(`${base}/storage/v1/object/sign/${encodeURIComponent(bucket)}/${encodedPath}`, {
    method: 'POST',
    headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ expiresIn }),
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.signedURL) throw new Error(data.message || `Could not sign document URL (${res.status}).`);
  const fullUrl = `${base}/storage/v1${data.signedURL}`;
  if (!download) return fullUrl;
  const filenamePart = typeof download === 'string' && download.trim() ? `=${encodeURIComponent(download.trim())}` : '';
  return `${fullUrl}${fullUrl.includes('?') ? '&' : '?'}download${filenamePart}`;
}

export default async function handler(req) {
  if (!sameOrigin(req)) return json(403, { ok: false, error: 'Same-origin NAT-CORP access required.' });
  if (req.method !== 'POST') return json(405, { ok: false, error: 'POST only.' });
  try {
    const session = await loadProfileSession(req);
    if (!session || session.discovery_status !== 'verified') {
      return json(401, { ok: false, error: 'A verified Business Capability Profile is required.' });
    }
    const body = await req.json().catch(() => ({}));
    const opportunityId = safe(body.opportunity_id, 80);
    if (!opportunityId) return json(400, { ok: false, error: 'opportunity_id is required.' });

    const rows = await db(
      'contract_package_documents', 'GET',
      `?canonical_opportunity_id=eq.${encodeURIComponent(opportunityId)}&select=id,original_filename,document_type,byte_size,storage_bucket,storage_path,extraction_status&order=document_type.asc`,
    );

    const documents = await Promise.all((rows || []).map(async (d) => {
      let url = null;
      let downloadUrl = null;
      let error = null;
      try {
        [url, downloadUrl] = await Promise.all([
          signedUrl(d.storage_bucket, d.storage_path),
          signedUrl(d.storage_bucket, d.storage_path, { download: d.original_filename || true }),
        ]);
      } catch (e) { error = e.message; }
      return {
        id: d.id,
        filename: d.original_filename,
        document_type: d.document_type,
        document_type_label: DOCUMENT_TYPE_LABEL[d.document_type] || d.document_type || 'Document',
        byte_size: d.byte_size,
        extraction_status: d.extraction_status,
        url,
        download_url: downloadUrl,
        error,
      };
    }));

    return json(200, { ok: true, opportunity_id: opportunityId, count: documents.length, documents });
  } catch (error) {
    console.error('[contract-package-documents]', error);
    return json(500, { ok: false, error: safe(error?.message, 500) || 'The solicitation package could not be loaded.' });
  }
}

export const config = { path: '/api/contract-package-documents' };
