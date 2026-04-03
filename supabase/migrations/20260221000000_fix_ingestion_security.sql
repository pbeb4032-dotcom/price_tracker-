-- ============================================================
-- SECURITY PATCH: Lock down internal ingestion tables
--
-- Why:
-- - ingestion_error_events had an overly-permissive policy (FOR ALL USING true)
-- - crawl_frontier was publicly readable, leaking crawl URLs and internal states
--
-- Service-role edge functions bypass RLS, so we do NOT need an INSERT policy
-- for these tables. We only allow admins to read/manage.
-- ============================================================

-- 1) ingestion_error_events: remove permissive policy
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'ingestion_error_events'
      AND policyname = 'error_events_service_only'
  ) THEN
    EXECUTE 'DROP POLICY "error_events_service_only" ON public.ingestion_error_events';
  END IF;
END $$;

-- Ensure admin read policy exists (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'ingestion_error_events'
      AND policyname = 'error_events_admin_read'
  ) THEN
    EXECUTE $$
      CREATE POLICY "error_events_admin_read" ON public.ingestion_error_events
        FOR SELECT USING (has_role(auth.uid(), 'admin'::app_role));
    $$;
  END IF;
END $$;

-- 2) crawl_frontier: remove public read (keep admin manage)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'crawl_frontier'
      AND policyname = 'Crawl frontier publicly readable'
  ) THEN
    EXECUTE 'DROP POLICY "Crawl frontier publicly readable" ON public.crawl_frontier';
  END IF;
END $$;
