-- Agency Login now collects the full business intake in one form (Name,
-- Business Name, Business Website URL, Business Email, Agency Name, Promo
-- Code) instead of a separate Universal Intake step after the code gate.
-- Jeff asked for the combined form 2026-08-25; this column lets him see
-- which BUSINESS came in through which agency's code, not just the
-- referring person's name -- the original table only tracked that.
alter table public.natcorp_agency_pilot_logins
  add column if not exists business_name text;

comment on column public.natcorp_agency_pilot_logins.business_name is
  'Business name captured in the same Agency Login submission, once the form was combined with Universal Intake -- self-reported, not independently verified. Null for logins recorded before this column existed.';
