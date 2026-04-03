-- Sprint 2 foundation: canonical product identity.
-- Separates family / variant / listing / identifier while keeping legacy products compatible.

CREATE TABLE IF NOT EXISTS public.catalog_product_families (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_fingerprint text NOT NULL UNIQUE,
  canonical_name_ar text NOT NULL,
  canonical_name_en text,
  normalized_family_name text NOT NULL,
  normalized_brand text,
  taxonomy_key text,
  legacy_anchor_product_id uuid NULL REFERENCES public.products(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'merged', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_catalog_product_families_name
  ON public.catalog_product_families(normalized_family_name);
CREATE INDEX IF NOT EXISTS idx_catalog_product_families_taxonomy
  ON public.catalog_product_families(taxonomy_key);

CREATE TABLE IF NOT EXISTS public.catalog_product_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES public.catalog_product_families(id) ON DELETE CASCADE,
  legacy_anchor_product_id uuid NULL REFERENCES public.products(id) ON DELETE SET NULL,
  display_name_ar text NOT NULL,
  display_name_en text,
  normalized_variant_name text NOT NULL,
  normalized_brand text,
  size_value numeric,
  size_unit text,
  pack_count integer NOT NULL DEFAULT 1 CHECK (pack_count > 0),
  barcode_primary text,
  fingerprint text NOT NULL UNIQUE,
  taxonomy_key text,
  condition text NOT NULL DEFAULT 'new',
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'merged', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_catalog_product_variants_family
  ON public.catalog_product_variants(family_id);
CREATE INDEX IF NOT EXISTS idx_catalog_product_variants_barcode
  ON public.catalog_product_variants(barcode_primary) WHERE barcode_primary IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.catalog_variant_legacy_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id uuid NOT NULL REFERENCES public.catalog_product_variants(id) ON DELETE CASCADE,
  legacy_product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  is_anchor boolean NOT NULL DEFAULT false,
  source text NOT NULL DEFAULT 'backfill',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(variant_id, legacy_product_id),
  UNIQUE(legacy_product_id)
);

CREATE INDEX IF NOT EXISTS idx_catalog_variant_legacy_links_variant
  ON public.catalog_variant_legacy_links(variant_id);

CREATE TABLE IF NOT EXISTS public.catalog_variant_identifiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id uuid NOT NULL REFERENCES public.catalog_product_variants(id) ON DELETE CASCADE,
  legacy_product_id uuid NULL REFERENCES public.products(id) ON DELETE SET NULL,
  id_type text NOT NULL
    CHECK (id_type IN ('gtin', 'barcode', 'ean', 'upc', 'sku', 'qr_url', 'digital_link', 'merchant_sku', 'unknown')),
  id_value_normalized text NOT NULL,
  id_value_raw text,
  source text NOT NULL DEFAULT 'catalog',
  confidence numeric(4,3) NOT NULL DEFAULT 1.000,
  is_primary boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(variant_id, id_type, id_value_normalized)
);

CREATE INDEX IF NOT EXISTS idx_catalog_variant_identifiers_lookup
  ON public.catalog_variant_identifiers(id_type, id_value_normalized);
CREATE INDEX IF NOT EXISTS idx_catalog_variant_identifiers_legacy
  ON public.catalog_variant_identifiers(legacy_product_id);

CREATE TABLE IF NOT EXISTS public.catalog_merchant_listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id uuid NOT NULL REFERENCES public.catalog_product_variants(id) ON DELETE CASCADE,
  legacy_product_id uuid NULL REFERENCES public.products(id) ON DELETE SET NULL,
  source_id uuid NOT NULL REFERENCES public.price_sources(id) ON DELETE CASCADE,
  source_url text NOT NULL,
  source_url_hash text NOT NULL,
  canonical_url text,
  external_item_id text,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive', 'quarantined', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(source_id, source_url_hash)
);

CREATE INDEX IF NOT EXISTS idx_catalog_merchant_listings_variant
  ON public.catalog_merchant_listings(variant_id);
CREATE INDEX IF NOT EXISTS idx_catalog_merchant_listings_legacy
  ON public.catalog_merchant_listings(legacy_product_id);

CREATE TABLE IF NOT EXISTS public.catalog_identity_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NULL REFERENCES public.catalog_product_families(id) ON DELETE SET NULL,
  variant_id uuid NULL REFERENCES public.catalog_product_variants(id) ON DELETE SET NULL,
  listing_id uuid NULL REFERENCES public.catalog_merchant_listings(id) ON DELETE SET NULL,
  legacy_product_id uuid NULL REFERENCES public.products(id) ON DELETE SET NULL,
  decision_type text NOT NULL
    CHECK (decision_type IN ('family_seed', 'variant_seed', 'identifier_seed', 'listing_seed', 'resolver_match', 'resolver_quarantine')),
  decision_status text NOT NULL
    CHECK (decision_status IN ('approved', 'quarantined', 'manual_review', 'rejected')),
  confidence numeric(4,3),
  reason text,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  decider text NOT NULL DEFAULT 'system',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_catalog_identity_decisions_variant
  ON public.catalog_identity_decisions(variant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_catalog_identity_decisions_legacy
  ON public.catalog_identity_decisions(legacy_product_id, created_at DESC);

CREATE OR REPLACE VIEW public.v_catalog_variant_legacy_projection AS
SELECT
  v.id AS variant_id,
  v.family_id,
  link.legacy_product_id AS product_id,
  v.display_name_ar,
  v.display_name_en,
  f.canonical_name_ar AS family_name_ar,
  f.canonical_name_en AS family_name_en,
  v.normalized_variant_name,
  v.normalized_brand,
  v.size_value,
  v.size_unit,
  v.pack_count,
  v.barcode_primary,
  v.fingerprint,
  COALESCE(v.taxonomy_key, f.taxonomy_key) AS taxonomy_key,
  v.condition,
  v.status,
  v.created_at,
  v.updated_at
FROM public.catalog_product_variants v
JOIN public.catalog_product_families f ON f.id = v.family_id
JOIN public.catalog_variant_legacy_links link ON link.variant_id = v.id;

CREATE OR REPLACE VIEW public.v_catalog_listing_legacy_projection AS
SELECT
  l.id AS listing_id,
  l.variant_id,
  COALESCE(
    l.legacy_product_id,
    anchor.legacy_product_id,
    v.legacy_anchor_product_id
  ) AS product_id,
  l.source_id,
  ps.domain AS source_domain,
  l.source_url,
  l.canonical_url,
  l.external_item_id,
  l.status,
  l.created_at,
  l.updated_at
FROM public.catalog_merchant_listings l
JOIN public.catalog_product_variants v ON v.id = l.variant_id
JOIN public.price_sources ps ON ps.id = l.source_id
LEFT JOIN LATERAL (
  SELECT legacy_product_id
  FROM public.catalog_variant_legacy_links link
  WHERE link.variant_id = l.variant_id
  ORDER BY link.is_anchor DESC, link.updated_at DESC NULLS LAST, link.created_at DESC
  LIMIT 1
) anchor ON true;
