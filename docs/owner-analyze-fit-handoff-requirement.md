# Owner Analyze Fit Handoff Requirement

When an outreach recipient is classified as `INTERESTED`, NAT-CORP must create a client-safe, contract-specific Analyze Fit continuation URL and notify the APROPOS owner/operator by email.

The owner notification must include:
- interested contractor name
- selected contract title and reference
- response deadline
- the client-safe Analyze Fit URL
- a clear instruction that the owner may forward the URL to the interested contractor

The URL must not expose raw contractor data or internal credentials. It must carry a scoped opaque token that resolves server-side to the authoritative contractor candidate, contract, outreach, and Analyze Fit service request context.

Opening the URL must load the Opportunity-to-Fulfillment-specific Analyze Fit confirmation page with the contractor and contract details precompleted for report generation.
