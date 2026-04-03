CREATE OR REPLACE FUNCTION public.claim_crawl_frontier_batch(
  p_limit integer DEFAULT 25,
  p_exclude_domains text[] DEFAULT '{}',
  p_per_domain_limit integer DEFAULT 5
)
RETURNS TABLE(id uuid, url text, source_domain text, page_type text, depth integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT cf.id,
           cf.discovered_at,
           cf.source_domain,
           row_number() OVER (
             PARTITION BY cf.source_domain
             ORDER BY cf.discovered_at ASC
           ) AS rn
    FROM public.crawl_frontier cf
    WHERE cf.status = 'pending'
      AND cf.next_retry_at <= now()
      AND cf.page_type IN ('product','category','unknown')
      AND NOT (cf.source_domain = ANY(COALESCE(p_exclude_domains, '{}'::text[])))
  ),
  picked AS (
    SELECT c.id
    FROM candidates c
    WHERE c.rn <= GREATEST(p_per_domain_limit, 1)
    ORDER BY c.discovered_at ASC
    LIMIT GREATEST(1, LEAST(p_limit, 200))
    FOR UPDATE SKIP LOCKED
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
$function$;