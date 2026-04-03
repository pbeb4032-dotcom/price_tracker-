-- ============================================================
-- Shadow Mode (Candidate → Validate → Activate) + Health Rollups
-- Added: 2026-02-28
-- Non-destructive (ALTER/CREATE IF NOT EXISTS)
-- ============================================================

-- 1) price_sources lifecycle fields
ALTER TABLE public.price_sources
  ADD COLUMN IF NOT EXISTS lifecycle_status text NOT NULL DEFAULT 'active'
    CHECK (lifecycle_status IN ('active','candidate','disabled','rejected')),
  ADD COLUMN IF NOT EXISTS crawl_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS validation_state text NOT NULL DEFAULT 'unvalidated'
    CHECK (validation_state IN ('unvalidated','needs_review','passed','failed')),
  ADD COLUMN IF NOT EXISTS validation_score numeric(4,3) NULL,
  ADD COLUMN IF NOT EXISTS discovered_via text NULL,
  ADD COLUMN IF NOT EXISTS discovery_tags jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS last_probe_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS validated_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS activated_at timestamptz NULL;

-- Backfill: map legacy is_active to lifecycle_status (best-effort)
UPDATE public.price_sources
  SET lifecycle_status = CASE
    WHEN coalesce(is_active,false) = true THEN 'active'
    ELSE COALESCE(NULLIF(lifecycle_status,''), 'active')
  END
WHERE lifecycle_status IS NULL OR lifecycle_status = '';

-- Ensure candidate sources are not public by default (safe)
UPDATE public.price_sources
  SET is_active = false
WHERE lifecycle_status = 'candidate' AND is_active = true;

-- 2) Daily rollups table for health dashboard
CREATE TABLE IF NOT EXISTS public.source_health_daily (
  day date NOT NULL,
  source_id uuid NOT NULL REFERENCES public.price_sources(id) ON DELETE CASCADE,
  domain text NOT NULL,
  successes int NOT NULL DEFAULT 0,
  failures int NOT NULL DEFAULT 0,
  anomalies int NOT NULL DEFAULT 0,
  error_rate numeric(5,4) NULL,
  anomaly_rate numeric(5,4) NULL,
  last_success_at timestamptz NULL,
  last_error_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(day, source_id)
);

CREATE INDEX IF NOT EXISTS idx_source_health_daily_day_desc
  ON public.source_health_daily(day DESC);

-- 3) Latest health view (one row per source)
CREATE OR REPLACE VIEW public.v_source_health_latest
WITH (security_invoker = on) AS
SELECT DISTINCT ON (sh.source_id)
  sh.source_id,
  sh.day,
  sh.domain,
  sh.successes,
  sh.failures,
  sh.anomalies,
  sh.error_rate,
  sh.anomaly_rate,
  sh.last_success_at,
  sh.last_error_at,
  sh.created_at
FROM public.source_health_daily sh
ORDER BY sh.source_id, sh.day DESC, sh.created_at DESC;
