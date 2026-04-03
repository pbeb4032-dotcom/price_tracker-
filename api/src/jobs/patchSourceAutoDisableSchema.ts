import { sql } from 'drizzle-orm';
import { getDb, type Env } from '../db';

/**
 * Patch schema for ingestion auto-disable + health policy columns.
 * Safe + idempotent.
 *
 * NOTE: This is additive only; older DB volumes will still run.
 */
export async function patchSourceAutoDisableSchema(env: Env): Promise<any> {
  const db = getDb(env);

  await db.execute(sql`
    alter table public.price_sources
      add column if not exists auto_disabled boolean not null default false,
      add column if not exists auto_disabled_reason text,
      add column if not exists auto_disabled_at timestamptz,
      add column if not exists auto_recovered_at timestamptz,
      add column if not exists auto_disabled_forced_inactive boolean not null default false,

      -- Backoff / budget / state
      add column if not exists disabled_until timestamptz,
      add column if not exists disable_level int not null default 0,
      add column if not exists paused_until timestamptz,
      add column if not exists budget_per_hour int not null default 300,
      add column if not exists budget_hour_start timestamptz,
      add column if not exists budget_used int not null default 0,

      -- Counters (per-domain)
      add column if not exists consecutive_failures int not null default 0,
      add column if not exists consecutive_bot_challenges int not null default 0,
      add column if not exists consecutive_403 int not null default 0,
      add column if not exists consecutive_429 int not null default 0,
      add column if not exists consecutive_timeouts int not null default 0,
      add column if not exists consecutive_dns_errors int not null default 0,
      add column if not exists last_bot_challenge_at timestamptz,

      -- Diagnostics
      add column if not exists last_http_status int,
      add column if not exists last_error_code text,
      add column if not exists last_ingest_success_at timestamptz,
      add column if not exists last_ingest_failure_at timestamptz;
  `);

  return { ok: true };
}
