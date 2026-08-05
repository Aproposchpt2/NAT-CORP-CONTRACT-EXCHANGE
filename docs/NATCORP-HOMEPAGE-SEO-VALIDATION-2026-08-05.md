# NAT-CORP Homepage SEO and Conversion Validation

Date: 2026-08-05  
Implementation branch: `seo-homepage-production-natcorp-v1`  
Production base commit: `176e5ee287016f7ad5a635d03e2526ff2b47e6c5`  
Implementation commit: `0a9f6b5690e597bc71efc523dbd20e6d57023c91`  
Deploy Preview: `https://deploy-preview-56--national-corp-contract-exchange.netlify.app`

## Preservation

- Existing `headquarters.webp` hero asset retained.
- “Opportunity Builds Business. Business Builds Community.” retained.
- Community Economic Development narrative retained.
- “Our Commitment” section retained.
- Existing navy and executive presentation retained.

## Messaging and offer

- Official name: National Corporate Contract Exchange.
- Audience: all licensed contractors.
- Current coverage language: six states; nationwide expansion underway.
- Trial: 14 days.
- Subscription: $119 monthly after trial.
- Analyze Fit Report: $15 one-time.
- Contract Proposal Development: separately priced.
- Primary CTA: “Start Your 14-Day Free Trial.”
- Secondary CTA: “Member Login.”

## Metadata validation

- Title exact match: PASS
- Description exact match: PASS
- Canonical URL exact match: PASS
- Robots meta allows indexing: PASS
- Open Graph metadata present: PASS
- Twitter metadata present: PASS
- Exactly one H1: PASS

Validated title:

`State and Local Government Contract Matching | NAT-CORP`

Validated canonical:

`https://natcorp.aproposgroupllc.com/`

## Structured-data validation

Parsed JSON-LD types:

- Organization: PASS
- WebSite: PASS
- Service: PASS
- Offer: PASS

Offer assertions:

- Price `119.00`: PASS
- Currency `USD`: PASS
- Monthly billing duration `P1M`: PASS
- Fourteen-day trial duration `P14D`: PASS

No unsupported ratings, testimonials, or all-50-state operational claims were added.

## Live link tests

All tested preview routes and assets returned HTTP 200:

- `/`
- `/intake`
- `/member-login`
- `/proposal`
- `/support`
- `/privacy`
- `/terms`
- `/accessibility`
- `/robots.txt`
- `/sitemap.xml`
- `/assets/homepage-seo.css`
- `/headquarters.webp`

## Responsive review

Captured and reviewed at:

- Desktop viewport: 1440 × 1000
- Mobile device profile: iPhone 13
- Desktop full-page render: 1440 × 11198
- Mobile full-page render: 1170 × 51186 at device scale factor 3

Review findings:

- Existing headquarters hero image remains visible and stable.
- Navigation and both conversion CTAs remain visible on desktop and mobile.
- Section order follows the authorized homepage directive.
- No horizontal clipping was observed in the mobile render.
- Cards, pricing, FAQ, final CTA, trust disclosures, and footer stack correctly.
- Keyboard focus indicators and reduced-motion behavior are included.
- Hero minimum height reserves layout space to reduce visual shift.

## Deployment validation

Netlify deploy-preview build status: PASS

- Redirect rules processed without error: 39
- Header rules processed without error: 19
- Functions deployed: 31
- Secret-scan matches: 0
- Production deployment performed: NO
- Production branch modified: NO

## Review artifacts

Artifact package: `natcorp-homepage-review-package`

Contents:

- `desktop-hero.png`
- `desktop-full-page.png`
- `mobile-hero.png`
- `mobile-full-page.png`
- `link-test-results.txt`
- `metadata-schema-validation.json`

Artifact SHA-256 digest:

`c9668aba314f1e318cb74882383f1e187a57092abe405fc59a8941bfee26a7eb`

## Deployment control

The implementation remains in a draft pull request and deploy preview. No production merge or production deployment is authorized until review approval is received.
