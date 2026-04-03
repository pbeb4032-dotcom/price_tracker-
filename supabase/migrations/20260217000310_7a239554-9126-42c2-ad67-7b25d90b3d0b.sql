
-- P3.13.4c: Query intent boost + brand miss penalty

-- 1) Intent rules table
CREATE TABLE IF NOT EXISTS public.search_intent_rules (
  id          bigserial PRIMARY KEY,
  intent      text NOT NULL CHECK (intent IN ('cheap', 'best', 'original')),
  alias       text NOT NULL,
  boost       numeric(8,4) NOT NULL CHECK (boost > 0 AND boost <= 0.3000),
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_search_intent_rules_norm
ON public.search_intent_rules (
  intent,
  public.normalize_ar_text(lower(alias))
);

ALTER TABLE public.search_intent_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS intent_rules_read ON public.search_intent_rules;
CREATE POLICY intent_rules_read
  ON public.search_intent_rules FOR SELECT USING (true);

DROP POLICY IF EXISTS intent_rules_admin ON public.search_intent_rules;
CREATE POLICY intent_rules_admin
  ON public.search_intent_rules FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

-- 2) Seed intent aliases
INSERT INTO public.search_intent_rules (intent, alias, boost) VALUES
  ('cheap', 'ارخص', 0.1400), ('cheap', 'رخيص', 0.1200), ('cheap', 'اقتصادي', 0.1000),
  ('cheap', 'cheap', 0.1200), ('cheap', 'cheapest', 0.1400), ('cheap', 'budget', 0.1000),
  ('best', 'افضل', 0.0900), ('best', 'احسن', 0.0900), ('best', 'best', 0.0900),
  ('best', 'top', 0.0700), ('best', 'premium', 0.0800),
  ('original', 'اصلي', 0.1300), ('original', 'وكالة', 0.1000), ('original', 'مضمون', 0.0800),
  ('original', 'original', 0.1300), ('original', 'genuine', 0.1300),
  ('original', 'authentic', 0.1200), ('original', 'oem', 0.1000)
ON CONFLICT DO NOTHING;

-- 3) Replace search_products_live with intent + brand miss penalty
CREATE OR REPLACE FUNCTION public.search_products_live(
  p_query text, p_region_id uuid DEFAULT NULL, p_filters jsonb DEFAULT '{}'::jsonb,
  p_limit int DEFAULT 24, p_offset int DEFAULT 0, p_sort text DEFAULT 'best'
)
RETURNS TABLE(
  product_id uuid, name_ar text, name_en text, image_url text,
  category text, best_price_iqd numeric, source_id uuid,
  source_name text, rank_score numeric
)
LANGUAGE sql STABLE
SET search_path TO 'public', 'extensions'
AS $function$
WITH prm AS (
  SELECT
    public.normalize_ar_text(coalesce(p_query,'')) AS q,
    public.expand_query_text(coalesce(p_query,'')) AS qx,
    lower(coalesce(p_query,'')) AS q_en,
    coalesce(nullif(trim(coalesce(p_filters->>'category','')), ''), '') AS cat,
    coalesce(nullif(regexp_replace(coalesce(p_filters->>'min_price_iqd',''),'[^0-9.]','','g'),'')::numeric, 0) AS pmin,
    coalesce(nullif(regexp_replace(coalesce(p_filters->>'max_price_iqd',''),'[^0-9.]','','g'),'')::numeric, 999999999) AS pmax
),
offers AS (
  SELECT DISTINCT ON (o.product_id)
    o.product_id, o.normalized_price_iqd::numeric AS best_price_iqd, o.source_id,
    coalesce(o.merchant_name, ps.name_ar, ps.domain) AS source_name
  FROM public.source_price_observations o
  LEFT JOIN public.price_sources ps ON ps.id = o.source_id
  WHERE o.is_synthetic = false AND o.normalized_price_iqd > 0
    AND o.observed_at >= now() - interval '14 days'
    AND (p_region_id IS NULL OR o.region_id = p_region_id)
  ORDER BY o.product_id, o.normalized_price_iqd ASC, o.observed_at DESC
),
intent_flags AS (
  SELECT
    coalesce(max(CASE WHEN i.intent='cheap' THEN i.boost END), 0)::numeric(8,4) AS cheap_boost,
    coalesce(max(CASE WHEN i.intent='best' THEN i.boost END), 0)::numeric(8,4) AS best_boost,
    coalesce(max(CASE WHEN i.intent='original' THEN i.boost END), 0)::numeric(8,4) AS original_boost
  FROM public.search_intent_rules i CROSS JOIN prm
  WHERE i.is_active = true
    AND (prm.q LIKE '%' || public.normalize_ar_text(lower(i.alias)) || '%'
      OR prm.q_en LIKE '%' || lower(i.alias) || '%')
),
query_brands AS (
  SELECT b.alias, b.boost
  FROM public.search_brand_aliases b CROSS JOIN prm
  WHERE b.is_active = true
    AND (prm.q LIKE '%' || public.normalize_ar_text(lower(b.alias)) || '%'
      OR prm.q_en LIKE '%' || lower(b.alias) || '%')
),
brand_meta AS (
  SELECT count(*)::int AS brand_cnt FROM query_brands
),
prod AS (
  SELECT p.id, p.name_ar, p.name_en, p.image_url, p.category,
    public.normalize_ar_text(coalesce(p.name_ar,'')) AS ar_norm,
    lower(coalesce(p.name_en,'')) AS en_norm
  FROM public.products p WHERE p.is_active = true
),
cand AS (
  SELECT
    p.id AS product_id, p.name_ar, p.name_en, p.image_url, p.category,
    ofr.best_price_iqd, ofr.source_id, ofr.source_name,
    (
      GREATEST(
        extensions.similarity(p.ar_norm, prm.q),
        extensions.word_similarity(p.ar_norm, prm.q),
        CASE WHEN prm.qx <> prm.q THEN extensions.similarity(p.ar_norm, prm.qx) ELSE 0 END
      ) * 0.50
      + GREATEST(
          extensions.similarity(p.en_norm, prm.q_en),
          extensions.word_similarity(p.en_norm, prm.q_en)
        ) * 0.18
      + CASE WHEN p.ar_norm = prm.q OR p.en_norm = prm.q_en THEN 0.42 ELSE 0 END
      + CASE WHEN p.ar_norm LIKE prm.q || '%' OR p.en_norm LIKE prm.q_en || '%' THEN 0.24 ELSE 0 END
      + CASE WHEN ofr.best_price_iqd IS NULL THEN 0
             ELSE LEAST(0.20, (30000.0 / NULLIF(ofr.best_price_iqd, 0))) END
      + CASE WHEN it.cheap_boost > 0 AND ofr.best_price_iqd IS NOT NULL
             THEN LEAST(it.cheap_boost, (70000.0 / NULLIF(ofr.best_price_iqd, 0))) ELSE 0 END
      + CASE WHEN it.best_boost > 0 AND (
              p.ar_norm = prm.q OR p.en_norm = prm.q_en OR
              p.ar_norm LIKE prm.q || '%' OR p.en_norm LIKE prm.q_en || '%')
             THEN it.best_boost ELSE 0 END
      + CASE WHEN it.original_boost > 0 AND (
              p.ar_norm ~ '(اصلي|اورجنال|وكاله|مضمون)'
              OR p.en_norm ~ '(original|genuine|authentic|oem)')
             THEN it.original_boost ELSE 0 END
      + coalesce(br.brand_boost, 0)
      + CASE WHEN bm.brand_cnt > 0 AND coalesce(br.brand_boost, 0) = 0
             THEN -0.0800 ELSE 0 END
    )::numeric(12,6) AS rank_score
  FROM prod p
  CROSS JOIN prm CROSS JOIN intent_flags it CROSS JOIN brand_meta bm
  LEFT JOIN offers ofr ON ofr.product_id = p.id
  LEFT JOIN LATERAL (
    SELECT coalesce(max(qb.boost), 0)::numeric(8,4) AS brand_boost
    FROM query_brands qb
    WHERE p.ar_norm LIKE '%' || public.normalize_ar_text(lower(qb.alias)) || '%'
       OR p.en_norm LIKE '%' || lower(qb.alias) || '%'
  ) br ON true
  WHERE
    (p.ar_norm LIKE '%' || prm.q || '%'
      OR p.en_norm LIKE '%' || prm.q_en || '%'
      OR extensions.word_similarity(p.ar_norm, prm.q) >= 0.08
      OR extensions.word_similarity(p.en_norm, prm.q_en) >= 0.08
      OR (prm.qx <> prm.q AND (
        p.ar_norm LIKE '%' || prm.qx || '%'
        OR extensions.word_similarity(p.ar_norm, prm.qx) >= 0.08)))
    AND (prm.cat = '' OR coalesce(p.category,'') = prm.cat)
    AND coalesce(ofr.best_price_iqd, 0) BETWEEN prm.pmin AND prm.pmax
)
SELECT c.product_id, c.name_ar, c.name_en, c.image_url, c.category,
  c.best_price_iqd, c.source_id, c.source_name, c.rank_score
FROM cand c
ORDER BY
  CASE WHEN p_sort='price_asc' THEN c.best_price_iqd END ASC NULLS LAST,
  CASE WHEN p_sort='price_desc' THEN c.best_price_iqd END DESC NULLS LAST,
  c.rank_score DESC, c.best_price_iqd ASC NULLS LAST
LIMIT GREATEST(1, LEAST(p_limit, 100))
OFFSET GREATEST(0, p_offset);
$function$;

-- 4) Force cache rebuild
UPDATE public.search_queries
SET expires_at = now() - interval '1 second', updated_at = now()
WHERE expires_at > now();
