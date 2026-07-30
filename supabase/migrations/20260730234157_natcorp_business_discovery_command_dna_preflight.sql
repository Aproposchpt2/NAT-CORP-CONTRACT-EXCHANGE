-- NAT-CORP OTF live-test remediation
-- Self-heal stale/not_started Contract DNA immediately before Business Discovery command creation.

create or replace function public.natcorp_create_business_discovery_command(p_opportunity_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'piee', 'pg_temp'
as $function$
declare
  o public.state_contract_opportunities%rowtype;
  p piee.solicitation_profiles%rowtype;
  v_dna jsonb := '{}'::jsonb;
  v_build_result jsonb;
begin
  if current_user not in ('postgres','service_role') then
    raise exception 'service role required';
  end if;

  select * into o
  from public.state_contract_opportunities
  where id = p_opportunity_id;

  if not found then
    raise exception 'opportunity not found: %', p_opportunity_id;
  end if;

  if coalesce(lower(o.status),'') <> 'open' then
    raise exception 'opportunity is not actionable; status=%', coalesce(o.status,'Unavailable');
  end if;

  if o.response_deadline is null or o.response_deadline <= now() then
    raise exception 'opportunity is not actionable; response deadline has passed or is unavailable';
  end if;

  select * into p
  from piee.solicitation_profiles
  where opportunity_id = p_opportunity_id;

  if found then
    begin
      v_dna := coalesce(p.required_capability_summary::jsonb, '{}'::jsonb);
    exception when others then
      v_dna := '{}'::jsonb;
    end;
  end if;

  if coalesce(o.natcorp_contract_dna_status,'not_started') <> 'complete'
     or p.id is null
     or coalesce((v_dna->>'nomination_ready')::boolean,false) is not true then
    select public.natcorp_build_contract_dna(array[p_opportunity_id]) into v_build_result;

    select * into o
    from public.state_contract_opportunities
    where id = p_opportunity_id;

    select * into p
    from piee.solicitation_profiles
    where opportunity_id = p_opportunity_id;

    if p.id is not null then
      begin
        v_dna := coalesce(p.required_capability_summary::jsonb, '{}'::jsonb);
      exception when others then
        v_dna := '{}'::jsonb;
      end;
    else
      v_dna := '{}'::jsonb;
    end if;
  end if;

  if coalesce(o.natcorp_contract_dna_status,'not_started') <> 'complete'
     or p.id is null
     or coalesce((v_dna->>'nomination_ready')::boolean,false) is not true then
    raise exception 'opportunity is not nomination ready after automatic Contract DNA preflight; contract DNA status=%', coalesce(o.natcorp_contract_dna_status,'Unavailable');
  end if;

  return public.natcorp_create_business_discovery_command_core(p_opportunity_id);
end;
$function$;

revoke all on function public.natcorp_create_business_discovery_command(uuid) from public;
revoke all on function public.natcorp_create_business_discovery_command(uuid) from anon;
revoke all on function public.natcorp_create_business_discovery_command(uuid) from authenticated;
grant execute on function public.natcorp_create_business_discovery_command(uuid) to service_role;
