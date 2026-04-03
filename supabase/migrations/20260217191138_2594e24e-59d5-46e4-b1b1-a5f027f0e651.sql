
-- 1) Replace claim_crawl_frontier_batch (concurrency-safe headroom version)
--    Drop old overloads first
DROP FUNCTION IF EXISTS public.claim_crawl_frontier_batch(integer);
DROP FUNCTION IF EXISTS public.claim_crawl_frontier_batch(integer, text[], integer);

CREATE OR REPLACE FUNCTION public.claim_crawl_frontier_batch(
  p_limit integer DEFAULT 20,
  p_exclude_domains text[] DEFAULT NULL,
  p_per_domain_limit integer DEFAULT 5
)
RETURNS TABLE(id uuid, url text, source_domain text, page_type text, depth integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_lim int := greatest(coalesce(p_limit, 20), 1);
  v_per int := greatest(coalesce(p_per_domain_limit, 5), 1);
  v_excluded text[] := coalesce(p_exclude_domains, '{}'::text[]);
BEGIN
  RETURN QUERY
  WITH domain_processing AS (
    SELECT
      cf.source_domain AS sd,
      count(*)::int AS processing_now
    FROM public.crawl_frontier cf
    WHERE cf.status = 'processing'
    GROUP BY cf.source_domain
  ),
  eligible AS (
    SELECT
      cf.id,
      cf.source_domain,
      cf.discovered_at,
      greatest(0, v_per - coalesce(dp.processing_now, 0))::int AS headroom
    FROM public.crawl_frontier cf
    LEFT JOIN domain_processing dp ON dp.sd = cf.source_domain
    WHERE cf.status = 'pending'
      AND (cf.next_retry_at IS NULL OR cf.next_retry_at <= now())
      AND cf.page_type IN ('product','category','unknown')
      AND NOT (cf.source_domain = ANY(v_excluded))
  ),
  ranked AS (
    SELECT
      e.id,
      e.source_domain,
      e.discovered_at,
      e.headroom,
      row_number() OVER (
        PARTITION BY e.source_domain
        ORDER BY e.discovered_at ASC, e.id ASC
      ) AS rn
    FROM eligible e
    WHERE e.headroom > 0
  ),
  picked AS (
    SELECT r.id
    FROM ranked r
    WHERE r.rn <= r.headroom
    ORDER BY r.discovered_at ASC, r.id ASC
    LIMIT v_lim
  ),
  locked AS (
    SELECT cf2.id
    FROM public.crawl_frontier cf2
    WHERE cf2.id IN (SELECT picked.id FROM picked)
    FOR UPDATE SKIP LOCKED
  ),
  claimed AS (
    UPDATE public.crawl_frontier cf3
    SET status = 'processing', updated_at = now()
    WHERE cf3.id IN (SELECT locked.id FROM locked)
    RETURNING cf3.id, cf3.url, cf3.source_domain, cf3.page_type, cf3.depth
  )
  SELECT claimed.id, claimed.url, claimed.source_domain, claimed.page_type, claimed.depth
  FROM claimed
  ORDER BY claimed.source_domain, claimed.id;
END;
$$;

-- Backward-compatible 1-arg overload
CREATE OR REPLACE FUNCTION public.claim_crawl_frontier_batch(p_limit integer)
RETURNS TABLE(id uuid, url text, source_domain text, page_type text, depth integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY SELECT * FROM public.claim_crawl_frontier_batch(p_limit, NULL, 5);
END;
$$;

-- 2) Advisory lock helpers for run-level exclusion
CREATE OR REPLACE FUNCTION public.try_acquire_ingest_lock()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT pg_try_advisory_lock(hashtext('ingest-product-pages'));
$$;

CREATE OR REPLACE FUNCTION public.release_ingest_lock()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT pg_advisory_unlock(hashtext('ingest-product-pages'));
$$;
