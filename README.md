# National Corporate Contract Exchange

National Corporate Contract Exchange is an independent procurement-intelligence service operated by Apropos Group LLC.

## Public visitor journey

The production UX has one required sequence:

1. **Start** — public homepage
2. **Intake** — visitor name, licensed business name, and email for the current visit
3. **Business Intake** — supported service states, delivery roles, capabilities, employee range, and optional contract capacity
4. **Dashboard** — live AOIE evaluation of current procurement candidates

Every visitor follows this sequence, including returning visitors.

## Access model

- Free public access
- No subscription or payment card required
- No member login
- No one-time password or OTP endpoint
- No cookie-based account session
- No `localStorage` or `sessionStorage` profile restoration in the production visitor flow
- Refreshing, reopening, or directly visiting a later workflow step restarts Intake

Intake data is transferred once through a URL fragment, read into page memory, and immediately removed from the visible address. Analyze Fit uses the same one-time handoff pattern from the live dashboard.

## Live coverage

Current live opportunity matching covers supported records from:

- Arizona
- California
- Nevada

Coverage varies by procurement publisher, source availability, publication method, and update schedule. The platform does not claim to include every public solicitation.

## Production services

- `netlify/functions/aoie-state-shadow.mjs` — live candidate retrieval and AOIE scoring
- `netlify/functions/analyze-fit-state.mjs` — evidence-aware Executive Opportunity Assessment
- Supabase — protected procurement data source
- Netlify — static hosting, routing, headers, and serverless functions

## Canonical routes

- `/` — Start
- `/intake` — Intake
- `/business-intake` — Business Intake
- `/dashboard` — live dashboard; requires a current one-time profile handoff
- `/analyze-fit` — assessment; requires a current dashboard handoff

Legacy login, OTP, onboarding, board, and service routes must not bypass Intake.

## Deploy

GitHub deploys to Netlify from `main`. The site is a static publish from `.` with functions in `netlify/functions`.