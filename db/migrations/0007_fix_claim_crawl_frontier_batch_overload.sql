-- Fix ambiguous function resolution between 1-arg overload and 3-arg defaulted signature.
-- Keep only the 3-arg signature (it can be called with 1 arg thanks to DEFAULTs).

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'claim_crawl_frontier_batch'
      AND pg_get_function_identity_arguments(p.oid) = 'p_limit integer'
  ) THEN
    EXECUTE 'DROP FUNCTION public.claim_crawl_frontier_batch(integer)';
  END IF;
END $$;
