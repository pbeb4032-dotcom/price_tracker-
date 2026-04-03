
-- P3.13.2: Complete search engine (fixed search_path for pg_trgm)

CREATE EXTENSION IF NOT EXISTS pg_trgm SCHEMA extensions;

-- 1) Arabic normalization
CREATE OR REPLACE FUNCTION public.normalize_ar_text(v text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public
AS $$
  SELECT trim(regexp_replace(regexp_replace(
    replace(replace(replace(replace(replace(lower(coalesce(v,'')),
      'أ','ا'),'إ','ا'),'آ','ا'),'ى','ي'),'ة','ه'),
    '[^[:alnum:]ء-ي ]+', ' ', 'g'), '\s+', ' ', 'g'));
$$;

-- 2) Cache key
CREATE OR REPLACE FUNCTION public.search_cache_key(
  p_query_norm text, p_region_id uuid, p_filters jsonb
) RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT md5(
    coalesce(p_query_norm,'') || '|' ||
    coalesce(p_region_id::text,'') || '|' ||
    coalesce((SELECT string_agg(k||'='||v,',' ORDER BY k)
              FROM jsonb_each_text(coalesce(p_filters,'{}'::jsonb)) AS t(k,v)), '')
  );
$$;

-- 3) Add columns
ALTER TABLE public.search_queries ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'ready';
ALTER TABLE public.search_queries ADD COLUMN IF NOT EXISTS result_count int NOT NULL DEFAULT 0;

ALTER TABLE public.search_cache_entries ADD COLUMN IF NOT EXISTS rank_score numeric(12,6) NOT NULL DEFAULT 0;
ALTER TABLE public.search_cache_entries ADD COLUMN IF NOT EXISTS best_price_iqd numeric(14,2);
ALTER TABLE public.search_cache_entries ADD COLUMN IF NOT EXISTS source_id uuid;
ALTER TABLE public.search_cache_entries ADD COLUMN IF NOT EXISTS source_name text;
ALTER TABLE public.search_cache_entries ADD COLUMN IF NOT EXISTS image_url text;
ALTER TABLE public.search_cache_entries ADD COLUMN IF NOT EXISTS payload jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.search_cache_entries ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Dedup + unique index
DELETE FROM public.search_cache_entries a
USING public.search_cache_entries b
WHERE a.id > b.id AND a.query_id = b.query_id AND a.product_id = b.product_id AND a.region_id = b.region_id;

CREATE UNIQUE INDEX IF NOT EXISTS uq_cache_entry_qpr
  ON public.search_cache_entries (query_id, product_id, region_id);

-- Performance indexes (normalize_ar_text now exists, so expression index works)
CREATE INDEX IF NOT EXISTS idx_obs_product_region_recent
  ON public.source_price_observations (product_id, region_id, observed_at DESC, normalized_price_iqd)
  WHERE is_synthetic = false;
CREATE INDEX IF NOT EXISTS idx_search_cache_query_rank
  ON public.search_cache_entries (query_id, region_id, rank_score DESC, best_price_iqd ASC);

-- 4) Live ranking search (search_path includes extensions for similarity())
CREATE OR REPLACE FUNCTION public.search_products_live(
  p_query text,
  p_region_id uuid DEFAULT NULL,
  p_filters jsonb DEFAULT '{}'::jsonb,
  p_limit int DEFAULT 24,
  p_offset int DEFAULT 0,
  p_sort text DEFAULT 'best'
)
RETURNS TABLE(
  product_id uuid, name_ar text, name_en text, image_url text,
  category text, best_price_iqd numeric, source_id uuid,
  source_name text, rank_score numeric
)
LANGUAGE sql STABLE SET search_path TO 'public', 'extensions'
AS $$
WITH prm AS (
  SELECT
    public.normalize_ar_text(p_query) AS q,
    coalesce(nullif(trim(coalesce(p_filters->>'category','')), ''), '') AS cat,
    coalesce(nullif(regexp_replace(coalesce(p_filters->>'min_price_iqd',''),'[^0-9.]','','g'),'')::numeric, 0) AS pmin,
    coalesce(nullif(regexp_replace(coalesce(p_filters->>'max_price_iqd',''),'[^0-9.]','','g'),'')::numeric, 999999999) AS pmax
),
offers AS (
  SELECT DISTINCT ON (o.product_id)
    o.product_id,
    o.normalized_price_iqd::numeric AS best_price_iqd,
    o.source_id,
    coalesce(o.merchant_name, ps.name_ar, ps.domain) AS source_name
  FROM public.source_price_observations o
  LEFT JOIN public.price_sources ps ON ps.id = o.source_id
  WHERE o.is_synthetic = false
    AND o.normalized_price_iqd > 0
    AND o.observed_at >= now() - interval '14 days'
    AND (p_region_id IS NULL OR o.region_id = p_region_id)
  ORDER BY o.product_id, o.normalized_price_iqd ASC, o.observed_at DESC
),
cand AS (
  SELECT
    p.id AS product_id, p.name_ar, p.name_en, p.image_url, p.category,
    ofr.best_price_iqd, ofr.source_id, ofr.source_name,
    (
      similarity(public.normalize_ar_text(coalesce(p.name_ar,'')), prm.q) * 0.60 +
      similarity(lower(coalesce(p.name_en,'')), lower(prm.q)) * 0.20 +
      CASE WHEN public.normalize_ar_text(coalesce(p.name_ar,'')) = prm.q
             OR lower(coalesce(p.name_en,'')) = lower(prm.q) THEN 0.45 ELSE 0 END +
      CASE WHEN public.normalize_ar_text(coalesce(p.name_ar,'')) LIKE prm.q||'%'
             OR lower(coalesce(p.name_en,'')) LIKE lower(prm.q)||'%' THEN 0.25 ELSE 0 END +
      CASE WHEN ofr.best_price_iqd IS NULL THEN 0
           ELSE LEAST(0.20, (30000.0 / NULLIF(ofr.best_price_iqd,0))) END
    )::numeric(12,6) AS rank_score
  FROM public.products p
  CROSS JOIN prm
  LEFT JOIN offers ofr ON ofr.product_id = p.id
  WHERE p.is_active = true
    AND (
      public.normalize_ar_text(coalesce(p.name_ar,'')) LIKE '%'||prm.q||'%'
      OR lower(coalesce(p.name_en,'')) LIKE '%'||lower(prm.q)||'%'
      OR similarity(public.normalize_ar_text(coalesce(p.name_ar,'')), prm.q) >= 0.10
      OR similarity(lower(coalesce(p.name_en,'')), lower(prm.q)) >= 0.10
    )
    AND (prm.cat = '' OR coalesce(p.category,'') = prm.cat)
    AND coalesce(ofr.best_price_iqd, 0) BETWEEN prm.pmin AND prm.pmax
)
SELECT c.product_id, c.name_ar, c.name_en, c.image_url, c.category,
       c.best_price_iqd, c.source_id, c.source_name, c.rank_score
FROM cand c
ORDER BY
  CASE WHEN p_sort='price_asc'  THEN c.best_price_iqd END ASC NULLS LAST,
  CASE WHEN p_sort='price_desc' THEN c.best_price_iqd END DESC NULLS LAST,
  c.rank_score DESC, c.best_price_iqd ASC NULLS LAST
LIMIT GREATEST(1, LEAST(p_limit, 100))
OFFSET GREATEST(0, p_offset);
$$;

-- 5) Cache-aware engine
CREATE OR REPLACE FUNCTION public.search_products_engine(
  p_query text,
  p_region_id uuid DEFAULT NULL,
  p_filters jsonb DEFAULT '{}'::jsonb,
  p_limit int DEFAULT 24,
  p_offset int DEFAULT 0,
  p_sort text DEFAULT 'best'
)
RETURNS TABLE(
  query_id uuid, product_id uuid, name_ar text, name_en text,
  image_url text, category text, best_price_iqd numeric,
  source_name text, rank_score numeric, cache_hit boolean
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_started timestamptz := clock_timestamp();
  v_q_norm text; v_ckey text; v_qid uuid; v_exp timestamptz;
  v_rows int := 0; v_lat numeric; v_hit boolean := true; v_rid text;
BEGIN
  v_q_norm := normalize_ar_text(p_query);
  IF char_length(v_q_norm) < 2 THEN RETURN; END IF;

  v_ckey := search_cache_key(v_q_norm, p_region_id, p_filters);
  v_rid  := coalesce(p_region_id::text, '');

  SELECT q.id, q.expires_at INTO v_qid, v_exp
  FROM search_queries q WHERE q.query_key = v_ckey LIMIT 1;

  IF v_qid IS NULL THEN
    INSERT INTO search_queries (query_key, query_text, normalized_query, filters, status, expires_at, hits_count, last_executed_at)
    VALUES (v_ckey, p_query, v_q_norm, coalesce(p_filters,'{}'::jsonb), 'refreshing', now()-interval '1 second', 0, now())
    RETURNING id, expires_at INTO v_qid, v_exp;
  END IF;

  IF v_exp <= now() THEN
    v_hit := false;
    PERFORM pg_advisory_xact_lock(hashtext(v_ckey));
    SELECT q.expires_at INTO v_exp FROM search_queries q WHERE q.id = v_qid FOR UPDATE;

    IF v_exp <= now() THEN
      UPDATE search_queries SET status='refreshing', updated_at=now(), last_executed_at=now() WHERE id = v_qid;
      DELETE FROM search_cache_entries WHERE query_id = v_qid AND region_id = v_rid;

      INSERT INTO search_cache_entries (query_id, product_id, region_id, rank, rank_score, best_price_iqd, source_id, source_name, image_url, payload)
      SELECT v_qid, l.product_id, v_rid,
        row_number() OVER (ORDER BY l.rank_score DESC, l.best_price_iqd ASC NULLS LAST)::int,
        l.rank_score, l.best_price_iqd, l.source_id, l.source_name, l.image_url,
        jsonb_build_object('name_ar',l.name_ar,'name_en',l.name_en,'category',l.category)
      FROM search_products_live(v_q_norm, p_region_id, p_filters, GREATEST(p_limit*8,120), 0, 'best') l
      ON CONFLICT (query_id, product_id, region_id) DO UPDATE SET
        rank_score=EXCLUDED.rank_score, best_price_iqd=EXCLUDED.best_price_iqd,
        source_id=EXCLUDED.source_id, source_name=EXCLUDED.source_name,
        image_url=EXCLUDED.image_url, payload=EXCLUDED.payload, updated_at=now();

      GET DIAGNOSTICS v_rows = ROW_COUNT;
      UPDATE search_queries SET status='ready', result_count=v_rows, expires_at=now()+interval '6 hours',
        hits_count=hits_count+1, updated_at=now(), last_executed_at=now() WHERE id = v_qid;
    END IF;
  ELSE
    UPDATE search_queries SET hits_count=hits_count+1, last_executed_at=now(), updated_at=now() WHERE id = v_qid;
  END IF;

  v_lat := round((extract(epoch FROM clock_timestamp()-v_started)*1000)::numeric, 2);
  UPDATE search_queries SET avg_latency_ms = CASE WHEN avg_latency_ms IS NULL THEN v_lat
    ELSE round((avg_latency_ms*0.70+v_lat*0.30)::numeric,2) END, updated_at=now() WHERE id = v_qid;

  RETURN QUERY
  SELECT v_qid, c.product_id, p.name_ar, p.name_en,
    coalesce(nullif(c.image_url,''), p.image_url), p.category, c.best_price_iqd,
    c.source_name, c.rank_score, v_hit
  FROM search_cache_entries c JOIN products p ON p.id = c.product_id
  WHERE c.query_id = v_qid AND c.region_id = v_rid
  ORDER BY
    CASE WHEN p_sort='price_asc' THEN c.best_price_iqd END ASC NULLS LAST,
    CASE WHEN p_sort='price_desc' THEN c.best_price_iqd END DESC NULLS LAST,
    c.rank_score DESC, c.best_price_iqd ASC NULLS LAST
  LIMIT GREATEST(1,LEAST(p_limit,100)) OFFSET GREATEST(0,p_offset);

EXCEPTION WHEN OTHERS THEN
  UPDATE search_queries SET status='failed', updated_at=now() WHERE id=v_qid;
  RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.search_products_engine(text,uuid,jsonb,int,int,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_products_engine(text,uuid,jsonb,int,int,text) TO anon, authenticated, service_role;
