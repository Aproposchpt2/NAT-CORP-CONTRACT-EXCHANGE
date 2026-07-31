alter table public.natcorp_service_requests
  drop constraint if exists natcorp_service_requests_service_type_check;

alter table public.natcorp_service_requests
  add constraint natcorp_service_requests_service_type_check
  check (
    service_type = any (
      array[
        'ANALYZE_FIT'::text,
        'PROPOSAL_DEVELOPMENT'::text,
        'CONTRACT_PROPOSAL_DEVELOPMENT'::text,
        'CONTRACTOR_REPOSITORY_SUBSCRIPTION'::text
      ]
    )
  );
