-- =============================================================
-- RLS Integration Verification Script
-- =============================================================
-- Run in Lovable Cloud → Backend → Run SQL
-- Each test documents expected outcome.
-- Execute sequentially and verify results match expectations.
-- =============================================================

-- =============================================
-- SETUP: Verify preconditions
-- =============================================

-- PRECONDITION 1: RLS is ON for all 11 tables
-- Expected: 11 rows, all rowsecurity = true
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
AND tablename IN (
  'alerts','audit_logs','moderation_actions','price_reports',
  'product_aliases','products','profiles','regions',
  'report_votes','stores','user_roles'
)
ORDER BY tablename;

-- PRECONDITION 2: Views have security_invoker=on
-- Expected: Both views show security_invoker=on in reloptions
SELECT c.relname, c.reloptions
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
AND c.relname IN ('v_approved_reports','v_product_price_summary');

-- =============================================
-- TEST A: Anon cannot INSERT into protected tables
-- =============================================
-- RLS blocks all INSERT without auth.uid().
-- All INSERT policies require user_id = auth.uid().
-- Without a JWT, auth.uid() returns NULL → no policy matches → DENIED.
--
-- Verification: Count INSERT policies that DON'T require auth.uid():
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
AND cmd IN ('INSERT', 'ALL')
ORDER BY tablename;
-- Expected: Every INSERT/ALL policy uses auth.uid() or has_role(auth.uid(), ...)

-- =============================================
-- TEST B: Auth user can insert only OWN report
-- =============================================
-- Policy: "Users can submit reports" WITH CHECK (user_id = auth.uid())
-- This means: if user_id != auth.uid(), INSERT is DENIED.
SELECT policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
AND tablename = 'price_reports'
AND cmd = 'INSERT';
-- Expected: with_check contains "user_id = auth.uid()"

-- =============================================
-- TEST C: Users cannot read/edit others' alerts
-- =============================================
-- All alert policies scope to user_id = auth.uid()
SELECT policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
AND tablename = 'alerts'
ORDER BY cmd;
-- Expected: Every policy uses "user_id = auth.uid()" in qual or with_check.
-- No policy uses "true" for SELECT (unlike products/regions which are public).

-- =============================================
-- TEST D: Moderator-only on moderation_actions
-- =============================================
SELECT policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
AND tablename = 'moderation_actions'
ORDER BY cmd;
-- Expected:
--   INSERT: with_check contains has_role(..., 'moderator') AND moderator_id = auth.uid()
--   SELECT: qual contains has_role(..., 'moderator')
--   No UPDATE or DELETE policies exist → those operations are DENIED

-- =============================================
-- TEST E: No client inserts into audit_logs
-- =============================================
SELECT policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
AND tablename = 'audit_logs'
ORDER BY cmd;
-- Expected: Only SELECT policy for admin exists.
-- No INSERT/UPDATE/DELETE policies → all writes DENIED for any client role.
-- Only SECURITY DEFINER triggers (audit_report_status_change) can write.

-- =============================================
-- TEST F: Constraint enforcement verification
-- =============================================
SELECT conname, conrelid::regclass AS table_name, contype,
  CASE contype
    WHEN 'c' THEN 'CHECK'
    WHEN 'u' THEN 'UNIQUE'
    WHEN 'p' THEN 'PRIMARY KEY'
    WHEN 'f' THEN 'FOREIGN KEY'
  END AS constraint_type
FROM pg_constraint
WHERE conname IN (
  'uq_report_votes_user_report',
  'uq_product_alias_norm',
  'uq_alerts_dedup',
  'chk_price_range',
  'chk_quantity_positive',
  'chk_trust_score_range',
  'chk_alert_target_price',
  'chk_store_latitude',
  'chk_store_longitude',
  'chk_region_latitude',
  'chk_region_longitude'
)
ORDER BY table_name, conname;
-- Expected: 11 rows, all present.
-- 3 UNIQUE constraints + 8 CHECK constraints.
