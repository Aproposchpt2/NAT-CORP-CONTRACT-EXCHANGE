create or replace function public.natcorp_record_business_discovery_candidates(p_command_id uuid, p_candidates jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare
  v_opportunity_id uuid;
  v_count integer := 0;
begin
  if current_user not in ('postgres','service_role') then
    raise exception 'service role required';
  end if;

  select opportunity_id into v_opportunity_id
  from public.natcorp_business_discovery_commands
  where command_id=p_command_id;

  if v_opportunity_id is null then
    raise exception 'business discovery command not found: %', p_command_id;
  end if;

  insert into public.natcorp_business_discovery_candidates(
    command_id,opportunity_id,business_name,website,location,
    capability_evidence,qualification_evidence,past_performance_evidence,
    source_urls,contract_fit_notes,gaps_or_unverified_items,
    discovery_rank,discovery_score,verification_status,updated_at
  )
  select
    p_command_id,v_opportunity_id,x.business_name,nullif(x.website,''),nullif(x.location,''),
    coalesce(x.capability_evidence,'[]'::jsonb),coalesce(x.qualification_evidence,'[]'::jsonb),coalesce(x.past_performance_evidence,'[]'::jsonb),
    coalesce(x.source_urls,'[]'::jsonb),coalesce(x.contract_fit_notes,'[]'::jsonb),coalesce(x.gaps_or_unverified_items,'[]'::jsonb),
    x.discovery_rank,
    case
      when coalesce(x.discovery_score,0)>0 then least(100,greatest(0,x.discovery_score))
      else least(100,greatest(1,
        45
        + 7*jsonb_array_length(coalesce(x.capability_evidence,'[]'::jsonb))
        + 4*jsonb_array_length(coalesce(x.qualification_evidence,'[]'::jsonb))
        + 4*jsonb_array_length(coalesce(x.past_performance_evidence,'[]'::jsonb))
        + 5*jsonb_array_length(coalesce(x.contract_fit_notes,'[]'::jsonb))
        - 4*jsonb_array_length(coalesce(x.gaps_or_unverified_items,'[]'::jsonb))
      ))
    end,
    'evidence_checked',now()
  from jsonb_to_recordset(coalesce(p_candidates,'[]'::jsonb)) as x(
    business_name text,website text,location text,
    capability_evidence jsonb,qualification_evidence jsonb,past_performance_evidence jsonb,
    source_urls jsonb,contract_fit_notes jsonb,gaps_or_unverified_items jsonb,
    discovery_rank integer,discovery_score numeric
  )
  on conflict (command_id,business_name) do update set
    website=excluded.website,
    location=excluded.location,
    capability_evidence=excluded.capability_evidence,
    qualification_evidence=excluded.qualification_evidence,
    past_performance_evidence=excluded.past_performance_evidence,
    source_urls=excluded.source_urls,
    contract_fit_notes=excluded.contract_fit_notes,
    gaps_or_unverified_items=excluded.gaps_or_unverified_items,
    discovery_rank=excluded.discovery_rank,
    discovery_score=excluded.discovery_score,
    verification_status='evidence_checked',
    updated_at=now();

  get diagnostics v_count=row_count;
  update public.natcorp_business_discovery_commands set status='running',updated_at=now() where command_id=p_command_id;
  return jsonb_build_object('command_id',p_command_id,'candidates_recorded',v_count,'status','running');
end;
$$;

revoke all on function public.natcorp_record_business_discovery_candidates(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.natcorp_record_business_discovery_candidates(uuid,jsonb) to service_role;

update public.natcorp_business_discovery_candidates
set contact_email=null,contact_verified=false,updated_at=now()
where lower(trim(coalesce(contact_email,''))) in ('unavailable','unknown','n/a','na','none','not available','null');

update public.natcorp_business_discovery_candidates
set contact_verified=false,updated_at=now()
where contact_source_url is not null
  and lower(contact_source_url) ~ '(yellowpages\.com|yelp\.com|mapquest\.com|facebook\.com|linkedin\.com)';

update public.natcorp_business_discovery_candidates
set discovery_score=least(100,greatest(1,
  45
  + 7*jsonb_array_length(coalesce(capability_evidence,'[]'::jsonb))
  + 4*jsonb_array_length(coalesce(qualification_evidence,'[]'::jsonb))
  + 4*jsonb_array_length(coalesce(past_performance_evidence,'[]'::jsonb))
  + 5*jsonb_array_length(coalesce(contract_fit_notes,'[]'::jsonb))
  - 4*jsonb_array_length(coalesce(gaps_or_unverified_items,'[]'::jsonb))
)),updated_at=now()
where coalesce(discovery_score,0)<=0;
