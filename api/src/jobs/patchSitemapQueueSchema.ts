import { sql } from 'drizzle-orm';
import { getDb, type Env } from '../db';

// Creates a persistent sitemap queue so seeding can scale to 100k+ URLs per domain
// without caps and without re-downloading giant sitemaps on every run.
export async function patchSitemapQueueSchema(env: Env) {
  const db = getDb(env);

  // pgcrypto provides gen_random_uuid(). Most installs already have it.
  await db.execute(sql`create extension if not exists pgcrypto`);

  await db.execute(sql`
    create table if not exists public.domain_sitemap_queue (
      id uuid primary key default gen_random_uuid(),
      source_domain text not null,
      sitemap_url text not null,
      depth int not null default 0,
      status text not null default 'pending',
      kind text null,
      loc_cursor int not null default 0,
      loc_total int null,
      etag text null,
      last_modified text null,
      last_checked_at timestamptz null,
      last_fetched_at timestamptz null,
      processing_started_at timestamptz null,
      error_count int not null default 0,
      next_retry_at timestamptz null,
      last_error text null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (source_domain, sitemap_url)
    )
  `);

  await db.execute(sql`
    create index if not exists idx_domain_sitemap_queue_status_retry
    on public.domain_sitemap_queue (status, next_retry_at)
  `);
  await db.execute(sql`
    create index if not exists idx_domain_sitemap_queue_domain_status
    on public.domain_sitemap_queue (source_domain, status)
  `);
  await db.execute(sql`
    create index if not exists idx_domain_sitemap_queue_checked
    on public.domain_sitemap_queue (last_checked_at)
  `);

  return { ok: true };
}
