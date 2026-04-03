import { sql } from 'drizzle-orm';
import { getDb, type Env } from '../db';
import { extractNumberLike, normalizeToIqdSmart, normalizeDomain } from '../ingestion/sanity';

/**
 * Repairs legacy price parsing mistakes using raw_price_text that was stored during ingestion.
 *
 * Typical bug: "100.000" was parsed as 100 instead of 100000.
 * This job:
 * - Finds suspiciously-low stored prices (default 1..999)
 * - Re-parses raw_price_text using the current robust parser
 * - Updates price + normalized_price_iqd safely
 * - Refreshes product_price_snapshot_v3 if present
 */
export async function repairPricesFromRawText(
  env: Env,
  opts?: { limit?: number; min?: number; max?: number; dryRun?: boolean },
): Promise<any> {
  const db = getDb(env);
  const min = Math.max(1, Number(opts?.min ?? 1));
  const max = Math.max(min, Number(opts?.max ?? 999));
  const limit = Math.max(1, Math.min(200000, Number(opts?.limit ?? 50000)));
  const dryRun = Boolean(opts?.dryRun ?? false);

  // FX fallback (only used when parsed currency != IQD)
  let fxRate = 1470;
  try {
    const fx = await db.execute(sql`
      select mid_iqd_per_usd::numeric as mid
      from public.exchange_rates
      order by observed_at desc nulls last
      limit 1
    `);
    const v = Number((fx.rows as any[])[0]?.mid ?? 0);
    if (Number.isFinite(v) && v > 500) fxRate = v;
  } catch {
    // ignore
  }

  const candidates = await db.execute(sql`
    select
      spo.id,
      spo.product_id,
      spo.source_id,
      spo.source_url,
      spo.raw_price_text,
      spo.parsed_currency,
      spo.price::numeric as price_raw,
      spo.normalized_price_iqd::bigint as normalized_old,
      p.category as product_category,
      ps.domain as source_domain
    from public.source_price_observations spo
    join public.products p on p.id = spo.product_id
    join public.price_sources ps on ps.id = spo.source_id
    where spo.raw_price_text is not null
      and length(spo.raw_price_text) > 0
      and coalesce(spo.is_price_anomaly,false) = false
      and (
        (coalesce(spo.normalized_price_iqd, 0) between ${min} and ${max})
        or (coalesce(spo.price, 0) between ${min} and ${max})
      )
      -- likely had thousands separators
      and spo.raw_price_text ~ '[\.,٬،]'
    order by spo.observed_at desc
    limit ${limit}
  `);

  let processed = 0;
  let updated = 0;
  let skipped = 0;
  const samples: any[] = [];

  for (const row of (candidates.rows as any[]) ?? []) {
    processed += 1;
    const raw = String(row.raw_price_text ?? '').trim();
    const parsed = extractNumberLike(raw);
    if (!parsed || !Number.isFinite(parsed) || parsed <= 0) {
      skipped += 1;
      continue;
    }

    // currency hint
    let cur = String(row.parsed_currency ?? 'IQD').toUpperCase();
    if (raw.toLowerCase().includes('usd') || raw.includes('$')) cur = 'USD';

    const domain = normalizeDomain(String(row.source_domain ?? ''));
    const categoryHint = String(row.product_category ?? 'general');

    const norm = normalizeToIqdSmart(parsed, cur, fxRate, { categoryHint, domain });
    const newIqd = Math.round(norm.priceIqd);

    const oldIqd = Number(row.normalized_old ?? row.price_raw ?? 0);

    // Update only if it looks like a real repair (e.g., 100 -> 100000), or a large correction.
    const isRepair =
      (oldIqd >= min && oldIqd <= max && newIqd >= 1000) ||
      (oldIqd > 0 && newIqd > 0 && (newIqd / oldIqd >= 10 || oldIqd / newIqd >= 10));

    if (!isRepair) {
      skipped += 1;
      continue;
    }

    if (!dryRun) {
      await db.execute(sql`
        update public.source_price_observations
        set
          price = ${newIqd}::numeric,
          normalized_price_iqd = ${newIqd}::bigint,
          parsed_currency = 'IQD',
          normalization_factor = ${norm.normalizationFactor}::int,
          price_confidence = greatest(coalesce(price_confidence,0.50), 0.70)
        where id = ${row.id}::uuid
      `);
    }

    updated += 1;
    if (samples.length < 50) {
      samples.push({
        id: row.id,
        raw_price_text: raw,
        old: oldIqd,
        new: newIqd,
        source_domain: row.source_domain,
      });
    }
  }

  // Refresh snapshot if present
  let refreshed = false;
  if (!dryRun) {
    try {
      await db.execute(sql`refresh materialized view public.product_price_snapshot_v3`);
      refreshed = true;
    } catch {
      // ignore (older DBs may not have it)
    }
  }

  return { ok: true, processed, updated, skipped, dryRun, fxRate, refreshed_snapshot_v3: refreshed, samples };
}
