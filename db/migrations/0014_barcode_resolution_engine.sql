-- Sprint 4 foundation: barcode / QR resolution engine.
-- Records resolution attempts, external registry cache, and ranked candidates.

CREATE TABLE IF NOT EXISTS public.barcode_resolution_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  input_text text,
  parsed_code text,
  identifier_type text
    CHECK (identifier_type IN ('gtin', 'barcode', 'ean', 'upc', 'sku', 'qr_url', 'digital_link', 'merchant_sku', 'unknown')),
  parse_source text NOT NULL DEFAULT 'unresolved'
    CHECK (parse_source IN ('empty', 'direct', 'numeric_scan', 'query_param', 'path_segment', 'digital_link', 'unresolved')),
  resolution_status text NOT NULL DEFAULT 'running'
    CHECK (resolution_status IN ('running', 'resolved_internal', 'resolved_external', 'ambiguous', 'not_found', 'failed')),
  variant_id uuid NULL REFERENCES public.catalog_product_variants(id) ON DELETE SET NULL,
  family_id uuid NULL REFERENCES public.catalog_product_families(id) ON DELETE SET NULL,
  legacy_product_id uuid NULL REFERENCES public.products(id) ON DELETE SET NULL,
  region_id uuid NULL REFERENCES public.regions(id) ON DELETE SET NULL,
  external_source text,
  confidence numeric(4,3),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_barcode_resolution_runs_code
  ON public.barcode_resolution_runs(parsed_code, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_barcode_resolution_runs_status
  ON public.barcode_resolution_runs(resolution_status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.barcode_resolution_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.barcode_resolution_runs(id) ON DELETE CASCADE,
  candidate_type text NOT NULL
    CHECK (candidate_type IN ('internal_variant', 'legacy_product', 'external_catalog', 'catalog_match', 'offer_match')),
  candidate_rank integer NOT NULL DEFAULT 1,
  candidate_status text NOT NULL DEFAULT 'ranked'
    CHECK (candidate_status IN ('selected', 'ranked', 'ambiguous', 'quarantined', 'rejected')),
  variant_id uuid NULL REFERENCES public.catalog_product_variants(id) ON DELETE SET NULL,
  family_id uuid NULL REFERENCES public.catalog_product_families(id) ON DELETE SET NULL,
  legacy_product_id uuid NULL REFERENCES public.products(id) ON DELETE SET NULL,
  listing_id uuid NULL REFERENCES public.catalog_merchant_listings(id) ON DELETE SET NULL,
  source_domain text,
  confidence numeric(4,3),
  reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_barcode_resolution_candidates_run
  ON public.barcode_resolution_candidates(run_id, candidate_rank ASC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_barcode_resolution_candidates_variant
  ON public.barcode_resolution_candidates(variant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.barcode_external_catalog_cache (
  normalized_code text PRIMARY KEY,
  identifier_type text
    CHECK (identifier_type IN ('gtin', 'barcode', 'ean', 'upc', 'sku', 'qr_url', 'digital_link', 'merchant_sku', 'unknown')),
  source text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_barcode_external_catalog_cache_expires
  ON public.barcode_external_catalog_cache(expires_at);
