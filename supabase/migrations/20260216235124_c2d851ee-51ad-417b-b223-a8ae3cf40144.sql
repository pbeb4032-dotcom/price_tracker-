
-- P3.13.4a: unique index to prevent duplicate synonyms (case-insensitive)
CREATE UNIQUE INDEX IF NOT EXISTS uq_search_synonyms_alias_canonical_lower
  ON public.search_synonyms (lower(alias), lower(canonical));
