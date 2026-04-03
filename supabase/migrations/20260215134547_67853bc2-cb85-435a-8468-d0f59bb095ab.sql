
-- Drop existing view first to allow column type change
DROP VIEW IF EXISTS public.v_best_offers_ui;

-- Create the v2 trusted price snapshot with IQR + trust flag
DROP MATERIALIZED VIEW IF EXISTS public.product_price_snapshot_v2;

CREATE MATERIALIZED VIEW public.product_price_snapshot_v2 AS
WITH valid AS (
  SELECT
    s.product_id,
    s.normalized_price_iqd::numeric AS price_iqd
  FROM public.source_price_observations s
  WHERE COALESCE(s.normalized_price_iqd, 0) > 0
    AND COALESCE(s.is_price_anomaly, false) = false
),
stats AS (
  SELECT
    product_id,
    percentile_cont(0.25) WITHIN GROUP (ORDER BY price_iqd) AS p25,
    percentile_cont(0.50) WITHIN GROUP (ORDER BY price_iqd) AS median_iqd,
    percentile_cont(0.75) WITHIN GROUP (ORDER BY price_iqd) AS p75,
    count(*) AS samples
  FROM valid
  GROUP BY product_id
),
iqr_rows AS (
  SELECT
    v.product_id,
    v.price_iqd,
    s.p25, s.p75, s.median_iqd, s.samples,
    (s.p75 - s.p25) AS iqr
  FROM valid v
  JOIN stats s ON s.product_id = v.product_id
),
agg AS (
  SELECT
    product_id,
    MIN(price_iqd) FILTER (
      WHERE price_iqd >= (p25 - 1.5 * iqr)
        AND price_iqd <= (p75 + 1.5 * iqr)
    )::bigint AS display_iqd,
    ROUND(MAX(median_iqd))::bigint AS median_iqd,
    MAX(samples)::int AS samples,
    MAX(p25) AS p25,
    MAX(p75) AS p75
  FROM iqr_rows
  GROUP BY product_id
)
SELECT
  a.product_id,
  a.display_iqd,
  a.median_iqd,
  a.samples,
  CASE
    WHEN a.samples >= 3
     AND a.display_iqd IS NOT NULL
     AND a.p25 > 0
     AND (a.p75 / a.p25) <= 2.20
    THEN true
    ELSE false
  END AS is_trusted
FROM agg a;

CREATE UNIQUE INDEX idx_pps_v2_product
  ON public.product_price_snapshot_v2(product_id);

GRANT SELECT ON public.product_price_snapshot_v2 TO anon, authenticated;

-- Rebuild v_best_offers_ui with v2 snapshot + trust gate
CREATE VIEW public.v_best_offers_ui AS
SELECT
  b.*,
  CASE WHEN s.is_trusted THEN s.display_iqd ELSE NULL END AS final_price_safe,
  s.median_iqd AS median_iqd_safe,
  s.samples AS price_samples,
  (
    SELECT pi.image_url
    FROM public.product_images pi
    WHERE pi.product_id = b.product_id
      AND pi.is_verified = true
    ORDER BY pi.is_primary DESC, pi.confidence_score DESC, pi.position ASC
    LIMIT 1
  ) AS product_image_url_safe
FROM public.v_best_offers b
LEFT JOIN public.product_price_snapshot_v2 s
  ON s.product_id = b.product_id;

ALTER VIEW public.v_best_offers_ui SET (security_invoker = on);
GRANT SELECT ON public.v_best_offers_ui TO anon, authenticated;
