import { sql } from 'drizzle-orm';
import { getDb, type Env } from '../db';

/**
 * Data-compat patch:
 * Older checkpoints used category key 'grocery'.
 * Current schema + guardrails use 'groceries'.
 *
 * This patch safely rewrites existing rows to avoid empty category pages
 * and to make price guardrails & reclassify jobs consistent.
 */
export async function patchCategoryGroceriesKey(env: Env): Promise<any> {
  const db = getDb(env);

  // products.category
  const p1 = await db.execute(sql`
    update public.products
    set category = 'groceries', updated_at = now()
    where category = 'grocery'
  `).catch(() => ({ rowCount: 0 } as any));

  // observation hints (optional columns; ignore if not present)
  let p2 = { rowCount: 0 } as any;
  try {
    p2 = await db.execute(sql`
      update public.source_price_observations
      set category_hint = 'groceries'
      where category_hint = 'grocery'
    `);
  } catch {
    // Column may not exist yet in older DBs.
  }

  return { ok: true, products_updated: (p1 as any).rowCount ?? null, observations_updated: (p2 as any).rowCount ?? null };
}
