# NatCorp Command Center Clone — Trace, Review, and Compatibility Check

Working notes for the `natcorp-command-center` branch. Written before any new
code was added, per the RUFLO "Clone Command Center to NAT-CORP-CONTRACT-EXCHANGE"
instruction's Step 1 ("report back the complete list of files... before writing
anything new").

## Step 1 — Traced natcorp execution path in APROPOS-CONTRACT-BRIEF (read-only)

Entry point read in full: `netlify/functions/cbrief-command-center.mjs`. Its
`x-command-target === 'natcorp'` branch (GET status + POST actions) delegates to
`natcorpStatusBundle()` / `natcorpHandleAction()`, which pull in the rest of this
chain. Every file below was read in full.

### Entry point
- `netlify/functions/cbrief-command-center.mjs` — natcorp branch only (lines ~156-164
  for GET, ~222-230 for POST). Auth via `CBRIEF_COMMAND_KEY` / `x-cbrief-command-key`.

### Shared modules (`netlify/functions/_shared/`)
- `cbrief-command-center-natcorp.mjs` — the entire natcorp status+action surface;
  everything below is reached from here.
- `pipeline-registry.mjs` — dual-Supabase-project registry. Defines `NATCORP_PROJECT_ID`
  (`judislfknmhofcgzyozc`) / `CBRIEF_PROJECT_ID`, `normalizeProjectKey`/`isNatcorp`,
  cross-project `crossDb`/`crossDbCount` (reads `NATCORP_SUPABASE_URL` /
  `NATCORP_SUPABASE_SERVICE_ROLE_KEY` — env vars that don't exist yet on the
  apropos-contract-brief Netlify site), bound helpers `natcorpDb`/`natcorpDbCount`,
  and `STATE_NAME_TO_CODE`/`STATE_CODE_TO_NAME`/`stateCodeFor`.
- `natcorp-pipeline-acquisition.mjs` — Stage 1 storage: `storeNatcorpRawCandidate()`
  writes into `state_raw_records`; `ensureNatcorpAcquisitionJob`/`listNatcorpAcquisitionJobs`/
  `natcorpRawCoverage` track job status on `pdas_acquisition_jobs` (job id
  `cbrief_command_center:<stateCode>:<scopeId>`).
- `natcorp-pipeline-jobs.mjs` — generic rolling job-status helpers on
  `pdas_acquisition_jobs` (one row per stage, updated in place, not a per-run ledger).
  Well-known job ids: `cbrief_command_center:natcorp_extraction` /
  `natcorp_taxonomy` / `natcorp_reprocess`. `jobAsRunSummary()` reshapes a job row
  into the run-summary shape `command-center.html` already renders.
- `natcorp-pipeline-extraction.mjs` — Stage 2: normalizes `state_raw_records` →
  `state_normalized_records`, promotes to `state_contract_opportunities`, and
  generates the five-field explainer (`required_licenses`, `required_certifications`,
  `bonding_requirements`, `key_dates`, `scope_summary`) into
  `apie_contract_plain_language_explainer` via OpenAI structured output
  (model `gpt-5-mini`). `explainOpportunity()` is shared with Reprocess mode.
- `natcorp-pipeline-taxonomy.mjs` — Stage 3: classifies a contract against
  `aoie_taxonomy_capabilities` and writes `industry_label` + confidence onto the
  opportunity's `raw_source_payload.taxonomy_classification`, plus
  `aoie_opportunity_service_mappings` when a real capability matches. Deliberately
  does **not** call `cbrief-work-capability.mjs` (Literal Capability Match V1.2 stays
  cbrief-only). Notes that `aoie_taxonomy_*` tables are currently empty in the
  natcorp project, so every classification today lands as `NO_TAXONOMY_AVAILABLE`.
- `natcorp-pipeline-reprocess.mjs` — Reprocess mode: runs explainer + taxonomy
  classification directly against existing `state_contract_opportunities` rows
  (bypassing raw/normalized staging), prioritized `response_deadline IS NULL` first.
- `cbrief-state-publisher-defined.mjs` — builds the `STATE_PUBLISHER_DEFINED` scope
  tree per state (CA/AZ/NV) by merging child scopes from the two registries below.
- `cbrief-discovery-registry.mjs` — `DISCOVERY_TARGET` (50), `MIN_CLOSING_DAYS` (10),
  `DISCOVERY_LEDGER_PUBLISHER_ID`, the Las Vegas Metro / Maricopa Metro market
  scopes, and the base per-publisher scope list (CAL eProcure, CA_SRCS, CA_PID, all
  NV Clark-County-market publishers, a handful of AZ base publishers).
- `cbrief-vendor-registry.mjs` — the platform-family (`VENDOR`) scopes: OpenGov,
  PlanetBids, Bonfire/Euna, BidNet Direct, Periscope ePro, Public Purchase, JAGGAER,
  DemandStar, Ion Wave — one entry per state where verified, each with its own buyer
  list and allowed host suffixes.
- `cbrief-state-publisher-runner.mjs` — orchestrates one `STATE_PUBLISHER_DEFINED`
  run across all child scopes. Contains the **natcorp guard**: `runnerFor(scope, project)`
  forces every child scope through `runOpenAIDiscovery` when `project === 'natcorp'`,
  regardless of platform, specifically so a Bonfire/BidNet/IonWave/NevadaEPro/Market
  child scope can never fall through to one of those cbrief-only engines and misfile
  a natcorp record into a cbrief table. Imports all six engines but natcorp mode only
  ever calls one.
- `cbrief-openai-discovery.mjs` — the actual OpenAI web-search acquisition engine
  (`runOpenAIDiscovery`): up to 6 passes × 15 candidates, verifies each candidate's
  authoritative URL against an allowlist, and branches at `upsertCandidate()` on
  `evidence.project === 'natcorp'` to call `storeNatcorpRawCandidate` instead of
  writing `cbrief_contract_opportunities` directly.
- `openai-structured-json.mjs` — generic OpenAI Responses API wrapper enforcing
  strict JSON-schema output with one retry. No natcorp-specific logic; used by both
  the extraction and taxonomy modules above.
- `natcorp-db.mjs` — already exists identically in this repo (see compatibility
  check below). Supplies `db`/`dbCount`/`env`/`json`/`nowIso`/`sha256`/`commandAuthorized`.
  Not a new file to port.

### Background workers (`netlify/functions/`)
- `natcorp-discovery-run-background.mjs` — Stage 1 worker; calls
  `runStatePublisherDefinedDiscovery` with `project: 'natcorp'`.
- `natcorp-extraction-run-background.mjs` — Stage 2 worker; calls `runNatcorpExtractionBatch`.
- `natcorp-taxonomy-run-background.mjs` — Stage 3 worker; calls `runNatcorpTaxonomyBatch`.
- `natcorp-reprocess-run-background.mjs` — Reprocess worker; calls `runNatcorpReprocessBatch`.
All four share the same shape: verify `CBRIEF_COMMAND_KEY`/`x-cbrief-command-key`,
ensure/update a `pdas_acquisition_jobs` job row, run the batch, record COMPLETED/FAILED.

### Frontend
- `command-center.html` — read in full as the clone source for Step 2.

### Explicitly NOT needed for natcorp mode
`cbrief-market-discovery.mjs`, `cbrief-vendor-discovery.mjs`, `cbrief-bonfire-discovery.mjs`,
`cbrief-bidnet-discovery.mjs`, `cbrief-ionwave-discovery.mjs`, `cbrief-nevadaepro-discovery.mjs`
— imported by `cbrief-state-publisher-runner.mjs` but never invoked when
`project === 'natcorp'` (the guard always returns `runOpenAIDiscovery`). Also not
needed: `cbrief-task-reporting.mjs`, `cbrief-work-capability.mjs`, `cbrief-vendor-registry.mjs`'s
cbrief-only callers — natcorp's own status bundle stubs `task_reporting` itself and
never runs Literal Capability Match.

## Second-opinion review (advisor, called after Step 1, before writing)

Four points raised, all resolved before writing:

1. **Check the destination repo root for an existing `command-center.html`** —
   not yet checked at that point (only `netlify/functions/` and `_shared/` had been
   checked for `natcorp-*`/`pipeline-*` collisions). Given this repo already has
   `natcorp-command-page.mjs`, a same-named HTML file was a real possibility, not
   a formality. **Checked: no collision** (`ls command-center.html` → "No such
   file or directory").
2. **"Combining the logic into one function" (Step 3) can't literally mean one
   file** — the OpenAI discovery loop (6 passes × 15 candidates, each fetched/verified/
   upserted) and the batch explainer/taxonomy calls are exactly why the source repo
   split into a main handler + four `*-run-background.mjs` workers; a synchronous
   Netlify function will time out on this workload. Read consistently with how the
   *cloning* instruction itself described `cbrief-command-center.mjs` as "the single
   serverless function" even though it delegates to background workers — so: one
   entry-point handler (`natcorp-command-center.mjs`) with the action branches
   directly (no cbrief-style target switch, since there's only one target), plus
   background worker files and shared libs as additional new files.
3. **Don't port `CBRIEF_COMMAND_KEY`/`x-cbrief-command-key`** — this repo's own
   `natcorp-db.mjs` already exports `commandAuthorized(req)`, checking
   `NATCORP_OPERATOR_ACCESS`/`NATCORP_COMMAND_KEY`/`JEFF_DASHBOARD_PASSWORD` via
   `x-natcorp-command-key`/`x-dashboard-password`. The new handler and its
   background workers use that scheme instead.
4. **Verify `natcorp-db.mjs` import-compatibility rather than assume it** — done,
   see below.

Advisor also flagged the coexistence risk between this new pipeline and the
existing `natcorp-agent-acquisition.mjs` family already in this repo (see
"Open risk" below) as worth naming in the report but not a blocker, since nothing
merges to `main` and nothing auto-deploys from a branch.

## natcorp-db.mjs compatibility check

Compared `netlify/functions/_shared/natcorp-db.mjs` in this repo against the copy
in APROPOS-CONTRACT-BRIEF. **Identical**, including the `VAR-AUTH-001` comment and
the exact `commandAuthorized()` implementation — confirmed by direct read of both
files' first 60 lines. Confirmed exports used by the ported code: `db`, `dbCount`,
`env`, `json`, `nowIso`, `sha256` (via re-export chain), `commandAuthorized`. No
adaptation needed for this file; it is imported as-is, not duplicated.

## Open risk carried into the Step 4 report (not a blocker)

This repo's own `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` point at the **same**
Supabase project (`judislfknmhofcgzyozc`) that APROPOS-CONTRACT-BRIEF's natcorp
mode reaches cross-project via `NATCORP_SUPABASE_URL`. That means both repos, once
both are live, can write into the literal same `state_raw_records` /
`pdas_acquisition_jobs` / `state_contract_opportunities` / `aoie_opportunity_service_mappings`
rows — not just similar tables, the same ones. To reduce collision risk, the ported
job-id prefix is changed from `cbrief_command_center:` to a distinct prefix so the
two systems' `pdas_acquisition_jobs` rows can never collide on the same job id even
if both are run concurrently. This does not eliminate the deeper duplicate-pipeline
question (two independent acquisition systems targeting the same canonical tables),
which is a decision for Jeff, not something resolved by this branch.

Separately (found while confirming the `/api/cbrief-command-center` route, outside
today's write scope since APROPOS-CONTRACT-BRIEF is read-only for this task):
`_redirects` there actually points `/api/cbrief-command-center` at
`cbrief-command-center-publisher-defined.mjs`, a wrapper around the traced
`cbrief-command-center.mjs`. That wrapper intercepts `action === 'launch_discovery'`
unconditionally — it does not check `x-command-target` — so a natcorp-mode
"Launch Contract Acquisition" click in the *currently deployed* apropos-contract-brief
command center likely writes into the cbrief-only path regardless of the selected
target. Flagged for Jeff; not touched here (out of this task's read-only scope for
that repo).
