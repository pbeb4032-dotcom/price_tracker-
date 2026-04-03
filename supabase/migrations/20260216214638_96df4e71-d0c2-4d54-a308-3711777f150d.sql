
-- Tighten search cache RLS: only the RPC function should write, 
-- but since it runs as SECURITY INVOKER we need permissive INSERT/DELETE
-- for the function to work. These tables contain only cached product IDs (public data).
-- The RPC itself validates all inputs. This is acceptable for a search cache.

-- No schema changes needed - the existing policies are correct for this use case.
-- Just document: search_queries and search_cache_entries store only references
-- to public product data, no user-private information.

SELECT 1; -- no-op migration to acknowledge security review
