-- Tracks who actually redeems the ACP agency-outreach campaign's access
-- code. Before this, /api/advisor-access validated a code and returned
-- ok/fail but wrote nothing anywhere -- there was no record of which
-- agencies actually engaged after the outreach email, only the code
-- itself working or not. Jeff asked for this explicitly (2026-08-25):
-- "Yes we do want to track the Agencies that login."
--
-- Scoped to the agency flow only: advisor-access.mjs only inserts a row
-- here when the caller supplied name/agency_name (agency-login.html's new
-- 3-field form), so Albert's existing single-field advisor-login.html
-- flow is unaffected and logs nothing here.
create table if not exists public.natcorp_agency_pilot_logins (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  agency_name text not null,
  code_used text not null,
  logged_in_at timestamptz not null default now()
);

comment on table public.natcorp_agency_pilot_logins is
  'One row per successful Agency Login (agency-login.html) redemption of an access code -- name/agency self-reported at login, not independently verified.';

create index if not exists natcorp_agency_pilot_logins_logged_in_at_idx
  on public.natcorp_agency_pilot_logins (logged_in_at desc);

alter table public.natcorp_agency_pilot_logins enable row level security;
revoke all on public.natcorp_agency_pilot_logins from anon, authenticated;
