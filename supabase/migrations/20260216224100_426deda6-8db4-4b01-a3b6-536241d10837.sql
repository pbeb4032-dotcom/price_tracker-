
-- Fix: Replace overly permissive ALL policy with separate read/write policies
DROP POLICY IF EXISTS "error_events_service_only" ON public.ingestion_error_events;
DROP POLICY IF EXISTS "error_events_admin_read" ON public.ingestion_error_events;

-- Admins can read error events
CREATE POLICY "error_events_admin_read" ON public.ingestion_error_events
  FOR SELECT USING (has_role(auth.uid(), 'admin'::app_role));

-- No public insert/update/delete (service_role bypasses RLS)
