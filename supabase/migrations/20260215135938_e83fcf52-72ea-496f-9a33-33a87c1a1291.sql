
-- R8-A: Rebuild v_best_offers_ui with electronics guardrail + verified image only

DROP VIEW IF EXISTS public.v_best_offers_ui;

CREATE VIEW public.v_best_offers_ui AS
SELECT
  b.*,
  CASE
    WHEN s.is_trusted = true
     AND s.display_iqd IS NOT NULL
     AND s.display_iqd > 0
     AND NOT (
       (COALESCE(b.category, '') = 'electronics' AND s.display_iqd < 100000)
       OR (
         (COALESCE(b.product_name_ar, '') || ' ' || COALESCE(b.product_name_en, ''))
           ~* '(iphone|آيفون|ايفون|سامسونج|galaxy|هاتف|phone)'
         AND s.display_iqd < 100000
       )
     )
    THEN s.display_iqd::numeric
    ELSE NULL
  END AS final_price_safe,
  s.median_iqd::numeric AS median_iqd_safe,
  s.samples::int AS price_samples,
  (
    SELECT pi.image_url
    FROM public.product_images pi
    WHERE pi.product_id = b.product_id
      AND pi.is_verified = true
      AND pi.image_url !~* '(picsum\.photos|placehold|placeholder|dummyimage|fakeimg|source\.unsplash\.com)'
    ORDER BY pi.is_primary DESC, pi.confidence_score DESC, pi.position ASC
    LIMIT 1
  ) AS product_image_url_safe
FROM public.v_best_offers b
LEFT JOIN public.product_price_snapshot_v2 s
  ON s.product_id = b.product_id;

ALTER VIEW public.v_best_offers_ui SET (security_invoker = on);
GRANT SELECT ON public.v_best_offers_ui TO anon, authenticated;
