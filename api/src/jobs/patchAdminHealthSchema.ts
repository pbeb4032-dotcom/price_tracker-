import { sql } from 'drizzle-orm';
import { getDb, type Env } from '../db';

/**
 * Admin/Health schema guardrail.
 *
 * هدفه: يمنع 500 على /admin/source_health و jobs اللي تعتمد على جداول/أعمدة
 * لما المستخدم يكون عنده DB volume قديم.
 *
 * ✅ additive only + idempotent.
 */
export async function patchAdminHealthSchema(env: Env): Promise<any> {
  const db = getDb(env);

  // Make sure uuid generator exists.
  await db.execute(sql`create extension if not exists pgcrypto`).catch(() => {});

  // price_sources columns that admin/health pages depend on.
  await db
    .execute(sql`
      alter table public.price_sources
        add column if not exists trust_weight_dynamic numeric(3,2),
        add column if not exists trust_last_scored_at timestamptz,
        add column if not exists trust_score_meta jsonb,

        add column if not exists disabled_until timestamptz,
        add column if not exists disable_level int not null default 0,
        add column if not exists paused_until timestamptz,
        add column if not exists budget_per_hour int not null default 300,
        add column if not exists budget_hour_start timestamptz,
        add column if not exists budget_used int not null default 0,

        add column if not exists last_http_status int,
        add column if not exists last_error_code text,
        add column if not exists last_ingest_success_at timestamptz,
        add column if not exists last_ingest_failure_at timestamptz;
    `)
    .catch(() => {});

  // Ingestion error events table (used by /admin/source_health and diagnostics)
  await db
    .execute(sql`
      create table if not exists public.ingestion_error_events (
        id uuid primary key default gen_random_uuid(),
        run_id uuid null,
        frontier_id uuid null,
        source_domain text not null,
        url text not null,
        http_status int null,
        blocked_reason text null,
        error_code text null,
        error_message text null,
        created_at timestamptz not null default now()
      );
      create index if not exists idx_ingestion_error_events_domain_created
        on public.ingestion_error_events (source_domain, created_at desc);
      create index if not exists idx_ingestion_error_events_created
        on public.ingestion_error_events (created_at desc);
    `)
    .catch(() => {});

  // Probe queue table (prevents 400 on /admin/probe_queue_stats)
  await db
    .execute(sql`
      create table if not exists public.domain_probe_queue (
        id uuid primary key default gen_random_uuid(),
        source_domain text not null,
        probe_url text not null,
        status text not null default 'queued',
        priority int not null default 100,
        attempts int not null default 0,
        last_http_status int null,
        last_error_code text null,
        last_error_message text null,
        next_retry_at timestamptz null,
        started_at timestamptz null,
        completed_at timestamptz null,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
      create index if not exists idx_domain_probe_queue_status_retry
        on public.domain_probe_queue(status, next_retry_at);
      create index if not exists idx_domain_probe_queue_domain
        on public.domain_probe_queue(source_domain);
      create unique index if not exists uq_domain_probe_queue_active_domain
        on public.domain_probe_queue(source_domain)
        where status in ('queued','running');
    `)
    .catch(() => {});

  // Health rollups storage
  await db
    .execute(sql`
      create table if not exists public.source_health_daily (
        day date not null,
        source_id uuid not null references public.price_sources(id) on delete cascade,
        domain text not null,
        successes int not null default 0,
        failures int not null default 0,
        anomalies int not null default 0,
        error_rate numeric(5,4) null,
        anomaly_rate numeric(5,4) null,
        last_success_at timestamptz null,
        last_error_at timestamptz null,
        created_at timestamptz not null default now(),
        primary key(day, source_id)
      );
    `)
    .catch(() => {});

  await db
    .execute(sql`
      create or replace view public.v_source_health_latest
      with (security_invoker = on) as
      select distinct on (sh.source_id)
        sh.source_id, sh.day, sh.domain, sh.successes, sh.failures, sh.anomalies,
        sh.error_rate, sh.anomaly_rate, sh.last_success_at, sh.last_error_at, sh.created_at
      from public.source_health_daily sh
      order by sh.source_id, sh.day desc, sh.created_at desc;
    `)
    .catch(() => {});

  // Some older DBs might miss anomaly flag; source_health query uses it.
  await db
    .execute(sql`
      alter table public.source_price_observations
        add column if not exists is_price_anomaly boolean,
        add column if not exists created_at timestamptz;
    `)
    .catch(() => {});

  return { ok: true };
}
