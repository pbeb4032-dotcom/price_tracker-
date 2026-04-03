-- ============================================================
-- P4.1: Site plugin system (domains) + API endpoints registry
-- ============================================================

-- A) Optional API endpoints per domain (Shopify/Woo/etc)
CREATE TABLE IF NOT EXISTS public.source_api_endpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain text NOT NULL,
  url text NOT NULL,
  endpoint_type text NOT NULL CHECK (endpoint_type IN (
    'shopify_products_json',
    'woocommerce_store_api',
    'generic_json'
  )),
  priority int NOT NULL DEFAULT 100,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (domain, url)
);

CREATE INDEX IF NOT EXISTS idx_source_api_endpoints_domain_active
  ON public.source_api_endpoints(domain, is_active, priority);

ALTER TABLE public.source_api_endpoints ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "Admins can manage API endpoints"
  ON public.source_api_endpoints FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY IF NOT EXISTS "API endpoints publicly readable"
  ON public.source_api_endpoints FOR SELECT
  USING (true);

CREATE TRIGGER IF NOT EXISTS update_source_api_endpoints_updated_at
  BEFORE UPDATE ON public.source_api_endpoints
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- B) Helpful view for admin UI (one row per domain)
CREATE OR REPLACE VIEW public.v_site_plugins
WITH (security_invoker = on) AS
SELECT
  ps.id AS source_id,
  ps.domain,
  ps.name_ar,
  ps.source_kind,
  ps.trust_weight,
  ps.is_active,
  ps.base_url,
  ps.logo_url,
  dup.product_regex,
  dup.category_regex,
  COALESCE(
    (
      SELECT jsonb_agg(jsonb_build_object(
        'id', se.id,
        'url', se.url,
        'page_type', se.page_type,
        'priority', se.priority,
        'is_active', se.is_active
      ) ORDER BY se.priority ASC)
      FROM public.source_entrypoints se
      WHERE se.domain = ps.domain
    ),
    '[]'::jsonb
  ) AS entrypoints,
  COALESCE(
    (
      SELECT jsonb_agg(jsonb_build_object(
        'id', sa.id,
        'adapter_type', sa.adapter_type,
        'priority', sa.priority,
        'is_active', sa.is_active,
        'selectors', sa.selectors
      ) ORDER BY sa.priority ASC)
      FROM public.source_adapters sa
      WHERE sa.source_id = ps.id
    ),
    '[]'::jsonb
  ) AS adapters,
  COALESCE(
    (
      SELECT jsonb_agg(jsonb_build_object(
        'id', ae.id,
        'url', ae.url,
        'endpoint_type', ae.endpoint_type,
        'priority', ae.priority,
        'is_active', ae.is_active
      ) ORDER BY ae.priority ASC)
      FROM public.source_api_endpoints ae
      WHERE ae.domain = ps.domain
    ),
    '[]'::jsonb
  ) AS api_endpoints
FROM public.price_sources ps
LEFT JOIN public.domain_url_patterns dup
  ON dup.domain = ps.domain
WHERE ps.country_code = 'IQ';
