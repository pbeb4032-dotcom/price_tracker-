-- ============================================================
-- Local auth support (email/password) for standalone mode
-- ============================================================

CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.password_auth (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION auth.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_password_auth_updated_at ON auth.password_auth;
CREATE TRIGGER trg_password_auth_updated_at
  BEFORE UPDATE ON auth.password_auth
  FOR EACH ROW EXECUTE FUNCTION auth.set_updated_at();

