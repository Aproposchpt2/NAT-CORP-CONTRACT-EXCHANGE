-- The background judging worker needs the resolved business profile to
-- judge candidates against. Rather than requiring a new internal-service
-- auth secret to pass it through an HTTP trigger call (AOIE_INTERNAL_TOKEN
-- is not currently configured on this site), the trigger endpoint stores
-- the already-authenticated, already-resolved profile directly on the job
-- row it creates (service-role DB access, same as everything else in this
-- flow). The background worker then only needs a job_id: it reads the
-- profile from the job it's processing, the single source of truth for
-- "what needs to be judged and against what."
alter table public.aoie_llm_relevance_jobs
  add column if not exists profile_snapshot jsonb not null default '{}'::jsonb;
