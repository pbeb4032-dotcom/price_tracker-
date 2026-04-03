-- ============================================================
-- PUBLIC VIEWS SAFETY: never show offers from inactive/auto-disabled sources
-- Added: 2026-02-28
-- ============================================================

-- Best offers (per product+region)
CREATE OR REPLACE VIEW public.v_best_offers AS
SELECT DISTINCT ON (spo.product_id, spo.region_id)
  spo.id as offer_id,
  spo.product_id,
  p.name_ar as product_name_ar,
  p.name_en as product_name_en,
  p.image_url as product_image_url,
  p.category,
  p.unit,
  p.brand_ar,
  p.brand_en,
  p.barcode,
  p.size_value,
  p.size_unit,
  spo.price as base_price,
  spo.discount_price,
  COALESCE(spo.discount_price, spo.price) as final_price,
  spo.delivery_fee,
  spo.currency,
  spo.in_stock,
  spo.source_url,
  spo.merchant_name,
  spo.observed_at,
  spo.region_id,
  r.name_ar as region_name_ar,
  r.name_en as region_name_en,
  ps.name_ar as source_name_ar,
  ps.domain as source_domain,
  ps.logo_url as source_logo_url,
  ps.source_kind,
  spo.source_id,
  spo.is_verified,
  spo.raw_price_text,
  spo.normalized_price_iqd,
  spo.is_price_anomaly,
  spo.anomaly_reason,
  spo.price_confidence
FROM public.source_price_observations spo
JOIN public.products p ON spo.product_id = p.id
JOIN public.regions r ON spo.region_id = r.id
JOIN public.price_sources ps ON spo.source_id = ps.id
WHERE spo.is_verified = true
  AND p.is_active = true
  AND p.condition = 'new'
  AND spo.product_condition = 'new'
  AND spo.in_stock = true
  AND ps.is_active = true
  AND COALESCE(ps.auto_disabled,false) = false
ORDER BY spo.product_id, spo.region_id, COALESCE(spo.discount_price, spo.price) ASC, spo.observed_at DESC;

-- All offers for a product (public-safe)
CREATE OR REPLACE VIEW public.v_product_all_offers
WITH (security_invoker = on) AS
SELECT
  spo.id as offer_id,
  spo.product_id,
  p.name_ar as product_name_ar,
  p.name_en as product_name_en,
  p.image_url as product_image_url,
  p.category,
  p.unit,
  p.brand_ar,
  p.brand_en,
  spo.price as base_price,
  spo.discount_price,
  COALESCE(spo.discount_price, spo.price) as final_price,
  spo.delivery_fee,
  spo.currency,
  spo.in_stock,
  spo.source_url,
  spo.merchant_name,
  spo.observed_at,
  spo.region_id,
  r.name_ar as region_name_ar,
  r.name_en as region_name_en,
  ps.name_ar as source_name_ar,
  ps.domain as source_domain,
  ps.logo_url as source_logo_url,
  ps.source_kind,
  spo.source_id,
  spo.is_verified,
  spo.raw_price_text,
  spo.normalized_price_iqd,
  spo.is_price_anomaly,
  spo.anomaly_reason,
  spo.price_confidence
FROM public.source_price_observations spo
JOIN public.products p ON spo.product_id = p.id
JOIN public.regions r ON spo.region_id = r.id
JOIN public.price_sources ps ON spo.source_id = ps.id
WHERE p.is_active = true
  AND p.condition = 'new'
  AND spo.product_condition = 'new'
  AND ps.is_active = true
  AND COALESCE(ps.auto_disabled,false) = false
ORDER BY COALESCE(spo.discount_price, spo.price) ASC, spo.observed_at DESC;
