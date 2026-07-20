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
