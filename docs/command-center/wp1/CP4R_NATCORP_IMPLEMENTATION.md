# APIOS-CC-WP1-001-CP4R — NAT-CORP Admitted-Contract Delivery Remediation

## Status

- Repository: `Aproposchpt2/NAT-CORP-CONTRACT-EXCHANGE`
- Branch: `implementation/admitted-contract-delivery-v1`
- Mode: branch implementation and shadow comparison only
- Production deployment: not authorized
- Customer cutover: disabled

## Implemented controls

1. `netlify/functions/_shared/admitted-contract-control.mjs`
   - Resolves records from `public.admitted_contracts_current`.
   - Requires admission, policy, evaluation, lifecycle, deadline, official-source, contact, scope, and requirements evidence.
   - Fails closed when the admission control plane is unavailable.
   - Reads `public.apios_natcorp_delivery_current_v2` for admitted-only delivery.
   - Compares legacy eligible, current admitted, and current delivery counts without changing production state.

2. `netlify/functions/analyze-fit-admitted-state.mjs`
   - Requires `admitted_contract_id` before invoking the accepted Analyze Fit implementation.
   - Rejects candidate/admission identity mismatches.
   - Preserves the accepted assessment output and public presentation.

3. `netlify/functions/natcorp-admitted-delivery-shadow.mjs`
   - Provides an authorized shadow endpoint.
   - Returns admitted-only delivery records when Zone C objects are available.
   - Never enables customer cutover.
   - Records or returns legacy-to-admitted comparison evidence.

4. `tests/admitted-contract-delivery.test.mjs`
   - Validates mandatory fail-closed codes.
   - Validates Analyze Fit admission ordering.
   - Validates shadow-only delivery behavior.

## Confirmed legacy direct readers and writers

### Direct candidate readers

- `netlify/functions/_shared/natcorp-acquisition.mjs`
- `netlify/functions/_shared/natcorp-agents.mjs`
- `netlify/functions/analyze-fit-state.mjs` through caller-provided opportunity payloads

### Direct release and delivery dependencies

- `matchingAgent` invokes `public.natcorp_apply_release_gates`.
- `deliveryAgent` counts `public.state_contract_opportunities` by `natcorp_release_status`.
- `reportingAgent` reports legacy evaluated and eligible counts as current operational inventory.

### Required later reconciliation

- Replace `matchingAgent` release-gate authority with APIOS admission evaluation and admitted-only AOIE processing.
- Replace `deliveryAgent` legacy counts with admitted and delivery-feed-v2 counts.
- Replace `reportingAgent.current_actionable` with current admitted inventory.
- Route the customer-facing Analyze Fit caller to `/api/analyze-fit-admitted-state` only after production cutover authorization.
- Preserve acquisition access to Zone A for internal collection and audit purposes.

## Rollback

Rollback is branch-level deletion or reversion of the four added files. No production data, schema, environment variable, deployment, or accepted public presentation has been changed.
