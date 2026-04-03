
-- ============================================================
-- R2-01: Source-transparency foundation (Iraq-only)
-- Drop old R2.1 tables/view, create spec-compliant schema
-- ============================================================

-- 1. Drop old R2.1 artifacts
DROP VIEW IF EXISTS public.v_verified_market_prices;
DROP TABLE IF EXISTS public.product_source_map;
DROP TABLE IF EXISTS public.source_prices;
DROP TABLE IF EXISTS public.price_sources;

-- ============================================================
-- 2. price_sources (spec-compliant)
-- ============================================================
CREATE TABLE public.price_sources (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name_ar TEXT NOT NULL,
  domain TEXT NOT NULL,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('retailer','marketplace','official')),
  country_code TEXT NOT NULL DEFAULT 'IQ' CHECK (country_code = 'IQ'),
  trust_weight NUMERIC(3,2) NOT NULL DEFAULT 0.50 CHECK (trust_weight >= 0 AND trust_weight <= 1),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(domain, country_code)
);

-- ============================================================
-- 3. source_price_observations
-- ============================================================
CREATE TABLE public.source_price_observations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  source_id UUID NOT NULL REFERENCES public.price_sources(id) ON DELETE RESTRICT,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  region_id UUID NOT NULL REFERENCES public.regions(id) ON DELETE RESTRICT,
  price NUMERIC(12,2) NOT NULL CHECK (price > 0),
  currency TEXT NOT NULL DEFAULT 'IQD' CHECK (currency = 'IQD'),
  unit TEXT NOT NULL,
  source_url TEXT NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  evidence_type TEXT NOT NULL CHECK (evidence_type IN ('url','screenshot','api')),
  evidence_ref TEXT NULL,
  is_verified BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 4. Indexes
-- ============================================================
CREATE INDEX idx_spo_product_region ON public.source_price_observations(product_id, region_id);
CREATE INDEX idx_spo_observed_at ON public.source_price_observations(observed_at DESC);
CREATE INDEX idx_spo_verified ON public.source_price_observations(is_verified);

-- ============================================================
-- 5. RLS
-- ============================================================
ALTER TABLE public.price_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.source_price_observations ENABLE ROW LEVEL SECURITY;

-- price_sources: only active IQ sources publicly readable
CREATE POLICY "Public can view active IQ sources"
  ON public.price_sources FOR SELECT
  USING (is_active = true AND country_code = 'IQ');

-- source_price_observations: only verified rows publicly readable
CREATE POLICY "Public can view verified observations"
  ON public.source_price_observations FOR SELECT
  USING (is_verified = true);

-- Admin manage policies
CREATE POLICY "Admins can manage price sources"
  ON public.price_sources FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can manage observations"
  ON public.source_price_observations FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

-- ============================================================
-- 6. View: v_trusted_price_summary
-- ============================================================
CREATE OR REPLACE VIEW public.v_trusted_price_summary
WITH (security_invoker = on) AS
SELECT
  spo.product_id,
  spo.region_id,
  spo.unit,
  p.name_ar AS product_name_ar,
  p.name_en AS product_name_en,
  p.category,
  r.name_ar AS region_name_ar,
  r.name_en AS region_name_en,
  ROUND(AVG(spo.price), 2) AS avg_price_iqd,
  MIN(spo.price) AS min_price_iqd,
  MAX(spo.price) AS max_price_iqd,
  COUNT(*) AS sample_count,
  MAX(spo.observed_at) AS last_observed_at
FROM public.source_price_observations spo
JOIN public.price_sources ps
  ON ps.id = spo.source_id
  AND ps.is_active = true
  AND ps.country_code = 'IQ'
JOIN public.products p
  ON p.id = spo.product_id
  AND p.is_active = true
JOIN public.regions r
  ON r.id = spo.region_id
  AND r.is_active = true
WHERE spo.is_verified = true
  AND spo.currency = 'IQD'
GROUP BY spo.product_id, spo.region_id, spo.unit,
         p.name_ar, p.name_en, p.category,
         r.name_ar, r.name_en;
