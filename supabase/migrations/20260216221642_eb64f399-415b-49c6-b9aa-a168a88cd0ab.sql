
-- P3.9b: Function + check constraints (indexes already applied)

-- A) Atomic claim function
CREATE OR REPLACE FUNCTION public.claim_crawl_frontier_batch(p_limit int DEFAULT 25)
RETURNS TABLE (
  id uuid,
  url text,
  source_domain text,
  page_type text,
  depth int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT cf.id
    FROM public.crawl_frontier cf
    WHERE cf.status = 'pending'
      AND cf.next_retry_at <= now()
      AND cf.page_type IN ('product','category','unknown')
    ORDER BY cf.discovered_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT GREATEST(1, LEAST(p_limit, 200))
  ),
  upd AS (
    UPDATE public.crawl_frontier cf
    SET status = 'processing',
        updated_at = now()
    WHERE cf.id IN (SELECT picked.id FROM picked)
    RETURNING cf.id, cf.url, cf.source_domain, cf.page_type, cf.depth
  )
  SELECT upd.id, upd.url, upd.source_domain, upd.page_type, upd.depth FROM upd;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_crawl_frontier_batch(int) TO service_role;

-- B) Check constraints
ALTER TABLE public.source_price_observations
  ADD CONSTRAINT chk_real_obs_normalized_iqd
  CHECK (
    COALESCE(is_synthetic, false) = true
    OR (normalized_price_iqd IS NOT NULL AND normalized_price_iqd > 0)
  );

ALTER TABLE public.source_price_observations
  ADD CONSTRAINT chk_currency_supported
  CHECK (currency IN ('IQD','USD'));
