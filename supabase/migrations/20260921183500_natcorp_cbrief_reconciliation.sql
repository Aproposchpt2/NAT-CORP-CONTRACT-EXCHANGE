-- Cross-project reconciliation between the legacy NAT-CORP opportunity inventory
-- and the canonical CBrief contract inventory.
-- Diagnostic/crosswalk table only. It does not alter contract lifecycle rows.

create table if not exists public.natcorp_cbrief_reconciliation (
  natcorp_opportunity_id uuid primary key references public.state_contract_opportunities(id) on delete cascade,
  cbrief_opportunity_id uuid,
  state_code text not null,
  title text not null,
  solicitation_number text,
  response_deadline timestamptz,
  reconciliation_status text not null check (
    reconciliation_status in (
      'CURRENT_DUPLICATE',
      'EXPIRED_DUPLICATE',
      'CURRENT_UNMATCHED',
      'EXPIRED_NOT_IN_CBRIEF'
    )
  ),
  match_method text,
  reconciled_at timestamptz not null default now()
);

create index if not exists natcorp_cbrief_reconciliation_cbrief_idx
  on public.natcorp_cbrief_reconciliation(cbrief_opportunity_id)
  where cbrief_opportunity_id is not null;

create index if not exists natcorp_cbrief_reconciliation_status_idx
  on public.natcorp_cbrief_reconciliation(reconciliation_status,state_code);

comment on table public.natcorp_cbrief_reconciliation is
'Cross-project reconciliation between NAT-CORP state_contract_opportunities and the canonical CBrief inventory. Diagnostic/crosswalk data only; contract lifecycle records are not mutated.';
