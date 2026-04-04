import { sql } from 'drizzle-orm';
import { getDb, type Env } from '../db';

/**
 * Sprint 6 foundation:
 * - source certification tiers + publish eligibility
 * - quality score storage
 * - auditable certification runs and decisions
 */
export async function patchSourceCertificationSchema(env: Env): Promise<any> {
  const db = getDb(env);

  await db.execute(sql`
    alter table public.price_sources
      add column if not exists certification_tier text not null default 'published',
      add column if not exists certification_status text not null default 'pending',
      add column if not exists quality_score numeric(4,3),
      add column if not exists quality_updated_at timestamptz,
      add column if not exists catalog_publish_enabled boolean not null default true,
      add column if not exists certification_reason text,
      add column if not exists certification_meta jsonb not null default '{}'::jsonb
  `).catch(() => {});

  await db.execute(sql`
    update public.price_sources
    set
      certification_tier = case
        when lifecycle_status = 'candidate' then 'sandbox'
        when coalesce(auto_disabled, false) = true then 'suspended'
        when coalesce(is_active, false) = true then coalesce(nullif(certification_tier, ''), 'published')
        else coalesce(nullif(certification_tier, ''), 'observed')
      end,
      certification_status = case
        when lifecycle_status = 'candidate' then 'pending'
        when coalesce(auto_disabled, false) = true then 'suspended'
        when coalesce(is_active, false) = true then coalesce(nullif(certification_status, ''), 'certified')
        else coalesce(nullif(certification_status, ''), 'needs_review')
      end,
      catalog_publish_enabled = case
        when lifecycle_status = 'candidate' then false
        when coalesce(auto_disabled, false) = true then false
        else coalesce(catalog_publish_enabled, coalesce(is_active, false))
      end,
      quality_score = coalesce(quality_score, coalesce(trust_weight_dynamic, trust_weight, 0.50)),
      quality_updated_at = coalesce(quality_updated_at, now()),
      certification_meta = coalesce(certification_meta, '{}'::jsonb)
    where country_code = 'IQ'
  `).catch(() => {});

  await db.execute(sql`
    create table if not exists public.source_certification_runs (
      id uuid primary key default gen_random_uuid(),
      mode text not null default 'apply',
      status text not null default 'running',
      country_code text not null default 'IQ',
      window_hours integer not null default 72,
      scanned_count integer not null default 0,
      changed_count integer not null default 0,
      published_count integer not null default 0,
      sandboxed_count integer not null default 0,
      suspended_count integer not null default 0,
      notes jsonb not null default '{}'::jsonb,
      started_at timestamptz not null default now(),
      completed_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `).catch(() => {});
  await db.execute(sql`create index if not exists idx_source_certification_runs_started on public.source_certification_runs(started_at desc)`).catch(() => {});

  await db.execute(sql`
    create table if not exists public.source_certification_decisions (
      id uuid primary key default gen_random_uuid(),
      run_id uuid null references public.source_certification_runs(id) on delete set null,
      source_id uuid not null references public.price_sources(id) on delete cascade,
      domain text not null,
      previous_tier text,
      decided_tier text not null,
      previous_status text,
      decided_status text not null,
      publish_enabled boolean not null default false,
      quality_score numeric(4,3) not null default 0,
      confidence numeric(4,3) not null default 0,
      review_priority integer not null default 100,
      reason text,
      evidence jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now()
    )
  `).catch(() => {});
  await db.execute(sql`create index if not exists idx_source_certification_decisions_source on public.source_certification_decisions(source_id, created_at desc)`).catch(() => {});
  await db.execute(sql`create index if not exists idx_source_certification_decisions_tier on public.source_certification_decisions(decided_tier, decided_status, created_at desc)`).catch(() => {});

  return { ok: true };
}
