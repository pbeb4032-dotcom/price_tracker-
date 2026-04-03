import { sql } from 'drizzle-orm';
import { getDb, type Env } from '../db';

/**
 * Minimal-risk schema patch:
 * - Adds optional category meta columns on source_price_observations (safe for existing DBs)
 * - Creates a lightweight quarantine table for category conflicts
 */
export async function patchCategoryConflictSchema(env: Env): Promise<any> {
  const db = getDb(env);

  // 1) Add optional columns (no-op if they already exist)
  await db.execute(sql`
    alter table public.source_price_observations
      add column if not exists category_hint text,
      add column if not exists category_badge text,
      add column if not exists category_confidence numeric,
      add column if not exists category_conflict boolean not null default false,
      add column if not exists category_evidence jsonb
  `);

  await db.execute(sql`create index if not exists idx_spo_category_hint on public.source_price_observations(category_hint)`);

  // 2) Category conflict quarantine (admin review queue)
  await db.execute(sql`
    create table if not exists public.category_conflict_quarantine (
      id uuid primary key default gen_random_uuid(),
      status text not null default 'open' check (status in ('open','resolved','ignored')),
      review_note text,
      decided_category text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      first_seen_at timestamptz not null default now(),
      last_seen_at timestamptz not null default now(),
      seen_count int not null default 1,
      product_id uuid not null,
      evidence jsonb not null
    )
  `);


  // One record per product per status (enables ON CONFLICT upsert without relying on partial indexes)
  await db.execute(sql`
    create unique index if not exists uq_category_conflict_product_status
    on public.category_conflict_quarantine(product_id, status)
  `);

  // Unique open record per product (helps ON CONFLICT upsert)
  await db.execute(sql`
    create unique index if not exists uq_category_conflict_open_product
    on public.category_conflict_quarantine(product_id)
    where status = 'open'
  `);

  await db.execute(sql`
    create index if not exists idx_category_conflict_status_created
    on public.category_conflict_quarantine(status, created_at desc)
  `);

  await db.execute(sql`
    create index if not exists idx_category_conflict_product
    on public.category_conflict_quarantine(product_id)
  `);

  return { ok: true };
}
