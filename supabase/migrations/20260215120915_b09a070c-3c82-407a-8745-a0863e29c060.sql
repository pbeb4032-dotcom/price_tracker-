
-- ============================================
-- P1: Price Guardrails + Validation Columns
-- ============================================

-- 1) Category-based price guardrails
CREATE TABLE IF NOT EXISTS public.price_guardrails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_key text NOT NULL UNIQUE,
  min_iqd bigint NOT NULL CHECK (min_iqd > 0),
  max_iqd bigint NOT NULL CHECK (max_iqd > min_iqd),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.price_guardrails ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Guardrails publicly readable"
  ON public.price_guardrails FOR SELECT USING (true);

CREATE POLICY "Admins can manage guardrails"
  ON public.price_guardrails FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

-- 2) Add validation metadata to source_price_observations
ALTER TABLE public.source_price_observations
  ADD COLUMN IF NOT EXISTS raw_price_text text,
  ADD COLUMN IF NOT EXISTS parsed_currency text,
  ADD COLUMN IF NOT EXISTS normalized_price_iqd bigint,
  ADD COLUMN IF NOT EXISTS normalization_factor int DEFAULT 1,
  ADD COLUMN IF NOT EXISTS is_price_anomaly boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS anomaly_reason text,
  ADD COLUMN IF NOT EXISTS price_confidence numeric(3,2) DEFAULT 0.50;

-- 3) Indexes for fast anomaly/price queries
CREATE INDEX IF NOT EXISTS idx_spo_price_anomaly ON public.source_price_observations(is_price_anomaly);
CREATE INDEX IF NOT EXISTS idx_spo_normalized_price ON public.source_price_observations(normalized_price_iqd);

-- 4) Seed realistic guardrails for Iraqi market categories
INSERT INTO public.price_guardrails (category_key, min_iqd, max_iqd) VALUES
  ('vegetables',    250,       100000),
  ('grains',        500,       200000),
  ('dairy',         500,       150000),
  ('meat',         1000,       500000),
  ('essentials',    250,       300000),
  ('beverages',     250,       200000),
  ('groceries',     250,       500000),
  ('electronics',  5000,   500000000),
  ('clothing',     5000,    50000000),
  ('home',         5000,    50000000),
  ('beauty',       1000,    10000000),
  ('automotive',   5000,   200000000),
  ('sports',       5000,    50000000),
  ('toys',         1000,    20000000),
  ('general',       250,   100000000)
ON CONFLICT (category_key) DO NOTHING;

-- ============================================
-- P3: Exchange Rates Table
-- ============================================

CREATE TABLE IF NOT EXISTS public.exchange_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rate_date date NOT NULL,
  source_type text NOT NULL CHECK (source_type IN ('gov', 'market')),
  source_name text NOT NULL,
  buy_iqd_per_usd numeric(12,4),
  sell_iqd_per_usd numeric(12,4),
  mid_iqd_per_usd numeric(12,4) NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(rate_date, source_type, source_name)
);

ALTER TABLE public.exchange_rates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Exchange rates publicly readable"
  ON public.exchange_rates FOR SELECT USING (true);

CREATE POLICY "Admins can manage exchange rates"
  ON public.exchange_rates FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Seed initial rates (CBI official + market approximation Feb 2026)
INSERT INTO public.exchange_rates (rate_date, source_type, source_name, buy_iqd_per_usd, sell_iqd_per_usd, mid_iqd_per_usd) VALUES
  ('2026-02-15', 'gov', 'البنك المركزي العراقي', 1310.0000, 1310.0000, 1310.0000),
  ('2026-02-15', 'market', 'سوق الصرافين', 1460.0000, 1480.0000, 1470.0000)
ON CONFLICT (rate_date, source_type, source_name) DO NOTHING;

-- Backfill normalized_price_iqd from existing price data
UPDATE public.source_price_observations
SET normalized_price_iqd = COALESCE(discount_price, price)::bigint,
    normalization_factor = 1,
    parsed_currency = currency,
    is_price_anomaly = false,
    price_confidence = 0.70
WHERE normalized_price_iqd IS NULL;
