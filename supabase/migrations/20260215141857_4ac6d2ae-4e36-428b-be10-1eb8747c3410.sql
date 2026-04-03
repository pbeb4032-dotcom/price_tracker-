
-- ============================================================
-- PATCH 1: Mark synthetic data
-- ============================================================
ALTER TABLE public.source_price_observations
  ADD COLUMN IF NOT EXISTS is_synthetic boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS synthetic_reason text;

CREATE TABLE IF NOT EXISTS public.source_domain_rules (
  domain text PRIMARY KEY,
  is_active boolean NOT NULL DEFAULT true,
  country_code text NOT NULL DEFAULT 'IQ',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.source_domain_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Domain rules publicly readable"
  ON public.source_domain_rules FOR SELECT USING (true);
CREATE POLICY "Admins can manage domain rules"
  ON public.source_domain_rules FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

INSERT INTO public.source_domain_rules(domain)
SELECT DISTINCT lower(domain) FROM public.price_sources
WHERE domain IS NOT NULL
  AND domain !~* '(local\.test|localhost|127\.0\.0\.1|example\.com)'
ON CONFLICT (domain) DO NOTHING;

-- ============================================================
-- PATCH 2: Drop view FIRST, then create mat view, then recreate view
-- ============================================================
DROP VIEW IF EXISTS public.v_best_offers_ui;
DROP MATERIALIZED VIEW IF EXISTS public.product_price_snapshot_v3;

CREATE MATERIALIZED VIEW public.product_price_snapshot_v3 AS
WITH valid AS (
  SELECT s.product_id, s.normalized_price_iqd::numeric AS price_iqd
  FROM public.source_price_observations s
  WHERE COALESCE(s.normalized_price_iqd, 0) > 0
    AND COALESCE(s.is_price_anomaly, false) = false
    AND COALESCE(s.is_synthetic, false) = false
),
stats AS (
  SELECT product_id,
    percentile_cont(0.25) WITHIN GROUP (ORDER BY price_iqd) AS p25,
    percentile_cont(0.50) WITHIN GROUP (ORDER BY price_iqd) AS p50,
    percentile_cont(0.75) WITHIN GROUP (ORDER BY price_iqd) AS p75,
    count(*)::int AS samples
  FROM valid GROUP BY product_id
),
scored AS (
  SELECT v.product_id, v.price_iqd, s.p25, s.p50, s.p75, s.samples,
    (s.p75 - s.p25) AS iqr
  FROM valid v JOIN stats s ON s.product_id = v.product_id
)
SELECT product_id,
  ROUND(MAX(p50))::bigint AS display_iqd,
  MIN(price_iqd) FILTER (WHERE price_iqd >= (p25 - 1.5*iqr) AND price_iqd <= (p75 + 1.5*iqr))::bigint AS low_iqd_safe,
  MAX(price_iqd) FILTER (WHERE price_iqd >= (p25 - 1.5*iqr) AND price_iqd <= (p75 + 1.5*iqr))::bigint AS high_iqd_safe,
  MAX(samples)::int AS samples,
  CASE WHEN MAX(samples) >= 3 AND MAX(p25) > 0 AND (MAX(p75)/MAX(p25)) <= 2.20 THEN true ELSE false END AS is_trusted
FROM scored GROUP BY product_id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_pps_v3_product ON public.product_price_snapshot_v3(product_id);
GRANT SELECT ON public.product_price_snapshot_v3 TO anon, authenticated;

-- Recreate the view with new columns
CREATE VIEW public.v_best_offers_ui AS
SELECT b.*,
  CASE WHEN s.is_trusted THEN s.display_iqd::numeric ELSE NULL END AS final_price_safe,
  CASE WHEN s.is_trusted THEN s.low_iqd_safe::numeric ELSE NULL END AS low_price_safe,
  CASE WHEN s.is_trusted THEN s.high_iqd_safe::numeric ELSE NULL END AS high_price_safe,
  s.display_iqd::numeric AS median_iqd_safe,
  s.samples AS price_samples,
  (SELECT pi.image_url FROM public.product_images pi
   WHERE pi.product_id = b.product_id AND pi.is_verified = true
     AND pi.image_url !~* '(picsum\.photos|placehold|placeholder|dummyimage|fakeimg|source\.unsplash\.com)'
   ORDER BY pi.is_primary DESC, pi.confidence_score DESC, pi.position ASC LIMIT 1
  ) AS product_image_url_safe
FROM public.v_best_offers b
LEFT JOIN public.product_price_snapshot_v3 s ON s.product_id = b.product_id;

ALTER VIEW public.v_best_offers_ui SET (security_invoker = on);
GRANT SELECT ON public.v_best_offers_ui TO anon, authenticated;

-- ============================================================
-- PATCH 3: Crawl frontier table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.crawl_frontier (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_domain text NOT NULL,
  url text NOT NULL,
  url_hash text GENERATED ALWAYS AS (md5(lower(url))) STORED,
  status text NOT NULL DEFAULT 'pending',
  last_error text,
  discovered_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_crawl_frontier_url_hash ON public.crawl_frontier(url_hash);
CREATE INDEX IF NOT EXISTS idx_crawl_frontier_status ON public.crawl_frontier(status, discovered_at);

ALTER TABLE public.crawl_frontier ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Crawl frontier publicly readable" ON public.crawl_frontier FOR SELECT USING (true);
CREATE POLICY "Admins can manage crawl frontier" ON public.crawl_frontier FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));

CREATE OR REPLACE FUNCTION public.validate_crawl_frontier_status()
  RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.status NOT IN ('pending','processing','done','failed') THEN
    RAISE EXCEPTION 'Invalid crawl_frontier status: %', NEW.status;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_validate_crawl_frontier_status
  BEFORE INSERT OR UPDATE ON public.crawl_frontier
  FOR EACH ROW EXECUTE FUNCTION public.validate_crawl_frontier_status();
