import { sql } from 'drizzle-orm';
import { getDb, type Env } from '../db';

/**
 * Sprint 7 step 1:
 * - governed source onboarding metadata
 * - auditable source seed import runs
 * - section allowlists for mixed marketplaces
 */
export async function patchSourceOnboardingSchema(env: Env): Promise<any> {
  const db = getDb(env);

  await db.execute(sql`
    alter table public.price_sources
      add column if not exists source_channel text not null default 'website',
      add column if not exists adapter_strategy text not null default 'html_sitemap',
      add column if not exists catalog_condition_policy text not null default 'unknown',
      add column if not exists condition_confidence numeric(4,3),
      add column if not exists onboarding_origin text not null default 'legacy',
      add column if not exists source_priority integer not null default 100,
      add column if not exists onboarding_meta jsonb not null default '{}'::jsonb
  `).catch(() => {});

  await db.execute(sql`
    update public.price_sources
    set
      source_channel = coalesce(nullif(source_channel, ''), case when source_kind = 'marketplace' then 'marketplace' else 'website' end),
      adapter_strategy = coalesce(nullif(adapter_strategy, ''), 'html_sitemap'),
      catalog_condition_policy = coalesce(nullif(catalog_condition_policy, ''), 'unknown'),
      condition_confidence = coalesce(condition_confidence, 0.50),
      onboarding_origin = coalesce(nullif(onboarding_origin, ''), case when coalesce(discovered_via, '') <> '' then discovered_via else 'legacy' end),
      source_priority = coalesce(source_priority, 100),
      onboarding_meta = coalesce(onboarding_meta, '{}'::jsonb),
      discovery_tags = coalesce(discovery_tags, '{}'::jsonb)
    where country_code = 'IQ'
  `).catch(() => {});

  await db.execute(sql`
    create table if not exists public.source_seed_import_runs (
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
    )
  `).catch(() => {});
  await db.execute(sql`create index if not exists idx_source_seed_import_runs_started on public.source_seed_import_runs(started_at desc)`).catch(() => {});

  await db.execute(sql`
    create table if not exists public.source_seed_import_rows (
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
    )
  `).catch(() => {});
  await db.execute(sql`create index if not exists idx_source_seed_import_rows_run on public.source_seed_import_rows(run_id, row_index asc)`).catch(() => {});
  await db.execute(sql`create index if not exists idx_source_seed_import_rows_source on public.source_seed_import_rows(source_id, created_at desc)`).catch(() => {});

  await db.execute(sql`
    create table if not exists public.source_section_policies (
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
    )
  `).catch(() => {});
  await db.execute(sql`create index if not exists idx_source_section_policies_source_active on public.source_section_policies(source_id, is_active, priority asc)`).catch(() => {});

  return { ok: true };
}
