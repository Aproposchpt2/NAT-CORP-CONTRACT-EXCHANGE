import legacyAnalyzeFit from './analyze-fit-state.mjs';
import { json } from './_shared/natcorp-db.mjs';
import { AdmissionDeniedError, requireCurrentAdmission } from './_shared/admitted-contract-control.mjs';

export default async function handler(req) {
  if (req.method !== 'POST') return json(405, { ok: false, error: 'POST only' });

  const legacyRequest = req.clone();
  let body;
  try { body = await req.json(); }
  catch { return json(400, { ok: false, error: 'Invalid JSON request.' }); }

  try {
    const admitted = await requireCurrentAdmission(body.admitted_contract_id);
    const candidateId = admitted.candidate_opportunity_id || admitted.opportunity_id || null;
    const submittedCandidateId = body.bid?.id || body.bid?.opportunity_id || body.candidate_opportunity_id || null;
    if (submittedCandidateId && candidateId && String(submittedCandidateId) !== String(candidateId)) {
      throw new AdmissionDeniedError('CANDIDATE_ADMISSION_MISMATCH', 'The submitted opportunity does not match the admitted contract.');
    }
    return await legacyAnalyzeFit(legacyRequest);
  } catch (error) {
    const code = error instanceof AdmissionDeniedError ? error.code : 'ADMISSION_VALIDATION_ERROR';
    const status = code === 'ADMITTED_CONTRACT_ID_REQUIRED' ? 400 : code === 'ADMISSION_CONTROL_UNAVAILABLE' ? 503 : 403;
    return json(status, {
      ok: false,
      error: error?.message || 'Analyze Fit admission validation failed.',
      code,
      details: error?.details || {},
    });
  }
}

export const config = {
  path: '/api/analyze-fit-admitted-state',
  rateLimit: {
    windowLimit: 5,
    windowSize: 60,
    aggregateBy: ['ip', 'domain'],
  },
};
