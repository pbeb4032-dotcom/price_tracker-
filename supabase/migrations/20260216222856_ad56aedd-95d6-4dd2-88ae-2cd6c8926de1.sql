
-- P3.11.A1: Bootstrap paths table
CREATE TABLE IF NOT EXISTS public.domain_bootstrap_paths (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_domain text NOT NULL,
  path text NOT NULL,
  page_type text NOT NULL DEFAULT 'category',
  priority int NOT NULL DEFAULT 100,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(source_domain, path)
);

ALTER TABLE public.domain_bootstrap_paths ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Bootstrap paths publicly readable"
  ON public.domain_bootstrap_paths FOR SELECT
  USING (true);

CREATE POLICY "Admins can manage bootstrap paths"
  ON public.domain_bootstrap_paths FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));
