
-- =============================================================
-- HARDENING MIGRATION: Constraints, Indexes, Views, Audit
-- =============================================================

-- 1) UNIQUE CONSTRAINTS --

-- One vote per user per report
ALTER TABLE public.report_votes
  ADD CONSTRAINT uq_report_votes_user_report UNIQUE (user_id, report_id);

-- Product alias uniqueness (product + normalized alias + language)
ALTER TABLE public.product_aliases
  ADD CONSTRAINT uq_product_alias_norm UNIQUE (product_id, alias_name, language);

-- Alert dedup: one alert per user/product/region/type
ALTER TABLE public.alerts
  ADD CONSTRAINT uq_alerts_dedup UNIQUE (user_id, product_id, region_id, alert_type);

-- 2) CHECK CONSTRAINTS --

-- Price must be positive and within sane range
ALTER TABLE public.price_reports
  ADD CONSTRAINT chk_price_range CHECK (price > 0 AND price <= 999999999);

-- Quantity must be positive when set
ALTER TABLE public.price_reports
  ADD CONSTRAINT chk_quantity_positive CHECK (quantity IS NULL OR quantity > 0);

-- Trust score 0-100
ALTER TABLE public.price_reports
  ADD CONSTRAINT chk_trust_score_range CHECK (trust_score IS NULL OR (trust_score >= 0 AND trust_score <= 100));

-- Target price positive when set
ALTER TABLE public.alerts
  ADD CONSTRAINT chk_alert_target_price CHECK (target_price IS NULL OR target_price > 0);

-- Latitude/longitude ranges on stores
ALTER TABLE public.stores
  ADD CONSTRAINT chk_store_latitude CHECK (latitude IS NULL OR (latitude >= -90 AND latitude <= 90));

ALTER TABLE public.stores
  ADD CONSTRAINT chk_store_longitude CHECK (longitude IS NULL OR (longitude >= -180 AND longitude <= 180));

-- Latitude/longitude ranges on regions
ALTER TABLE public.regions
  ADD CONSTRAINT chk_region_latitude CHECK (latitude IS NULL OR (latitude >= -90 AND latitude <= 90));

ALTER TABLE public.regions
  ADD CONSTRAINT chk_region_longitude CHECK (longitude IS NULL OR (longitude >= -180 AND longitude <= 180));

-- 3) INDEXES for query performance --

CREATE INDEX IF NOT EXISTS idx_price_reports_product_id ON public.price_reports (product_id);
CREATE INDEX IF NOT EXISTS idx_price_reports_region_id ON public.price_reports (region_id);
CREATE INDEX IF NOT EXISTS idx_price_reports_created_at ON public.price_reports (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_price_reports_status ON public.price_reports (status);
CREATE INDEX IF NOT EXISTS idx_price_reports_user_id ON public.price_reports (user_id);
CREATE INDEX IF NOT EXISTS idx_price_reports_store_id ON public.price_reports (store_id) WHERE store_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_alerts_user_id ON public.alerts (user_id);
CREATE INDEX IF NOT EXISTS idx_alerts_product_id ON public.alerts (product_id);

CREATE INDEX IF NOT EXISTS idx_stores_region_id ON public.stores (region_id);
CREATE INDEX IF NOT EXISTS idx_product_aliases_product_id ON public.product_aliases (product_id);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON public.audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_table_name ON public.audit_logs (table_name);

CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON public.user_roles (user_id);

CREATE INDEX IF NOT EXISTS idx_report_votes_report_id ON public.report_votes (report_id);

-- 4) PUBLIC READ VIEWS (safe aggregated data) --

-- Approved price reports view (no user_id exposed)
CREATE OR REPLACE VIEW public.v_approved_reports AS
SELECT
  pr.id,
  pr.product_id,
  pr.store_id,
  pr.region_id,
  pr.price,
  pr.currency,
  pr.unit,
  pr.quantity,
  pr.notes,
  pr.upvotes,
  pr.downvotes,
  pr.trust_score,
  pr.reported_at,
  pr.created_at
FROM public.price_reports pr
WHERE pr.status = 'approved';

-- Comment: This view exposes only approved reports without user_id.
-- Trust boundary: anon and authenticated users can read this view.
COMMENT ON VIEW public.v_approved_reports IS 'Public-safe view of approved price reports. No user_id exposed. Trust boundary: read-only for all roles.';

-- Product summary with latest price stats per region
CREATE OR REPLACE VIEW public.v_product_price_summary AS
SELECT
  p.id AS product_id,
  p.name_ar,
  p.name_en,
  p.category,
  p.unit,
  pr.region_id,
  COUNT(pr.id) AS report_count,
  AVG(pr.price) AS avg_price,
  MIN(pr.price) AS min_price,
  MAX(pr.price) AS max_price,
  MAX(pr.reported_at) AS latest_report_at
FROM public.products p
LEFT JOIN public.price_reports pr ON pr.product_id = p.id AND pr.status = 'approved'
GROUP BY p.id, p.name_ar, p.name_en, p.category, p.unit, pr.region_id;

COMMENT ON VIEW public.v_product_price_summary IS 'Aggregated price statistics per product per region. Only approved reports included. Trust boundary: safe for public read.';

-- 5) AUDIT INTEGRITY --
-- Ensure audit_logs can only be inserted by triggers/service role.
-- RLS already blocks anon/auth INSERT. Add explicit COMMENT.
COMMENT ON TABLE public.audit_logs IS 'Immutable audit trail. INSERT only via database triggers or service_role. No client-side writes allowed. Trust boundary: backend-only write path.';

-- Add comments on all RLS policies for trust boundary documentation
COMMENT ON POLICY "Admins can view audit logs" ON public.audit_logs IS 'Trust boundary: only admin role can read audit logs. No write access for any client role.';
COMMENT ON POLICY "Users can create own alerts" ON public.alerts IS 'Trust boundary: authenticated users can only create alerts for themselves (user_id = auth.uid()).';
COMMENT ON POLICY "Users can view own alerts" ON public.alerts IS 'Trust boundary: users can only see their own alerts.';
COMMENT ON POLICY "Users can update own alerts" ON public.alerts IS 'Trust boundary: users can only modify their own alerts.';
COMMENT ON POLICY "Users can delete own alerts" ON public.alerts IS 'Trust boundary: users can only delete their own alerts.';
COMMENT ON POLICY "Users can submit reports" ON public.price_reports IS 'Trust boundary: authenticated users insert reports with user_id = auth.uid() only.';
COMMENT ON POLICY "Approved reports are publicly viewable" ON public.price_reports IS 'Trust boundary: only approved reports visible to public. Pending/rejected/flagged hidden.';
COMMENT ON POLICY "Users can view own reports" ON public.price_reports IS 'Trust boundary: users see all their own reports regardless of status.';
COMMENT ON POLICY "Users can update own pending reports" ON public.price_reports IS 'Trust boundary: users can only edit their own reports while still pending.';
COMMENT ON POLICY "Moderators can manage reports" ON public.price_reports IS 'Trust boundary: moderator role has full CRUD on all reports for moderation workflow.';
COMMENT ON POLICY "Moderators can insert moderation actions" ON public.moderation_actions IS 'Trust boundary: only moderators can create actions, and moderator_id must match auth.uid().';
COMMENT ON POLICY "Moderators can view moderation actions" ON public.moderation_actions IS 'Trust boundary: only moderators can view moderation history.';
