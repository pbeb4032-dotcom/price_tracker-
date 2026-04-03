-- Crowd signals (offer reports) + Source health (auto-disable)

create extension if not exists pgcrypto;

-- crawl_frontier columns used by ingestion/seed jobs
alter table public.crawl_frontier
  add column if not exists page_type text not null default 'unknown',
  add column if not exists depth int not null default 0,
  add column if not exists parent_url text null;

-- 1) offer_reports
create table if not exists public.offer_reports (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references public.source_price_observations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  report_type text not null check (report_type in ('wrong_price','unavailable','duplicate','other')),
  severity int not null default 2 check (severity between 1 and 5),
  note text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (offer_id, user_id, report_type)
);

create index if not exists idx_offer_reports_offer_id on public.offer_reports(offer_id);
create index if not exists idx_offer_reports_created_at on public.offer_reports(created_at desc);

create or replace view public.v_offer_reports_agg
with (security_invoker = on) as
select
  offer_id,
  count(*)::int as reports_total,
  sum(case when report_type='wrong_price' then 1 else 0 end)::int as wrong_price,
  sum(case when report_type='unavailable' then 1 else 0 end)::int as unavailable,
  sum(case when report_type='duplicate' then 1 else 0 end)::int as duplicate,
  sum(case when report_type='other' then 1 else 0 end)::int as other,
  max(created_at) as last_reported_at,
  least(
    0.60,
    (
      sum(case when report_type='wrong_price' then 1 else 0 end) * 0.15
      + sum(case when report_type='unavailable' then 1 else 0 end) * 0.10
      + sum(case when report_type='duplicate' then 1 else 0 end) * 0.08
      + sum(case when report_type='other' then 1 else 0 end) * 0.05
    )
  )::numeric(3,2) as penalty
from public.offer_reports
where created_at >= now() - interval '30 days'
group by offer_id;

-- 2) price_sources auto-disable columns
alter table public.price_sources
  add column if not exists auto_disabled boolean not null default false,
  add column if not exists auto_disabled_forced_inactive boolean not null default false,
  add column if not exists auto_disabled_reason text null,
  add column if not exists auto_disabled_at timestamptz null,
  add column if not exists auto_recovered_at timestamptz null;

-- Ensure v_product_all_offers exposes anomaly/confidence fields
create or replace view public.v_product_all_offers
with (security_invoker = on) as
select
  spo.id as offer_id,
  spo.product_id,
  p.name_ar as product_name_ar,
  p.name_en as product_name_en,
  p.image_url as product_image_url,
  p.category,
  p.unit,
  p.brand_ar,
  p.brand_en,
  spo.price as base_price,
  spo.discount_price,
  coalesce(spo.discount_price, spo.price) as final_price,
  spo.delivery_fee,
  spo.currency,
  spo.in_stock,
  spo.source_url,
  spo.merchant_name,
  spo.observed_at,
  spo.region_id,
  r.name_ar as region_name_ar,
  r.name_en as region_name_en,
  ps.name_ar as source_name_ar,
  ps.domain as source_domain,
  ps.logo_url as source_logo_url,
  ps.source_kind,
  spo.source_id,
  spo.is_verified,
  spo.raw_price_text,
  spo.normalized_price_iqd,
  spo.is_price_anomaly,
  spo.anomaly_reason,
  spo.price_confidence
from public.source_price_observations spo
join public.products p on spo.product_id = p.id
join public.regions r on spo.region_id = r.id
join public.price_sources ps on spo.source_id = ps.id
where p.is_active = true
  and p.condition = 'new'
  and spo.product_condition = 'new'
order by coalesce(spo.discount_price, spo.price) asc, spo.observed_at desc;
