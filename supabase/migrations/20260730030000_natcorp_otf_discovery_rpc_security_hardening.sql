-- NAT-CORP Opportunity-to-Fulfillment internal RPC security hardening.
-- Business discovery orchestration is service-side only; no public client may
-- create discovery commands, persist external-search candidates, or select them.

begin;

revoke all on function public.natcorp_create_business_discovery_command(uuid) from public, anon, authenticated;
grant execute on function public.natcorp_create_business_discovery_command(uuid) to service_role;

revoke all on function public.natcorp_record_business_discovery_candidates(uuid,jsonb) from public, anon, authenticated;
grant execute on function public.natcorp_record_business_discovery_candidates(uuid,jsonb) to service_role;

revoke all on function public.natcorp_select_business_discovery_candidate(uuid,uuid) from public, anon, authenticated;
grant execute on function public.natcorp_select_business_discovery_candidate(uuid,uuid) to service_role;

commit;
