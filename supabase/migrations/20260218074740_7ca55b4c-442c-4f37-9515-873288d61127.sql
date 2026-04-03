
-- 1) Mutex table for TTL-based locking (pooling-safe)
CREATE TABLE IF NOT EXISTS public.ingest_mutex (
  name text PRIMARY KEY,
  owner text NOT NULL,
  lock_until timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ingest_mutex ENABLE ROW LEVEL SECURITY;

-- Only service_role / SECURITY DEFINER functions touch this table
CREATE POLICY "ingest_mutex_service_only"
  ON public.ingest_mutex FOR ALL
  USING (true);

-- 2) Acquire (atomic, TTL-based)
CREATE OR REPLACE FUNCTION public.acquire_ingest_mutex(
  p_name text,
  p_owner text,
  p_ttl_seconds integer DEFAULT 900
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows int := 0;
BEGIN
  -- Try insert first
  BEGIN
    INSERT INTO public.ingest_mutex(name, owner, lock_until, updated_at)
    VALUES (p_name, p_owner, now() + make_interval(secs => p_ttl_seconds), now());
    RETURN true;
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  -- Existing row: take over only if expired or same owner
  UPDATE public.ingest_mutex m
     SET owner = p_owner,
         lock_until = now() + make_interval(secs => p_ttl_seconds),
         updated_at = now()
   WHERE m.name = p_name
     AND (m.lock_until < now() OR m.owner = p_owner);

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$$;

-- 3) Heartbeat / refresh
CREATE OR REPLACE FUNCTION public.refresh_ingest_mutex(
  p_name text,
  p_owner text,
  p_ttl_seconds integer DEFAULT 900
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.ingest_mutex m
     SET lock_until = now() + make_interval(secs => p_ttl_seconds),
         updated_at = now()
   WHERE m.name = p_name
     AND m.owner = p_owner
  RETURNING true;
$$;

-- 4) Release (owner-safe)
CREATE OR REPLACE FUNCTION public.release_ingest_mutex(
  p_name text,
  p_owner text
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.ingest_mutex
   WHERE name = p_name
     AND owner = p_owner
  RETURNING true;
$$;

-- 5) Drop old advisory lock helpers (no longer needed)
DROP FUNCTION IF EXISTS public.try_acquire_ingest_lock();
DROP FUNCTION IF EXISTS public.release_ingest_lock();
