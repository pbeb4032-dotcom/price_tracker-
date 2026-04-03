
-- Enable pg_cron and pg_net for scheduled dispatch (Supabase-only extensions).
-- In local / vanilla Postgres these extensions may not exist; skip safely.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'extensions') THEN
    EXECUTE 'CREATE SCHEMA IF NOT EXISTS extensions';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    EXECUTE 'CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_net') THEN
    EXECUTE 'CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions';
  END IF;
END $$;
