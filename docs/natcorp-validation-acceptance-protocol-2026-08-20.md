# NAT-CORP Contract Exchange — Validation and Acceptance Protocol

**Execution date:** 2026-08-20
**Purpose:** Pre-handoff validation ahead of external review access (Albert and team)
**Production application:** `https://natcorp.aproposgroupllc.com`
**Repository:** `github.com/Aproposchpt2/NAT-CORP-CONTRACT-EXCHANGE`
**Validated commit:** `5e2dd33`
**Supabase project:** `judislfknmhofcgzyozc`

## Final determination

**ACCEPTED — READY FOR EXTERNAL REVIEW ACCESS**, with one internal-tool-only gap tracked and disclosed below (not customer-facing, does not block handoff).

## Method

This validation was run against the actual current `origin/main`, not assumed from a prior report or a local checkout. A local clone used earlier in this process turned out to be several hundred commits stale relative to the real repository; that was caught before anything was pushed, the clone was reset to match real `origin/main` exactly, and every finding below was re-verified against that corrected state. No claim in this document rests on cached or assumed state — every result was produced by actually running the suite or hitting the live site during this session.

## Automated test results

**Full suite: 44 of 44 tests passing, 0 failing, 1 explicitly tracked as incomplete (`test.todo`, see Known Gap below).**

| Suite | Pass | Fail |
|---|---|---|
| `npm test` (`tests/*.test.js`, 10 files) | 35 | 0 |
| `analyze-fit-premium.test.mjs` | 1 | 0 |
| `aoie-state-local.test.mjs` | 1 | 0 |
| `aoie-state-source.test.mjs` | 1 | 0 |
| `business-profile-agent.test.mjs` | 1 | 0 |
| `opportunity-queue-pagination.test.mjs` | 2 | 0 |
| `otf-founder-outreach.test.mjs` | 1 | 0 |
| `otf-owner-command-center.test.mjs` | 1 | 0 |
| `owner-analyze-fit-handoff.test.mjs` | 1 | 0 (1 todo) |

**Note on test coverage:** `npm test` is configured as `node --test tests/*.test.js`, which does not include the repository's 8 `.test.mjs` files. All 8 were run individually as part of this validation. This gap in the configured command is itself worth fixing separately so future `npm test` runs catch what this validation had to check by hand.

## Findings and fixes applied

Three real issues were found while producing a genuine (not assumed) current baseline. All three are now resolved or explicitly tracked:

**1. Two stale test files, not product bugs.** `capability-profile-flow.test.js` and `analyze-fit-premium.test.mjs` both asserted the intake form exposes a `visitorEmail` field. The Aug 15 commit "Reduce Nat-Corp to the universal four-field intake" deliberately dropped that field from the live form — the backend (`capability-profile.mjs`) already treats it as fully optional and absent — but neither test was updated to match. Both fixed to assert the real, intentional four-field contract (`contactName`, `businessName`, `businessEmail`, `website`).

**2. One test referencing a deleted file, not a product bug.** `opportunity-queue-pagination.test.mjs` and `owner-analyze-fit-handoff.test.mjs` both read `netlify/functions/opportunity-fulfillment-page.mjs`, deleted in "Remove failing function route for OTF page" after an emergency revert to a static operator page. Both repointed to the real current page (`opportunity-fulfillment.html`); the pagination contract was also corrected to match what's actually live now (server-side `page`/`page_size` pagination in 30-record batches, not the old client-side 60-record array-slicing the test expected).

**3. One real, disclosed gap — not customer-facing.** While fixing #2, confirmed that nothing in the live repository actually calls `/api/owner-analyze-fit-handoff` except the function's own definition and its test — the "notify the owner when a business responds INTERESTED to outreach" wiring appears to have been lost somewhere across the OTF page-wrapper emergency reverts. The endpoint itself is intact and correct (verified by its own passing test). This lives entirely inside the internal Opportunity-to-Fulfillment operator tool — Albert's team will not see or use this page — so rather than guess at re-wiring it under time pressure, it's marked `test.todo` with the full finding documented inline in the test file, so it stays visible and doesn't silently disappear. **This needs a real decision: was this feature intentionally retired, or should it be restored?**

## Live production verification

Checked directly against the live site, not inferred from deploy status:

| Path | Result |
|---|---|
| `/` (homepage) | 200 |
| `/welcome.html` (intake) | 200 |
| `/profile-building.html` | 200 |
| `/profile-review.html` | 200 |
| `/dashboard` | 200 |
| `/analyze-fit-v2.html` | 200 |
| `/intake` | 200 |
| `/member-login` | 200 |
| `/services.html`, `/support.html` | 302 → `/intake` (intentional — retired pages, consolidated into the universal intake) |
| Stripe checkout link (`buy.stripe.com/...`) | 200 — the live $119/month, 14-day-trial payment path from the homepage's primary CTA |

## Known gap (tracked, does not block handoff)

- **Owner Analyze Fit handoff on interested response** — disconnected from the live OTF operator flow. Internal-tool-only; needs a decision on restore vs. formally retire. Tracked as `test.todo` in `tests/owner-analyze-fit-handoff.test.mjs`.
- **`npm test` doesn't cover `.test.mjs` files** — worth wiring in so this class of drift surfaces automatically instead of requiring a manual full-suite run like this one.

Neither of these affects anything Albert's team would see or interact with in the customer-facing product.

## Acceptance checklist

- [x] Full test suite run against verified current `origin/main` (not assumed/cached state)
- [x] All customer-facing flow pages confirmed live (200) end to end: homepage → intake → profile build → profile review → dashboard → Analyze Fit
- [x] Live payment path (Stripe) confirmed reachable
- [x] Retired-page redirects confirmed intentional, not broken links
- [x] Every test failure traced to a root cause and either fixed or explicitly disclosed — none silently deleted or ignored
- [x] All fixes committed and pushed to `origin/main`, verified at commit `5e2dd33`

## Operational status

**READY FOR EXTERNAL REVIEW ACCESS.** No customer-facing defect found. One internal-tool gap disclosed above needs a decision, but does not touch anything in Albert's review scope.
