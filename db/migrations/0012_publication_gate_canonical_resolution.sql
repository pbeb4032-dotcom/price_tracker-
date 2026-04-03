-- Sprint 2 bridge: publication gate records canonical identity matches.

ALTER TABLE public.ingest_listing_candidates
  ADD COLUMN IF NOT EXISTS matched_variant_id uuid NULL REFERENCES public.catalog_product_variants(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS matched_family_id uuid NULL REFERENCES public.catalog_product_families(id) ON DELETE SET NULL;

ALTER TABLE public.ingest_listing_candidates
  DROP CONSTRAINT IF EXISTS ingest_listing_candidates_match_kind_check;

ALTER TABLE public.ingest_listing_candidates
  ADD CONSTRAINT ingest_listing_candidates_match_kind_check
  CHECK (match_kind IN ('url_map', 'identifier', 'canonical_identifier', 'canonical_fingerprint', 'legacy_product', 'exact_name', 'none'));

CREATE INDEX IF NOT EXISTS idx_ingest_listing_candidates_variant
  ON public.ingest_listing_candidates(matched_variant_id, created_at DESC);

ALTER TABLE public.catalog_publish_queue
  ADD COLUMN IF NOT EXISTS target_variant_id uuid NULL REFERENCES public.catalog_product_variants(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS target_family_id uuid NULL REFERENCES public.catalog_product_families(id) ON DELETE SET NULL;
