-- Watchlist + Alerts + Trust Graph (dynamic trust) additions

alter table public.price_sources
  add column if not exists trust_weight_dynamic numeric(3,2),
  add column if not exists trust_last_scored_at timestamptz,
  add column if not exists trust_score_meta jsonb;

alter table public.alerts
  add column if not exists include_delivery boolean not null default false;

create index if not exists idx_alerts_user_active
  on public.alerts (user_id, is_active) where is_active = true;

