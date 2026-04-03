-- Sprint 1 foundation: ingestion staging + decision records + publication gate queue.
-- This separates raw ingest evidence from public catalog mutations.

CREATE TABLE IF NOT EXISTS public.ingest_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ingest_run_id uuid,
  source_id uuid NULL REFERENCES public.price_sources(id) ON DELETE SET NULL,
  source_domain text NOT NULL,
  source_kind text NOT NULL DEFAULT 'unknown'
    CHECK (source_kind IN ('html', 'api', 'manual', 'unknown')),
  page_type text,
  source_url text,
  canonical_url text,
  external_item_id text,
  http_status integer,
  content_type text,
  payload_kind text NOT NULL DEFAULT 'json'
    CHECK (payload_kind IN ('json', 'html', 'unknown')),
  payload_hash text,
  payload_excerpt text,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  extracted_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'captured'
    CHECK (status IN ('captured', 'processed', 'quarantined', 'published', 'rejected', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ingest_documents_source_created
  ON public.ingest_documents(source_domain, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ingest_documents_source_url
  ON public.ingest_documents(source_url);
CREATE INDEX IF NOT EXISTS idx_ingest_documents_status
  ON public.ingest_documents(status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.ingest_listing_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.ingest_documents(id) ON DELETE CASCADE,
  source_id uuid NULL REFERENCES public.price_sources(id) ON DELETE SET NULL,
  source_domain text NOT NULL,
  source_url text,
  canonical_url text,
  external_item_id text,
  product_name text NOT NULL,
  normalized_name text,
  barcode_normalized text,
  category_hint text,
  subcategory_hint text,
  taxonomy_hint text,
  match_kind text NOT NULL DEFAULT 'none'
    CHECK (match_kind IN ('url_map', 'identifier', 'exact_name', 'none')),
  matched_product_id uuid NULL REFERENCES public.products(id) ON DELETE SET NULL,
  identity_confidence numeric(4,3) NOT NULL DEFAULT 0,
  taxonomy_confidence numeric(4,3) NOT NULL DEFAULT 0,
  price_confidence numeric(4,3) NOT NULL DEFAULT 0,
  category_conflict boolean NOT NULL DEFAULT false,
  taxonomy_conflict boolean NOT NULL DEFAULT false,
  publish_blocked boolean NOT NULL DEFAULT true,
  publish_status text NOT NULL DEFAULT 'pending'
    CHECK (publish_status IN ('pending', 'approved', 'quarantined', 'rejected', 'published', 'failed')),
  publish_reason text,
  publish_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  gate_version text NOT NULL DEFAULT 'v1',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(document_id)
);

CREATE INDEX IF NOT EXISTS idx_ingest_listing_candidates_status
  ON public.ingest_listing_candidates(publish_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ingest_listing_candidates_source
  ON public.ingest_listing_candidates(source_domain, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ingest_listing_candidates_match
  ON public.ingest_listing_candidates(match_kind, identity_confidence DESC);

CREATE TABLE IF NOT EXISTS public.ingest_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES public.ingest_listing_candidates(id) ON DELETE CASCADE,
  decision_type text NOT NULL
    CHECK (decision_type IN ('identity', 'taxonomy', 'price', 'publication')),
  decision_status text NOT NULL
    CHECK (decision_status IN ('approved', 'quarantined', 'rejected', 'pending', 'manual_review')),
  confidence numeric(4,3),
  reason text,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  decider text NOT NULL DEFAULT 'system',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ingest_decisions_candidate
  ON public.ingest_decisions(candidate_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ingest_decisions_type_status
  ON public.ingest_decisions(decision_type, decision_status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.catalog_publish_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES public.ingest_listing_candidates(id) ON DELETE CASCADE,
  target_kind text NOT NULL DEFAULT 'legacy_product_projection'
    CHECK (target_kind IN ('legacy_product_projection', 'catalog_variant_projection')),
  legacy_product_id uuid NULL REFERENCES public.products(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'published', 'skipped', 'failed')),
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  scheduled_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(candidate_id)
);

CREATE INDEX IF NOT EXISTS idx_catalog_publish_queue_status
  ON public.catalog_publish_queue(status, scheduled_at ASC);
