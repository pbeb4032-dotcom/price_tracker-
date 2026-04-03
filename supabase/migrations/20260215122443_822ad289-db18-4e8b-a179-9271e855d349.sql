
-- R5: No need for "offers" compatibility view — code uses v_best_offers/source_price_observations directly.
-- This migration focuses on R6 (image cleanup) and R7 (robust price snapshot).

-- R6-A) DB function to check blocked image hosts
CREATE OR REPLACE FUNCTION public.is_blocked_image_host(url text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT coalesce(url,'') ~* '(https?://)?([^/]+\.)?(picsum\.photos|placehold\.co|via\.placeholder\.com|source\.unsplash\.com|dummyimage\.com|fakeimg\.pl|lorempixel\.com|placeholder\.com)(/|$)';
$$;

-- R6-B) Image recrawl queue for products missing real images
CREATE TABLE IF NOT EXISTS public.image_recrawl_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  attempts int NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Validation trigger instead of CHECK constraint
CREATE OR REPLACE FUNCTION public.validate_recrawl_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.status NOT IN ('pending', 'processing', 'done', 'failed') THEN
    RAISE EXCEPTION 'Invalid status: %', NEW.status;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_recrawl_status
  BEFORE INSERT OR UPDATE ON public.image_recrawl_queue
  FOR EACH ROW EXECUTE FUNCTION public.validate_recrawl_status();

-- Unique constraint per product (only one active entry)
CREATE UNIQUE INDEX IF NOT EXISTS idx_recrawl_queue_product
  ON public.image_recrawl_queue(product_id)
  WHERE status IN ('pending', 'processing');

-- RLS
ALTER TABLE public.image_recrawl_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage recrawl queue"
  ON public.image_recrawl_queue FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Public can view recrawl queue stats"
  ON public.image_recrawl_queue FOR SELECT
  USING (true);

-- R6-C) Enqueue products missing real images
INSERT INTO public.image_recrawl_queue(product_id, status)
SELECT p.id, 'pending'
FROM public.products p
WHERE NOT EXISTS (
  SELECT 1 FROM public.product_images pi
  WHERE pi.product_id = p.id
    AND NOT public.is_blocked_image_host(pi.image_url)
)
ON CONFLICT DO NOTHING;

-- R7) Materialized view for robust IQR-filtered prices
CREATE MATERIALIZED VIEW IF NOT EXISTS public.product_price_snapshot AS
WITH valid AS (
  SELECT
    s.product_id,
    COALESCE(s.normalized_price_iqd, COALESCE(s.discount_price, s.price))::bigint AS price_iqd
  FROM public.source_price_observations s
  WHERE COALESCE(s.normalized_price_iqd, COALESCE(s.discount_price, s.price)) > 0
    AND COALESCE(s.is_price_anomaly, false) = false
),
stats AS (
  SELECT
    product_id,
    percentile_cont(0.25) WITHIN GROUP (ORDER BY price_iqd) AS p25,
    percentile_cont(0.50) WITHIN GROUP (ORDER BY price_iqd) AS median_iqd,
    percentile_cont(0.75) WITHIN GROUP (ORDER BY price_iqd) AS p75,
    count(*) AS samples
  FROM valid
  GROUP BY product_id
),
iqr_filtered AS (
  SELECT
    v.product_id,
    v.price_iqd,
    st.p25, st.p75, st.median_iqd, st.samples,
    (st.p75 - st.p25) AS iqr
  FROM valid v
  JOIN stats st ON st.product_id = v.product_id
)
SELECT
  product_id,
  MIN(price_iqd) FILTER (
    WHERE price_iqd >= (p25 - 1.5 * iqr)
      AND price_iqd <= (p75 + 1.5 * iqr)
  )::bigint AS display_iqd,
  ROUND(median_iqd)::bigint AS median_iqd,
  samples
FROM iqr_filtered
GROUP BY product_id, median_iqd, samples;

CREATE UNIQUE INDEX IF NOT EXISTS idx_pps_product ON public.product_price_snapshot(product_id);
