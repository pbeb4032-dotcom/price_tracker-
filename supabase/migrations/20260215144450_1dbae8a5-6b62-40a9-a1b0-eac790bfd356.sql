
-- PATCH-1: Fix view visibility for anon users
ALTER VIEW public.v_best_offers_ui SET (security_invoker = false);
ALTER VIEW public.v_best_offers SET (security_invoker = false);

GRANT SELECT ON public.v_best_offers_ui TO anon, authenticated;
GRANT SELECT ON public.v_best_offers TO anon, authenticated;
