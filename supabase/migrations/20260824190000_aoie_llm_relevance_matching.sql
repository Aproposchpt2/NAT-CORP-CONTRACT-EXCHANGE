-- LLM-based contract relevance judgment.
--
-- Replaces the keyword/ontology-bucket matcher (aoie-state-scoring.mjs) as
-- the actual relevance decision for contract matching. Confirmed live
-- 2026-08-24, repeatedly, against real CA inventory and a real business
-- profile: substring/keyword matching cannot distinguish "this contract's
-- core subject relates to X" from "the word X appears somewhere in this
-- 300KB+ document" -- a HIPAA/HITECH compliance citation or a standard
-- county data-security clause reads identically to a real subject-matter
-- match to a keyword matcher. Every attempted heuristic fix (corroboration
-- thresholds, phrase-specificity) either under- or over-corrected against
-- real data. This is a genuine semantic relevance-judgment problem, and the
-- right tool for that is an LLM actually reading the business profile
-- against the contract's real scope of work and reasoning about fit --
-- not a different keyword heuristic.
--
-- Verdicts are cached per (opportunity, profile_fingerprint) pair so a
-- profile is only re-judged against a contract once, not on every dashboard
-- load -- LLM judgment is comparatively expensive and slow (one call per
-- contract), unlike the near-instant synchronous scoring it replaces.

create table if not exists public.aoie_llm_relevance_verdicts (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.state_contract_opportunities(id) on delete cascade,
  profile_fingerprint text not null,
  business_name text,
  relevant boolean not null,
  tier text not null check (tier in ('Strong Match','Good Match','Review','Not Recommended')),
  fit_score integer not null check (fit_score between 0 and 100),
  reasoning text not null,
  evidence jsonb not null default '[]'::jsonb,
  concerns jsonb not null default '[]'::jsonb,
  model text not null,
  opportunity_updated_at timestamptz not null,
  judged_at timestamptz not null default now(),
  unique (opportunity_id, profile_fingerprint)
);

comment on table public.aoie_llm_relevance_verdicts is
  'Cached LLM relevance judgments, one row per (contract, business-profile-fingerprint) pair. opportunity_updated_at lets a stale verdict be detected and re-judged if the underlying contract data changes after judgment.';

create index if not exists aoie_llm_relevance_verdicts_lookup_idx
  on public.aoie_llm_relevance_verdicts (profile_fingerprint, relevant);

alter table public.aoie_llm_relevance_verdicts enable row level security;
revoke all on public.aoie_llm_relevance_verdicts from anon, authenticated;

-- Background judging job tracking, so the dashboard can show real progress
-- ("standby while we judge N contracts") instead of a cosmetic loading
-- message -- this makes that message literally true.
create table if not exists public.aoie_llm_relevance_jobs (
  id uuid primary key default gen_random_uuid(),
  profile_fingerprint text not null,
  business_name text,
  states text[] not null default '{}',
  status text not null default 'QUEUED' check (status in ('QUEUED','RUNNING','COMPLETED','FAILED')),
  total_candidates integer not null default 0,
  judged_candidates integer not null default 0,
  relevant_count integer not null default 0,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists aoie_llm_relevance_jobs_fingerprint_idx
  on public.aoie_llm_relevance_jobs (profile_fingerprint, created_at desc);

alter table public.aoie_llm_relevance_jobs enable row level security;
revoke all on public.aoie_llm_relevance_jobs from anon, authenticated;
