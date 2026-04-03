-- Ensure product_url_map has url_hash column and unique index used by ingestion upserts.

DO $$
BEGIN
  IF to_regclass('public.product_url_map') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema='public' AND table_name='product_url_map' AND column_name='url_hash'
    ) THEN
      ALTER TABLE public.product_url_map
        ADD COLUMN url_hash text GENERATED ALWAYS AS (md5(lower(url))) STORED;
    END IF;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_product_url_map_source_url_hash
      ON public.product_url_map(source_id, url_hash);
  END IF;
END $$;
