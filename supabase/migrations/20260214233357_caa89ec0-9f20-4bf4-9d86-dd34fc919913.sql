
-- ============================================================
-- Iraq Product & Price Collector — Data Foundation Migration
-- Extends existing tables + creates ingestion tracking + views
-- Fully reversible: DROP columns/tables/views/function/extension
-- ============================================================

-- 0) Enable pg_trgm for fuzzy search (Arabic + English)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================================================
-- 1) Extend products table for product identity
-- ============================================================
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS barcode text,
  ADD COLUMN IF NOT EXISTS brand_ar text,
  ADD COLUMN IF NOT EXISTS brand_en text,
  ADD COLUMN IF NOT EXISTS size_value numeric,
  ADD COLUMN IF NOT EXISTS size_unit text,
  ADD COLUMN IF NOT EXISTS condition text NOT NULL DEFAULT 'new';

CREATE INDEX IF NOT EXISTS idx_products_barcode ON public.products (barcode) WHERE barcode IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_products_condition ON public.products (condition);
CREATE INDEX IF NOT EXISTS idx_products_category_active ON public.products (category) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_products_name_ar_trgm ON public.products USING gin (name_ar gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_products_name_en_trgm ON public.products USING gin (name_en gin_trgm_ops);

-- ============================================================
-- 2) Extend source_price_observations for offer details
-- ============================================================
ALTER TABLE public.source_price_observations
  ADD COLUMN IF NOT EXISTS discount_price numeric,
  ADD COLUMN IF NOT EXISTS delivery_fee numeric,
  ADD COLUMN IF NOT EXISTS in_stock boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS merchant_name text,
  ADD COLUMN IF NOT EXISTS product_condition text NOT NULL DEFAULT 'new';

CREATE INDEX IF NOT EXISTS idx_spo_in_stock ON public.source_price_observations (in_stock) WHERE in_stock = true;
CREATE INDEX IF NOT EXISTS idx_spo_condition ON public.source_price_observations (product_condition);
CREATE INDEX IF NOT EXISTS idx_spo_product_final_price ON public.source_price_observations (product_id, price);
CREATE INDEX IF NOT EXISTS idx_spo_observed_at_desc ON public.source_price_observations (observed_at DESC);

-- ============================================================
-- 3) Extend price_sources with logo + base URL
-- ============================================================
ALTER TABLE public.price_sources
  ADD COLUMN IF NOT EXISTS logo_url text,
  ADD COLUMN IF NOT EXISTS base_url text;

-- ============================================================
-- 4) Ingestion jobs tracking
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ingestion_jobs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  source_id uuid NOT NULL REFERENCES public.price_sources(id),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  started_at timestamptz,
  completed_at timestamptz,
  items_found integer NOT NULL DEFAULT 0,
  items_inserted integer NOT NULL DEFAULT 0,
  items_updated integer NOT NULL DEFAULT 0,
  items_skipped integer NOT NULL DEFAULT 0,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ingestion_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage ingestion jobs"
  ON public.ingestion_jobs FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Public can view completed ingestion jobs"
  ON public.ingestion_jobs FOR SELECT
  USING (status = 'completed');

CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_source ON public.ingestion_jobs (source_id);
CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_status ON public.ingestion_jobs (status);

-- ============================================================
-- 5) View: v_best_offers — cheapest verified offer per product×region
-- ============================================================
CREATE OR REPLACE VIEW public.v_best_offers AS
SELECT DISTINCT ON (spo.product_id, spo.region_id)
  spo.id as offer_id,
  spo.product_id,
  p.name_ar as product_name_ar,
  p.name_en as product_name_en,
  p.image_url as product_image_url,
  p.category,
  p.unit,
  p.brand_ar,
  p.brand_en,
  p.barcode,
  p.size_value,
  p.size_unit,
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
  spo.source_id
FROM public.source_price_observations spo
JOIN public.products p ON spo.product_id = p.id
JOIN public.regions r ON spo.region_id = r.id
JOIN public.price_sources ps ON spo.source_id = ps.id
WHERE spo.is_verified = true
  AND p.is_active = true
  AND p.condition = 'new'
  AND spo.product_condition = 'new'
  AND spo.in_stock = true
ORDER BY spo.product_id, spo.region_id, COALESCE(spo.discount_price, spo.price) ASC, spo.observed_at DESC;

-- ============================================================
-- 6) View: v_product_all_offers — all offers for a product
-- ============================================================
CREATE OR REPLACE VIEW public.v_product_all_offers AS
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
  spo.source_id
FROM public.source_price_observations spo
JOIN public.products p ON spo.product_id = p.id
JOIN public.regions r ON spo.region_id = r.id
JOIN public.price_sources ps ON spo.source_id = ps.id
WHERE p.is_active = true
  AND p.condition = 'new'
  AND spo.product_condition = 'new'
ORDER BY COALESCE(spo.discount_price, spo.price) ASC, spo.observed_at DESC;

-- ============================================================
-- 7) Fuzzy search function (Arabic + English + barcode)
-- ============================================================
CREATE OR REPLACE FUNCTION public.search_products(
  search_query text,
  category_filter text DEFAULT NULL,
  limit_count integer DEFAULT 50
)
RETURNS TABLE (
  product_id uuid,
  name_ar text,
  name_en text,
  category text,
  unit text,
  image_url text,
  brand_ar text,
  brand_en text,
  barcode text,
  condition text,
  similarity_score real
)
LANGUAGE sql STABLE
SET search_path TO 'public'
AS $$
  SELECT
    p.id as product_id,
    p.name_ar,
    p.name_en,
    p.category,
    p.unit,
    p.image_url,
    p.brand_ar,
    p.brand_en,
    p.barcode,
    p.condition,
    GREATEST(
      similarity(p.name_ar, search_query),
      similarity(COALESCE(p.name_en, ''), search_query)
    ) as similarity_score
  FROM public.products p
  WHERE p.is_active = true
    AND p.condition = 'new'
    AND (category_filter IS NULL OR p.category = category_filter)
    AND (
      p.name_ar % search_query
      OR COALESCE(p.name_en, '') % search_query
      OR p.barcode = search_query
    )
  ORDER BY similarity_score DESC
  LIMIT limit_count;
$$;

-- Set lower threshold for Arabic fuzzy matching
SELECT set_limit(0.2);
