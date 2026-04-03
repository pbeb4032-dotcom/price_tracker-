import { sql } from 'drizzle-orm';
import { getDb, type Env } from '../db';

/**
 * Marks suspiciously-low prices (commonly caused by parsing "100.000" as 100).
 * Safe-by-default:
 * - Targets only non-food categories where < 1000 IQD is almost always wrong
 * - Does NOT delete data; it only flags as anomaly and un-verifies
 */
export async function fixLowPriceOutliers(
  env: Env,
  opts?: { limit?: number; min?: number; max?: number; dryRun?: boolean },
): Promise<any> {
  const db = getDb(env);
  const min = Math.max(1, Number(opts?.min ?? 1));
  const max = Math.max(min, Number(opts?.max ?? 999));
  const limit = Math.max(1, Math.min(200000, Number(opts?.limit ?? 20000)));
  const dryRun = Boolean(opts?.dryRun ?? false);

  const candidates = await db.execute(sql`
    with c as (
      select
        spo.id,
        spo.product_id,
        p.category,
        coalesce(spo.normalized_price_iqd, spo.price)::numeric as price_iqd
      from public.source_price_observations spo
      join public.products p on p.id = spo.product_id
      where coalesce(spo.is_price_anomaly,false) = false
        and coalesce(spo.is_verified,false) = true
        and p.is_active = true
        and p.category in ('beauty','electronics','clothing','automotive','home','sports','toys')
        and coalesce(spo.normalized_price_iqd, spo.price)::numeric between ${min}::numeric and ${max}::numeric
      order by spo.observed_at desc
      limit ${limit}
    )
    select count(*)::int as n from c;
  `);

  const n = Number((candidates.rows as any[])[0]?.n ?? 0);
  if (dryRun) return { ok: true, dryRun: true, min, max, limit, marked: 0, candidates: n };

  const updated = await db.execute(sql`
    with c as (
      select spo.id
      from public.source_price_observations spo
      join public.products p on p.id = spo.product_id
      where coalesce(spo.is_price_anomaly,false) = false
        and coalesce(spo.is_verified,false) = true
        and p.is_active = true
        and p.category in ('beauty','electronics','clothing','automotive','home','sports','toys')
        and coalesce(spo.normalized_price_iqd, spo.price)::numeric between ${min}::numeric and ${max}::numeric
      order by spo.observed_at desc
      limit ${limit}
    )
    update public.source_price_observations spo
    set
      is_price_anomaly = true,
      anomaly_reason = coalesce(spo.anomaly_reason, 'auto:low_price_outlier'),
      is_verified = false
    from c
    where spo.id = c.id
    returning 1;
  `);

  const marked = (updated.rows as any[])?.length ?? 0;
  return { ok: true, min, max, limit, candidates: n, marked };
}
