# CalStateGen

**Win California government contracts.** The California instance of StateGen — surfaces open
**State of California, county, city, school district, and university** solicitations, matched to a
business's work. **No SAM.gov required.** Sister site to [StateGen (Nevada)](https://stategen.aproposgroupllc.com).

- **Domain (planned):** calstategen.aproposgroupllc.com
- **Owner:** Apropos Group LLC

## Status — PLACEHOLDER
This is a branded "launching soon" landing so the Netlify project + domain can be set up now. The full
product (bid board + keyword matching + straight-to-bid links) is built next, reusing the StateGen engine.

## Data plan (California)
California's portals differ from Nevada's (Nevada = NGEM/Ionwave, a clean public feed). For CA:
- **PlanetBids = primary source** — powers most CA cities/counties/districts; public bid portals (no login),
  data served via JSON behind the SPA. Aggregate the major CA agencies (San Diego id 17950, LA, etc.).
- **Cal eProcure** (state level) runs on PeopleSoft — brittle to scrape; later/optional.
- **data.ca.gov** open data = awarded contracts/POs (analytics later, not current open bids).

Live ingest = an adapter per the normalized opportunity shape (same as StateGen), wired once the
PlanetBids endpoint is mapped.

## Deploy
GitHub → Netlify auto-deploy from `main`. Static publish (`.`); functions in `netlify/functions` (added with the live build).
