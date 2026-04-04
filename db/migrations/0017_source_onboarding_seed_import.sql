-- Sprint 7 step 1: Iraqi source onboarding foundation

ALTER TABLE public.price_sources
  ADD COLUMN IF NOT EXISTS source_channel text NOT NULL DEFAULT 'website',
  ADD COLUMN IF NOT EXISTS adapter_strategy text NOT NULL DEFAULT 'html_sitemap',
  ADD COLUMN IF NOT EXISTS catalog_condition_policy text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS condition_confidence numeric(4,3),
  ADD COLUMN IF NOT EXISTS onboarding_origin text NOT NULL DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS source_priority integer NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS onboarding_meta jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE public.price_sources
SET
  source_channel = coalesce(nullif(source_channel, ''), case when source_kind = 'marketplace' then 'marketplace' else 'website' end),
  adapter_strategy = coalesce(nullif(adapter_strategy, ''), 'html_sitemap'),
  catalog_condition_policy = coalesce(nullif(catalog_condition_policy, ''), 'unknown'),
  condition_confidence = coalesce(condition_confidence, 0.50),
  onboarding_origin = coalesce(nullif(onboarding_origin, ''), case when coalesce(discovered_via, '') <> '' then discovered_via else 'legacy' end),
  source_priority = coalesce(source_priority, 100),
  onboarding_meta = coalesce(onboarding_meta, '{}'::jsonb),
  discovery_tags = coalesce(discovery_tags, '{}'::jsonb)
WHERE country_code = 'IQ';

CREATE TABLE IF NOT EXISTS public.source_seed_import_runs (
  id uuid primary key default gen_random_uuid(),
  import_name text not null default 'iraq_source_seed',
  mode text not null default 'apply',
  status text not null default 'running',
  row_count integer not null default 0,
  inserted_count integer not null default 0,
  updated_count integer not null default 0,
  invalid_count integer not null default 0,
  notes jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

CREATE INDEX IF NOT EXISTS idx_source_seed_import_runs_started
  ON public.source_seed_import_runs(started_at DESC);

CREATE TABLE IF NOT EXISTS public.source_seed_import_rows (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.source_seed_import_runs(id) on delete cascade,
  row_index integer not null,
  domain text,
  action text not null default 'invalid',
  source_id uuid null references public.price_sources(id) on delete set null,
  issues jsonb not null default '[]'::jsonb,
  raw_row jsonb not null default '{}'::jsonb,
  normalized_row jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

CREATE INDEX IF NOT EXISTS idx_source_seed_import_rows_run
  ON public.source_seed_import_rows(run_id, row_index ASC);

CREATE INDEX IF NOT EXISTS idx_source_seed_import_rows_source
  ON public.source_seed_import_rows(source_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.source_section_policies (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.price_sources(id) on delete cascade,
  section_key text not null,
  section_label text,
  section_url text,
  policy_scope text not null default 'allow',
  condition_policy text not null default 'new_only',
  priority integer not null default 100,
  is_active boolean not null default true,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(source_id, section_key)
);

CREATE INDEX IF NOT EXISTS idx_source_section_policies_source_active
  ON public.source_section_policies(source_id, is_active, priority ASC);
