-- Quarantine queue for suspicious parsed prices (admin review workflow)

create table if not exists public.price_anomaly_quarantine (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'pending' check (status in ('pending','approved','rejected','ignored')),
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  reviewed_at timestamptz,

  product_id uuid,
  source_id uuid,
  source_domain text,
  source_name text,
  product_name text,
  product_url text,

  raw_price text,
  parsed_price numeric,
  currency text,
  reason_code text,
  reason_detail text,
  observed_payload jsonb
);

create index if not exists idx_price_anomaly_quarantine_status_created
  on public.price_anomaly_quarantine(status, created_at desc);

create index if not exists idx_price_anomaly_quarantine_product_id
  on public.price_anomaly_quarantine(product_id);
