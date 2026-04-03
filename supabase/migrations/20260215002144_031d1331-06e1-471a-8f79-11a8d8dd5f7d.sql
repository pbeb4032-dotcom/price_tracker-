
-- D.1: Historical price chart — SQL function + index
-- Additive only, no destructive changes

-- World-scale: keep long-term history as daily rollups (raw rows can be retained short-term)
CREATE TABLE IF NOT EXISTS public.app_settings (
  key text PRIMARY KEY,
  value text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.source_price_rollups_daily (
  day date NOT NULL,
  source_id uuid NOT NULL REFERENCES public.price_sources(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  region_id uuid NOT NULL REFERENCES public.regions(id) ON DELETE CASCADE,
  product_condition text NOT NULL DEFAULT 'new',
  unit text,
  min_final_price numeric,
  max_final_price numeric,
  avg_final_price numeric,
  min_effective_price numeric,
  max_effective_price numeric,
  avg_effective_price numeric,
  sample_count int NOT NULL DEFAULT 0,
  in_stock_count int NOT NULL DEFAULT 0,
  first_observed_at timestamptz,
  last_observed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (day, source_id, product_id, region_id, product_condition, unit)
);

CREATE INDEX IF NOT EXISTS idx_sprd_product_day ON public.source_price_rollups_daily(product_id, day DESC);
CREATE INDEX IF NOT EXISTS idx_sprd_product_region_day ON public.source_price_rollups_daily(product_id, region_id, day DESC);

-- Performance index for product + time range lookups
CREATE INDEX IF NOT EXISTS idx_spo_product_observed
  ON public.source_price_observations (product_id, observed_at DESC);

CREATE INDEX IF NOT EXISTS idx_spo_product_region_observed
  ON public.source_price_observations (product_id, region_id, observed_at DESC);

-- Function: daily price history for a product
CREATE OR REPLACE FUNCTION public.get_product_price_history(
  p_product_id uuid,
  p_days int DEFAULT 90,
  p_region_id uuid DEFAULT NULL,
  p_include_delivery boolean DEFAULT false
)
RETURNS TABLE (
  day date,
  min_price numeric,
  max_price numeric,
  avg_price numeric,
  offer_count int,
  source_count int
)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  WITH
  raw AS (
    SELECT
      (o.observed_at AT TIME ZONE 'Asia/Baghdad')::date AS day,
      MIN(
        CASE WHEN p_include_delivery
          THEN (COALESCE(o.discount_price, o.price) + COALESCE(o.delivery_fee, 0))
          ELSE COALESCE(o.discount_price, o.price)
        END
      ) AS min_price,
      MAX(
        CASE WHEN p_include_delivery
          THEN (COALESCE(o.discount_price, o.price) + COALESCE(o.delivery_fee, 0))
          ELSE COALESCE(o.discount_price, o.price)
        END
      ) AS max_price,
      ROUND(AVG(
        CASE WHEN p_include_delivery
          THEN (COALESCE(o.discount_price, o.price) + COALESCE(o.delivery_fee, 0))
          ELSE COALESCE(o.discount_price, o.price)
        END
      ), 0) AS avg_price,
      COUNT(*)::int AS offer_count,
      COUNT(DISTINCT o.source_id)::int AS source_count
    FROM public.source_price_observations o
    WHERE o.product_id = p_product_id
      AND o.observed_at >= (now() - (p_days || ' days')::interval)
      AND (p_region_id IS NULL OR o.region_id = p_region_id)
      AND COALESCE(o.discount_price, o.price) > 0
      AND COALESCE(o.discount_price, o.price) < 500000000
    GROUP BY (o.observed_at AT TIME ZONE 'Asia/Baghdad')::date
  ),
  roll AS (
    SELECT
      r.day,
      MIN(CASE WHEN p_include_delivery THEN r.min_effective_price ELSE r.min_final_price END) AS min_price,
      MAX(CASE WHEN p_include_delivery THEN r.max_effective_price ELSE r.max_final_price END) AS max_price,
      ROUND(AVG(CASE WHEN p_include_delivery THEN r.avg_effective_price ELSE r.avg_final_price END), 0) AS avg_price,
      SUM(r.sample_count)::int AS offer_count,
      COUNT(DISTINCT r.source_id)::int AS source_count
    FROM public.source_price_rollups_daily r
    WHERE r.product_id = p_product_id
      AND r.day >= ((now() AT TIME ZONE 'Asia/Baghdad')::date - (p_days::int))
      AND (p_region_id IS NULL OR r.region_id = p_region_id)
    GROUP BY r.day
  ),
  merged AS (
    SELECT
      COALESCE(raw.day, roll.day) AS day,
      CASE WHEN raw.day IS NOT NULL THEN raw.min_price ELSE roll.min_price END AS min_price,
      CASE WHEN raw.day IS NOT NULL THEN raw.max_price ELSE roll.max_price END AS max_price,
      CASE WHEN raw.day IS NOT NULL THEN raw.avg_price ELSE roll.avg_price END AS avg_price,
      CASE WHEN raw.day IS NOT NULL THEN raw.offer_count ELSE roll.offer_count END AS offer_count,
      CASE WHEN raw.day IS NOT NULL THEN raw.source_count ELSE roll.source_count END AS source_count
    FROM roll
    FULL OUTER JOIN raw ON raw.day = roll.day
  )
  SELECT * FROM merged
  ORDER BY day ASC;
$$;
