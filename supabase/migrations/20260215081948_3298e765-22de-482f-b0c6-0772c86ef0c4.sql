
-- Add include_delivery column to existing alerts table
ALTER TABLE public.alerts ADD COLUMN IF NOT EXISTS include_delivery boolean NOT NULL DEFAULT false;

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_alerts_product_region ON public.alerts(product_id, region_id);

-- RPC: find triggered alerts (read-only, service_role only)
CREATE OR REPLACE FUNCTION public.get_triggered_price_alerts(p_limit int DEFAULT 500)
RETURNS TABLE (
  alert_id uuid,
  user_id uuid,
  product_id uuid,
  region_id uuid,
  target_price numeric,
  current_price numeric,
  source_name_ar text,
  source_url text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH ranked AS (
    SELECT
      a.id AS alert_id,
      a.user_id,
      a.product_id,
      a.region_id,
      a.target_price,
      o.source_name_ar,
      o.source_url,
      CASE
        WHEN a.include_delivery THEN (o.final_price + COALESCE(o.delivery_fee, 0))
        ELSE o.final_price
      END AS effective_price,
      ROW_NUMBER() OVER (
        PARTITION BY a.id
        ORDER BY
          CASE
            WHEN a.include_delivery THEN (o.final_price + COALESCE(o.delivery_fee, 0))
            ELSE o.final_price
          END ASC,
          o.observed_at DESC
      ) AS rn
    FROM public.alerts a
    JOIN public.v_product_all_offers o
      ON o.product_id = a.product_id
     AND (a.region_id IS NULL OR o.region_id = a.region_id)
    WHERE a.is_active = true
      AND o.in_stock = true
      AND (a.last_triggered_at IS NULL OR a.last_triggered_at < now() - interval '12 hours')
  )
  SELECT
    r.alert_id,
    r.user_id,
    r.product_id,
    r.region_id,
    r.target_price,
    r.effective_price AS current_price,
    r.source_name_ar,
    r.source_url
  FROM ranked r
  WHERE r.rn = 1
    AND r.effective_price <= r.target_price
  ORDER BY r.effective_price ASC
  LIMIT GREATEST(p_limit, 1);
$$;

REVOKE ALL ON FUNCTION public.get_triggered_price_alerts(int) FROM public;
GRANT EXECUTE ON FUNCTION public.get_triggered_price_alerts(int) TO service_role;
