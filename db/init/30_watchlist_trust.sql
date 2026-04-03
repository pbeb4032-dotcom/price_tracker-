-- ============================================================
-- Watchlist + Alerts + Trust Graph support
-- Added: 2026-02-27
--
-- This file is safe/idempotent and only adds optional columns.
-- Existing DB volumes are upgraded via scripts/run-dev.ps1.
-- ============================================================

-- Dynamic trust fields (trust graph)
ALTER TABLE public.price_sources
  ADD COLUMN IF NOT EXISTS trust_weight_dynamic numeric(3,2),
  ADD COLUMN IF NOT EXISTS trust_last_scored_at timestamptz,
  ADD COLUMN IF NOT EXISTS trust_score_meta jsonb;

-- Alerts: include_delivery was introduced later; keep it safe for older DBs
ALTER TABLE public.alerts
  ADD COLUMN IF NOT EXISTS include_delivery boolean NOT NULL DEFAULT false;

-- Indexes helpful for watchlist scans
CREATE INDEX IF NOT EXISTS idx_alerts_user_active
  ON public.alerts (user_id, is_active) WHERE is_active = true;

