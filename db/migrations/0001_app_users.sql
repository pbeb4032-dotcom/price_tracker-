-- Internal user mapping for Clerk (or any external IdP).
-- Keeps the rest of the schema unchanged (still uses UUID user_id everywhere).

create extension if not exists pgcrypto;

create table if not exists public.app_users (
  id uuid primary key default gen_random_uuid(),
  clerk_user_id text not null unique,
  created_at timestamptz not null default now()
);

-- Ensure profiles has updated_at if not already.
alter table if exists public.profiles
  add column if not exists updated_at timestamptz;

create index if not exists app_users_clerk_user_id_idx on public.app_users (clerk_user_id);
