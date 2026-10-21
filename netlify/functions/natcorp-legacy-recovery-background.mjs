import { db, env, nowIso, sha256 } from './_shared/natcorp-db.mjs';
import { generateExplainer } from './_shared/command-center-extraction.mjs';
import { resolveWorkCapability } from './_shared/command-center-work-capability.mjs';

const RECOVERY_TABLE = 'natcorp_legacy_opportunities_recovery_20260906';
const RECOVERED_METHOD = 'LEGACY_RECOVERED_EXTRACTION_V2';
const RECOVERY_RUN = 'LEGACY_RECOVERY_20260906';

const encode = (v) => encodeURIComponent(String(v ?? ''));
const arr = (v) => Array.isArray(v) ? v : [];
const obj = (v) => v && typeof v === 'object' && !Array.isArray(v) ? v : {};

async function patchRecovery(id, patch) {
  await db(RECOVERY_TABLE, 'PATCH', `?id=eq.${encode(id)}`, {
    ...patch,
    recovered_at: nowIso(),
  }, 'return=minimal');
}

function validFutureDate(value) {
  if (!value) return null;
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return null;
  return d.getTime() > Date.now() ? d.toISOString() : null;
}

function canonicalRow(source, summary, workCapability, effectiveDeadline, sourceFingerprint) {
  const timestamp = nowIso();
  const sourceUrl = source.source_url || source.official_source_url;
  const sourcePayload = obj(source.raw_source_payload);
  return {
    id: source.id,
    pdas_record_id: source.pdas_record_id || undefined,
    state_code: source.state_code,
    jurisdiction_type: source.jurisdiction_type || null,
    jurisdiction_name: source.jurisdiction_name || source.issuing_organization,
    issuing_organization: source.issuing_organization,
    issuing_department: source.issuing_department || null,
    source_platform: source.source_platform || 'LEGACY_RECOVERY',
    source_record_id: source.source_record_id || source.solicitation_number || sourceFingerprint.slice(0, 24),
    source_url: sourceUrl,
    official_source_url: source.official_source_url || sourceUrl,
    vendor_registration_url: source.vendor_registration_url || null,
    solicitation_number: source.solicitation_number || null,
    title: source.title,
    description: source.description,
    procurement_type: source.procurement_type || null,
    notice_type: source.notice_type || null,
    status: 'open',
    posted_at: source.posted_at || null,
    response_deadline: effectiveDeadline,
    prebid_datetime: source.prebid_datetime || null,
    question_deadline: source.question_deadline || null,
    award_date: source.award_date || null,
    place_of_performance_city: source.place_of_performance_city || null,
    place_of_performance_county: source.place_of_performance_county || null,
    place_of_performance_state: source.place_of_performance_state || source.state_code || null,
    place_of_performance_zip: source.place_of_performance_zip || null,
    estimated_value_min: source.estimated_value_min ?? null,
    estimated_value_max: source.estimated_value_max ?? null,
    currency: source.currency || 'USD',
    contact_name: source.contact_name || null,
    contact_email: source.contact_email || null,
    contact_phone: source.contact_phone || null,
    naics_codes: arr(source.naics_codes),
    nigp_codes: arr(source.nigp_codes),
    unspsc_codes: arr(source.unspsc_codes),
    commodity_codes: arr(source.commodity_codes),
    set_asides: arr(source.set_asides),
    certifications_required: arr(summary.required_certifications),
    keywords: arr(source.keywords),
    document_urls: arr(source.document_urls),
    classifications: {
      who_can_perform_work: workCapability.who_can_perform_work,
      work_capability_profile: workCapability,
    },
    requirements: {
      scope_summary: summary.scope_summary || '',
      required_licenses: arr(summary.required_licenses),
      required_certifications: arr(summary.required_certifications),
      bonding_requirements: summary.bonding_requirements || 'Not specified in the listing.',
      key_dates: arr(summary.key_dates),
    },
    raw_source_payload: {
      ...sourcePayload,
      recovery: {
        recovery_version: 'natcorp_legacy_recovery_v2_20260906',
        original_acquisition_method: source.acquisition_method || null,
        original_requirements_extraction_status: source.requirements_extraction_status || null,
        archived_at: source.archived_at || null,
        recovered_at: timestamp,
        extraction_model: 'gpt-5-mini',
        work_capability_model: workCapability.model || 'gpt-5-mini',
      },
    },
    source_fingerprint: sourceFingerprint,
    content_fingerprint: source.content_fingerprint || null,
    duplicate_of: null,
    amendment_number: source.amendment_number || null,
    amendment_count: Number(source.amendment_count) || 0,
    is_latest_version: true,
    first_seen_at: source.first_seen_at || source.created_at || timestamp,
    last_seen_at: source.last_seen_at || timestamp,
    last_verified_at: timestamp,
    acquisition_method: RECOVERED_METHOD,
    ingestion_run_id: RECOVERY_RUN,
    extraction_confidence: 1,
    data_quality_score: source.data_quality_score ?? null,
    qa_status: 'auto_ingested',
    qa_notes: 'Recovered from preserved legacy inventory and normalized with Extraction V2 + Work Capability V2 on 2026-09-06.',
    requirements_extraction_status: 'COMPLETE',
    created_at: source.created_at || timestamp,
    updated_at: timestamp,
  };
}

export default async function handler(req) {
  const url = new URL(req.url);
  const expected = env('NATCORP_RECOVERY_TOKEN');
  const supplied = url.searchParams.get('token') || '';
  if (!expected || supplied !== expected) return;

  const limit = Math.max(1, Math.min(25, Number(url.searchParams.get('limit')) || 10));
  const apiKey = env('OPENAI_API_KEY');
  if (!apiKey) return;

  const rows = (await db(
    RECOVERY_TABLE,
    'GET',
    `?recovery_status=eq.READY_EXTRACTION&select=*&order=created_at.asc&limit=${limit}`,
  )) || [];

  for (const source of rows) {
    try {
      await patchRecovery(source.id, { recovery_status: 'PROCESSING', recovery_reason: 'Extraction V2 normalization started.' });

      const sourceUrl = source.source_url || source.official_source_url;
      if (!sourceUrl || !source.state_code || !source.title || !source.issuing_organization || !source.description) {
        await patchRecovery(source.id, { recovery_status: 'REVIEW_REQUIRED', recovery_reason: 'Missing canonical source fields required for safe recovery.' });
        continue;
      }

      const sourceFingerprint = source.source_fingerprint || await sha256(sourceUrl);
      const existing = (await db(
        'state_contract_opportunities',
        'GET',
        `?state_code=eq.${encode(source.state_code)}&source_fingerprint=eq.${encode(sourceFingerprint)}&select=id&limit=1`,
      )) || [];
      if (existing[0]?.id) {
        await patchRecovery(source.id, {
          recovery_status: 'DUPLICATE_SKIPPED',
          recovery_reason: 'An equivalent canonical state/source fingerprint already exists.',
          promoted_opportunity_id: existing[0].id,
        });
        continue;
      }

      if (source.response_deadline) {
        const recorded = new Date(source.response_deadline);
        if (Number.isFinite(recorded.getTime()) && recorded.getTime() <= Date.now()) {
          await patchRecovery(source.id, { recovery_status: 'EXPIRED_SKIPPED', recovery_reason: 'Recorded bidding deadline has passed.' });
          continue;
        }
      }

      const summary = await generateExplainer(source, { apiKey });
      const effectiveDeadline = validFutureDate(source.response_deadline) || validFutureDate(summary.inferred_response_deadline);
      if (!effectiveDeadline) {
        await patchRecovery(source.id, {
          recovery_status: 'REVIEW_REQUIRED_DEADLINE',
          recovery_reason: 'Extraction V2 completed, but no verifiable future response deadline was available. Record was not promoted.',
        });
        continue;
      }

      const normalized = {
        ...source,
        response_deadline: effectiveDeadline,
        requirements: {
          scope_summary: summary.scope_summary || '',
          required_licenses: arr(summary.required_licenses),
          required_certifications: arr(summary.required_certifications),
          bonding_requirements: summary.bonding_requirements || 'Not specified in the listing.',
          key_dates: arr(summary.key_dates),
        },
      };
      const workCapability = await resolveWorkCapability({ apiKey, opportunity: normalized });
      const row = canonicalRow(source, summary, workCapability, effectiveDeadline, sourceFingerprint);
      await db('state_contract_opportunities', 'POST', '', [row], 'return=minimal');

      await patchRecovery(source.id, {
        recovery_status: 'PROMOTED',
        recovery_reason: 'Recovered with Extraction V2 and Work Capability V2; promoted to canonical inventory.',
        promoted_opportunity_id: source.id,
      });
    } catch (error) {
      await patchRecovery(source.id, {
        recovery_status: 'FAILED',
        recovery_reason: String(error instanceof Error ? error.message : error).slice(0, 1000),
      }).catch(() => {});
    }
  }
}
