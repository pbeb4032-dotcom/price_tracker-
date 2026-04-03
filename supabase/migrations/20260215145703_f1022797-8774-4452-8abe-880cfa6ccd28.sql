
-- =========================================================
-- A) View: always show all prices + quality label
-- =========================================================
CREATE OR REPLACE VIEW public.v_best_offers_ui AS
WITH sample_stats AS (
  SELECT
    so.product_id,
    COUNT(*) FILTER (
      WHERE COALESCE(so.is_synthetic,false) = false
        AND COALESCE(so.is_price_anomaly,false) = false
    )::int AS real_valid_samples,
    COUNT(*) FILTER (WHERE COALESCE(so.is_synthetic,false) = true)::int AS synthetic_samples,
    MAX(so.observed_at) AS last_observed_at
  FROM public.source_price_observations so
  GROUP BY so.product_id
)
SELECT
  b.*,
  COALESCE(s.display_iqd::numeric, b.final_price) AS display_price_iqd,
  (COALESCE(s.is_trusted,false) AND COALESCE(ss.real_valid_samples,0) >= 2) AS is_price_trusted,
  CASE
    WHEN (COALESCE(s.is_trusted,false) AND COALESCE(ss.real_valid_samples,0) >= 2) THEN 'trusted'
    WHEN COALESCE(ss.real_valid_samples,0) >= 1 THEN 'provisional'
    ELSE 'synthetic'
  END AS price_quality,
  COALESCE(ss.real_valid_samples,0) AS price_samples,
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
  ) AS product_image_url_safe,
  ss.last_observed_at
FROM public.v_best_offers b
LEFT JOIN public.product_price_snapshot_v3 s ON s.product_id = b.product_id
LEFT JOIN sample_stats ss ON ss.product_id = b.product_id;

ALTER VIEW public.v_best_offers_ui SET (security_invoker = false);
GRANT SELECT ON public.v_best_offers_ui TO anon, authenticated;

-- =========================================================
-- B) Domain config tables
-- =========================================================
CREATE TABLE IF NOT EXISTS public.source_entrypoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain text NOT NULL,
  url text NOT NULL,
  page_type text NOT NULL DEFAULT 'category',
  priority int NOT NULL DEFAULT 100,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (domain, url)
);

ALTER TABLE public.source_entrypoints ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage entrypoints"
  ON public.source_entrypoints FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Entrypoints publicly readable"
  ON public.source_entrypoints FOR SELECT
  USING (true);

CREATE TABLE IF NOT EXISTS public.domain_url_patterns (
  domain text PRIMARY KEY,
  product_regex text NOT NULL,
  category_regex text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.domain_url_patterns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage domain patterns"
  ON public.domain_url_patterns FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Domain patterns publicly readable"
  ON public.domain_url_patterns FOR SELECT
  USING (true);

-- crawl_frontier metadata columns
ALTER TABLE public.crawl_frontier
  ADD COLUMN IF NOT EXISTS http_status int,
  ADD COLUMN IF NOT EXISTS content_type text,
  ADD COLUMN IF NOT EXISTS fetch_ms int,
  ADD COLUMN IF NOT EXISTS blocked_reason text;
