-- NAT-CORP Opportunity-to-Fulfillment Service v1
-- Production-aligned schema for outreach, business intake/DNA, Analyze Fit,
-- report metadata, service requests, Contractor Repository, and subscriptions.

begin;

alter table public.natcorp_business_discovery_candidates
  add column if not exists contact_name text,
  add column if not exists contact_email text,
  add column if not exists contact_phone text,
  add column if not exists contact_source_url text,
  add column if not exists contact_verified boolean not null default false;

alter table public.natcorp_business_discovery_candidates
  drop constraint if exists natcorp_business_discovery_candidates_verification_status_check;
alter table public.natcorp_business_discovery_candidates
  add constraint natcorp_business_discovery_candidates_verification_status_check
  check (verification_status = any (array['discovered'::text,'evidence_checked'::text,'selected'::text,'interested'::text,'rejected'::text]));

create table if not exists public.natcorp_candidate_dispositions (
  disposition_id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.state_contract_opportunities(id) on delete cascade,
  command_id uuid,
  source_candidate_id uuid,
  business_name text not null,
  disposition text not null check (disposition in ('NOT_INTERESTED','NO_RESPONSE','DO_NOT_CONTACT','REJECTED','ADVANCED','OTHER')),
  source text not null default 'operator',
  response_text text,
  candidate_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists natcorp_candidate_dispositions_opportunity_idx on public.natcorp_candidate_dispositions(opportunity_id, created_at desc);

create table if not exists public.natcorp_outreach_events (
  outreach_id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.state_contract_opportunities(id) on delete cascade,
  command_id uuid,
  candidate_id uuid,
  business_name text not null,
  contact_name text,
  contact_email text,
  subject text not null,
  body_text text not null,
  status text not null default 'draft' check (status in ('draft','sent','delivered','replied','failed','canceled')),
  response_class text check (response_class is null or response_class in ('INTERESTED','NOT_INTERESTED','CONTRACT_QUESTION','TRUST_QUESTION','NO_RESPONSE','DO_NOT_CONTACT','UNKNOWN')),
  response_text text,
  provider_message_id text,
  provider_payload jsonb not null default '{}'::jsonb,
  sent_at timestamptz,
  replied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists natcorp_outreach_events_candidate_idx on public.natcorp_outreach_events(candidate_id, created_at desc);
create index if not exists natcorp_outreach_events_status_idx on public.natcorp_outreach_events(status, created_at desc);

create table if not exists public.natcorp_business_intakes (
  intake_id uuid primary key default gen_random_uuid(),
  outreach_id uuid references public.natcorp_outreach_events(outreach_id) on delete set null,
  opportunity_id uuid not null references public.state_contract_opportunities(id) on delete cascade,
  candidate_id uuid,
  business_profile_id uuid references public.aoie_business_profiles(id) on delete set null,
  status text not null default 'started' check (status in ('started','submitted','dna_complete','analysis_complete','closed')),
  contact_email text,
  intake_payload jsonb not null default '{}'::jsonb,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists natcorp_business_intakes_opportunity_idx on public.natcorp_business_intakes(opportunity_id, created_at desc);

create table if not exists public.natcorp_analyze_fit_runs (
  run_id uuid primary key default gen_random_uuid(),
  intake_id uuid not null references public.natcorp_business_intakes(intake_id) on delete cascade,
  opportunity_id uuid not null references public.state_contract_opportunities(id) on delete cascade,
  candidate_id uuid,
  business_profile_id uuid references public.aoie_business_profiles(id) on delete set null,
  contract_dna_id uuid references piee.solicitation_profiles(id) on delete set null,
  status text not null default 'queued' check (status in ('queued','running','completed','failed')),
  provider text,
  model text,
  score integer check (score is null or (score between 0 and 100)),
  recommendation text check (recommendation is null or recommendation in ('PURSUE','CONDITIONAL','DO_NOT_PURSUE')),
  analysis jsonb not null default '{}'::jsonb,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists natcorp_analyze_fit_runs_intake_idx on public.natcorp_analyze_fit_runs(intake_id, created_at desc);

create table if not exists public.natcorp_analyze_fit_reports (
  report_id uuid primary key default gen_random_uuid(),
  analyze_fit_run_id uuid not null references public.natcorp_analyze_fit_runs(run_id) on delete cascade,
  opportunity_id uuid not null references public.state_contract_opportunities(id) on delete cascade,
  business_profile_id uuid references public.aoie_business_profiles(id) on delete set null,
  report_version text not null default 'NATCORP-OTF-ANALYZE-FIT-v1',
  file_name text not null,
  content_hash text,
  generated_at timestamptz not null default now(),
  unique(analyze_fit_run_id)
);

create table if not exists public.natcorp_service_requests (
  request_id uuid primary key default gen_random_uuid(),
  intake_id uuid references public.natcorp_business_intakes(intake_id) on delete set null,
  opportunity_id uuid references public.state_contract_opportunities(id) on delete set null,
  business_profile_id uuid references public.aoie_business_profiles(id) on delete set null,
  service_type text not null check (service_type in ('CONTRACT_PROPOSAL_DEVELOPMENT','CONTRACTOR_REPOSITORY_SUBSCRIPTION')),
  status text not null default 'requested' check (status in ('requested','contact_pending','quoted','active','declined','closed')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.natcorp_contractor_repository (
  membership_id uuid primary key default gen_random_uuid(),
  business_profile_id uuid not null references public.aoie_business_profiles(id) on delete cascade,
  source_intake_id uuid references public.natcorp_business_intakes(intake_id) on delete set null,
  subscription_status text not null default 'pending' check (subscription_status in ('pending','active','past_due','canceled')),
  monthly_price numeric(10,2) not null default 29.99 check (monthly_price >= 0),
  currency text not null default 'USD',
  search_priority integer not null default 100,
  capability_summary text,
  service_territory jsonb not null default '{}'::jsonb,
  qualification_summary text,
  capacity_summary text,
  past_performance_summary text,
  billing_customer_id text,
  billing_subscription_id text,
  subscription_started_at timestamptz,
  canceled_at timestamptz,
  last_profile_reviewed_at timestamptz,
  active boolean generated always as (subscription_status = 'active') stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(business_profile_id)
);
create index if not exists natcorp_contractor_repository_active_idx on public.natcorp_contractor_repository(subscription_status, search_priority, updated_at desc);

create table if not exists public.natcorp_subscription_events (
  event_id uuid primary key default gen_random_uuid(),
  membership_id uuid references public.natcorp_contractor_repository(membership_id) on delete set null,
  business_profile_id uuid references public.aoie_business_profiles(id) on delete set null,
  event_type text not null,
  provider text,
  provider_event_id text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(provider, provider_event_id)
);

alter table public.natcorp_candidate_dispositions enable row level security;
alter table public.natcorp_outreach_events enable row level security;
alter table public.natcorp_business_intakes enable row level security;
alter table public.natcorp_analyze_fit_runs enable row level security;
alter table public.natcorp_analyze_fit_reports enable row level security;
alter table public.natcorp_service_requests enable row level security;
alter table public.natcorp_contractor_repository enable row level security;
alter table public.natcorp_subscription_events enable row level security;

create or replace function public.natcorp_get_contract_dna(p_opportunity_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public','piee','pg_temp' as $$
declare p piee.solicitation_profiles%rowtype;
begin
  if current_user not in ('postgres','service_role') then raise exception 'service role required'; end if;
  select * into p from piee.solicitation_profiles where opportunity_id=p_opportunity_id;
  if not found then return null; end if;
  return to_jsonb(p);
end;
$$;

create or replace function public.natcorp_disposition_candidate(
  p_candidate_id uuid,
  p_disposition text,
  p_response_text text default null,
  p_source text default 'operator'
) returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare c public.natcorp_business_discovery_candidates%rowtype; n public.natcorp_business_discovery_candidates%rowtype;
begin
  if current_user not in ('postgres','service_role') then raise exception 'service role required'; end if;
  if p_disposition not in ('NOT_INTERESTED','NO_RESPONSE','DO_NOT_CONTACT','REJECTED','ADVANCED','OTHER') then raise exception 'invalid disposition: %',p_disposition; end if;
  select * into c from public.natcorp_business_discovery_candidates where candidate_id=p_candidate_id for update;
  if not found then raise exception 'candidate not found: %',p_candidate_id; end if;
  insert into public.natcorp_candidate_dispositions(opportunity_id,command_id,source_candidate_id,business_name,disposition,source,response_text,candidate_snapshot)
  values(c.opportunity_id,c.command_id,c.candidate_id,c.business_name,p_disposition,coalesce(nullif(p_source,''),'operator'),p_response_text,to_jsonb(c));
  delete from public.natcorp_business_discovery_candidates where candidate_id=c.candidate_id;
  select * into n from public.natcorp_business_discovery_candidates where command_id=c.command_id order by coalesce(discovery_rank,2147483647),coalesce(discovery_score,0) desc,created_at limit 1 for update;
  if found then
    update public.natcorp_business_discovery_candidates set selected=false,updated_at=now() where command_id=c.command_id;
    update public.natcorp_business_discovery_candidates set selected=true,verification_status='selected',updated_at=now() where candidate_id=n.candidate_id;
  end if;
  return jsonb_build_object('removed_candidate_id',c.candidate_id,'removed_business_name',c.business_name,'disposition',p_disposition,'next_candidate_id',case when n.candidate_id is null then null else n.candidate_id end,'next_business_name',case when n.business_name is null then null else n.business_name end,'next_discovery_rank',n.discovery_rank,'status',case when n.candidate_id is null then 'candidate_queue_exhausted' else 'next_candidate_selected' end);
end;
$$;

create or replace function public.natcorp_build_business_dna(p_intake_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare i public.natcorp_business_intakes%rowtype; p jsonb; v_profile_id uuid; v_taxonomy_id uuid; q jsonb; perf jsonb; v_years integer; v_value numeric;
begin
  if current_user not in ('postgres','service_role') then raise exception 'service role required'; end if;
  select * into i from public.natcorp_business_intakes where intake_id=p_intake_id for update;
  if not found then raise exception 'intake not found: %',p_intake_id; end if;
  p:=coalesce(i.intake_payload,'{}'::jsonb);
  select id into v_taxonomy_id from public.aoie_taxonomy_versions order by case when status in ('ACTIVE','PILOT') then 0 else 1 end,created_at desc limit 1;
  if v_taxonomy_id is null then raise exception 'AOIE taxonomy version unavailable'; end if;
  v_years:=case when coalesce(p->>'years_in_business','') ~ '^[0-9]+$' then (p->>'years_in_business')::integer else null end;
  if i.business_profile_id is null then
    insert into public.aoie_business_profiles(legal_business_name,dba_name,business_description,website,primary_location,service_territory,years_in_business,employee_range,taxonomy_version_id,completion_score,confidence_score,verification_status,last_reviewed_at,user_confirmed,session_id,visit_scoped,source_provenance,updated_at)
    values(coalesce(nullif(p->>'legal_business_name',''),nullif(p->>'business_name',''),'Unnamed Business'),nullif(p->>'dba_name',''),coalesce(nullif(p->>'business_description',''),nullif(p->>'capabilities','')),nullif(p->>'website',''),jsonb_build_object('city',coalesce(p->>'city',''),'state',coalesce(p->>'state','')),coalesce(p->'service_territory',jsonb_build_object('states',coalesce(p->'service_states','[]'::jsonb))),v_years,nullif(p->>'employee_range',''),v_taxonomy_id,75,75,'SELF_REPORTED',now(),true,'otf:'||p_intake_id::text,false,jsonb_build_object('source','NAT-CORP Opportunity-to-Fulfillment intake','intake_id',p_intake_id,'opportunity_id',i.opportunity_id),now()) returning id into v_profile_id;
  else
    v_profile_id:=i.business_profile_id;
    update public.aoie_business_profiles set legal_business_name=coalesce(nullif(p->>'legal_business_name',''),nullif(p->>'business_name',''),legal_business_name),dba_name=coalesce(nullif(p->>'dba_name',''),dba_name),business_description=coalesce(nullif(p->>'business_description',''),nullif(p->>'capabilities',''),business_description),website=coalesce(nullif(p->>'website',''),website),primary_location=jsonb_build_object('city',coalesce(p->>'city',''),'state',coalesce(p->>'state','')),service_territory=coalesce(p->'service_territory',jsonb_build_object('states',coalesce(p->'service_states','[]'::jsonb))),years_in_business=coalesce(v_years,years_in_business),employee_range=coalesce(nullif(p->>'employee_range',''),employee_range),profile_version=profile_version+1,last_reviewed_at=now(),user_confirmed=true,updated_at=now() where id=v_profile_id;
  end if;
  insert into public.aoie_business_capacity(business_profile_id,staffing_capacity,equipment_capacity,geographic_capacity,fulfillment_capacity,updated_at)
  values(v_profile_id,nullif(p->>'staffing_capacity',''),nullif(p->>'equipment_capacity',''),coalesce(p->'service_territory',jsonb_build_object('states',coalesce(p->'service_states','[]'::jsonb))),nullif(p->>'fulfillment_capacity',''),now())
  on conflict(business_profile_id) do update set staffing_capacity=excluded.staffing_capacity,equipment_capacity=excluded.equipment_capacity,geographic_capacity=excluded.geographic_capacity,fulfillment_capacity=excluded.fulfillment_capacity,updated_at=now();
  delete from public.aoie_business_qualifications where business_profile_id=v_profile_id and metadata->>'source'='NAT-CORP OTF intake';
  for q in select value from jsonb_array_elements(coalesce(p->'qualifications','[]'::jsonb)) loop
    if coalesce(q->>'name','')<>'' then insert into public.aoie_business_qualifications(business_profile_id,qualification_type,qualification_name,issuing_authority,identifier,verified,metadata) values(v_profile_id,coalesce(nullif(q->>'type',''),'CONTRACT_RELEVANT'),q->>'name',nullif(q->>'issuing_authority',''),nullif(q->>'identifier',''),false,jsonb_build_object('source','NAT-CORP OTF intake')); end if;
  end loop;
  delete from public.aoie_business_past_performance where business_profile_id=v_profile_id and reference_details->>'source'='NAT-CORP OTF intake';
  for perf in select value from jsonb_array_elements(coalesce(p->'past_performance','[]'::jsonb)) loop
    if coalesce(perf->>'project_title','')<>'' then
      v_value:=case when replace(replace(coalesce(perf->>'contract_value',''),'$',''),',','') ~ '^[0-9]+(\.[0-9]+)?$' then replace(replace(perf->>'contract_value','$',''),',','')::numeric else null end;
      insert into public.aoie_business_past_performance(business_profile_id,client_name,client_type,project_title,project_description,contract_value,reference_details,verified) values(v_profile_id,nullif(perf->>'client_name',''),nullif(perf->>'client_type',''),perf->>'project_title',nullif(perf->>'project_description',''),v_value,jsonb_build_object('source','NAT-CORP OTF intake','reference',coalesce(perf->>'reference','')),false);
    end if;
  end loop;
  update public.natcorp_business_intakes set business_profile_id=v_profile_id,status='dna_complete',updated_at=now() where intake_id=p_intake_id;
  return jsonb_build_object('intake_id',p_intake_id,'business_profile_id',v_profile_id,'status','dna_complete');
end;
$$;

-- Service boundary hardening: these internal workflow tables are not public APIs.
revoke all on public.natcorp_candidate_dispositions from public, anon, authenticated;
revoke all on public.natcorp_outreach_events from public, anon, authenticated;
revoke all on public.natcorp_business_intakes from public, anon, authenticated;
revoke all on public.natcorp_analyze_fit_runs from public, anon, authenticated;
revoke all on public.natcorp_analyze_fit_reports from public, anon, authenticated;
revoke all on public.natcorp_service_requests from public, anon, authenticated;
revoke all on public.natcorp_contractor_repository from public, anon, authenticated;
revoke all on public.natcorp_subscription_events from public, anon, authenticated;

grant all on public.natcorp_candidate_dispositions to service_role;
grant all on public.natcorp_outreach_events to service_role;
grant all on public.natcorp_business_intakes to service_role;
grant all on public.natcorp_analyze_fit_runs to service_role;
grant all on public.natcorp_analyze_fit_reports to service_role;
grant all on public.natcorp_service_requests to service_role;
grant all on public.natcorp_contractor_repository to service_role;
grant all on public.natcorp_subscription_events to service_role;

revoke all on function public.natcorp_disposition_candidate(uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.natcorp_disposition_candidate(uuid,text,text,text) to service_role;
revoke all on function public.natcorp_build_business_dna(uuid) from public, anon, authenticated;
grant execute on function public.natcorp_build_business_dna(uuid) to service_role;
revoke all on function public.natcorp_get_contract_dna(uuid) from public, anon, authenticated;
grant execute on function public.natcorp_get_contract_dna(uuid) to service_role;

commit;
