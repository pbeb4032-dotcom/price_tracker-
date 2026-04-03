
-- R1-A: Product Images table for multi-image support with source attribution
-- Supports: multiple images per product, source tracking, confidence scoring, dedup

-- ------------------------------------------------------------
-- A) Create product_images table
-- ------------------------------------------------------------
CREATE TABLE public.product_images (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  image_url text NOT NULL,
  source_site text,              -- e.g. "talabat.com", "miswag.com"
  source_page_url text,          -- direct link to the product page
  position smallint NOT NULL DEFAULT 0,
  confidence_score numeric(3,2) NOT NULL DEFAULT 0.00
    CHECK (confidence_score >= 0 AND confidence_score <= 1),
  is_primary boolean NOT NULL DEFAULT false,
  is_verified boolean NOT NULL DEFAULT false,
  width integer,
  height integer,
  perceptual_hash text,          -- for dedup across sources
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Dedup: same product + same URL = one row
CREATE UNIQUE INDEX product_images_product_url_uidx
  ON public.product_images(product_id, image_url);

-- Fast lookup by product + primary flag
CREATE INDEX product_images_product_primary_idx
  ON public.product_images(product_id, is_primary DESC, position ASC);

-- Perceptual hash lookup for cross-source dedup
CREATE INDEX product_images_phash_idx
  ON public.product_images(perceptual_hash)
  WHERE perceptual_hash IS NOT NULL;

-- Auto-update updated_at
CREATE TRIGGER update_product_images_updated_at
  BEFORE UPDATE ON public.product_images
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- ------------------------------------------------------------
-- B) RLS Policies
-- ------------------------------------------------------------
ALTER TABLE public.product_images ENABLE ROW LEVEL SECURITY;

-- Public read (images are non-sensitive)
CREATE POLICY "Product images are publicly viewable"
  ON public.product_images
  FOR SELECT
  USING (true);

-- Admin write
CREATE POLICY "Admins can manage product images"
  ON public.product_images
  FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

-- ------------------------------------------------------------
-- C) Enforce single primary image per product (trigger)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_single_primary_image()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.is_primary = true THEN
    UPDATE public.product_images
    SET is_primary = false, updated_at = now()
    WHERE product_id = NEW.product_id
      AND id != NEW.id
      AND is_primary = true;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_enforce_single_primary_image
  AFTER INSERT OR UPDATE OF is_primary ON public.product_images
  FOR EACH ROW
  WHEN (NEW.is_primary = true)
  EXECUTE FUNCTION public.enforce_single_primary_image();
