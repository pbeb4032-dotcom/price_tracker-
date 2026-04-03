
-- Fix SECURITY DEFINER views to use SECURITY INVOKER (safe default)
ALTER VIEW public.v_approved_reports SET (security_invoker = on);
ALTER VIEW public.v_product_price_summary SET (security_invoker = on);
