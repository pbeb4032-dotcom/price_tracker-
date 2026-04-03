import { sql } from 'drizzle-orm';
import { getDb, type Env } from '../db';

/**
 * Sprint 1 foundation:
 * - raw ingest evidence is recorded
 * - listing candidates are evaluated before publication
 * - publication decisions are auditable
 *
 * Safe + idempotent + additive.
 */
export async function patchPublicationGateSchema(env: Env): Promise<any> {
  const db = getDb(env);

  await db.execute(sql`
    create table if not exists public.ingest_documents (
      id uuid primary key default gen_random_uuid(),
      ingest_run_id uuid,
      source_id uuid null references public.price_sources(id) on delete set null,
      source_domain text not null,
      source_kind text not null default 'unknown'
        check (source_kind in ('html', 'api', 'manual', 'unknown')),
      page_type text,
      source_url text,
      canonical_url text,
      external_item_id text,
      http_status integer,
      content_type text,
      payload_kind text not null default 'json'
        check (payload_kind in ('json', 'html', 'unknown')),
      payload_hash text,
      payload_excerpt text,
      raw_payload jsonb not null default '{}'::jsonb,
      extracted_payload jsonb not null default '{}'::jsonb,
      status text not null default 'captured'
        check (status in ('captured', 'processed', 'quarantined', 'published', 'rejected', 'failed')),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `);
  await db.execute(sql`create index if not exists idx_ingest_documents_source_created on public.ingest_documents(source_domain, created_at desc)`).catch(() => {});
  await db.execute(sql`create index if not exists idx_ingest_documents_source_url on public.ingest_documents(source_url)`).catch(() => {});
  await db.execute(sql`create index if not exists idx_ingest_documents_status on public.ingest_documents(status, created_at desc)`).catch(() => {});

  await db.execute(sql`
    create table if not exists public.ingest_listing_candidates (
      id uuid primary key default gen_random_uuid(),
      document_id uuid not null references public.ingest_documents(id) on delete cascade,
      source_id uuid null references public.price_sources(id) on delete set null,
      source_domain text not null,
      source_url text,
      canonical_url text,
      external_item_id text,
      product_name text not null,
      normalized_name text,
      barcode_normalized text,
      category_hint text,
      subcategory_hint text,
      taxonomy_hint text,
      match_kind text not null default 'none'
        check (match_kind in ('url_map', 'identifier', 'exact_name', 'none')),
      matched_product_id uuid null references public.products(id) on delete set null,
      identity_confidence numeric(4,3) not null default 0,
      taxonomy_confidence numeric(4,3) not null default 0,
      price_confidence numeric(4,3) not null default 0,
      category_conflict boolean not null default false,
      taxonomy_conflict boolean not null default false,
      publish_blocked boolean not null default true,
      publish_status text not null default 'pending'
        check (publish_status in ('pending', 'approved', 'quarantined', 'rejected', 'published', 'failed')),
      publish_reason text,
      publish_reasons jsonb not null default '[]'::jsonb,
      gate_version text not null default 'v1',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique(document_id)
    )
  `);
  await db.execute(sql`create index if not exists idx_ingest_listing_candidates_status on public.ingest_listing_candidates(publish_status, created_at desc)`).catch(() => {});
  await db.execute(sql`create index if not exists idx_ingest_listing_candidates_source on public.ingest_listing_candidates(source_domain, created_at desc)`).catch(() => {});
  await db.execute(sql`create index if not exists idx_ingest_listing_candidates_match on public.ingest_listing_candidates(match_kind, identity_confidence desc)`).catch(() => {});

  await db.execute(sql`
    create table if not exists public.ingest_decisions (
      id uuid primary key default gen_random_uuid(),
      candidate_id uuid not null references public.ingest_listing_candidates(id) on delete cascade,
      decision_type text not null
        check (decision_type in ('identity', 'taxonomy', 'price', 'publication')),
      decision_status text not null
        check (decision_status in ('approved', 'quarantined', 'rejected', 'pending', 'manual_review')),
      confidence numeric(4,3),
      reason text,
      evidence jsonb not null default '{}'::jsonb,
      decider text not null default 'system',
      created_at timestamptz not null default now()
    )
  `);
  await db.execute(sql`create index if not exists idx_ingest_decisions_candidate on public.ingest_decisions(candidate_id, created_at desc)`).catch(() => {});
  await db.execute(sql`create index if not exists idx_ingest_decisions_type_status on public.ingest_decisions(decision_type, decision_status, created_at desc)`).catch(() => {});

  await db.execute(sql`
    create table if not exists public.catalog_publish_queue (
      id uuid primary key default gen_random_uuid(),
      candidate_id uuid not null references public.ingest_listing_candidates(id) on delete cascade,
      target_kind text not null default 'legacy_product_projection'
        check (target_kind in ('legacy_product_projection', 'catalog_variant_projection')),
      legacy_product_id uuid null references public.products(id) on delete set null,
      status text not null default 'pending'
        check (status in ('pending', 'processing', 'published', 'skipped', 'failed')),
      attempts integer not null default 0,
      last_error text,
      scheduled_at timestamptz not null default now(),
      processed_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique(candidate_id)
    )
  `);
  await db.execute(sql`create index if not exists idx_catalog_publish_queue_status on public.catalog_publish_queue(status, scheduled_at asc)`).catch(() => {});

  return { ok: true };
}
