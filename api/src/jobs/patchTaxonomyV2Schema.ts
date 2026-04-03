import { sql } from 'drizzle-orm';
import { getDb, type Env } from '../db';

/**
 * Taxonomy v2 + product identity governance (non-destructive):
 * - taxonomy_nodes: hierarchical canonical taxonomy
 * - domain_taxonomy_mappings: learn mapping per domain+siteCategory
 * - taxonomy_quarantine: review queue
 * - products: taxonomy_key + confidence + manual lock
 * - product_identifiers: canonical barcode/GTIN/SKU/QR/Digital Link registry
 * - fx_rate_raw / fx_rate_effective: source-of-truth FX registry
 */
export async function patchTaxonomyV2Schema(env: Env): Promise<any> {
  const db = getDb(env);

  await db
    .execute(sql`
      alter table public.source_price_observations
        add column if not exists category_evidence jsonb
    `)
    .catch(() => {});

  await db.execute(sql`
    alter table public.products
      add column if not exists taxonomy_key text,
      add column if not exists taxonomy_confidence numeric(4,3),
      add column if not exists taxonomy_reason text,
      add column if not exists taxonomy_manual boolean not null default false,
      add column if not exists category_manual boolean not null default false,
      add column if not exists subcategory_manual boolean not null default false
  `).catch(() => {});

  await db.execute(sql`create index if not exists idx_products_taxonomy_key on public.products(taxonomy_key)`).catch(() => {});

  await db.execute(sql`
    create table if not exists public.taxonomy_nodes (
      key text primary key,
      parent_key text,
      label_ar text,
      label_en text,
      synonyms text[] not null default '{}'::text[],
      is_leaf boolean not null default true,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `).catch(() => {});

  await db.execute(sql`create index if not exists idx_taxonomy_nodes_parent on public.taxonomy_nodes(parent_key)`).catch(() => {});

  await db.execute(sql`
    create table if not exists public.domain_taxonomy_mappings (
      id uuid primary key default gen_random_uuid(),
      domain text not null,
      site_category_norm text not null,
      taxonomy_key text not null,
      is_active boolean not null default true,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique(domain, site_category_norm)
    )
  `).catch(() => {});

  await db.execute(sql`create index if not exists idx_domain_taxonomy_mappings_domain on public.domain_taxonomy_mappings(domain, is_active)`).catch(() => {});

  await db.execute(sql`
    create table if not exists public.taxonomy_quarantine (
      id uuid primary key default gen_random_uuid(),
      product_id uuid not null,
      domain text,
      url text,
      product_name text,
      site_category_raw text,
      site_category_norm text,
      current_taxonomy_key text,
      inferred_taxonomy_key text,
      chosen_taxonomy_key text,
      confidence numeric(4,3),
      reason text,
      conflict boolean not null default false,
      conflict_reason text,
      status text not null default 'pending' check (status in ('pending','approved','rejected')),
      reviewer_note text,
      reviewed_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique(product_id, status)
    )
  `).catch(() => {});

  await db.execute(sql`create index if not exists idx_taxonomy_quarantine_status on public.taxonomy_quarantine(status, created_at desc)`).catch(() => {});

  await db.execute(sql`
    create table if not exists public.product_identifiers (
      id uuid primary key default gen_random_uuid(),
      product_id uuid not null references public.products(id) on delete cascade,
      id_type text not null,
      id_value_normalized text not null,
      id_value_raw text,
      source text not null default 'catalog',
      confidence numeric(4,3) not null default 1.000,
      is_primary boolean not null default false,
      metadata jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      constraint product_identifiers_type_check check (id_type in ('gtin','barcode','ean','upc','sku','qr_url','digital_link','merchant_sku','unknown')),
      constraint product_identifiers_value_nonempty check (length(trim(id_value_normalized)) > 0)
    )
  `).catch(() => {});
  await db.execute(sql`create index if not exists idx_product_identifiers_lookup on public.product_identifiers(id_type, id_value_normalized)`).catch(() => {});
  await db.execute(sql`create unique index if not exists uq_product_identifiers_per_product on public.product_identifiers(product_id, id_type, id_value_normalized)`).catch(() => {});
  await db.execute(sql`create unique index if not exists uq_product_identifiers_primary on public.product_identifiers(product_id, id_type) where is_primary = true`).catch(() => {});

  await db.execute(sql`
    create table if not exists public.fx_rate_raw (
      id uuid primary key default gen_random_uuid(),
      rate_date date not null default current_date,
      source_name text not null,
      source_kind text not null,
      city text,
      buy_rate numeric(12,4),
      sell_rate numeric(12,4),
      mid_rate numeric(12,4),
      unit text not null default 'per_1_usd',
      source_url text,
      observed_at timestamptz,
      fetched_at timestamptz not null default now(),
      parser_confidence numeric(4,3),
      raw_payload jsonb not null default '{}'::jsonb,
      is_valid boolean not null default true,
      error text,
      created_at timestamptz not null default now()
    )
  `).catch(() => {});
  await db.execute(sql`create index if not exists idx_fx_rate_raw_date_kind on public.fx_rate_raw(rate_date desc, source_kind, city)`).catch(() => {});

  await db.execute(sql`
    create table if not exists public.fx_rate_effective (
      rate_date date primary key,
      official_rate numeric(12,4),
      market_buy_baghdad numeric(12,4),
      market_sell_baghdad numeric(12,4),
      market_mid_baghdad numeric(12,4),
      market_buy_erbil numeric(12,4),
      market_sell_erbil numeric(12,4),
      market_mid_erbil numeric(12,4),
      effective_rate_for_pricing numeric(12,4),
      quality_flag text not null default 'unverified',
      based_on_n_sources int not null default 0,
      meta jsonb not null default '{}'::jsonb,
      last_verified_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `).catch(() => {});

  await db.execute(sql`
    create or replace function public.product_taxonomy_canonical_category(key text)
    returns text
    language sql
    immutable
    as $$
      select case
        when key is null or btrim(key) = '' then 'general'
        when split_part(key, '/', 1) = 'groceries' and key = 'groceries/beverages' then 'beverages'
        when split_part(key, '/', 1) in ('electronics','groceries','beauty','clothing','home','sports','toys','automotive','essentials') then split_part(key, '/', 1)
        else 'general'
      end
    $$
  `).catch(() => {});

  await db.execute(sql`
    create or replace function public.product_taxonomy_canonical_subcategory(key text)
    returns text
    language sql
    immutable
    as $$
      select case
        when key is null or btrim(key) = '' then null
        when key = 'groceries/staples' then 'grains'
        when key = 'groceries/dairy' then 'dairy'
        when key = 'groceries/canned' then 'canned'
        when key = 'groceries/cooking_oils' then 'oils'
        when key = 'groceries/snacks' then 'snacks'
        when key = 'groceries/beverages' then null
        else null
      end
    $$
  `).catch(() => {});

  await db.execute(sql`
    create or replace function public.sync_products_taxonomy_cache()
    returns trigger
    language plpgsql
    as $$
    begin
      if new.taxonomy_key is not null and btrim(new.taxonomy_key) <> '' then
        if coalesce(new.category_manual, false) = false then
          new.category := public.product_taxonomy_canonical_category(new.taxonomy_key);
        end if;
        if coalesce(new.subcategory_manual, false) = false then
          new.subcategory := public.product_taxonomy_canonical_subcategory(new.taxonomy_key);
        end if;
      end if;
      return new;
    end;
    $$
  `).catch(() => {});

  await db.execute(sql`drop trigger if exists trg_sync_products_taxonomy_cache on public.products`).catch(() => {});
  await db.execute(sql`
    create trigger trg_sync_products_taxonomy_cache
    before insert or update of taxonomy_key, category_manual, subcategory_manual
    on public.products
    for each row
    execute function public.sync_products_taxonomy_cache()
  `).catch(() => {});

  await db.execute(sql`
    do $$
    begin
      if not exists (
        select 1 from pg_constraint where conname = 'products_taxonomy_key_fk'
      ) then
        alter table public.products
          add constraint products_taxonomy_key_fk
          foreign key (taxonomy_key)
          references public.taxonomy_nodes(key)
          not valid;
      end if;
    end $$;
  `).catch(() => {});

  await db.execute(sql`
    insert into public.product_identifiers (product_id, id_type, id_value_normalized, id_value_raw, source, confidence, is_primary)
    select
      p.id,
      case
        when length(regexp_replace(coalesce(p.barcode,''), '[^0-9A-Za-z]+', '', 'g')) = 8 then 'ean'
        when length(regexp_replace(coalesce(p.barcode,''), '[^0-9A-Za-z]+', '', 'g')) = 12 then 'upc'
        when length(regexp_replace(coalesce(p.barcode,''), '[^0-9A-Za-z]+', '', 'g')) in (13,14) then 'gtin'
        else 'barcode'
      end,
      regexp_replace(coalesce(p.barcode,''), '[^0-9A-Za-z]+', '', 'g'),
      p.barcode,
      'products.barcode',
      1.000,
      true
    from public.products p
    where coalesce(nullif(trim(coalesce(p.barcode,'')), ''), '') <> ''
      and length(regexp_replace(coalesce(p.barcode,''), '[^0-9A-Za-z]+', '', 'g')) >= 8
    on conflict do nothing
  `).catch(() => {});

  await db.execute(sql`
    update public.products
    set
      category = case when coalesce(category_manual,false)=true then category else public.product_taxonomy_canonical_category(taxonomy_key) end,
      subcategory = case when coalesce(subcategory_manual,false)=true then subcategory else public.product_taxonomy_canonical_subcategory(taxonomy_key) end,
      updated_at = now()
    where taxonomy_key is not null
      and btrim(taxonomy_key) <> ''
  `).catch(() => {});

  return { ok: true };
}
