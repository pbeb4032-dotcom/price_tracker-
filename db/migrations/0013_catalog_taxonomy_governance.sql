-- Sprint 3 foundation: governed taxonomy decisions over canonical catalog identity.

CREATE TABLE IF NOT EXISTS public.catalog_taxonomy_shadow_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mode text NOT NULL DEFAULT 'shadow'
    CHECK (mode IN ('shadow', 'apply')),
  status text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'completed', 'failed')),
  scanned_count integer NOT NULL DEFAULT 0,
  approved_count integer NOT NULL DEFAULT 0,
  quarantined_count integer NOT NULL DEFAULT 0,
  applied_count integer NOT NULL DEFAULT 0,
  changed_count integer NOT NULL DEFAULT 0,
  notes jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.catalog_taxonomy_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NULL REFERENCES public.catalog_taxonomy_shadow_runs(id) ON DELETE SET NULL,
  variant_id uuid NOT NULL REFERENCES public.catalog_product_variants(id) ON DELETE CASCADE,
  family_id uuid NULL REFERENCES public.catalog_product_families(id) ON DELETE SET NULL,
  legacy_product_id uuid NULL REFERENCES public.products(id) ON DELETE SET NULL,
  source_domain text,
  source_url text,
  site_category_raw text,
  decision_mode text NOT NULL DEFAULT 'shadow'
    CHECK (decision_mode IN ('shadow', 'apply', 'ingest_html', 'ingest_api')),
  decided_taxonomy_key text,
  decided_category text NOT NULL DEFAULT 'general',
  decided_subcategory text,
  confidence numeric(4,3) NOT NULL DEFAULT 0,
  margin numeric(4,3) NOT NULL DEFAULT 0,
  decision_status text NOT NULL
    CHECK (decision_status IN ('approved', 'quarantined', 'rejected')),
  review_priority integer NOT NULL DEFAULT 100,
  reason text,
  conflict boolean NOT NULL DEFAULT false,
  conflict_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  deny_rules text[] NOT NULL DEFAULT '{}'::text[],
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(run_id, variant_id)
);

CREATE INDEX IF NOT EXISTS idx_catalog_taxonomy_decisions_variant
  ON public.catalog_taxonomy_decisions(variant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_catalog_taxonomy_decisions_status
  ON public.catalog_taxonomy_decisions(decision_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_catalog_taxonomy_decisions_source
  ON public.catalog_taxonomy_decisions(source_domain, created_at DESC);

CREATE TABLE IF NOT EXISTS public.catalog_taxonomy_quarantine (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NULL REFERENCES public.catalog_taxonomy_shadow_runs(id) ON DELETE SET NULL,
  latest_decision_id uuid NULL REFERENCES public.catalog_taxonomy_decisions(id) ON DELETE SET NULL,
  variant_id uuid NOT NULL REFERENCES public.catalog_product_variants(id) ON DELETE CASCADE,
  family_id uuid NULL REFERENCES public.catalog_product_families(id) ON DELETE SET NULL,
  legacy_product_id uuid NULL REFERENCES public.products(id) ON DELETE SET NULL,
  source_domain text,
  source_url text,
  product_name text,
  current_taxonomy_key text,
  inferred_taxonomy_key text,
  inferred_category text NOT NULL DEFAULT 'general',
  inferred_subcategory text,
  confidence numeric(4,3) NOT NULL DEFAULT 0,
  margin numeric(4,3) NOT NULL DEFAULT 0,
  review_priority integer NOT NULL DEFAULT 100,
  deny_rules text[] NOT NULL DEFAULT '{}'::text[],
  conflict boolean NOT NULL DEFAULT false,
  conflict_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'ignored')),
  reviewer_note text,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(variant_id, status)
);

CREATE INDEX IF NOT EXISTS idx_catalog_taxonomy_quarantine_status
  ON public.catalog_taxonomy_quarantine(status, review_priority ASC, created_at DESC);

CREATE TABLE IF NOT EXISTS public.catalog_taxonomy_metrics_daily (
  day date NOT NULL,
  source_domain text NOT NULL,
  decided_category text NOT NULL,
  decided_taxonomy_key text,
  decision_status text NOT NULL,
  decisions_count integer NOT NULL DEFAULT 0,
  conflict_count integer NOT NULL DEFAULT 0,
  deny_rule_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (day, source_domain, decided_category, decided_taxonomy_key, decision_status)
);
