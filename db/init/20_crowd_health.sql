-- ============================================================
-- Crowd signals (offer reports) + Source health (auto-disable)
-- Added: 2026-02-27
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- crawl_frontier columns needed by jobs (some older schemas missed these)
ALTER TABLE public.crawl_frontier
  ADD COLUMN IF NOT EXISTS page_type text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS depth int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS parent_url text NULL;

-- -----------------------------
-- 1) Crowd signals: offer_reports
-- -----------------------------

CREATE TABLE IF NOT EXISTS public.offer_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id uuid NOT NULL REFERENCES public.source_price_observations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  report_type text NOT NULL CHECK (report_type IN ('wrong_price','unavailable','duplicate','other')),
  severity int NOT NULL DEFAULT 2 CHECK (severity BETWEEN 1 AND 5),
  note text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (offer_id, user_id, report_type)
);

CREATE INDEX IF NOT EXISTS idx_offer_reports_offer_id ON public.offer_reports(offer_id);
CREATE INDEX IF NOT EXISTS idx_offer_reports_created_at ON public.offer_reports(created_at DESC);

-- Aggregation view (used by API / UI)
CREATE OR REPLACE VIEW public.v_offer_reports_agg
WITH (security_invoker = on) AS
SELECT
  offer_id,
  count(*)::int AS reports_total,
  sum(CASE WHEN report_type='wrong_price' THEN 1 ELSE 0 END)::int AS wrong_price,
  sum(CASE WHEN report_type='unavailable' THEN 1 ELSE 0 END)::int AS unavailable,
  sum(CASE WHEN report_type='duplicate' THEN 1 ELSE 0 END)::int AS duplicate,
  sum(CASE WHEN report_type='other' THEN 1 ELSE 0 END)::int AS other,
  max(created_at) AS last_reported_at,
  LEAST(
    0.60,
    (
      sum(CASE WHEN report_type='wrong_price' THEN 1 ELSE 0 END) * 0.15
      + sum(CASE WHEN report_type='unavailable' THEN 1 ELSE 0 END) * 0.10
      + sum(CASE WHEN report_type='duplicate' THEN 1 ELSE 0 END) * 0.08
      + sum(CASE WHEN report_type='other' THEN 1 ELSE 0 END) * 0.05
    )
  )::numeric(3,2) AS penalty
FROM public.offer_reports
WHERE created_at >= now() - interval '30 days'
GROUP BY offer_id;

-- -----------------------------
-- 2) Source health: auto-disable columns
-- -----------------------------

ALTER TABLE public.price_sources
  ADD COLUMN IF NOT EXISTS auto_disabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_disabled_forced_inactive boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_disabled_reason text NULL,
  ADD COLUMN IF NOT EXISTS auto_disabled_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS auto_recovered_at timestamptz NULL;

-- Ensure v_product_all_offers exposes anomaly/confidence fields (backward compatible for SELECT *)
CREATE OR REPLACE VIEW public.v_product_all_offers
WITH (security_invoker = on) AS
SELECT
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
  COALESCE(spo.discount_price, spo.price) as final_price,
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
FROM public.source_price_observations spo
JOIN public.products p ON spo.product_id = p.id
JOIN public.regions r ON spo.region_id = r.id
JOIN public.price_sources ps ON spo.source_id = ps.id
WHERE p.is_active = true
  AND p.condition = 'new'
  AND spo.product_condition = 'new'
ORDER BY COALESCE(spo.discount_price, spo.price) ASC, spo.observed_at DESC;

-- Hotfix14: ingestion auto-disable schema (bot challenge protection)
ALTER TABLE public.price_sources
  ADD COLUMN IF NOT EXISTS auto_disabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_disabled_reason text,
  ADD COLUMN IF NOT EXISTS auto_disabled_at timestamptz,
  ADD COLUMN IF NOT EXISTS consecutive_bot_challenges int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_bot_challenge_at timestamptz;
