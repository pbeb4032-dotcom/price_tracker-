
-- P3.13.4b: Hardening guards

-- 1) Prevent activating short brand aliases
ALTER TABLE public.search_brand_aliases
DROP CONSTRAINT IF EXISTS chk_brand_aliases_min_active_len;

ALTER TABLE public.search_brand_aliases
ADD CONSTRAINT chk_brand_aliases_min_active_len
CHECK (
  is_active = false
  OR char_length(trim(alias)) >= 3
);

-- 2) Prevent duplicate synonyms with different casing/normalization
CREATE UNIQUE INDEX IF NOT EXISTS uq_search_synonyms_alias_canonical_norm
ON public.search_synonyms (
  public.normalize_ar_text(lower(alias)),
  public.normalize_ar_text(lower(canonical))
);
