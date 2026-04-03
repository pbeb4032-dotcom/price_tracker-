
-- A1: Create ingestion_error_events table for failure analytics
CREATE TABLE public.ingestion_error_events (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  run_id uuid NULL,
  frontier_id uuid NULL,
  source_domain text NOT NULL,
  url text NOT NULL,
  http_status integer NULL,
  blocked_reason text NULL,
  error_code text NOT NULL,
  error_message text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Index for analytics queries
CREATE INDEX idx_ingestion_error_events_code ON public.ingestion_error_events (error_code);
CREATE INDEX idx_ingestion_error_events_domain ON public.ingestion_error_events (source_domain, created_at DESC);
CREATE INDEX idx_ingestion_error_events_created ON public.ingestion_error_events (created_at DESC);

-- Enable RLS
ALTER TABLE public.ingestion_error_events ENABLE ROW LEVEL SECURITY;

-- Service-role only for writes (edge functions), admins can read
CREATE POLICY "error_events_service_only" ON public.ingestion_error_events
  FOR ALL USING (true);

CREATE POLICY "error_events_admin_read" ON public.ingestion_error_events
  FOR SELECT USING (has_role(auth.uid(), 'admin'::app_role));

-- A3: Add last_error_code column to crawl_frontier
ALTER TABLE public.crawl_frontier ADD COLUMN IF NOT EXISTS last_error_code text NULL;
