
-- =====================================================
-- PATCH B: Ingestion Foundation Tables
-- Reversible: DROP TABLE IF EXISTS in reverse order
-- No changes to existing tables/views/functions
-- =====================================================

-- 1) source_sync_runs — tracks each ingestion run per source
CREATE TABLE public.source_sync_runs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  source_id uuid NOT NULL REFERENCES public.price_sources(id),
  status text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'success', 'partial', 'failed')),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz NULL,
  fetched_count int NOT NULL DEFAULT 0,
  normalized_count int NOT NULL DEFAULT 0,
  inserted_count int NOT NULL DEFAULT 0,
  updated_count int NOT NULL DEFAULT 0,
  error_count int NOT NULL DEFAULT 0,
  error_summary text NULL,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- 2) source_raw_items — raw fetched payloads before normalization
CREATE TABLE public.source_raw_items (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES public.source_sync_runs(id) ON DELETE CASCADE,
  source_id uuid NOT NULL REFERENCES public.price_sources(id),
  external_item_id text NULL,
  raw_payload jsonb NOT NULL,
  raw_url text NULL,
  raw_title text NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  parse_status text NOT NULL DEFAULT 'pending'
    CHECK (parse_status IN ('pending', 'normalized', 'skipped', 'invalid', 'error')),
  parse_error text NULL
);

-- 3) product_identity_map — fingerprint-to-product mapping
CREATE TABLE public.product_identity_map (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  fingerprint text NOT NULL UNIQUE,
  product_id uuid NOT NULL REFERENCES public.products(id),
  confidence numeric(5,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- =====================================================
-- INDEXES
-- =====================================================

CREATE INDEX idx_source_raw_items_source_fetched
  ON public.source_raw_items (source_id, fetched_at DESC);

CREATE INDEX idx_source_raw_items_run_status
  ON public.source_raw_items (run_id, parse_status);

CREATE INDEX idx_source_sync_runs_source_started
  ON public.source_sync_runs (source_id, started_at DESC);

CREATE INDEX idx_product_identity_map_product
  ON public.product_identity_map (product_id);

CREATE INDEX idx_source_raw_items_payload_gin
  ON public.source_raw_items USING GIN (raw_payload);

-- =====================================================
-- RLS
-- =====================================================

ALTER TABLE public.source_sync_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.source_raw_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_identity_map ENABLE ROW LEVEL SECURITY;

-- source_sync_runs: admins manage, public can view completed runs
CREATE POLICY "Admins can manage sync runs"
  ON public.source_sync_runs FOR ALL
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Public can view completed sync runs"
  ON public.source_sync_runs FOR SELECT
  USING (status IN ('success', 'partial'));

-- source_raw_items: admin only (internal data)
CREATE POLICY "Admins can manage raw items"
  ON public.source_raw_items FOR ALL
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- product_identity_map: admins manage, public can read
CREATE POLICY "Admins can manage identity map"
  ON public.product_identity_map FOR ALL
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Public can view identity map"
  ON public.product_identity_map FOR SELECT
  USING (true);

-- =====================================================
-- Trigger: auto-update updated_at on product_identity_map
-- =====================================================

CREATE TRIGGER update_product_identity_map_updated_at
  BEFORE UPDATE ON public.product_identity_map
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
