# PDAS Acquisition Monitoring

The operational monitoring layer consists of:

- `public.pdas_acquisition_jobs` — one current-state record per acquisition job.
- `public.pdas_acquisition_runs` — immutable execution history for each job.

Current California jobs:

- `CA-CALEPROCURE`
- `CA-PLANETBIDS`
- `CA-OBAS`

Each GitHub Actions workflow sets `PDAS_SOURCE_JOB_ID` before running `scripts/sync-supabase.js`. The synchronization script records the run start, discovered records, successful and failed upserts, runtime, final health status, and any error message.

The live dashboard continues to read opportunities from `public.state_contract_opportunities`; the monitoring tables support operations, alerting, and acquisition-health reporting.

## Contract Intelligence governance

All new or revised acquisition assignments must comply with [`PDAS-CIAS-1.0`](./pdas-contract-intelligence-acquisition-standard.md).

PDAS must report metadata ingestion separately from Contract Intelligence completeness. A successful row upsert does not establish that the opportunity has enough scope, requirements, documents, entity evidence, or contact information for contractor matching.

Every acquisition report must distinguish:

- database acquisition and write status;
- meaningful-description and scope coverage;
- substantive-requirement coverage;
- document, addenda, and amendment coverage;
- issuing-entity coverage;
- procurement and technical contact coverage;
- requirement extraction confidence;
- records approved for contractor matching;
- records held for enrichment;
- records excluded from contractor-facing release.

## Customer-release controls

The AOIE release gate independently verifies that customer-facing records have:

- a title;
- a valid official or authorized source URL;
- a future response deadline;
- an identifiable issuing organization;
- at least one substantive contract requirement;
- positive extraction confidence;
- an approved QA status.

Records that fail a release control remain available for governed research and enrichment but are not scored or returned to the contractor-facing dashboard.

## Assignment registry

Publisher-specific execution assignments are stored under `docs/pdas-agent-assignments/`.

The City of Tucson assignment is:

- [`AZ-L1-003 — City of Tucson`](./pdas-agent-assignments/AZ-L1-003-city-of-tucson.md)
