
-- Create v_best_offers_ui: joins best offers with snapshot price + verified image
CREATE OR REPLACE VIEW public.v_best_offers_ui AS
SELECT
  bo.*,
  COALESCE(ps.display_iqd, bo.final_price) AS final_price_safe,
  COALESCE(pi.image_url, bo.product_image_url) AS product_image_url_safe
FROM public.v_best_offers bo
LEFT JOIN public.product_price_snapshot ps
  ON ps.product_id = bo.product_id
LEFT JOIN LATERAL (
  SELECT x.image_url
  FROM public.product_images x
  WHERE x.product_id = bo.product_id
    AND x.is_verified = true
  ORDER BY x.is_primary DESC, x.confidence_score DESC, x.position ASC
  LIMIT 1
) pi ON true;

-- Grant access
GRANT SELECT ON public.v_best_offers_ui TO anon, authenticated;
