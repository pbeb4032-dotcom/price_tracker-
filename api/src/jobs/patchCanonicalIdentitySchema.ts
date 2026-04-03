import { sql } from 'drizzle-orm';
import { getDb, type Env } from '../db';

/**
 * Sprint 2 foundation:
 * canonical product family / variant / listing / identifier schema
 * with compatibility views over legacy product IDs.
 */
export async function patchCanonicalIdentitySchema(env: Env): Promise<any> {
  const db = getDb(env);

  await db.execute(sql`
    create table if not exists public.catalog_product_families (
      id uuid primary key default gen_random_uuid(),
      family_fingerprint text not null unique,
      canonical_name_ar text not null,
      canonical_name_en text,
      normalized_family_name text not null,
      normalized_brand text,
      taxonomy_key text,
      legacy_anchor_product_id uuid null references public.products(id) on delete set null,
      status text not null default 'active'
        check (status in ('active', 'merged', 'archived')),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `);
  await db.execute(sql`create index if not exists idx_catalog_product_families_name on public.catalog_product_families(normalized_family_name)`).catch(() => {});
  await db.execute(sql`create index if not exists idx_catalog_product_families_taxonomy on public.catalog_product_families(taxonomy_key)`).catch(() => {});

  await db.execute(sql`
    create table if not exists public.catalog_product_variants (
      id uuid primary key default gen_random_uuid(),
      family_id uuid not null references public.catalog_product_families(id) on delete cascade,
      legacy_anchor_product_id uuid null references public.products(id) on delete set null,
      display_name_ar text not null,
      display_name_en text,
      normalized_variant_name text not null,
      normalized_brand text,
      size_value numeric,
      size_unit text,
      pack_count integer not null default 1 check (pack_count > 0),
      barcode_primary text,
      fingerprint text not null unique,
      taxonomy_key text,
      condition text not null default 'new',
      status text not null default 'active'
        check (status in ('active', 'merged', 'archived')),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `);
  await db.execute(sql`create index if not exists idx_catalog_product_variants_family on public.catalog_product_variants(family_id)`).catch(() => {});
  await db.execute(sql`create index if not exists idx_catalog_product_variants_barcode on public.catalog_product_variants(barcode_primary) where barcode_primary is not null`).catch(() => {});

  await db.execute(sql`alter table public.catalog_product_variants add column if not exists legacy_anchor_product_id uuid null references public.products(id) on delete set null`).catch(() => {});
  await db.execute(sql`
    update public.catalog_product_variants
    set legacy_anchor_product_id = coalesce(legacy_anchor_product_id, legacy_product_id)
    where legacy_anchor_product_id is null
      and exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'catalog_product_variants'
          and column_name = 'legacy_product_id'
      )
  `).catch(() => {});
  await db.execute(sql`create unique index if not exists uq_catalog_product_variants_fingerprint on public.catalog_product_variants(fingerprint)`).catch(() => {});

  await db.execute(sql`
    create table if not exists public.catalog_variant_legacy_links (
      id uuid primary key default gen_random_uuid(),
      variant_id uuid not null references public.catalog_product_variants(id) on delete cascade,
      legacy_product_id uuid not null references public.products(id) on delete cascade,
      is_anchor boolean not null default false,
      source text not null default 'backfill',
      metadata jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique(variant_id, legacy_product_id),
      unique(legacy_product_id)
    )
  `);
  await db.execute(sql`create index if not exists idx_catalog_variant_legacy_links_variant on public.catalog_variant_legacy_links(variant_id)`).catch(() => {});
  await db.execute(sql`
    insert into public.catalog_variant_legacy_links (
      variant_id,
      legacy_product_id,
      is_anchor,
      source,
      metadata
    )
    select
      v.id,
      v.legacy_anchor_product_id,
      true,
      'schema_patch',
      jsonb_build_object('migrated_from', 'catalog_product_variants.legacy_anchor_product_id')
    from public.catalog_product_variants v
    where v.legacy_anchor_product_id is not null
    on conflict (legacy_product_id) do nothing
  `).catch(() => {});

  await db.execute(sql`
    create table if not exists public.catalog_variant_identifiers (
      id uuid primary key default gen_random_uuid(),
      variant_id uuid not null references public.catalog_product_variants(id) on delete cascade,
      legacy_product_id uuid null references public.products(id) on delete set null,
      id_type text not null
        check (id_type in ('gtin', 'barcode', 'ean', 'upc', 'sku', 'qr_url', 'digital_link', 'merchant_sku', 'unknown')),
      id_value_normalized text not null,
      id_value_raw text,
      source text not null default 'catalog',
      confidence numeric(4,3) not null default 1.000,
      is_primary boolean not null default false,
      metadata jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique(variant_id, id_type, id_value_normalized)
    )
  `);
  await db.execute(sql`create index if not exists idx_catalog_variant_identifiers_lookup on public.catalog_variant_identifiers(id_type, id_value_normalized)`).catch(() => {});
  await db.execute(sql`create index if not exists idx_catalog_variant_identifiers_legacy on public.catalog_variant_identifiers(legacy_product_id)`).catch(() => {});

  await db.execute(sql`
    create table if not exists public.catalog_merchant_listings (
      id uuid primary key default gen_random_uuid(),
      variant_id uuid not null references public.catalog_product_variants(id) on delete cascade,
      legacy_product_id uuid null references public.products(id) on delete set null,
      source_id uuid not null references public.price_sources(id) on delete cascade,
      source_url text not null,
      source_url_hash text not null,
      canonical_url text,
      external_item_id text,
      status text not null default 'active'
        check (status in ('active', 'inactive', 'quarantined', 'archived')),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique(source_id, source_url_hash)
    )
  `);
  await db.execute(sql`create index if not exists idx_catalog_merchant_listings_variant on public.catalog_merchant_listings(variant_id)`).catch(() => {});
  await db.execute(sql`create index if not exists idx_catalog_merchant_listings_legacy on public.catalog_merchant_listings(legacy_product_id)`).catch(() => {});

  await db.execute(sql`
    create table if not exists public.catalog_identity_decisions (
      id uuid primary key default gen_random_uuid(),
      family_id uuid null references public.catalog_product_families(id) on delete set null,
      variant_id uuid null references public.catalog_product_variants(id) on delete set null,
      listing_id uuid null references public.catalog_merchant_listings(id) on delete set null,
      legacy_product_id uuid null references public.products(id) on delete set null,
      decision_type text not null
        check (decision_type in ('family_seed', 'variant_seed', 'identifier_seed', 'listing_seed', 'resolver_match', 'resolver_quarantine')),
      decision_status text not null
        check (decision_status in ('approved', 'quarantined', 'manual_review', 'rejected')),
      confidence numeric(4,3),
      reason text,
      evidence jsonb not null default '{}'::jsonb,
      decider text not null default 'system',
      created_at timestamptz not null default now()
    )
  `);
  await db.execute(sql`create index if not exists idx_catalog_identity_decisions_variant on public.catalog_identity_decisions(variant_id, created_at desc)`).catch(() => {});
  await db.execute(sql`create index if not exists idx_catalog_identity_decisions_legacy on public.catalog_identity_decisions(legacy_product_id, created_at desc)`).catch(() => {});

  await db.execute(sql`
    create or replace view public.v_catalog_variant_legacy_projection as
    select
      v.id as variant_id,
      v.family_id,
      link.legacy_product_id as product_id,
      v.display_name_ar,
      v.display_name_en,
      f.canonical_name_ar as family_name_ar,
      f.canonical_name_en as family_name_en,
      v.normalized_variant_name,
      v.normalized_brand,
      v.size_value,
      v.size_unit,
      v.pack_count,
      v.barcode_primary,
      v.fingerprint,
      coalesce(v.taxonomy_key, f.taxonomy_key) as taxonomy_key,
      v.condition,
      v.status,
      v.created_at,
      v.updated_at
    from public.catalog_product_variants v
    join public.catalog_product_families f on f.id = v.family_id
    join public.catalog_variant_legacy_links link on link.variant_id = v.id
  `).catch(() => {});

  await db.execute(sql`
    create or replace view public.v_catalog_listing_legacy_projection as
    select
      l.id as listing_id,
      l.variant_id,
      coalesce(
        l.legacy_product_id,
        anchor.legacy_product_id,
        v.legacy_anchor_product_id
      ) as product_id,
      l.source_id,
      ps.domain as source_domain,
      l.source_url,
      l.canonical_url,
      l.external_item_id,
      l.status,
      l.created_at,
      l.updated_at
    from public.catalog_merchant_listings l
    join public.catalog_product_variants v on v.id = l.variant_id
    join public.price_sources ps on ps.id = l.source_id
    left join lateral (
      select legacy_product_id
      from public.catalog_variant_legacy_links link
      where link.variant_id = l.variant_id
      order by link.is_anchor desc, link.updated_at desc nulls last, link.created_at desc
      limit 1
    ) anchor on true
  `).catch(() => {});

  return { ok: true };
}
