
-- P3.9 remaining: indexes after dedup cleanup

-- C) Daily dedup at DB level
CREATE UNIQUE INDEX IF NOT EXISTS uq_obs_daily
ON public.source_price_observations (
  product_id,
  source_id,
  source_url,
  ((observed_at AT TIME ZONE 'UTC')::date)
);

-- D) Cache integrity dedup
CREATE UNIQUE INDEX IF NOT EXISTS uq_search_cache_entry
ON public.search_cache_entries (query_id, product_id, region_id);

-- E) Crawl retry index
CREATE INDEX IF NOT EXISTS idx_frontier_retry_pick
ON public.crawl_frontier (status, next_retry_at, discovered_at);
