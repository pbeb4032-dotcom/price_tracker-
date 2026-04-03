import { sql } from 'drizzle-orm';
import { getDb, type Env } from '../db';

/**
 * Patch v_best_offers to avoid "empty categories".
 *
 * Older schema filtered only spo.is_verified=true which can hide most offers on new sources.
 * We keep quality via:
 * - in_stock = true
 * - is_price_anomaly = false
 * - price_confidence >= 0.60
 */
export async function patchViewsBestOffers(env: Env): Promise<any> {
  const db = getDb(env);

  // Postgres won't allow CREATE OR REPLACE VIEW if it would *drop* existing columns.
  // To keep this patch non-destructive across older deployments, we:
  // 1) compute the "desired" base view (quality-gated)
  // 2) if the view already exists, we preserve the existing column list/order,
  //    and fill any legacy columns with NULL::<type> so we never drop columns.
  type ViewCol = { name: string; type: string };
  const existingCols: ViewCol[] = await db
    .execute(sql`
      select a.attname as name,
             format_type(a.atttypid, a.atttypmod) as type
      from pg_attribute a
      join pg_class c on a.attrelid = c.oid
      join pg_namespace n on c.relnamespace = n.oid
      where n.nspname = 'public'
        and c.relname = 'v_best_offers'
        and a.attnum > 0
        and not a.attisdropped
      order by a.attnum
    `)
    .then((r: any) => ((r?.rows as any[]) ?? []).map((x: any) => ({ name: String(x.name), type: String(x.type) })))
    .catch(() => []);

  const desiredAliases = [
    'offer_id',
    'product_id',
    'product_name_ar',
    'product_name_en',
    'product_image_url',
    'category',
    'subcategory',
    'taxonomy_key',
    'unit',
    'brand_ar',
    'brand_en',
    'barcode',
    'size_value',
    'size_unit',
    'base_price',
    'discount_price',
    'final_price',
    'delivery_fee',
    'currency',
    'in_stock',
    'source_url',
    'merchant_name',
    'observed_at',
    'region_id',
    'region_name_ar',
    'region_name_en',
    'source_name_ar',
    'source_domain',
    'source_logo_url',
    'source_kind',
    'source_id',
  ];

  const existingSet = new Set(existingCols.map((c) => c.name));
  const desiredSet = new Set(desiredAliases);
  const selectParts: string[] = [];
  if (existingCols.length) {
    for (const c of existingCols) {
      if (desiredSet.has(c.name)) {
        selectParts.push(`base."${c.name}"`);
      } else {
        // Preserve legacy columns without dropping them
        selectParts.push(`null::${c.type} as "${c.name}"`);
      }
    }
    // It's safe to add new columns at the end
    for (const name of desiredAliases) {
      if (!existingSet.has(name)) selectParts.push(`base."${name}"`);
    }
  } else {
    selectParts.push('base.*');
  }

  const viewSql = `
    create or replace view public.v_best_offers as
    with base as (
      select distinct on (spo.product_id, spo.region_id)
        spo.id as offer_id,
        spo.product_id,
        p.name_ar as product_name_ar,
        p.name_en as product_name_en,
        p.image_url as product_image_url,
        coalesce(public.product_taxonomy_canonical_category(p.taxonomy_key), p.category, 'general') as category,
        coalesce(public.product_taxonomy_canonical_subcategory(p.taxonomy_key), p.subcategory) as subcategory,
        p.taxonomy_key as taxonomy_key,
        p.unit,
        p.brand_ar,
        p.brand_en,
        p.barcode,
        p.size_value,
        p.size_unit,
        spo.price as base_price,
        spo.discount_price,
        coalesce(spo.discount_price, spo.price) as final_price,
        spo.delivery_fee,
        spo.currency,
        spo.in_stock,
        spo.source_url,
        spo.merchant_name,
        spo.observed_at,
        spo.region_id,
        r.name_ar as region_name_ar,
        r.name_en as region_name_en,
        ps.name_ar as source_name_ar,
        ps.domain as source_domain,
        ps.logo_url as source_logo_url,
        ps.source_kind,
        spo.source_id
      from public.source_price_observations spo
      join public.products p on spo.product_id = p.id
      join public.regions r on spo.region_id = r.id
      join public.price_sources ps on spo.source_id = ps.id
      where p.is_active = true
        and p.condition = 'new'
        and spo.product_condition = 'new'
        and spo.in_stock = true
        and coalesce(spo.is_synthetic,false) = false
        and coalesce(spo.is_price_anomaly,false) = false
        and coalesce(spo.price_confidence, 0.50) >= 0.60
      order by spo.product_id, spo.region_id, coalesce(spo.discount_price, spo.price) asc, spo.observed_at desc
    )
    select
      ${selectParts.join(',\n      ')}
    from base;
  `;

  await db.execute(sql.raw(viewSql));

  // Keep UI view readable
  await db.execute(sql`alter view public.v_best_offers set (security_invoker = false);`).catch(() => {});
  await db.execute(sql`grant select on public.v_best_offers to anon, authenticated;`).catch(() => {});

  return { ok: true };
}
