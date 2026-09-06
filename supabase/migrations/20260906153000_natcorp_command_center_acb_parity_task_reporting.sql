create table if not exists public.natcorp_task_sessions (
  id uuid primary key default gen_random_uuid(),
  task_type text not null check (task_type in ('ACQUISITION','EXTRACTION')),
  status text not null default 'ACTIVE' check (status in ('ACTIVE','CLOSED')),
  started_at timestamptz not null default now(),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.natcorp_task_sessions enable row level security;
create unique index if not exists natcorp_task_sessions_one_active_per_type
  on public.natcorp_task_sessions(task_type)
  where status = 'ACTIVE';
create index if not exists natcorp_task_sessions_started_idx
  on public.natcorp_task_sessions(task_type, started_at desc);

create table if not exists public.natcorp_discovery_runs (
  id uuid primary key default gen_random_uuid(),
  task_session_id uuid references public.natcorp_task_sessions(id) on delete set null,
  scope_id text not null,
  state_code text,
  publisher_name text,
  platform_name text,
  status text not null default 'QUEUED' check (status in ('QUEUED','RUNNING','COMPLETED','FAILED','CANCELLED')),
  target_records integer not null default 50,
  total_listed integer not null default 0,
  processed integer not null default 0,
  created integer not null default 0,
  updated integer not null default 0,
  failed integer not null default 0,
  activity jsonb not null default '{}'::jsonb,
  coverage_execution jsonb not null default '[]'::jsonb,
  error_report jsonb,
  error_message text,
  cancel_requested_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.natcorp_discovery_runs enable row level security;
create index if not exists natcorp_discovery_runs_session_idx
  on public.natcorp_discovery_runs(task_session_id, created_at desc);
create index if not exists natcorp_discovery_runs_status_idx
  on public.natcorp_discovery_runs(status, created_at desc);
create index if not exists natcorp_discovery_runs_scope_idx
  on public.natcorp_discovery_runs(scope_id, created_at desc);

create table if not exists public.natcorp_extraction_runs (
  id uuid primary key default gen_random_uuid(),
  task_session_id uuid references public.natcorp_task_sessions(id) on delete set null,
  status text not null default 'QUEUED' check (status in ('QUEUED','RUNNING','COMPLETED','FAILED','CANCELLED')),
  target_records integer not null default 25,
  total_eligible integer not null default 0,
  processed integer not null default 0,
  succeeded integer not null default 0,
  failed integer not null default 0,
  activity jsonb not null default '{}'::jsonb,
  error_message text,
  cancel_requested_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.natcorp_extraction_runs enable row level security;
create index if not exists natcorp_extraction_runs_session_idx
  on public.natcorp_extraction_runs(task_session_id, created_at desc);
create index if not exists natcorp_extraction_runs_status_idx
  on public.natcorp_extraction_runs(status, created_at desc);

create table if not exists public.natcorp_acquisition_candidate_decisions (
  id uuid primary key default gen_random_uuid(),
  task_session_id uuid references public.natcorp_task_sessions(id) on delete set null,
  run_id uuid not null references public.natcorp_discovery_runs(id) on delete cascade,
  decision text not null check (decision in ('ACCEPTED','REJECTED','SKIPPED')),
  stage text not null,
  reason_code text,
  storage_result text,
  publisher_name text,
  solicitation_number text,
  title text,
  authoritative_detail_url text,
  pathway_id text,
  pathway_name text,
  created_at timestamptz not null default now()
);

alter table public.natcorp_acquisition_candidate_decisions enable row level security;
create index if not exists natcorp_candidate_decisions_run_idx
  on public.natcorp_acquisition_candidate_decisions(run_id, created_at desc);
create index if not exists natcorp_candidate_decisions_session_idx
  on public.natcorp_acquisition_candidate_decisions(task_session_id, created_at desc);
