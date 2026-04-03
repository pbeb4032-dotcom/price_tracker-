
-- P3.13.5: Quality Gate Automation

-- 1) Store automated quality runs
CREATE TABLE IF NOT EXISTS public.search_quality_runs (
  id bigserial PRIMARY KEY,
  run_at timestamptz NOT NULL DEFAULT now(),
  ac3_apple_ratio numeric(6,3) NOT NULL DEFAULT 0,
  ac5_jaccard_jawwal_hatif numeric(6,3) NOT NULL DEFAULT 0,
  active_short_aliases int NOT NULL DEFAULT 0,
  intent_rules_count int NOT NULL DEFAULT 0,
  p95_latency_ms numeric(10,2) NOT NULL DEFAULT 999,
  overall_pass boolean NOT NULL DEFAULT false,
  details jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- 2) RLS (admin read/write)
ALTER TABLE public.search_quality_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY sqr_admin_read
  ON public.search_quality_runs
  FOR SELECT
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY sqr_admin_all
  ON public.search_quality_runs
  FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

-- 3) Snapshot function
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
  v_p95 numeric := 999;
  v_pass boolean := false;
  v_row public.search_quality_runs;
BEGIN
  -- AC3: top10 brand-match ratio for "apple iphone 15"
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

  -- AC5: Jaccard between "جوال" and "هاتف"
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

  -- Sanity: no active short aliases
  SELECT count(*)
  INTO v_short
  FROM public.search_brand_aliases
  WHERE is_active = true
    AND char_length(trim(alias)) < 3;

  -- Sanity: intent rules count
  SELECT count(*)
  INTO v_intents
  FROM public.search_intent_rules
  WHERE is_active = true;

  -- p95 latency from recent telemetry
  SELECT COALESCE(
    round(percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms)::numeric, 2),
    999
  )
  INTO v_p95
  FROM public.search_query_events
  WHERE created_at >= now() - interval '24 hours';

  -- Gate thresholds
  v_pass := (
    v_ac3 >= 0.60
    AND v_ac5 >= 0.40
    AND v_short = 0
    AND v_intents >= 10
    AND v_p95 <= 120
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
    v_ac3, v_ac5, v_short, v_intents, v_p95, v_pass,
    jsonb_build_object(
      'thresholds', jsonb_build_object(
        'ac3_min', 0.60, 'ac5_min', 0.40,
        'active_short_aliases_eq', 0, 'intent_rules_min', 10,
        'p95_latency_max_ms', 120
      )
    )
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$function$;

REVOKE ALL ON FUNCTION public.search_quality_snapshot() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_quality_snapshot() TO service_role;
