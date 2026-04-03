
CREATE OR REPLACE FUNCTION public.search_quality_snapshot()
RETURNS public.search_quality_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_ac3 numeric := 0;
  v_ac5 numeric := 0;
  v_short int := 0;
  v_intents int := 0;
  v_p95 numeric := NULL;
  v_latency_samples int := 0;
  v_pass boolean := false;
  v_row public.search_quality_runs;
BEGIN
  -- AC3
  WITH r AS (
    SELECT * FROM public.search_products_live('apple iphone 15', NULL, '{}'::jsonb, 10, 0, 'best')
  ),
  m AS (
    SELECT
      count(*)::numeric AS n,
      count(*) FILTER (
        WHERE public.normalize_ar_text(coalesce(name_ar,'')) ~ '(ابل|ايفون)'
           OR lower(coalesce(name_en,'')) ~ '(apple|iphone)'
      )::numeric AS matched
    FROM r
  )
  SELECT COALESCE(round(matched / NULLIF(n,0), 3), 0)
  INTO v_ac3
  FROM m;

  -- AC5
  WITH a AS (
    SELECT product_id FROM public.search_products_live('جوال', NULL, '{}'::jsonb, 20, 0, 'best')
  ),
  b AS (
    SELECT product_id FROM public.search_products_live('هاتف', NULL, '{}'::jsonb, 20, 0, 'best')
  ),
  i AS (
    SELECT count(*)::numeric AS inter
    FROM (SELECT product_id FROM a INTERSECT SELECT product_id FROM b) x
  ),
  u AS (
    SELECT count(*)::numeric AS uni
    FROM (SELECT product_id FROM a UNION SELECT product_id FROM b) x
  )
  SELECT COALESCE(round(inter / NULLIF(uni,0), 3), 0)
  INTO v_ac5
  FROM i, u;

  SELECT count(*)
  INTO v_short
  FROM public.search_brand_aliases
  WHERE is_active = true
    AND char_length(trim(alias)) < 3;

  SELECT count(*)
  INTO v_intents
  FROM public.search_intent_rules
  WHERE is_active = true;

  SELECT count(*)::int
  INTO v_latency_samples
  FROM public.search_query_events
  WHERE created_at >= now() - interval '24 hours';

  IF v_latency_samples > 0 THEN
    SELECT round(percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms)::numeric, 2)
    INTO v_p95
    FROM public.search_query_events
    WHERE created_at >= now() - interval '24 hours';
  END IF;

  v_pass := (
    v_ac3 >= 0.60
    AND v_ac5 >= 0.40
    AND v_short = 0
    AND v_intents >= 10
    AND (v_latency_samples = 0 OR v_p95 <= 120)
  );

  INSERT INTO public.search_quality_runs (
    ac3_apple_ratio,
    ac5_jaccard_jawwal_hatif,
    active_short_aliases,
    intent_rules_count,
    p95_latency_ms,
    overall_pass,
    details
  )
  VALUES (
    v_ac3,
    v_ac5,
    v_short,
    v_intents,
    COALESCE(v_p95, 0),
    v_pass,
    jsonb_build_object(
      'thresholds', jsonb_build_object(
        'ac3_min', 0.60,
        'ac5_min', 0.40,
        'active_short_aliases_eq', 0,
        'intent_rules_min', 10,
        'p95_latency_max_ms', 120
      ),
      'latency_samples_24h', v_latency_samples,
      'latency_status', CASE WHEN v_latency_samples = 0 THEN 'insufficient_data' ELSE 'measured' END
    )
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;
