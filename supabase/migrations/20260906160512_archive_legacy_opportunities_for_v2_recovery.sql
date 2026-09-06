begin;

create table public.natcorp_legacy_opportunities_recovery_20260906 as
select s.*
from public.state_contract_opportunities s
where s.acquisition_method is distinct from 'PUBLISHER_DIRECTED_OPENAI_WEB_SEARCH';

alter table public.natcorp_legacy_opportunities_recovery_20260906
  add column recovery_status text not null default 'PENDING',
  add column recovery_reason text,
  add column recovered_at timestamptz,
  add column promoted_opportunity_id uuid,
  add column archived_at timestamptz not null default now();

create index natcorp_legacy_recovery_status_idx
  on public.natcorp_legacy_opportunities_recovery_20260906 (recovery_status);
create index natcorp_legacy_recovery_deadline_idx
  on public.natcorp_legacy_opportunities_recovery_20260906 (response_deadline);
create index natcorp_legacy_recovery_source_url_idx
  on public.natcorp_legacy_opportunities_recovery_20260906 (source_url);

create table public.natcorp_legacy_aoie_verdicts_recovery_20260906 as
select v.*
from public.aoie_llm_relevance_verdicts v
join public.state_contract_opportunities s on s.id = v.opportunity_id
where s.acquisition_method is distinct from 'PUBLISHER_DIRECTED_OPENAI_WEB_SEARCH';

alter table public.natcorp_legacy_aoie_verdicts_recovery_20260906
  add column archived_at timestamptz not null default now();

update public.state_normalized_records n
set canonical_opportunity_id = null
where canonical_opportunity_id in (
  select id from public.natcorp_legacy_opportunities_recovery_20260906
);

delete from public.state_contract_opportunities s
where s.id in (
  select id from public.natcorp_legacy_opportunities_recovery_20260906
);

commit;
