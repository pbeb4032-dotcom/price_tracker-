import { sql } from 'drizzle-orm';
import { getDb, type Env } from '../db';

/**
 * Patch schema for Playwright Render Worker Queue (JS-only pages).
 * Safe + idempotent. Additive.
 */
export async function patchRenderQueueSchema(env: Env): Promise<any> {
  const db = getDb(env);

  // Ensure pgcrypto exists for gen_random_uuid (often already available, but keep best-effort).
  await db.execute(sql`create extension if not exists pgcrypto`).catch(() => {});

  // Columns on price_sources for JS-only + render budgets (worker-side).
  await db.execute(sql`
    alter table public.price_sources
      add column if not exists js_only boolean not null default false,
      add column if not exists js_only_reason text,
      add column if not exists js_only_hits int not null default 0,
      add column if not exists last_js_shell_at timestamptz,

      add column if not exists render_budget_per_hour int not null default 80,
      add column if not exists render_budget_hour_start timestamptz,
      add column if not exists render_budget_used int not null default 0,
      add column if not exists render_paused_until timestamptz,
      add column if not exists render_last_claim_at timestamptz,
      add column if not exists render_cache_ttl_min int not null default 720,
      add column if not exists render_stale_serve_min int not null default 1440,

      add column if not exists last_render_success_at timestamptz,
      add column if not exists last_render_failure_at timestamptz,
      add column if not exists render_consecutive_failures int not null default 0,
      add column if not exists last_render_error_code text,
      add column if not exists last_render_http_status int;
  `).catch(() => {});

  // Render queue table
  await db.execute(sql`
    create table if not exists public.render_queue (
      id uuid primary key default gen_random_uuid(),
      source_domain text not null,
      url text not null,
      url_hash text generated always as (md5(lower(url))) stored,
      status text not null default 'pending',
      priority int not null default 10,
      discovered_from text,

      attempts int not null default 0,
      next_retry_at timestamptz,
      claimed_at timestamptz,
      completed_at timestamptz,

      last_http_status int,
      last_error_code text,
      last_error text,

      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  `);

  await db.execute(sql`create unique index if not exists idx_render_queue_url_hash on public.render_queue(url_hash)`).catch(() => {});
  await db.execute(sql`create index if not exists idx_render_queue_status_next on public.render_queue(status, next_retry_at, priority)`).catch(() => {});
  await db.execute(sql`create index if not exists idx_render_queue_domain_status on public.render_queue(source_domain, status)`).catch(() => {});

  // Rendered pages cache (HTML)
  await db.execute(sql`
    create table if not exists public.rendered_pages (
      url text not null,
      url_hash text generated always as (md5(lower(url))) stored,
      source_domain text not null,
      html text not null,
      http_status int,
      content_type text,
      rendered_at timestamptz not null default now(),
      expires_at timestamptz not null,
      html_bytes int,
      primary key (url_hash)
    );
  `);

  await db.execute(sql`create index if not exists idx_rendered_pages_expires on public.rendered_pages(expires_at)`).catch(() => {});
  await db.execute(sql`create index if not exists idx_rendered_pages_domain on public.rendered_pages(source_domain)`).catch(() => {});

  return { ok: true };
}
