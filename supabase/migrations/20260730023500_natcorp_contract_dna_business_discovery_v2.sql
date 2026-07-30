-- NAT-CORP Contract DNA v2 + Business Discovery v2
-- Supersedes the original deterministic v1 completion/search logic.

create or replace function public.natcorp_build_contract_dna(p_opportunity_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path to 'public','piee','pg_temp'
as $$
declare
  r record; v_complete integer:=0; v_enrichment integer:=0; v_status text;
  v_summary text; v_capability jsonb; v_missing jsonb; v_duration text;
  v_contact_available boolean; v_requirements_available boolean;
begin
  if current_user not in ('postgres','service_role') then raise exception 'service role required'; end if;
  for r in select * from public.state_contract_opportunities where id=any(p_opportunity_ids) loop
    v_summary:=nullif(btrim(coalesce(r.description,r.title,'')),'');
    v_contact_available:=nullif(btrim(coalesce(r.contact_name,'')),'') is not null or nullif(btrim(coalesce(r.contact_email,'')),'') is not null or nullif(btrim(coalesce(r.contact_phone,'')),'') is not null;
    v_requirements_available:=coalesce(r.requirements,'{}'::jsonb)<>'{}'::jsonb or v_summary is not null or cardinality(coalesce(r.naics_codes,'{}'::text[]))>0 or cardinality(coalesce(r.nigp_codes,'{}'::text[]))>0 or cardinality(coalesce(r.unspsc_codes,'{}'::text[]))>0 or cardinality(coalesce(r.commodity_codes,'{}'::text[]))>0 or cardinality(coalesce(r.keywords,'{}'::text[]))>0;
    v_duration:=case when v_summary is not null then substring(v_summary from '(?i)(estimated duration[^.\n]*|contract duration[^.\n]*|duration[^.\n]*[0-9]+[^.\n]*(?:year|month|day|week)s?)') end;
    if nullif(btrim(coalesce(v_duration,'')),'') is null then v_duration:='Unavailable'; end if;
    v_missing:='[]'::jsonb;
    if nullif(btrim(coalesce(r.solicitation_number,'')),'') is null then v_missing:=v_missing||jsonb_build_array('solicitation_number'); end if;
    if r.estimated_value_min is null and r.estimated_value_max is null then v_missing:=v_missing||jsonb_build_array('estimated_value'); end if;
    if cardinality(coalesce(r.naics_codes,'{}'::text[]))=0 then v_missing:=v_missing||jsonb_build_array('naics_codes'); end if;
    if jsonb_array_length(coalesce(r.document_urls,'[]'::jsonb))=0 then v_missing:=v_missing||jsonb_build_array('procurement_documents'); end if;
    if nullif(btrim(coalesce(r.place_of_performance_city,'')),'') is null then v_missing:=v_missing||jsonb_build_array('place_of_performance_city'); end if;
    if nullif(btrim(coalesce(r.place_of_performance_county,'')),'') is null or btrim(coalesce(r.place_of_performance_county,'')) in ('(N/A)','N/A') then v_missing:=v_missing||jsonb_build_array('place_of_performance_county'); end if;
    if r.question_deadline is null then v_missing:=v_missing||jsonb_build_array('question_deadline'); end if;
    if r.prebid_datetime is null then v_missing:=v_missing||jsonb_build_array('prebid_datetime'); end if;

    v_status:=case when v_summary is not null and v_requirements_available and v_contact_available and nullif(btrim(coalesce(r.official_source_url,r.source_url,'')),'') is not null and r.response_deadline is not null then 'complete' else 'enrichment_required' end;
    v_capability:=jsonb_build_object(
      'dna_version','natcorp_contract_dna_v2','nomination_ready',v_status='complete','scope_summary',coalesce(v_summary,'Unavailable'),
      'stated_requirements',case when coalesce(r.requirements,'{}'::jsonb)<>'{}'::jsonb then r.requirements else jsonb_build_object('status','Unavailable') end,
      'business_acquisition_signals',jsonb_build_object('keywords',to_jsonb(coalesce(r.keywords,'{}'::text[])),'naics_codes',to_jsonb(coalesce(r.naics_codes,'{}'::text[])),'nigp_codes',to_jsonb(coalesce(r.nigp_codes,'{}'::text[])),'unspsc_codes',to_jsonb(coalesce(r.unspsc_codes,'{}'::text[])),'commodity_codes',to_jsonb(coalesce(r.commodity_codes,'{}'::text[])),'procurement_type',coalesce(nullif(r.procurement_type,''),'Unavailable'),'notice_type',coalesce(nullif(r.notice_type,''),'Unavailable'),'set_asides',to_jsonb(coalesce(r.set_asides,'{}'::text[])),'certifications_required',to_jsonb(coalesce(r.certifications_required,'{}'::text[]))),
      'performance',jsonb_build_object('state',coalesce(nullif(r.place_of_performance_state,''),r.state_code,'Unavailable'),'county',case when nullif(btrim(coalesce(r.place_of_performance_county,'')),'') is null or btrim(coalesce(r.place_of_performance_county,'')) in ('(N/A)','N/A') then 'Unavailable' else r.place_of_performance_county end,'city',coalesce(nullif(r.place_of_performance_city,''),'Unavailable'),'zip',coalesce(nullif(r.place_of_performance_zip,''),'Unavailable'),'duration',v_duration),
      'procurement_contact',jsonb_build_object('name',coalesce(nullif(r.contact_name,''),'Unavailable'),'email',coalesce(nullif(r.contact_email,''),'Unavailable'),'phone',coalesce(nullif(r.contact_phone,''),'Unavailable')),
      'procurement_timing',jsonb_build_object('posted_at',coalesce(to_jsonb(r.posted_at),'null'::jsonb),'response_deadline',coalesce(to_jsonb(r.response_deadline),'null'::jsonb),'question_deadline',coalesce(to_jsonb(r.question_deadline),'null'::jsonb),'prebid_datetime',coalesce(to_jsonb(r.prebid_datetime),'null'::jsonb)),
      'source',jsonb_build_object('platform',coalesce(nullif(r.source_platform,''),'Unavailable'),'source_record_id',coalesce(nullif(r.source_record_id,''),'Unavailable'),'official_source_url',coalesce(nullif(r.official_source_url,''),nullif(r.source_url,''),'Unavailable'),'vendor_registration_url',coalesce(nullif(r.vendor_registration_url,''),'Unavailable')),
      'unavailable_details',v_missing);

    insert into piee.solicitation_profiles(opportunity_id,source_content_fingerprint,title,solicitation_number,agency,department,buyer,state_code,county,city,procurement_platform,procurement_method,contract_type,due_date,duration_text,estimated_value_min,estimated_value_max,buying_summary,buying_reason,required_capability_summary,extraction_method,extraction_confidence,extracted_at,updated_at)
    values(r.id,r.content_fingerprint,coalesce(nullif(r.title,''),'Unavailable'),coalesce(nullif(r.solicitation_number,''),'Unavailable'),coalesce(nullif(r.issuing_organization,''),'Unavailable'),coalesce(nullif(r.issuing_department,''),'Unavailable'),coalesce(nullif(r.contact_name,''),nullif(r.contact_email,''),'Unavailable'),coalesce(nullif(r.state_code,''),'Unavailable'),case when nullif(btrim(coalesce(r.place_of_performance_county,'')),'') is null or btrim(coalesce(r.place_of_performance_county,'')) in ('(N/A)','N/A') then 'Unavailable' else r.place_of_performance_county end,coalesce(nullif(r.place_of_performance_city,''),'Unavailable'),coalesce(nullif(r.source_platform,''),'Unavailable'),coalesce(nullif(r.procurement_type,''),'Unavailable'),coalesce(nullif(r.notice_type,''),'Unavailable'),r.response_deadline,v_duration,r.estimated_value_min,r.estimated_value_max,coalesce(v_summary,'Unavailable'),case when v_summary is not null then 'Agency is seeking a business capable of performing the published scope; detailed unstated requirements remain unavailable until additional source material is acquired.' else 'Unavailable' end,v_capability::text,'natcorp_deterministic_v2',coalesce(r.extraction_confidence,0.55),now(),now())
    on conflict(opportunity_id) do update set source_content_fingerprint=excluded.source_content_fingerprint,title=excluded.title,solicitation_number=excluded.solicitation_number,agency=excluded.agency,department=excluded.department,buyer=excluded.buyer,state_code=excluded.state_code,county=excluded.county,city=excluded.city,procurement_platform=excluded.procurement_platform,procurement_method=excluded.procurement_method,contract_type=excluded.contract_type,due_date=excluded.due_date,duration_text=excluded.duration_text,estimated_value_min=excluded.estimated_value_min,estimated_value_max=excluded.estimated_value_max,buying_summary=excluded.buying_summary,buying_reason=excluded.buying_reason,required_capability_summary=excluded.required_capability_summary,extraction_method=excluded.extraction_method,extraction_confidence=excluded.extraction_confidence,extracted_at=now(),updated_at=now();
    update public.state_contract_opportunities set natcorp_contract_dna_status=v_status,natcorp_contract_dna_updated_at=now(),qa_status=case when v_status='enrichment_required' and qa_status not in ('verified','rejected') then 'enrichment_required' when v_status='complete' and qa_status='enrichment_required' then 'auto_ingested' else qa_status end,updated_at=now() where id=r.id;
    if v_status='complete' then v_complete:=v_complete+1; else v_enrichment:=v_enrichment+1; end if;
  end loop;
  return jsonb_build_object('contract_dna_completed',v_complete,'enrichment_required',v_enrichment,'dna_version','natcorp_contract_dna_v2');
end;
$$;

create or replace function public.natcorp_create_business_discovery_command(p_opportunity_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public','piee','pg_temp'
as $$
declare o public.state_contract_opportunities%rowtype; p piee.solicitation_profiles%rowtype; v_dna jsonb; v_command jsonb; v_command_id uuid; v_scope text; v_geo text; v_duration text;
begin
  if current_user not in ('postgres','service_role') then raise exception 'service role required'; end if;
  select * into o from public.state_contract_opportunities where id=p_opportunity_id; if not found then raise exception 'opportunity not found: %',p_opportunity_id; end if;
  select * into p from piee.solicitation_profiles where opportunity_id=p_opportunity_id; if not found then raise exception 'contract DNA profile not found for opportunity: %',p_opportunity_id; end if;
  begin v_dna:=coalesce(p.required_capability_summary::jsonb,'{}'::jsonb); exception when others then v_dna:='{}'::jsonb; end;
  if coalesce((v_dna->>'nomination_ready')::boolean,false) is not true and coalesce(o.natcorp_contract_dna_status,'')<>'complete' then raise exception 'opportunity is not nomination ready; contract DNA status=%',coalesce(o.natcorp_contract_dna_status,'Unavailable'); end if;
  v_scope:=coalesce(v_dna->>'scope_summary',p.buying_summary,o.description,o.title,'Unavailable'); v_geo:=coalesce(v_dna#>>'{performance,state}',o.place_of_performance_state,o.state_code,'Unavailable'); v_duration:=coalesce(v_dna#>>'{performance,duration}',p.duration_text,'Unavailable');
  v_command:=jsonb_build_object(
    'command_type','BUSINESS_DISCOVERY','command_version','natcorp_business_discovery_v2','objective','Discover real businesses capable of performing the nominated contract using the Contract DNA. No business may be preselected or seeded into the search.','target_entity','business',
    'opportunity',jsonb_build_object('opportunity_id',o.id,'pdas_record_id',o.pdas_record_id,'contract_dna_reference',p.id,'title',o.title,'issuing_organization',o.issuing_organization,'issuing_department',o.issuing_department,'state_code',o.state_code,'response_deadline',o.response_deadline,'official_source_url',coalesce(o.official_source_url,o.source_url)),
    'business_search_specification',jsonb_build_object('scope_summary',v_scope,'geography',v_geo,'duration',v_duration,'stated_requirements',coalesce(o.requirements,'{}'::jsonb),'service_classification_hints',jsonb_build_object('unspsc_codes',coalesce(to_jsonb(o.unspsc_codes),'[]'::jsonb),'nigp_codes',coalesce(to_jsonb(o.nigp_codes),'[]'::jsonb),'commodity_codes',coalesce(to_jsonb(o.commodity_codes),'[]'::jsonb)),'source_keywords',coalesce(to_jsonb(o.keywords),'[]'::jsonb)),
    'search_rules',jsonb_build_array('Search only for businesses capable of performing the published contract scope.','Do not use a known business name, known website, or other preselected business identifier as a search seed.','Use the Contract DNA scope as the primary business-search specification.','Evaluate demonstrated services, professional disciplines, equipment, geographic coverage, required licensing, capacity, and comparable past performance when those factors are relevant to the contract.','Treat published commodity or service classification codes and source keywords only as supporting search hints; the actual contract scope controls the search.','Do not require unavailable contract details before discovery. Proceed using the usable Contract DNA.','Verify candidate capabilities using the business official website or authoritative public records whenever available.','Do not fabricate qualifications, licensing, capacity, or past performance. Mark unsupported attributes as Unavailable or Unverified.','Return multiple legitimate business candidates before selecting the strongest match.'),
    'source_priority',jsonb_build_array('Official business website and capability or service pages','State licensing or professional registration authority when the contract explicitly requires a license or regulated professional discipline','Secretary of State or equivalent business entity record when useful for identity verification','Government project, award, agency, or public-record sources demonstrating comparable past performance','Other authoritative sources that directly support capability, geography, capacity, or qualification evidence'),
    'minimum_candidate_evidence',jsonb_build_array('Legal or public business name','Business website or authoritative business record','Capability evidence relevant to the Contract DNA','Geographic or service-area evidence when geography matters','Qualification or licensing evidence only when the contract explicitly requires it','At least one source URL supporting the candidate'),
    'candidate_output_schema',jsonb_build_object('business_name','text','website','text or Unavailable','location','text or Unavailable','capability_evidence','array','qualification_evidence','array','past_performance_evidence','array','source_urls','array','contract_fit_notes','array','gaps_or_unverified_items','array','discovery_rank','integer','discovery_score','numeric'),
    'selection_rule','Select the strongest legitimate business match returned by the discovery search based on demonstrated capability to perform the Contract DNA, including geography, required licensing where applicable, capacity, and comparable past performance.',
    'search_query_generation_instruction','Generate several independent business-search queries from the contract scope, required services or professional disciplines, geography, explicit licensing or equipment requirements, and procurement-language synonyms. Do not include any preselected business name in the queries.');
  update public.natcorp_business_discovery_commands set status='superseded',updated_at=now() where opportunity_id=o.id and command_version<>'natcorp_business_discovery_v2' and status<>'superseded';
  insert into public.natcorp_business_discovery_commands(opportunity_id,contract_dna_reference,command_version,status,search_instructions,updated_at) values(o.id,p.id,'natcorp_business_discovery_v2','ready',v_command,now()) on conflict(opportunity_id,command_version) do update set contract_dna_reference=excluded.contract_dna_reference,status='ready',search_instructions=excluded.search_instructions,updated_at=now() returning command_id into v_command_id;
  return jsonb_build_object('command_id',v_command_id,'status','ready','command_version','natcorp_business_discovery_v2','target_entity','business','opportunity_id',o.id,'contract_dna_reference',p.id,'search_instructions',v_command);
end;
$$;

revoke all on function public.natcorp_build_contract_dna(uuid[]) from public, anon, authenticated;
grant execute on function public.natcorp_build_contract_dna(uuid[]) to service_role;
revoke all on function public.natcorp_create_business_discovery_command(uuid) from public, anon, authenticated;
grant execute on function public.natcorp_create_business_discovery_command(uuid) to service_role;
