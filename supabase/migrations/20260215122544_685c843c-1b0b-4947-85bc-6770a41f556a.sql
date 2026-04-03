
-- Revoke direct API access to the materialized view (security linter fix)
REVOKE ALL ON public.product_price_snapshot FROM anon, authenticated;

-- Grant read-only access explicitly (it's public pricing data)
GRANT SELECT ON public.product_price_snapshot TO anon, authenticated;
