
-- Fix Security Definer Views → set SECURITY INVOKER
ALTER VIEW public.v_best_offers SET (security_invoker = on);
ALTER VIEW public.v_product_all_offers SET (security_invoker = on);

-- Move pg_trgm to extensions schema
CREATE SCHEMA IF NOT EXISTS extensions;
ALTER EXTENSION pg_trgm SET SCHEMA extensions;
