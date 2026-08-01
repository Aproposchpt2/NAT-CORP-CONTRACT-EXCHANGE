-- NAT-CORP strict canonical contract admission and manual cleanup
-- Canonical table policy: retain only contracts with substantive requirements
-- and a named entity procurement contact with email or phone.

create or replace function public.natcorp_requirements_are_substantive(p_requirements jsonb)
returns boolean
language plpgsql
immutable
set search_path to 'public','pg_temp'
as $$
declare v_type text;
begin
  if p_requirements is null then return false; end if;
  v_type := jsonb_typeof(p_requirements);
  if v_type='array' then return jsonb_array_length(p_requirements)>0; end if;
  if v_type='string' then
    return length(btrim(p_requirements#>>'{}'))>=20
       and lower(btrim(p_requirements#>>'{}')) not in ('unavailable','none','not available','n/a');
  end if;
  if v_type<>'object' or p_requirements='{}'::jsonb then return false; end if;
  return exists (
    select 1 from jsonb_each(p_requirements) e(k,v)
    where k not in (
      'response_method','is_paused','is_private','addendum_count','aoie_enrichment','evidence_state',
      'aoie_extraction','bid_opening','bid_opening_date','deadline_precision','document_count',
      'document_package_registered','original_deadline','plans_status','close_out_reason','closed_substatus',
      'coming_soon','native_status','account_required_for_submission','public_documents_available',
      'submission_system','official_agency_source_verified','account_available','account_required_for_deeper_files',
      'authentication_bypassed','continuous','public_summary_accessible','proposal_due','question_deadline',
      'submission_location','addenda_count','document_hash_status','evaluation_timeline','intent_to_award_window',
      'procurement_package_status','procurement_type','program_context','program_source_verified',
      'public_discovery_authentication_required','publish_date','questions_deadline','response_type',
      'revised_deadline','schedule','submission_deadline','submission_instructions_status',
      'supplier_onboarding','vendor_registration_platform'
    )
    and case jsonb_typeof(v)
      when 'string' then length(btrim(v#>>'{}'))>=5 and lower(btrim(v#>>'{}')) not in ('unavailable','none','not available','n/a','false','true')
      when 'array' then jsonb_array_length(v)>0
      when 'object' then v<>'{}'::jsonb
      when 'number' then true
      when 'boolean' then k in ('mandatory_prebid','prequalification_required','account_required_for_submission') and v='true'::jsonb
      else false
    end
  );
end;
$$;

create table if not exists public.natcorp_contract_rejection_ledger (
  record_key text primary key,
  original_opportunity_id uuid,
  pdas_record_id text,
  source_platform text,
  source_record_id text,
  source_fingerprint text,
  ingestion_run_id text,
  rejection_reasons text[] not null,
  first_rejected_at timestamptz not null default now(),
  last_rejected_at timestamptz not null default now(),
  occurrence_count integer not null default 1
);

revoke all on public.natcorp_contract_rejection_ledger from public,anon,authenticated;
grant select,insert,update on public.natcorp_contract_rejection_ledger to service_role;

create or replace function public.natcorp_contract_rejection_key(
  p_source_platform text,p_source_record_id text,p_source_fingerprint text,
  p_pdas_record_id text,p_opportunity_id uuid
)
returns text
language sql
immutable
set search_path to 'public','pg_temp'
as $$
  select md5(concat_ws('|',
    coalesce(nullif(btrim(p_source_platform),''),'unknown'),
    coalesce(nullif(btrim(p_source_record_id),''),'unknown'),
    coalesce(nullif(btrim(p_source_fingerprint),''),'unknown'),
    coalesce(nullif(btrim(p_pdas_record_id),''),'unknown'),
    coalesce(p_opportunity_id::text,'unknown')
  ));
$$;

create or replace function public.natcorp_canonical_contract_admission_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare v_reasons text[]:='{}'::text[]; v_key text;
begin
  if not public.natcorp_requirements_are_substantive(new.requirements) then
    v_reasons:=array_append(v_reasons,'missing_substantive_contract_requirements');
  end if;
  if nullif(btrim(coalesce(new.contact_name,'')),'') is null
     or (nullif(btrim(coalesce(new.contact_email,'')),'') is null
         and nullif(btrim(coalesce(new.contact_phone,'')),'') is null) then
    v_reasons:=array_append(v_reasons,'missing_entity_procurement_contact');
  end if;
  if cardinality(v_reasons)>0 then
    v_key:=public.natcorp_contract_rejection_key(new.source_platform,new.source_record_id,new.source_fingerprint,new.pdas_record_id,new.id);
    insert into public.natcorp_contract_rejection_ledger(
      record_key,original_opportunity_id,pdas_record_id,source_platform,source_record_id,
      source_fingerprint,ingestion_run_id,rejection_reasons
    ) values (
      v_key,new.id,new.pdas_record_id,new.source_platform,new.source_record_id,
      new.source_fingerprint,new.ingestion_run_id,v_reasons
    ) on conflict(record_key) do update set
      rejection_reasons=excluded.rejection_reasons,
      last_rejected_at=now(),
      occurrence_count=public.natcorp_contract_rejection_ledger.occurrence_count+1;
    if tg_op='INSERT' then return null; end if;
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists natcorp_canonical_contract_admission_guard_trg on public.state_contract_opportunities;
create trigger natcorp_canonical_contract_admission_guard_trg
before insert or update of requirements,contact_name,contact_email,contact_phone
on public.state_contract_opportunities
for each row execute function public.natcorp_canonical_contract_admission_guard();

create or replace function public.natcorp_purge_invalid_canonical_contracts()
returns jsonb
language plpgsql
security definer
set search_path to 'public','piee','pg_temp'
as $$
declare
  v_invalid bigint:=0; v_document_sources bigint:=0; v_profiles bigint:=0;
  v_review_queue bigint:=0; v_lifecycle_events bigint:=0;
  v_commands bigint:=0; v_candidates bigint:=0; v_outreach bigint:=0; v_deleted bigint:=0;
begin
  if current_user not in ('postgres','service_role') then raise exception 'service role required'; end if;

  select count(*) into v_invalid from public.state_contract_opportunities o
  where not public.natcorp_requirements_are_substantive(o.requirements)
     or nullif(btrim(coalesce(o.contact_name,'')),'') is null
     or (nullif(btrim(coalesce(o.contact_email,'')),'') is null and nullif(btrim(coalesce(o.contact_phone,'')),'') is null);

  insert into public.natcorp_contract_rejection_ledger(
    record_key,original_opportunity_id,pdas_record_id,source_platform,source_record_id,
    source_fingerprint,ingestion_run_id,rejection_reasons
  )
  select public.natcorp_contract_rejection_key(o.source_platform,o.source_record_id,o.source_fingerprint,o.pdas_record_id,o.id),
         o.id,o.pdas_record_id,o.source_platform,o.source_record_id,o.source_fingerprint,o.ingestion_run_id,
         array_remove(array[
           case when not public.natcorp_requirements_are_substantive(o.requirements) then 'missing_substantive_contract_requirements' end,
           case when nullif(btrim(coalesce(o.contact_name,'')),'') is null
                  or (nullif(btrim(coalesce(o.contact_email,'')),'') is null and nullif(btrim(coalesce(o.contact_phone,'')),'') is null)
                then 'missing_entity_procurement_contact' end
         ],null)
  from public.state_contract_opportunities o
  where not public.natcorp_requirements_are_substantive(o.requirements)
     or nullif(btrim(coalesce(o.contact_name,'')),'') is null
     or (nullif(btrim(coalesce(o.contact_email,'')),'') is null and nullif(btrim(coalesce(o.contact_phone,'')),'') is null)
  on conflict(record_key) do update set rejection_reasons=excluded.rejection_reasons,last_rejected_at=now(),occurrence_count=public.natcorp_contract_rejection_ledger.occurrence_count+1;

  delete from piee.document_sources d using public.state_contract_opportunities o
  where d.opportunity_id=o.id and (
    not public.natcorp_requirements_are_substantive(o.requirements)
    or nullif(btrim(coalesce(o.contact_name,'')),'') is null
    or (nullif(btrim(coalesce(o.contact_email,'')),'') is null and nullif(btrim(coalesce(o.contact_phone,'')),'') is null));
  get diagnostics v_document_sources=row_count;

  delete from piee.solicitation_profiles p using public.state_contract_opportunities o
  where p.opportunity_id=o.id and (
    not public.natcorp_requirements_are_substantive(o.requirements)
    or nullif(btrim(coalesce(o.contact_name,'')),'') is null
    or (nullif(btrim(coalesce(o.contact_email,'')),'') is null and nullif(btrim(coalesce(o.contact_phone,'')),'') is null));
  get diagnostics v_profiles=row_count;

  delete from public.aoie_taxonomy_review_queue q using public.state_contract_opportunities o
  where q.opportunity_id=o.id and (
    not public.natcorp_requirements_are_substantive(o.requirements)
    or nullif(btrim(coalesce(o.contact_name,'')),'') is null
    or (nullif(btrim(coalesce(o.contact_email,'')),'') is null and nullif(btrim(coalesce(o.contact_phone,'')),'') is null));
  get diagnostics v_review_queue=row_count;

  delete from public.contract_lifecycle_events e using public.state_contract_opportunities o
  where e.opportunity_id=o.id and (
    not public.natcorp_requirements_are_substantive(o.requirements)
    or nullif(btrim(coalesce(o.contact_name,'')),'') is null
    or (nullif(btrim(coalesce(o.contact_email,'')),'') is null and nullif(btrim(coalesce(o.contact_phone,'')),'') is null));
  get diagnostics v_lifecycle_events=row_count;

  select count(*) into v_commands from public.natcorp_business_discovery_commands c join public.state_contract_opportunities o on o.id=c.opportunity_id
  where not public.natcorp_requirements_are_substantive(o.requirements) or nullif(btrim(coalesce(o.contact_name,'')),'') is null
     or (nullif(btrim(coalesce(o.contact_email,'')),'') is null and nullif(btrim(coalesce(o.contact_phone,'')),'') is null);
  select count(*) into v_candidates from public.natcorp_business_discovery_candidates c join public.state_contract_opportunities o on o.id=c.opportunity_id
  where not public.natcorp_requirements_are_substantive(o.requirements) or nullif(btrim(coalesce(o.contact_name,'')),'') is null
     or (nullif(btrim(coalesce(o.contact_email,'')),'') is null and nullif(btrim(coalesce(o.contact_phone,'')),'') is null);
  select count(*) into v_outreach from public.natcorp_outreach_events e join public.state_contract_opportunities o on o.id=e.opportunity_id
  where not public.natcorp_requirements_are_substantive(o.requirements) or nullif(btrim(coalesce(o.contact_name,'')),'') is null
     or (nullif(btrim(coalesce(o.contact_email,'')),'') is null and nullif(btrim(coalesce(o.contact_phone,'')),'') is null);

  delete from public.state_contract_opportunities o
  where not public.natcorp_requirements_are_substantive(o.requirements)
     or nullif(btrim(coalesce(o.contact_name,'')),'') is null
     or (nullif(btrim(coalesce(o.contact_email,'')),'') is null and nullif(btrim(coalesce(o.contact_phone,'')),'') is null);
  get diagnostics v_deleted=row_count;

  return jsonb_build_object(
    'invalid_identified',v_invalid,'contracts_deleted',v_deleted,
    'document_sources_deleted',v_document_sources,'solicitation_profiles_deleted',v_profiles,
    'taxonomy_review_rows_deleted',v_review_queue,'lifecycle_events_deleted',v_lifecycle_events,
    'business_discovery_commands_cascaded',v_commands,'business_discovery_candidates_cascaded',v_candidates,
    'outreach_drafts_cascaded',v_outreach
  );
end;
$$;

revoke all on function public.natcorp_requirements_are_substantive(jsonb) from public,anon,authenticated;
grant execute on function public.natcorp_requirements_are_substantive(jsonb) to service_role;
revoke all on function public.natcorp_purge_invalid_canonical_contracts() from public,anon,authenticated;
grant execute on function public.natcorp_purge_invalid_canonical_contracts() to service_role;

-- Production execution was performed under explicit owner authorization.
select public.natcorp_purge_invalid_canonical_contracts();
select public.natcorp_apply_release_gates(null);