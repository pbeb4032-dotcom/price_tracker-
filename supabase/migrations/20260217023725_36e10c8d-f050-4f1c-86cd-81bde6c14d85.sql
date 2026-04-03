
DROP FUNCTION IF EXISTS public.search_products_engine(text, uuid, jsonb, integer, integer, text);

CREATE OR REPLACE FUNCTION public.search_products_engine(
  p_query text,
  p_region_id uuid DEFAULT NULL::uuid,
  p_filters jsonb DEFAULT '{}'::jsonb,
  p_limit integer DEFAULT 24,
  p_offset integer DEFAULT 0,
  p_sort text DEFAULT 'best'::text
)
RETURNS TABLE(out_query_id uuid, product_id uuid, name_ar text, name_en text, image_url text, category text, best_price_iqd numeric, source_name text, rank_score numeric, cache_hit boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
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
      UPDATE search_queries SET status='refreshing', updated_at=now(), last_executed_at=now() WHERE search_queries.id = v_qid;
      DELETE FROM search_cache_entries sce WHERE sce.query_id = v_qid AND sce.region_id = v_rid;

      INSERT INTO search_cache_entries (query_id, product_id, region_id, rank, rank_score, best_price_iqd, source_id, source_name, image_url, payload)
      SELECT v_qid, l.product_id, v_rid,
        row_number() OVER (ORDER BY l.rank_score DESC, l.best_price_iqd ASC NULLS LAST)::int,
        l.rank_score, l.best_price_iqd, l.source_id, l.source_name, l.image_url,
        jsonb_build_object('name_ar',l.name_ar,'name_en',l.name_en,'category',l.category)
      FROM search_products_live(p_query, p_region_id, p_filters, GREATEST((p_limit + p_offset) * 4, 120), 0, 'best') l
      ON CONFLICT (query_id, product_id, region_id) DO UPDATE SET
        rank_score=EXCLUDED.rank_score, best_price_iqd=EXCLUDED.best_price_iqd,
        source_id=EXCLUDED.source_id, source_name=EXCLUDED.source_name,
        image_url=EXCLUDED.image_url, payload=EXCLUDED.payload, updated_at=now();

      GET DIAGNOSTICS v_rows = ROW_COUNT;
      UPDATE search_queries SET status='ready', result_count=v_rows, expires_at=now()+interval '6 hours',
        hits_count=hits_count+1, updated_at=now(), last_executed_at=now() WHERE search_queries.id = v_qid;
    END IF;
  ELSE
    UPDATE search_queries SET hits_count=hits_count+1, last_executed_at=now(), updated_at=now() WHERE search_queries.id = v_qid;
  END IF;

  v_lat := round((extract(epoch FROM clock_timestamp()-v_started)*1000)::numeric, 2);
  UPDATE search_queries SET avg_latency_ms = CASE WHEN avg_latency_ms IS NULL THEN v_lat
    ELSE round((avg_latency_ms*0.70+v_lat*0.30)::numeric,2) END, updated_at=now() WHERE search_queries.id = v_qid;

  INSERT INTO search_query_events (query_id, cache_hit, latency_ms, result_count)
  VALUES (v_qid, v_hit, v_lat,
    COALESCE(NULLIF(v_rows, 0),
      (SELECT count(*)::int FROM search_cache_entries sce2 WHERE sce2.query_id = v_qid AND sce2.region_id = v_rid)));

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
  UPDATE search_queries SET status='failed', updated_at=now() WHERE search_queries.id=v_qid;
  RAISE;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.search_products_engine(text, uuid, jsonb, integer, integer, text) TO anon, authenticated;
