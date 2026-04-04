-- Sprint 6 foundation: source certification governance + server-side ranking truth inputs.

ALTER TABLE public.price_sources
  ADD COLUMN IF NOT EXISTS certification_tier text NOT NULL DEFAULT 'published',
  ADD COLUMN IF NOT EXISTS certification_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS quality_score numeric(4,3),
  ADD COLUMN IF NOT EXISTS quality_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS catalog_publish_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS certification_reason text,
  ADD COLUMN IF NOT EXISTS certification_meta jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE public.price_sources
SET
  certification_tier = CASE
    WHEN lifecycle_status = 'candidate' THEN 'sandbox'
    WHEN coalesce(auto_disabled, false) = true THEN 'suspended'
    WHEN coalesce(is_active, false) = true THEN 'published'
    ELSE coalesce(certification_tier, 'observed')
  END,
  certification_status = CASE
    WHEN lifecycle_status = 'candidate' THEN 'pending'
    WHEN coalesce(auto_disabled, false) = true THEN 'suspended'
    WHEN coalesce(is_active, false) = true THEN 'certified'
    ELSE coalesce(certification_status, 'needs_review')
  END,
  catalog_publish_enabled = CASE
    WHEN lifecycle_status = 'candidate' THEN false
    WHEN coalesce(auto_disabled, false) = true THEN false
    ELSE coalesce(catalog_publish_enabled, coalesce(is_active, false))
  END,
  quality_score = coalesce(quality_score, coalesce(trust_weight_dynamic, trust_weight, 0.50)),
  quality_updated_at = coalesce(quality_updated_at, now()),
  certification_meta = coalesce(certification_meta, '{}'::jsonb)
WHERE country_code = 'IQ';

CREATE TABLE IF NOT EXISTS public.source_certification_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mode text NOT NULL DEFAULT 'apply',
  status text NOT NULL DEFAULT 'running',
  country_code text NOT NULL DEFAULT 'IQ',
  window_hours integer NOT NULL DEFAULT 72,
  scanned_count integer NOT NULL DEFAULT 0,
  changed_count integer NOT NULL DEFAULT 0,
  published_count integer NOT NULL DEFAULT 0,
  sandboxed_count integer NOT NULL DEFAULT 0,
  suspended_count integer NOT NULL DEFAULT 0,
  notes jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.source_certification_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NULL REFERENCES public.source_certification_runs(id) ON DELETE SET NULL,
  source_id uuid NOT NULL REFERENCES public.price_sources(id) ON DELETE CASCADE,
  domain text NOT NULL,
  previous_tier text,
  decided_tier text NOT NULL,
  previous_status text,
  decided_status text NOT NULL,
  publish_enabled boolean NOT NULL DEFAULT false,
  quality_score numeric(4,3) NOT NULL DEFAULT 0,
  confidence numeric(4,3) NOT NULL DEFAULT 0,
  review_priority integer NOT NULL DEFAULT 100,
  reason text,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_source_certification_runs_started
  ON public.source_certification_runs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_source_certification_decisions_source
  ON public.source_certification_decisions(source_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_source_certification_decisions_tier
  ON public.source_certification_decisions(decided_tier, decided_status, created_at DESC);
