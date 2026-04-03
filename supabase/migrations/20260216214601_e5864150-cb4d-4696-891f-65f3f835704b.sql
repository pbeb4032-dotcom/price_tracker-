
-- =========================
-- P2: Full schema migration (all-in-one)
-- =========================

-- 1) FX correction log
CREATE TABLE IF NOT EXISTS public.p2_fx_fix_log (
  observation_id text PRIMARY KEY,
  source_domain text NOT NULL,
  old_price numeric NOT NULL,
  old_currency text,
  fx_rate numeric NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  fixed_at timestamptz
);

ALTER TABLE public.p2_fx_fix_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "p2_fx_admin" ON public.p2_fx_fix_log FOR ALL
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "p2_fx_read" ON public.p2_fx_fix_log FOR SELECT
  USING (true);

-- 2) Search queries table
CREATE TABLE public.search_queries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  query_key text NOT NULL UNIQUE,
  query_text text NOT NULL,
  normalized_query text NOT NULL,
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  hits_count int NOT NULL DEFAULT 0,
  last_executed_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_sq_exp ON public.search_queries(expires_at);
CREATE INDEX idx_sq_norm ON public.search_queries(normalized_query);

ALTER TABLE public.search_queries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sq_select" ON public.search_queries FOR SELECT USING (true);
CREATE POLICY "sq_insert" ON public.search_queries FOR INSERT WITH CHECK (true);
CREATE POLICY "sq_update" ON public.search_queries FOR UPDATE USING (true);

-- 3) Search cache entries
CREATE TABLE public.search_cache_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  query_id uuid NOT NULL REFERENCES public.search_queries(id) ON DELETE CASCADE,
  rank int NOT NULL,
  product_id uuid NOT NULL,
  region_id text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_sce_unique ON public.search_cache_entries(query_id, product_id, region_id);
CREATE INDEX idx_sce_rank ON public.search_cache_entries(query_id, rank);

ALTER TABLE public.search_cache_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sce_select" ON public.search_cache_entries FOR SELECT USING (true);
CREATE POLICY "sce_insert" ON public.search_cache_entries FOR INSERT WITH CHECK (true);
CREATE POLICY "sce_delete" ON public.search_cache_entries FOR DELETE USING (true);

-- 4) RPC: search_offers_cached
CREATE OR REPLACE FUNCTION public.search_offers_cached(
  p_query text,
  p_category text DEFAULT NULL,
  p_region_id uuid DEFAULT NULL,
  p_limit int DEFAULT 24
)
RETURNS SETOF public.v_best_offers_ui
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  norm_q text := lower(trim(coalesce(p_query, '')));
  norm_cat text := lower(trim(coalesce(p_category, '')));
  qkey text := md5(norm_q || '|' || norm_cat || '|' || coalesce(p_region_id::text,'') || '|' || p_limit::text);
  qid uuid;
BEGIN
  IF norm_q = '' THEN
    RETURN QUERY
    SELECT v.*
    FROM public.v_best_offers_ui v
    WHERE (norm_cat = '' OR norm_cat = 'all' OR lower(v.category) = norm_cat)
      AND (p_region_id IS NULL OR v.region_id = p_region_id)
    ORDER BY v.is_price_trusted DESC NULLS LAST, v.display_price_iqd ASC NULLS LAST
    LIMIT p_limit;
    RETURN;
  END IF;

  SELECT sq.id INTO qid
  FROM public.search_queries sq
  WHERE sq.query_key = qkey AND sq.expires_at > now()
  LIMIT 1;

  IF qid IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.search_cache_entries e WHERE e.query_id = qid) THEN
    UPDATE public.search_queries SET last_executed_at = now(), updated_at = now() WHERE id = qid;
    RETURN QUERY
    SELECT v.*
    FROM public.search_cache_entries e
    JOIN public.v_best_offers_ui v ON v.product_id = e.product_id
    WHERE e.query_id = qid
      AND (p_region_id IS NULL OR e.region_id = COALESCE(p_region_id::text,''))
      AND (norm_cat = '' OR norm_cat = 'all' OR lower(v.category) = norm_cat)
    ORDER BY e.rank ASC
    LIMIT p_limit;
    RETURN;
  END IF;

  INSERT INTO public.search_queries(query_key, query_text, normalized_query, filters, hits_count, last_executed_at, expires_at)
  VALUES (qkey, p_query, norm_q,
    jsonb_build_object('category', p_category, 'region_id', p_region_id, 'limit', p_limit),
    0, now(), now() + interval '6 hours')
  ON CONFLICT (query_key) DO UPDATE
  SET query_text = EXCLUDED.query_text, normalized_query = EXCLUDED.normalized_query,
      filters = EXCLUDED.filters, last_executed_at = now(),
      expires_at = now() + interval '6 hours', updated_at = now()
  RETURNING id INTO qid;

  DELETE FROM public.search_cache_entries WHERE query_id = qid;

  INSERT INTO public.search_cache_entries(query_id, rank, product_id, region_id)
  SELECT qid,
    row_number() OVER (ORDER BY v.is_price_trusted DESC NULLS LAST, v.display_price_iqd ASC NULLS LAST)::int,
    v.product_id,
    COALESCE(v.region_id::text, '')
  FROM public.v_best_offers_ui v
  WHERE (v.product_name_ar ILIKE '%' || norm_q || '%'
      OR COALESCE(v.product_name_en,'') ILIKE '%' || norm_q || '%'
      OR COALESCE(v.brand_ar,'') ILIKE '%' || norm_q || '%'
      OR COALESCE(v.brand_en,'') ILIKE '%' || norm_q || '%')
    AND (norm_cat = '' OR norm_cat = 'all' OR lower(v.category) = norm_cat)
    AND (p_region_id IS NULL OR v.region_id = p_region_id)
  LIMIT p_limit;

  UPDATE public.search_queries
  SET hits_count = (SELECT count(*) FROM public.search_cache_entries WHERE query_id = qid), updated_at = now()
  WHERE id = qid;

  RETURN QUERY
  SELECT v.*
  FROM public.search_cache_entries e
  JOIN public.v_best_offers_ui v ON v.product_id = e.product_id
  WHERE e.query_id = qid
    AND (p_region_id IS NULL OR e.region_id = COALESCE(p_region_id::text,''))
  ORDER BY e.rank ASC
  LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION public.search_offers_cached(text, text, uuid, int) TO anon, authenticated;
