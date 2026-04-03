
-- PATCH 1: Recreate v_best_offers_ui — never hide products, show quality level
DROP VIEW IF EXISTS public.v_best_offers_ui;

CREATE VIEW public.v_best_offers_ui AS
WITH sample_stats AS (
  SELECT
    so.product_id,
    COUNT(*) FILTER (
      WHERE COALESCE(so.is_synthetic, false) = false
        AND COALESCE(so.is_price_anomaly, false) = false
        AND COALESCE(so.normalized_price_iqd, 0) > 0
    )::int AS real_valid_samples,
    COUNT(*) FILTER (WHERE COALESCE(so.is_synthetic, false) = true)::int AS synthetic_samples,
    MAX(so.observed_at) AS last_observed_at
  FROM public.source_price_observations so
  GROUP BY so.product_id
)
SELECT
  b.*,

  /* Always show a price — fallback to raw final_price when no trusted snapshot */
  COALESCE(s.display_iqd::numeric, b.final_price) AS display_price_iqd,

  /* Real trust flag */
  (COALESCE(s.is_trusted, false) AND COALESCE(ss.real_valid_samples, 0) >= 2) AS is_price_trusted,

  CASE
    WHEN (COALESCE(s.is_trusted, false) AND COALESCE(ss.real_valid_samples, 0) >= 2) THEN 'trusted'
    WHEN COALESCE(ss.real_valid_samples, 0) >= 1 THEN 'provisional'
    ELSE 'synthetic'
  END AS price_quality,

  COALESCE(ss.real_valid_samples, 0) AS price_samples,

  COALESCE(s.low_iqd_safe::numeric, b.final_price)  AS low_price_safe,
  COALESCE(s.high_iqd_safe::numeric, b.final_price) AS high_price_safe,

  (
    SELECT pi.image_url
    FROM public.product_images pi
    WHERE pi.product_id = b.product_id
      AND pi.is_verified = true
      AND pi.image_url !~* '(picsum\.photos|placehold|placeholder|dummyimage|fakeimg|source\.unsplash\.com)'
    ORDER BY pi.is_primary DESC, pi.confidence_score DESC, pi.position ASC
    LIMIT 1
  ) AS product_image_url_safe

FROM public.v_best_offers b
LEFT JOIN public.product_price_snapshot_v3 s ON s.product_id = b.product_id
LEFT JOIN sample_stats ss ON ss.product_id = b.product_id;

ALTER VIEW public.v_best_offers_ui SET (security_invoker = on);
GRANT SELECT ON public.v_best_offers_ui TO anon, authenticated;

-- PATCH 4.1: Add crawl frontier columns for deeper discovery
ALTER TABLE public.crawl_frontier
  ADD COLUMN IF NOT EXISTS page_type text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS depth int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS parent_url text,
  ADD COLUMN IF NOT EXISTS last_crawled_at timestamptz;
