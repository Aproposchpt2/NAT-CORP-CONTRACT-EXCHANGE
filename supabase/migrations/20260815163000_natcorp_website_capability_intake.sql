-- NAT-CORP website-first business capability intake.
-- Keeps opportunity-linked intake rows intact while adding a business-first profile workflow.

alter table public.natcorp_business_intakes
  add column if not exists intake_kind text not null default 'opportunity',
  add column if not exists session_token_hash text,
  add column if not exists session_expires_at timestamptz,
  add column if not exists contact_name text,
  add column if not exists business_name text,
  add column if not exists business_email text,
  add column if not exists website text,
  add column if not exists visitor_email text,
  add column if not exists canonical_domain text,
  add column if not exists resident_state text,
  add column if not exists discovery_status text not null default 'not_started',
  add column if not exists draft_profile jsonb not null default '{}'::jsonb,
  add column if not exists discovery_evidence jsonb not null default '[]'::jsonb,
  add column if not exists verified_profile jsonb not null default '{}'::jsonb,
  add column if not exists verified_at timestamptz,
  add column if not exists last_error text,
  add column if not exists matching_scope text not null default 'all_states';

alter table public.natcorp_business_intakes
  alter column opportunity_id drop not null;

alter table public.natcorp_business_intakes
  drop constraint if exists natcorp_business_intakes_intake_kind_check,
  add constraint natcorp_business_intakes_intake_kind_check
    check (intake_kind in ('opportunity','business_profile'));

alter table public.natcorp_business_intakes
  drop constraint if exists natcorp_business_intakes_kind_opportunity_check,
  add constraint natcorp_business_intakes_kind_opportunity_check
    check (
      (intake_kind = 'opportunity' and opportunity_id is not null)
      or
      (intake_kind = 'business_profile' and opportunity_id is null)
    );

alter table public.natcorp_business_intakes
  drop constraint if exists natcorp_business_intakes_discovery_status_check,
  add constraint natcorp_business_intakes_discovery_status_check
    check (discovery_status in ('not_started','intake_created','discovering','review_ready','verified','failed'));

alter table public.natcorp_business_intakes
  drop constraint if exists natcorp_business_intakes_matching_scope_check,
  add constraint natcorp_business_intakes_matching_scope_check
    check (matching_scope in ('all_states','resident_state'));

alter table public.natcorp_business_intakes
  drop constraint if exists natcorp_business_intakes_resident_state_check,
  add constraint natcorp_business_intakes_resident_state_check
    check (resident_state is null or resident_state ~ '^[A-Z]{2}$');

create unique index if not exists natcorp_business_intakes_session_token_hash_uq
  on public.natcorp_business_intakes(session_token_hash)
  where session_token_hash is not null;

create index if not exists natcorp_business_intakes_business_email_idx
  on public.natcorp_business_intakes(lower(business_email))
  where business_email is not null;

create index if not exists natcorp_business_intakes_business_profile_idx
  on public.natcorp_business_intakes(business_profile_id)
  where business_profile_id is not null;

comment on column public.natcorp_business_intakes.intake_kind is
  'opportunity = legacy contract-specific intake; business_profile = website-first Nat-Corp capability profiling.';
comment on column public.natcorp_business_intakes.session_token_hash is
  'SHA-256 hash of the opaque HttpOnly browser session token; the plaintext token is never persisted.';
comment on column public.natcorp_business_intakes.matching_scope is
  'Presentation preference only. Website-first matching evaluates all available APIE states before resident-state filtering.';