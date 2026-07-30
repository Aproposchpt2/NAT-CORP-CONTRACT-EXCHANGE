-- NAT-CORP OTF live-test remediation
-- Correct nomination readiness so blank descriptions fall back to the contract title
-- and missing procurement contact data remains Unavailable rather than blocking discovery.

create or replace function public.natcorp_build_contract_dna(p_opportunity_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'piee', 'pg_temp'
as $function$
declare
  r record;
  v_complete integer := 0;
  v_enrichment integer := 0;
  v_status text;
  v_summary text;
  v_capability jsonb;
  v_missing jsonb;
  v_duration text;
  v_requirements_available boolean;
begin
  for r in
    select *
    from public.state_contract_opportunities
    where id = any(p_opportunity_ids)
  loop
    -- A blank description must not suppress a usable title fallback.
    v_summary := coalesce(
      nullif(btrim(coalesce(r.description, '')), ''),
      nullif(btrim(coalesce(r.title, '')), '')
    );

    v_requirements_available :=
      coalesce(r.requirements, '{}'::jsonb) <> '{}'::jsonb
      or v_summary is not null
      or cardinality(coalesce(r.naics_codes, '{}'::text[])) > 0
      or cardinality(coalesce(r.nigp_codes, '{}'::text[])) > 0
      or cardinality(coalesce(r.unspsc_codes, '{}'::text[])) > 0
      or cardinality(coalesce(r.commodity_codes, '{}'::text[])) > 0
      or cardinality(coalesce(r.keywords, '{}'::text[])) > 0;

    v_duration := null;
    if v_summary is not null then
      v_duration := substring(v_summary from '(?i)(estimated duration[^.\n]*|contract duration[^.\n]*|duration[^.\n]*[0-9]+[^.\n]*(?:year|month|day|week)s?)');
    end if;
    if nullif(btrim(coalesce(v_duration, '')), '') is null then
      v_duration := 'Unavailable';
    end if;

    v_missing := '[]'::jsonb;
    if nullif(btrim(coalesce(r.solicitation_number, '')), '') is null then
      v_missing := v_missing || jsonb_build_array('solicitation_number');
    end if;
    if r.estimated_value_min is null and r.estimated_value_max is null then
      v_missing := v_missing || jsonb_build_array('estimated_value');
    end if;
    if cardinality(coalesce(r.naics_codes, '{}'::text[])) = 0 then
      v_missing := v_missing || jsonb_build_array('naics_codes');
    end if;
    if jsonb_array_length(coalesce(r.document_urls, '[]'::jsonb)) = 0 then
      v_missing := v_missing || jsonb_build_array('procurement_documents');
    end if;
    if nullif(btrim(coalesce(r.place_of_performance_city, '')), '') is null then
      v_missing := v_missing || jsonb_build_array('place_of_performance_city');
    end if;
    if nullif(btrim(coalesce(r.place_of_performance_county, '')), '') is null
       or btrim(coalesce(r.place_of_performance_county, '')) in ('(N/A)', 'N/A') then
      v_missing := v_missing || jsonb_build_array('place_of_performance_county');
    end if;
    if r.question_deadline is null then
      v_missing := v_missing || jsonb_build_array('question_deadline');
    end if;
    if r.prebid_datetime is null then
      v_missing := v_missing || jsonb_build_array('prebid_datetime');
    end if;
    if nullif(btrim(coalesce(r.contact_name, '')), '') is null
       and nullif(btrim(coalesce(r.contact_email, '')), '') is null
       and nullif(btrim(coalesce(r.contact_phone, '')), '') is null then
      v_missing := v_missing || jsonb_build_array('procurement_contact');
    end if;

    v_status := case
      when v_summary is not null
       and v_requirements_available
       and nullif(btrim(coalesce(r.official_source_url, r.source_url, '')), '') is not null
       and r.response_deadline is not null
      then 'complete'
      else 'enrichment_required'
    end;

    v_capability := jsonb_build_object(
      'dna_version', 'natcorp_contract_dna_v2',
      'nomination_ready', v_status = 'complete',
      'scope_summary', coalesce(v_summary, 'Unavailable'),
      'stated_requirements', case
        when coalesce(r.requirements, '{}'::jsonb) <> '{}'::jsonb then r.requirements
        else jsonb_build_object('status', 'Unavailable')
      end,
      'business_acquisition_signals', jsonb_build_object(
        'keywords', to_jsonb(coalesce(r.keywords, '{}'::text[])),
        'naics_codes', to_jsonb(coalesce(r.naics_codes, '{}'::text[])),
        'nigp_codes', to_jsonb(coalesce(r.nigp_codes, '{}'::text[])),
        'unspsc_codes', to_jsonb(coalesce(r.unspsc_codes, '{}'::text[])),
        'commodity_codes', to_jsonb(coalesce(r.commodity_codes, '{}'::text[])),
        'procurement_type', coalesce(nullif(r.procurement_type, ''), 'Unavailable'),
        'notice_type', coalesce(nullif(r.notice_type, ''), 'Unavailable'),
        'set_asides', to_jsonb(coalesce(r.set_asides, '{}'::text[])),
        'certifications_required', to_jsonb(coalesce(r.certifications_required, '{}'::text[]))
      ),
      'performance', jsonb_build_object(
        'state', coalesce(nullif(r.place_of_performance_state, ''), r.state_code, 'Unavailable'),
        'county', case
          when nullif(btrim(coalesce(r.place_of_performance_county, '')), '') is null
            or btrim(coalesce(r.place_of_performance_county, '')) in ('(N/A)', 'N/A')
          then 'Unavailable'
          else r.place_of_performance_county
        end,
        'city', coalesce(nullif(r.place_of_performance_city, ''), 'Unavailable'),
        'zip', coalesce(nullif(r.place_of_performance_zip, ''), 'Unavailable'),
        'duration', v_duration
      ),
      'procurement_contact', jsonb_build_object(
        'name', coalesce(nullif(r.contact_name, ''), 'Unavailable'),
        'email', coalesce(nullif(r.contact_email, ''), 'Unavailable'),
        'phone', coalesce(nullif(r.contact_phone, ''), 'Unavailable')
      ),
      'procurement_timing', jsonb_build_object(
        'posted_at', coalesce(to_jsonb(r.posted_at), 'null'::jsonb),
        'response_deadline', coalesce(to_jsonb(r.response_deadline), 'null'::jsonb),
        'question_deadline', coalesce(to_jsonb(r.question_deadline), 'null'::jsonb),
        'prebid_datetime', coalesce(to_jsonb(r.prebid_datetime), 'null'::jsonb)
      ),
      'source', jsonb_build_object(
        'platform', coalesce(nullif(r.source_platform, ''), 'Unavailable'),
        'source_record_id', coalesce(nullif(r.source_record_id, ''), 'Unavailable'),
        'official_source_url', coalesce(nullif(r.official_source_url, ''), nullif(r.source_url, ''), 'Unavailable'),
        'vendor_registration_url', coalesce(nullif(r.vendor_registration_url, ''), 'Unavailable')
      ),
      'unavailable_details', v_missing
    );

    insert into piee.solicitation_profiles(
      opportunity_id,
      source_content_fingerprint,
      title,
      solicitation_number,
      agency,
      department,
      buyer,
      state_code,
      county,
      city,
      procurement_platform,
      procurement_method,
      contract_type,
      due_date,
      duration_text,
      estimated_value_min,
      estimated_value_max,
      buying_summary,
      buying_reason,
      required_capability_summary,
      extraction_method,
      extraction_confidence,
      extracted_at,
      updated_at
    ) values (
      r.id,
      r.content_fingerprint,
      coalesce(nullif(r.title, ''), 'Unavailable'),
      coalesce(nullif(r.solicitation_number, ''), 'Unavailable'),
      coalesce(nullif(r.issuing_organization, ''), 'Unavailable'),
      coalesce(nullif(r.issuing_department, ''), 'Unavailable'),
      coalesce(nullif(r.contact_name, ''), nullif(r.contact_email, ''), 'Unavailable'),
      coalesce(nullif(r.state_code, ''), 'Unavailable'),
      case
        when nullif(btrim(coalesce(r.place_of_performance_county, '')), '') is null
          or btrim(coalesce(r.place_of_performance_county, '')) in ('(N/A)', 'N/A')
        then 'Unavailable'
        else r.place_of_performance_county
      end,
      coalesce(nullif(r.place_of_performance_city, ''), 'Unavailable'),
      coalesce(nullif(r.source_platform, ''), 'Unavailable'),
      coalesce(nullif(r.procurement_type, ''), 'Unavailable'),
      coalesce(nullif(r.notice_type, ''), 'Unavailable'),
      r.response_deadline,
      v_duration,
      r.estimated_value_min,
      r.estimated_value_max,
      coalesce(v_summary, 'Unavailable'),
      case
        when v_summary is not null then 'Agency is seeking a business capable of performing the published scope; detailed unstated requirements remain unavailable until additional source material is acquired.'
        else 'Unavailable'
      end,
      v_capability::text,
      'natcorp_deterministic_v2',
      coalesce(r.extraction_confidence, 0.55),
      now(),
      now()
    )
    on conflict (opportunity_id) do update set
      source_content_fingerprint = excluded.source_content_fingerprint,
      title = excluded.title,
      solicitation_number = excluded.solicitation_number,
      agency = excluded.agency,
      department = excluded.department,
      buyer = excluded.buyer,
      state_code = excluded.state_code,
      county = excluded.county,
      city = excluded.city,
      procurement_platform = excluded.procurement_platform,
      procurement_method = excluded.procurement_method,
      contract_type = excluded.contract_type,
      due_date = excluded.due_date,
      duration_text = excluded.duration_text,
      estimated_value_min = excluded.estimated_value_min,
      estimated_value_max = excluded.estimated_value_max,
      buying_summary = excluded.buying_summary,
      buying_reason = excluded.buying_reason,
      required_capability_summary = excluded.required_capability_summary,
      extraction_method = excluded.extraction_method,
      extraction_confidence = excluded.extraction_confidence,
      extracted_at = now(),
      updated_at = now();

    update public.state_contract_opportunities
    set natcorp_contract_dna_status = v_status,
        natcorp_contract_dna_updated_at = now(),
        qa_status = case
          when v_status = 'enrichment_required' and qa_status not in ('verified','rejected') then 'enrichment_required'
          when v_status = 'complete' and qa_status = 'enrichment_required' then 'auto_ingested'
          else qa_status
        end,
        updated_at = now()
    where id = r.id;

    if v_status = 'complete' then
      v_complete := v_complete + 1;
    else
      v_enrichment := v_enrichment + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'contract_dna_completed', v_complete,
    'enrichment_required', v_enrichment,
    'dna_version', 'natcorp_contract_dna_v2'
  );
end;
$function$;

revoke all on function public.natcorp_build_contract_dna(uuid[]) from public;
revoke all on function public.natcorp_build_contract_dna(uuid[]) from anon;
revoke all on function public.natcorp_build_contract_dna(uuid[]) from authenticated;
grant execute on function public.natcorp_build_contract_dna(uuid[]) to service_role;
