BEGIN;

-- Map crawled URLs to products (and keep canonical URL)
CREATE TABLE IF NOT EXISTS public.product_url_map (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES public.price_sources(id) ON DELETE CASCADE,
  url text NOT NULL,
  -- Used by ingestion jobs for fast upsert/dedup (matches code expectations)
  url_hash text GENERATED ALWAYS AS (md5(lower(url))) STORED,
  canonical_url text,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'new', -- new | mapped | error
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Primary upsert key used by the API jobs (on conflict (url_hash))
CREATE UNIQUE INDEX IF NOT EXISTS idx_product_url_map_source_url_hash
  ON public.product_url_map (source_id, url_hash);

CREATE UNIQUE INDEX IF NOT EXISTS idx_product_url_map_source_url
  ON public.product_url_map (source_id, url);

CREATE INDEX IF NOT EXISTS idx_product_url_map_product_id
  ON public.product_url_map (product_id);

-- updated_at trigger function
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$fn$;

-- updated_at trigger
DROP TRIGGER IF EXISTS trg_product_url_map_updated_at ON public.product_url_map;

CREATE TRIGGER trg_product_url_map_updated_at
BEFORE UPDATE ON public.product_url_map
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

COMMIT;