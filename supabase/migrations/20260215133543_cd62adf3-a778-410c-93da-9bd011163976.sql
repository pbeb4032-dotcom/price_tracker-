
-- Fix security definer: explicitly set v_best_offers_ui to INVOKER security
ALTER VIEW public.v_best_offers_ui SET (security_invoker = on);
