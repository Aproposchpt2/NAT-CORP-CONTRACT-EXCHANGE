# NAT-CORP-CONTRACT-EXCHANGE CLAUDE.md

@../CLAUDE.md

## Naming history — read this before trusting any name in this file
This repo/site has been renamed at least twice: `CALSTATEGEN` → `CAL-GOV-CONTRACT-CENTER` → **`NAT-CORP-CONTRACT-EXCHANGE`** (current, verified 2026-08-27 via `gh repo view` and the Netlify project). The git remote may still show an old URL (GitHub redirects renamed-repo clone URLs, so `git remote -v` can lie about the *current* name) — the sections below were themselves stale until this date, wrongly claiming this was still `CAL-GOV-CONTRACT-CENTER`/`calgovcc.aproposgroupllc.com`. **Do not trust this file's repo/site identity claims as current without re-checking the Netlify project first** — see [[feedback_github_url_source_of_truth]] and [[project_claude_md_inventory]] in Jeff's memory. This repo has also grown well beyond its original CA-only scope (see below) into the shared NAT-CORP multi-state (CA/NV/AZ) acquisition pipeline — the sections below describing it as CA-specific predate that expansion.

## Repo
- GitHub: github.com/Aproposchpt2/NAT-CORP-CONTRACT-EXCHANGE
- Production branch: `main`

## Deploy pipeline
- Site: natcorp.aproposgroupllc.com
- Host: Netlify, project name `national-corp-contract-exchange` (site id `35650334-7d30-459f-8369-8f5bbc7350ec` — same id as this file's old `cal-gov-contract-center` reference; confirms it's the same site, renamed), auto-deploys from this repo's `main` on every push.
- There is a separate, similarly-named `Aproposchpt2/calgovcc` GitHub repo that shares a lot of code/history with this one but has **no Netlify site linked to it at all** — do not confuse the two. If work needs to reach production, it happens here.
- A force-push to `main` triggers an immediate production rebuild — treat any force-push as a production deploy, not just a git operation.
- After any history rewrite (reset/revert), verify the new Netlify build succeeds before removing any manual "last known good" publish pin.
- Don't trust a deploy is live from `state: ready` alone if it matters — fetch the actual page (or hit the actual function) and check the content, the way a deploy check was actually confirmed on 2026-07-16.

## Acquisition pipeline (multi-state, grew out of the original CA-only scope)
- `.github/workflows/scrape-caleprocure.yml` (every 4h) and `.github/workflows/scrape.yml`/`ingest-obas.yml` (daily/monthly) run the CA acquisition jobs (`CA-CALEPROCURE`, `CA-PLANETBIDS`, `CA-OBAS`), writing to the shared Supabase `state_contract_opportunities`/`pdas_acquisition_runs`/`apie_contract_identity` tables (project `judislfknmhofcgzyozc`, "Procurement Site Development").
- As of 2026-08-27 there is no equivalent scheduled job for NV or AZ — the 19 NV / 11 AZ records present in `state_contract_opportunities` came from one-time manual pulls, not automation, and 100% of them are still stuck at `requirements_extraction_status=NOT_STARTED`. See [[project_procurement_warehouse_revenue_strategy]] for the acquisition backlog this created.

## Data architecture
`netlify/functions/cal-pipeline.js` is the live dashboard's single bid feed. It blends two independently-resilient sources concurrently (`Promise.all`, each with its own try/catch so one failing never blocks the other):
1. **Cal eProcure / DGS** (state-level solicitations) — scraped live on each request, 5-minute in-memory cache.
2. **PlanetBids** (municipal — 9 CA agency portals: San Diego, Sacramento, Fresno, Port of Long Beach, San Bernardino, National City, CSU Fresno, Metropolitan Water District of Southern California, Inland Empire Utilities Agency) — pre-scraped daily by `scripts/scrape.js` (Playwright, rate-limit-aware with inter-portal delay — PlanetBids sits behind an AWS WAF-style limiter) via `.github/workflows/scrape.yml`, written to `bids.json` and `categories.json` at repo root and committed back by the `calstategen-bot` account.

Both sources are deduped (keyed on `solicitation_no`, falling back to `title`+`agency`) and merged into one sorted list, each bid tagged `_source: 'caleprocure' | 'planetbids'` for debuggability. `board.html` reads `bids.json` directly (PlanetBids-only) and is unaffected by the blend.

## services.html — category codes
The service-category picker (`services.html`) uses real PlanetBids `categoryId` values captured from the 9-agency scrape (`categories.json`), not an official statewide taxonomy — full provenance detail (which agencies, what the codes do and don't guarantee, known gaps) is documented inline in the file itself, in the comment block directly above `var CTREE=`. Read that comment before touching the category list; don't duplicate its content here where it can drift out of sync.

## Known architecture — template for future state sites
This repo is intended to serve as the **template** for future state-specific gov-contract sites, not a one-off. Arizona already exists as a separate, similar repo (`azgovcc.aproposgroupllc.com`, `Aproposchpt2/azgovcc`); more states are planned. When standing up a new state site from this shell, the three things that should actually change are:
1. **The data source adapter** — the state's equivalent of Cal eProcure/DGS + whatever municipal procurement platforms that state's agencies actually use (PlanetBids is common but not universal).
2. **The category/commodity code set** — that state's own real category data, following the same pattern used here (capture real codes from the state's live procurement platforms, don't inherit another state's placeholder codes — this repo itself was built to replace exactly that mistake, see the `services.html` note above).
3. **Branding** — name, domain, visual identity.
Everything else (dashboard matching logic, drawer UI, OTP/session handling, Netlify function shape) is meant to carry over largely unchanged. If asked to scaffold a new state site, start by diffing against this repo and `azgovcc`, not from scratch.

## Environment quirk — bash cwd silently resets
- In this environment, the Bash tool's working directory **does not persist reliably across calls** — it has been observed silently resetting to `C:\Users\Jeff\repos\calgovcc` between commands, even after an explicit `cd` into a different repo. This caused a real incident (2026-07-16): a `cd` into this repo silently reverted, later commands executed against `calgovcc` instead, and a Netlify status check reported the wrong (unrelated) linked site as a result — contributing to hours of work being applied to the wrong repo before it was caught.
- **Standing rule, permanent, applies to every multi-repo session going forward: prefix every single command with an explicit `cd "<full path>"` and verify with `pwd` (and `git remote -v` for git operations) in the *same* command/output — every time, never assume a prior `cd` held.**

## Repo-specific notes
<!-- Add stack, build commands, and conventions here as they're established. -->
