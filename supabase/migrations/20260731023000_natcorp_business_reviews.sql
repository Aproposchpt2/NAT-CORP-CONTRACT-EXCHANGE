begin;

create table if not exists public.natcorp_business_reviews (
  review_id uuid primary key default gen_random_uuid(),
  business_name text not null,
  contact_name text,
  contact_email text not null,
  opportunity_reference text,
  rating smallint,
  review_text text not null,
  consent_to_publish boolean not null default false,
  status text not null default 'pending',
  source text not null default 'opportunity_services_page',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint natcorp_business_reviews_rating_ck check (rating is null or rating between 1 and 5),
  constraint natcorp_business_reviews_status_ck check (status in ('pending','approved','rejected','archived'))
);

create index if not exists natcorp_business_reviews_status_created_idx
  on public.natcorp_business_reviews (status, created_at desc);

alter table public.natcorp_business_reviews enable row level security;
revoke all on table public.natcorp_business_reviews from public, anon, authenticated;
grant select, insert, update, delete on table public.natcorp_business_reviews to service_role;

comment on table public.natcorp_business_reviews is
  'NAT-CORP business feedback submitted through the external Opportunity Services page. Reviews are moderated and never auto-published.';

commit;
