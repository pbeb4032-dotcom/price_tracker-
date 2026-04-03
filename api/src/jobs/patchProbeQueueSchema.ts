import { sql } from 'drizzle-orm';
import { getDb, type Env } from '../db';

/**
 * Patch schema for domain recover probes.
 * Safe + idempotent.
 */
export async function patchProbeQueueSchema(env: Env): Promise<any> {
  const db = getDb(env);

  // Add columns to price_sources to track probe state (non-breaking).
  await db.execute(sql`
    alter table public.price_sources
      add column if not exists probe_enabled boolean not null default true,
      add column if not exists probe_required boolean not null default false,
      add column if not exists probe_until timestamptz,
      add column if not exists last_probe_at timestamptz,
      add column if not exists last_probe_success_at timestamptz,
      add column if not exists last_probe_failure_at timestamptz,
      add column if not exists probe_consecutive_failures int not null default 0,
      add column if not exists last_probe_http_status int,
      add column if not exists last_probe_error_code text;
  `).catch(() => {});

  await db.execute(sql`
    create table if not exists public.domain_probe_queue (
      id uuid primary key default gen_random_uuid(),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),

      source_domain text not null,
      probe_url text not null,

      status text not null default 'pending'
        check (status in ('pending','processing','succeeded','failed','skipped')),
      priority int not null default 0,

      claimed_at timestamptz,
      completed_at timestamptz,

      last_http_status int,
      last_error_code text,
      last_error text,

      error_count int not null default 0,
      next_retry_at timestamptz
    );

    create index if not exists idx_domain_probe_queue_status_retry
      on public.domain_probe_queue(status, next_retry_at);

    create index if not exists idx_domain_probe_queue_domain
      on public.domain_probe_queue(source_domain);

    -- Only one active probe per domain at a time.
    create unique index if not exists uq_domain_probe_queue_active_domain
      on public.domain_probe_queue(source_domain)
      where status in ('pending','processing');
  `);

  // updated_at trigger (best-effort: function exists in base schema)
  await db.execute(sql`
    do $$
    begin
      if exists (
        select 1
        from pg_proc
        where proname = 'update_updated_at_column'
      ) then
        begin
          create trigger update_domain_probe_queue_updated_at
            before update on public.domain_probe_queue
            for each row execute function public.update_updated_at_column();
        exception when duplicate_object then
          null;
        end;
      end if;
    end $$;
  `).catch(() => {});

  return { ok: true };
}
