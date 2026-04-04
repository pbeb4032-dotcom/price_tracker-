import { sql } from 'drizzle-orm';
import { getDb, type Env } from '../db';

export async function patchSourceAdapterBacklogSchema(env: Env): Promise<any> {
  const db = getDb(env);

  await db.execute(sql`
    create table if not exists public.source_adapter_backlog_items (
      id uuid primary key default gen_random_uuid(),
      source_id uuid not null unique references public.price_sources(id) on delete cascade,
      domain text not null,
      current_readiness_class text,
      current_recommended_path text,
      assigned_path text,
      status text not null default 'pending',
      priority integer not null default 100,
      note text,
      last_action text,
      metadata jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `).catch(() => {});
  await db.execute(sql`create index if not exists idx_source_adapter_backlog_items_status on public.source_adapter_backlog_items(status, priority asc, updated_at desc)`).catch(() => {});
  await db.execute(sql`create index if not exists idx_source_adapter_backlog_items_domain on public.source_adapter_backlog_items(domain, updated_at desc)`).catch(() => {});

  await db.execute(sql`
    create table if not exists public.source_adapter_backlog_actions (
      id uuid primary key default gen_random_uuid(),
      backlog_id uuid not null references public.source_adapter_backlog_items(id) on delete cascade,
      source_id uuid not null references public.price_sources(id) on delete cascade,
      domain text not null,
      action text not null,
      previous_status text,
      next_status text not null,
      assigned_path text,
      note text,
      actor_type text not null default 'admin',
      actor_id uuid,
      metadata jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now()
    )
  `).catch(() => {});
  await db.execute(sql`create index if not exists idx_source_adapter_backlog_actions_source on public.source_adapter_backlog_actions(source_id, created_at desc)`).catch(() => {});
  await db.execute(sql`create index if not exists idx_source_adapter_backlog_actions_backlog on public.source_adapter_backlog_actions(backlog_id, created_at desc)`).catch(() => {});

  return { ok: true };
}
