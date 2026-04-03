import { sql } from 'drizzle-orm';
import { getDb, type Env } from '../db';

export async function patchBarcodeResolutionSchema(env: Env): Promise<any> {
  const db = getDb(env);

  await db.execute(sql`
    create table if not exists public.barcode_resolution_runs (
      id uuid primary key default gen_random_uuid(),
      input_text text,
      parsed_code text,
      identifier_type text
        check (identifier_type in ('gtin', 'barcode', 'ean', 'upc', 'sku', 'qr_url', 'digital_link', 'merchant_sku', 'unknown')),
      parse_source text not null default 'unresolved'
        check (parse_source in ('empty', 'direct', 'numeric_scan', 'query_param', 'path_segment', 'digital_link', 'unresolved')),
      resolution_status text not null default 'running'
        check (resolution_status in ('running', 'resolved_internal', 'resolved_external', 'ambiguous', 'not_found', 'failed')),
      variant_id uuid null references public.catalog_product_variants(id) on delete set null,
      family_id uuid null references public.catalog_product_families(id) on delete set null,
      legacy_product_id uuid null references public.products(id) on delete set null,
      region_id uuid null references public.regions(id) on delete set null,
      external_source text,
      confidence numeric(4,3),
      evidence jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      completed_at timestamptz,
      updated_at timestamptz not null default now()
    )
  `).catch(() => {});
  await db.execute(sql`create index if not exists idx_barcode_resolution_runs_code on public.barcode_resolution_runs(parsed_code, created_at desc)`).catch(() => {});
  await db.execute(sql`create index if not exists idx_barcode_resolution_runs_status on public.barcode_resolution_runs(resolution_status, created_at desc)`).catch(() => {});

  await db.execute(sql`
    create table if not exists public.barcode_resolution_candidates (
      id uuid primary key default gen_random_uuid(),
      run_id uuid not null references public.barcode_resolution_runs(id) on delete cascade,
      candidate_type text not null
        check (candidate_type in ('internal_variant', 'legacy_product', 'external_catalog', 'catalog_match', 'offer_match')),
      candidate_rank integer not null default 1,
      candidate_status text not null default 'ranked'
        check (candidate_status in ('selected', 'ranked', 'ambiguous', 'quarantined', 'rejected')),
      variant_id uuid null references public.catalog_product_variants(id) on delete set null,
      family_id uuid null references public.catalog_product_families(id) on delete set null,
      legacy_product_id uuid null references public.products(id) on delete set null,
      listing_id uuid null references public.catalog_merchant_listings(id) on delete set null,
      source_domain text,
      confidence numeric(4,3),
      reasons jsonb not null default '[]'::jsonb,
      evidence jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now()
    )
  `).catch(() => {});
  await db.execute(sql`create index if not exists idx_barcode_resolution_candidates_run on public.barcode_resolution_candidates(run_id, candidate_rank asc, created_at desc)`).catch(() => {});
  await db.execute(sql`create index if not exists idx_barcode_resolution_candidates_variant on public.barcode_resolution_candidates(variant_id, created_at desc)`).catch(() => {});

  await db.execute(sql`
    create table if not exists public.barcode_external_catalog_cache (
      normalized_code text primary key,
      identifier_type text
        check (identifier_type in ('gtin', 'barcode', 'ean', 'upc', 'sku', 'qr_url', 'digital_link', 'merchant_sku', 'unknown')),
      source text not null,
      payload jsonb not null default '{}'::jsonb,
      fetched_at timestamptz not null default now(),
      expires_at timestamptz not null default (now() + interval '7 days'),
      updated_at timestamptz not null default now()
    )
  `).catch(() => {});
  await db.execute(sql`create index if not exists idx_barcode_external_catalog_cache_expires on public.barcode_external_catalog_cache(expires_at)`).catch(() => {});

  return { ok: true };
}
