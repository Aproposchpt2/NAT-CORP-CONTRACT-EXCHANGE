# NAT-CORP Homepage SEO and Conversion Validation

Date: 2026-08-05  
Implementation branch: `seo-homepage-production-natcorp-v1`  
Production base commit: `176e5ee287016f7ad5a635d03e2526ff2b47e6c5`

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

## Static validation

- Exactly one H1.
- Canonical URL set to production homepage.
- Robots meta allows indexing.
- Open Graph and Twitter metadata present.
- JSON-LD contains Organization, WebSite, Service, and Offer.
- Offer price is USD 119.00 with monthly billing duration.
- Trial duration is represented as 14 days.
- Internal section anchors are unique.
- Existing public routes referenced: `/member-login`, `/proposal`, `/support`, `/privacy`, `/terms`, `/accessibility`.
- Existing `/intake` route remains unchanged in the repository.
- Hero image dimensions are reserved through a minimum-height layout to reduce visual shift.
- Keyboard focus indicators and reduced-motion behavior included.
- Responsive breakpoints included for desktop, tablet, and mobile.

## Deployment control

No production merge or production deployment is authorized by this implementation commit. Review the branch preview before merging.
