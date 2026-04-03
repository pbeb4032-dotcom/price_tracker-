import { sql } from 'drizzle-orm';
import { getDb, type Env } from '../db';

/**
 * Observation Rollups Schema (Daily) + settings table.
 *
 * هدفها: نخلي التاريخ الطويل للسعر متوفر بحجم صغير (rollups) حتى لو حذفنا raw observations القديمة.
 * Safe + idempotent + additive.
 */
export async function patchObservationRollupsSchema(env: Env): Promise<any> {
  const db = getDb(env);

  await db.execute(sql`create extension if not exists pgcrypto`).catch(() => {});

  // Settings KV for cursors / future tuning
  await db.execute(sql`
    create table if not exists public.app_settings (
      key text primary key,
      value text,
      updated_at timestamptz not null default now()
    );
  `);

  // Daily rollups per (day × source × product × region × condition × unit)
  await db.execute(sql`
    create table if not exists public.source_price_rollups_daily (
      day date not null,
      source_id uuid not null references public.price_sources(id) on delete cascade,
      product_id uuid not null references public.products(id) on delete cascade,
      region_id uuid not null references public.regions(id) on delete cascade,
      product_condition text not null default 'new',
      unit text,

      -- Final price = discount_price or price (IQD)
      min_final_price numeric,
      max_final_price numeric,
      avg_final_price numeric,

      -- Effective price = final + delivery_fee (if any)
      min_effective_price numeric,
      max_effective_price numeric,
      avg_effective_price numeric,

      sample_count int not null default 0,
      in_stock_count int not null default 0,
      first_observed_at timestamptz,
      last_observed_at timestamptz,

      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),

      primary key (day, source_id, product_id, region_id, product_condition, unit)
    );
  `);

  await db.execute(sql`create index if not exists idx_sprd_product_day on public.source_price_rollups_daily(product_id, day desc)`).catch(() => {});
  await db.execute(sql`create index if not exists idx_sprd_product_region_day on public.source_price_rollups_daily(product_id, region_id, day desc)`).catch(() => {});

  // World-scale History function: raw (recent) + rollups (older) automatically.
  await db.execute(sql`
    create or replace function public.get_product_price_history(
      p_product_id uuid,
      p_days int default 90,
      p_region_id uuid default null,
      p_include_delivery boolean default false
    )
    returns table (
      day date,
      min_price numeric,
      max_price numeric,
      avg_price numeric,
      offer_count int,
      source_count int
    )
    language sql
    stable
    set search_path to 'public'
    as $$
      with
      raw as (
        select
          (o.observed_at at time zone 'Asia/Baghdad')::date as day,
          min(
            case when p_include_delivery
              then (coalesce(o.discount_price, o.price) + coalesce(o.delivery_fee, 0))
              else coalesce(o.discount_price, o.price)
            end
          ) as min_price,
          max(
            case when p_include_delivery
              then (coalesce(o.discount_price, o.price) + coalesce(o.delivery_fee, 0))
              else coalesce(o.discount_price, o.price)
            end
          ) as max_price,
          round(avg(
            case when p_include_delivery
              then (coalesce(o.discount_price, o.price) + coalesce(o.delivery_fee, 0))
              else coalesce(o.discount_price, o.price)
            end
          ), 0) as avg_price,
          count(*)::int as offer_count,
          count(distinct o.source_id)::int as source_count
        from public.source_price_observations o
        where o.product_id = p_product_id
          and o.observed_at >= (now() - (p_days || ' days')::interval)
          and (p_region_id is null or o.region_id = p_region_id)
          and coalesce(o.discount_price, o.price) > 0
          and coalesce(o.discount_price, o.price) < 500000000
        group by (o.observed_at at time zone 'Asia/Baghdad')::date
      ),
      roll as (
        select
          r.day,
          min(case when p_include_delivery then r.min_effective_price else r.min_final_price end) as min_price,
          max(case when p_include_delivery then r.max_effective_price else r.max_final_price end) as max_price,
          round(avg(case when p_include_delivery then r.avg_effective_price else r.avg_final_price end), 0) as avg_price,
          sum(r.sample_count)::int as offer_count,
          count(distinct r.source_id)::int as source_count
        from public.source_price_rollups_daily r
        where r.product_id = p_product_id
          and r.day >= ((now() at time zone 'Asia/Baghdad')::date - (p_days::int))
          and (p_region_id is null or r.region_id = p_region_id)
          and coalesce(r.avg_final_price, 0) > 0
        group by r.day
      ),
      merged as (
        select
          coalesce(raw.day, roll.day) as day,
          case when raw.day is not null then raw.min_price else roll.min_price end as min_price,
          case when raw.day is not null then raw.max_price else roll.max_price end as max_price,
          case when raw.day is not null then raw.avg_price else roll.avg_price end as avg_price,
          case when raw.day is not null then raw.offer_count else roll.offer_count end as offer_count,
          case when raw.day is not null then raw.source_count else roll.source_count end as source_count
        from roll
        full outer join raw on raw.day = roll.day
      )
      select * from merged
      order by day asc;
    $$;
  `).catch(() => {});

  return { ok: true };
}
