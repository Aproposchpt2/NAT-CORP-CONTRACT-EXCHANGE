import { db, env, rpc } from './natcorp-db.mjs';

const SHADOW_MODE = () => String(env('NATCORP_ADMISSION_SHADOW_MODE') || 'true').toLowerCase() !== 'false';

export class AdmissionDeniedError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'AdmissionDeniedError';
    this.code = code;
    this.details = details;
  }
}

export async function resolveCurrentAdmission(admittedContractId) {
  const id = String(admittedContractId || '').trim();
  if (!id) throw new AdmissionDeniedError('ADMITTED_CONTRACT_ID_REQUIRED', 'A current admitted_contract_id is required.');

  try {
    const rows = await db(
      'admitted_contracts_current',
      'GET',
      `?admitted_contract_id=eq.${encodeURIComponent(id)}&select=*&limit=1`,
    );
    const admitted = rows?.[0] || null;
    if (!admitted) throw new AdmissionDeniedError('NOT_ADMITTED', 'The contract is not currently admitted.');
    return admitted;
  } catch (error) {
    if (error instanceof AdmissionDeniedError) throw error;
    if (SHADOW_MODE()) {
      throw new AdmissionDeniedError(
        'ADMISSION_CONTROL_UNAVAILABLE',
        'The admitted-contract control plane is unavailable in this environment.',
        { cause: String(error?.message || error).slice(0, 300), shadow_mode: true },
      );
    }
    throw error;
  }
}

export function assertAdmissionUsable(admitted) {
  const status = String(admitted?.admission_status || admitted?.status || '').toUpperCase();
  const lifecycle = String(admitted?.lifecycle_status || '').toLowerCase();
  const deadline = admitted?.response_deadline || admitted?.expiration_timestamp || null;

  if (status && status !== 'ADMITTED') throw new AdmissionDeniedError('NOT_ADMITTED', 'The contract is not admitted.');
  if (admitted?.revoked_at) throw new AdmissionDeniedError('ADMISSION_REVOKED', 'The contract admission has been revoked.');
  if (admitted?.superseded_by_admitted_contract_id) throw new AdmissionDeniedError('CONTRACT_SUPERSEDED', 'The contract has been superseded.');
  if (['closed', 'expired', 'cancelled', 'withdrawn', 'superseded', 'revoked'].includes(lifecycle)) {
    throw new AdmissionDeniedError('CONTRACT_NOT_CURRENT', 'The contract is not currently actionable.', { lifecycle_status: lifecycle });
  }
  if (deadline && Date.parse(deadline) <= Date.now()) throw new AdmissionDeniedError('CONTRACT_EXPIRED', 'The response deadline has passed.');

  const requiredEvidence = [
    ['official_source_evidence_id', 'OFFICIAL_SOURCE_EVIDENCE_INVALID'],
    ['contact_evidence_id', 'CONTACT_EVIDENCE_INVALID'],
    ['scope_evidence_id', 'SCOPE_EVIDENCE_INVALID'],
  ];
  for (const [field, code] of requiredEvidence) {
    if (!admitted?.[field]) throw new AdmissionDeniedError(code, `Mandatory evidence is missing: ${field}.`);
  }
  if (!admitted?.requirements_evidence_manifest || (Array.isArray(admitted.requirements_evidence_manifest) && !admitted.requirements_evidence_manifest.length)) {
    throw new AdmissionDeniedError('REQUIREMENTS_EVIDENCE_INVALID', 'Verified substantive requirements evidence is missing.');
  }
  if (!admitted?.evaluation_id) throw new AdmissionDeniedError('ADMISSION_EVALUATION_REQUIRED', 'The current admission evaluation is missing.');
  if (!admitted?.policy_id) throw new AdmissionDeniedError('ADMISSION_POLICY_REQUIRED', 'The admission policy reference is missing.');
  return admitted;
}

export async function requireCurrentAdmission(admittedContractId) {
  return assertAdmissionUsable(await resolveCurrentAdmission(admittedContractId));
}

export async function listCurrentDeliveries({ businessProfileId = null, limit = 250 } = {}) {
  const clauses = ['select=*', 'order=release_timestamp.desc', `limit=${Math.max(1, Math.min(Number(limit) || 250, 1000))}`];
  if (businessProfileId) clauses.push(`business_profile_id=eq.${encodeURIComponent(businessProfileId)}`);
  try {
    return await db('apios_natcorp_delivery_current_v2', 'GET', `?${clauses.join('&')}`) || [];
  } catch (error) {
    if (SHADOW_MODE()) return [];
    throw error;
  }
}

export async function compareLegacyAndAdmittedCounts() {
  const [legacyEligible, admittedCurrent, currentDelivery] = await Promise.all([
    db('state_contract_opportunities', 'GET', '?natcorp_release_status=eq.eligible&select=id&limit=10000'),
    db('admitted_contracts_current', 'GET', '?select=admitted_contract_id&limit=10000').catch(() => []),
    db('apios_natcorp_delivery_current_v2', 'GET', '?select=delivery_id&limit=10000').catch(() => []),
  ]);
  return {
    shadow_mode: SHADOW_MODE(),
    legacy_eligible: legacyEligible?.length || 0,
    current_admitted: admittedCurrent?.length || 0,
    current_delivery: currentDelivery?.length || 0,
    variance_legacy_to_admitted: (legacyEligible?.length || 0) - (admittedCurrent?.length || 0),
  };
}

export async function recordShadowComparison(payload) {
  try {
    return await rpc('apios_record_admission_shadow_comparison', { p_payload: payload });
  } catch {
    return { recorded: false, shadow_only: true };
  }
}
