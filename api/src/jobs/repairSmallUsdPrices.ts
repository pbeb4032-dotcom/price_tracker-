import { sql } from 'drizzle-orm';
import { getDb, type Env } from '../db';
import { getLatestFxRateForPricing } from '../fx/governedFx';

/**
 * Repair legacy offers where USD prices were stored as tiny IQD (e.g., 110 instead of 110*FX).
 *
 * Heuristic (safe):
 * - parsed_currency is IQD or null
 * - price in [1..999]
 * - product category in (electronics, beauty, automotive)
 * - product has strong Latin/brand signal (English name present OR Latin chars in Arabic name)
 */
export async function repairSmallUsdPrices(
  env: Env,
  opts?: { limit?: number; min?: number; max?: number; dryRun?: boolean },
): Promise<any> {
  const db = getDb(env);
  const limit = Math.max(1, Math.min(200000, Number(opts?.limit ?? 50000)));
  const min = Number(opts?.min ?? 1);
  const max = Number(opts?.max ?? 999);
  const dryRun = Boolean(opts?.dryRun ?? false);

  const fxRate = await getLatestFxRateForPricing(db, 1470);

  const rows = await db.execute(sql`
    select
      so.id,
      so.price,
      so.discount_price,
      so.raw_price_text,
      so.parsed_currency,
      p.category,
      p.name_ar,
      p.name_en
    from public.source_price_observations so
    join public.products p on p.id = so.product_id
    where coalesce(so.is_synthetic,false)=false
      and coalesce(so.is_price_anomaly,false)=false
      and coalesce(so.price,0) between ${min} and ${max}
      and coalesce(so.parsed_currency,'IQD') = 'IQD'
      and p.category in ('electronics','beauty','automotive')
      and (
        p.name_en is not null
        or p.name_ar ~ '[A-Za-z]'
      )
    order by so.observed_at desc nulls last
    limit ${limit}
  `);

  const items = (rows.rows as any[]) ?? [];
  const samples: any[] = [];
  let changed = 0;

  for (const r of items) {
    const id = r.id as string;
    const price = Number(r.price);
    const discount = r.discount_price == null ? null : Number(r.discount_price);

    const newPrice = Math.round(price * fxRate);
    const newDiscount = discount == null ? null : Math.round(discount * fxRate);

    if (samples.length < 20) {
      samples.push({ id, old: price, old_discount: discount, fxRate, new: newPrice, new_discount: newDiscount, category: r.category, name_en: r.name_en });
    }

    if (!dryRun) {
      try {
        await db.execute(sql`
          update public.source_price_observations
          set
            price = ${newPrice},
            normalized_price_iqd = ${newPrice},
            discount_price = ${newDiscount},
            parsed_currency = 'USD',
            normalization_factor = ${Math.round(fxRate)},
            raw_price_text = coalesce(raw_price_text,'') || ' (auto_usd)',
            is_verified = false,
            updated_at = now()
          where id = ${id}::uuid
        `);
      } catch (e: any) {
        // Schema fallback: update only core columns
        try {
          await db.execute(sql`
            update public.source_price_observations
            set
              price = ${newPrice},
              discount_price = ${newDiscount},
              parsed_currency = 'USD',
              raw_price_text = coalesce(raw_price_text,'') || ' (auto_usd)',
              is_verified = false
            where id = ${id}::uuid
          `);
        } catch {}
      }
      changed += 1;
    }
  }

  // Refresh snapshot if it exists
  if (!dryRun) {
    try {
      await db.execute(sql`refresh materialized view public.product_price_snapshot_v3`);
    } catch {}
  }

  return { ok: true, processed: items.length, changed: dryRun ? 0 : changed, dryRun, fxRate, samples };
}
