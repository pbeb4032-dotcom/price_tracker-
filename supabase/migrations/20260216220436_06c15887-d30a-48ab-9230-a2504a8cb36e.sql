
-- ============================================================
-- P3.1: source_adapters table
-- ============================================================
CREATE TABLE public.source_adapters (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  source_id uuid NOT NULL REFERENCES public.price_sources(id),
  adapter_type text NOT NULL CHECK (adapter_type IN ('jsonld','meta','dom','api')),
  selectors jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  priority int NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_source_adapters_source_id ON public.source_adapters(source_id);
CREATE INDEX idx_source_adapters_active ON public.source_adapters(is_active, priority);

ALTER TABLE public.source_adapters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage source adapters"
  ON public.source_adapters FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Source adapters publicly readable"
  ON public.source_adapters FOR SELECT
  USING (true);

CREATE TRIGGER update_source_adapters_updated_at
  BEFORE UPDATE ON public.source_adapters
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Seed baseline adapters for any existing Iraqi sources (safe on fresh DB)
-- (Previously this migration used hard-coded UUIDs from one environment.)
INSERT INTO public.source_adapters (source_id, adapter_type, priority, selectors)
SELECT
  ps.id,
  'jsonld',
  10,
  '{
    "productName": ["jsonld.name", "meta:og:title", "css:h1"],
    "description": ["jsonld.description", "meta:og:description", "meta:description"],
    "price": ["jsonld.offers.price", "jsonld.offers.lowPrice", "meta:product:price:amount"],
    "currency": ["jsonld.offers.priceCurrency", "meta:product:price:currency"],
    "image": ["jsonld.image", "meta:og:image"],
    "inStock": ["jsonld.offers.availability"]
  }'::jsonb
FROM public.price_sources ps
WHERE ps.country_code = 'IQ'
  AND NOT EXISTS (
    SELECT 1 FROM public.source_adapters sa
    WHERE sa.source_id = ps.id AND sa.adapter_type = 'jsonld'
  );

-- ============================================================
-- P3.2: crawl_frontier improvements
-- ============================================================
ALTER TABLE public.crawl_frontier
  ADD COLUMN IF NOT EXISTS retry_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_retry_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS content_hash text,
  ADD COLUMN IF NOT EXISTS discovered_from text,
  ADD COLUMN IF NOT EXISTS canonical_url text;

CREATE INDEX IF NOT EXISTS idx_crawl_frontier_next_retry ON public.crawl_frontier(status, next_retry_at)
  WHERE status = 'pending';

-- ============================================================
-- P3.6: search_queries latency tracking
-- ============================================================
ALTER TABLE public.search_queries
  ADD COLUMN IF NOT EXISTS avg_latency_ms numeric DEFAULT 0;

-- ============================================================
-- P3.8: ingestion_runs observability table
-- ============================================================
CREATE TABLE public.ingestion_runs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  run_id text NOT NULL,
  function_name text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','success','partial','failed')),
  processed int NOT NULL DEFAULT 0,
  succeeded int NOT NULL DEFAULT 0,
  failed int NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ingestion_runs_function ON public.ingestion_runs(function_name, started_at DESC);
CREATE INDEX idx_ingestion_runs_status ON public.ingestion_runs(status);

ALTER TABLE public.ingestion_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage ingestion runs"
  ON public.ingestion_runs FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Ingestion runs publicly readable"
  ON public.ingestion_runs FOR SELECT
  USING (true);

-- ============================================================
-- P3.8: Admin summary RPC
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_ingestion_dashboard()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object(
    'real_observations_24h', (
      SELECT count(*) FROM source_price_observations
      WHERE is_synthetic = false AND created_at >= now() - interval '24 hours'
    ),
    'failed_frontier_items', (
      SELECT count(*) FROM crawl_frontier WHERE status = 'failed'
    ),
    'verified_images', (
      SELECT count(*) FROM product_images WHERE is_verified = true
    ),
    'trusted_offers', (
      SELECT count(*) FROM product_price_snapshot_v3 WHERE is_trusted = true
    ),
    'total_products', (
      SELECT count(*) FROM products WHERE is_active = true
    ),
    'recent_runs', (
      SELECT coalesce(jsonb_agg(row_to_json(r)::jsonb), '[]'::jsonb)
      FROM (
        SELECT function_name, status, processed, succeeded, failed, started_at, ended_at
        FROM ingestion_runs ORDER BY started_at DESC LIMIT 10
      ) r
    )
  );
$$;
