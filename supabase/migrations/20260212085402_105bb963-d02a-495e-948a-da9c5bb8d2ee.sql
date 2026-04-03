
-- ============================================================
-- R2.1: Source-backed price foundation
-- Tables: price_sources, source_prices, product_source_map
-- View: v_verified_market_prices
-- ============================================================

-- 1. price_sources: external data providers (gov, NGO, etc.)
CREATE TABLE IF NOT EXISTS public.price_sources (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name_ar TEXT NOT NULL,
  name_en TEXT,
  source_type TEXT NOT NULL DEFAULT 'government',
  country_code TEXT NOT NULL DEFAULT 'IQ',
  website_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  reliability_score NUMERIC CHECK (reliability_score >= 0 AND reliability_score <= 100) DEFAULT 50,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. source_prices: price observations from sources
CREATE TABLE IF NOT EXISTS public.source_prices (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  source_id UUID NOT NULL REFERENCES public.price_sources(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  region_id UUID NOT NULL REFERENCES public.regions(id) ON DELETE CASCADE,
  price NUMERIC NOT NULL CHECK (price > 0),
  currency TEXT NOT NULL DEFAULT 'IQD',
  unit TEXT NOT NULL DEFAULT 'kg',
  observed_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. product_source_map: which products a source covers
CREATE TABLE IF NOT EXISTS public.product_source_map (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  source_id UUID NOT NULL REFERENCES public.price_sources(id) ON DELETE CASCADE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (product_id, source_id)
);

-- ============================================================
-- Indexes
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_source_prices_product_id ON public.source_prices(product_id);
CREATE INDEX IF NOT EXISTS idx_source_prices_region_id ON public.source_prices(region_id);
CREATE INDEX IF NOT EXISTS idx_source_prices_observed_at ON public.source_prices(observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_source_prices_source_id ON public.source_prices(source_id);
CREATE INDEX IF NOT EXISTS idx_product_source_map_product ON public.product_source_map(product_id);
CREATE INDEX IF NOT EXISTS idx_product_source_map_source ON public.product_source_map(source_id);

-- ============================================================
-- RLS
-- ============================================================

ALTER TABLE public.price_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.source_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_source_map ENABLE ROW LEVEL SECURITY;

-- price_sources: public read, admin manage
CREATE POLICY "Price sources are publicly viewable"
  ON public.price_sources FOR SELECT USING (true);

CREATE POLICY "Admins can manage price sources"
  ON public.price_sources FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

-- source_prices: public read, admin manage
CREATE POLICY "Source prices are publicly viewable"
  ON public.source_prices FOR SELECT USING (true);

CREATE POLICY "Admins can manage source prices"
  ON public.source_prices FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

-- product_source_map: public read, admin manage
CREATE POLICY "Product source mappings are publicly viewable"
  ON public.product_source_map FOR SELECT USING (true);

CREATE POLICY "Admins can manage product source mappings"
  ON public.product_source_map FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

-- ============================================================
-- Triggers for updated_at
-- ============================================================

CREATE TRIGGER update_price_sources_updated_at
  BEFORE UPDATE ON public.price_sources
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- View: v_verified_market_prices
-- Aggregates source_prices by product+region
-- ============================================================

CREATE OR REPLACE VIEW public.v_verified_market_prices
WITH (security_invoker = on) AS
SELECT
  sp.product_id,
  sp.region_id,
  p.name_ar AS product_name_ar,
  p.name_en AS product_name_en,
  p.unit,
  p.category,
  r.name_ar AS region_name_ar,
  r.name_en AS region_name_en,
  MIN(sp.price) AS min_price,
  AVG(sp.price) AS avg_price,
  MAX(sp.price) AS max_price,
  COUNT(DISTINCT sp.source_id) AS sources_count,
  MAX(sp.observed_at) AS latest_observed_at,
  sp.currency
FROM public.source_prices sp
JOIN public.products p ON p.id = sp.product_id AND p.is_active = true
JOIN public.regions r ON r.id = sp.region_id AND r.is_active = true
JOIN public.price_sources ps ON ps.id = sp.source_id AND ps.is_active = true
WHERE sp.observed_at >= now() - INTERVAL '30 days'
GROUP BY sp.product_id, sp.region_id, p.name_ar, p.name_en, p.unit, p.category,
         r.name_ar, r.name_en, sp.currency;
