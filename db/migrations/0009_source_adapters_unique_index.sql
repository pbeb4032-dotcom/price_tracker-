-- Ensure source_adapters supports ON CONFLICT (source_id, adapter_type)
-- by adding a UNIQUE index, after deduplicating any legacy duplicates.

DO $$
BEGIN
  IF to_regclass('public.source_adapters') IS NOT NULL THEN
    -- Remove duplicates (keep first physical row)
    DELETE FROM public.source_adapters a
    USING public.source_adapters b
    WHERE a.source_id = b.source_id
      AND a.adapter_type = b.adapter_type
      AND a.ctid > b.ctid;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_source_adapters_source_type_unique
      ON public.source_adapters(source_id, adapter_type);
  END IF;
END $$;
