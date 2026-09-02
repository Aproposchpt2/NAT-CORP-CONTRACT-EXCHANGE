-- NAT-CORP PR #75: customer-authoritative matching identity.
--
-- Historical relevance jobs remain intact and ownerless. After the matching
-- code in this PR is active, ownerless jobs are diagnostic/legacy evidence
-- only and cannot establish live customer completion truth.

alter table public.aoie_llm_relevance_jobs
  add column if not exists owner_intake_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'aoie_llm_relevance_jobs_owner_intake_id_fkey'
      and conrelid = 'public.aoie_llm_relevance_jobs'::regclass
  ) then
    alter table public.aoie_llm_relevance_jobs
      add constraint aoie_llm_relevance_jobs_owner_intake_id_fkey
      foreign key (owner_intake_id)
      references public.natcorp_business_intakes(intake_id)
      on delete set null;
  end if;
end
$$;

create index if not exists aoie_llm_relevance_jobs_owner_profile_idx
  on public.aoie_llm_relevance_jobs (owner_intake_id, profile_fingerprint, created_at desc);

comment on column public.aoie_llm_relevance_jobs.owner_intake_id is
  'Server-authoritative NAT-CORP intake/profile-instance owner. NULL denotes legacy owner authority unresolved and is never customer-authoritative.';

-- Semantic verdict rows remain reusable computation artifacts. This join table
-- records which semantic verdicts were accepted by a specific owner-bound job.
-- Customer presentation resolves results through the job, never by fingerprint
-- alone.
create table if not exists public.aoie_llm_relevance_job_verdicts (
  job_id uuid not null
    references public.aoie_llm_relevance_jobs(id) on delete cascade,
  verdict_id uuid not null
    references public.aoie_llm_relevance_verdicts(id) on delete restrict,
  opportunity_id uuid not null
    references public.state_contract_opportunities(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (job_id, verdict_id),
  unique (job_id, opportunity_id)
);

create index if not exists aoie_llm_relevance_job_verdicts_job_idx
  on public.aoie_llm_relevance_job_verdicts (job_id, created_at);

alter table public.aoie_llm_relevance_job_verdicts enable row level security;

-- This is a server-only authority table. Explicit grants are included because
-- Supabase no longer guarantees automatic Data API grants for newly created
-- public tables. No anon/authenticated policies are created.
revoke all on table public.aoie_llm_relevance_job_verdicts from anon, authenticated;
grant select, insert, update, delete on table public.aoie_llm_relevance_job_verdicts to service_role;

comment on table public.aoie_llm_relevance_job_verdicts is
  'Owner-bound authorization links from customer matching jobs to reusable semantic relevance verdicts.';
