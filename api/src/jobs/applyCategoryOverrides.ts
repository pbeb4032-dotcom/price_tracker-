import { sql } from 'drizzle-orm';
import { getDb, type Env } from '../db';
import { loadCategoryOverrides, matchCategoryOverride } from '../ingestion/categoryOverrides';

export async function applyCategoryOverrides(env: Env, opts?: { limit?: number; force?: boolean }): Promise<any> {
  const db = getDb(env);
  const limit = Math.max(1, Math.min(200000, Number(opts?.limit ?? 50000)));
  const force = Boolean(opts?.force ?? false);

  const overrides = await loadCategoryOverrides(db);
  if (!overrides.length) return { ok: true, processed: 0, updated: 0, note: 'no_overrides' };

  const r = await db.execute(sql`
    select distinct on (p.id)
      p.id,
      p.name_ar,
      p.name_en,
      p.description_ar,
      p.description_en,
      p.category,
      p.subcategory,
      coalesce(p.category_manual,false) as category_manual,
      coalesce(p.subcategory_manual,false) as subcategory_manual,
      ps.id as source_id,
      ps.domain as domain,
      pum.url as url
    from public.products p
    left join public.product_url_map pum on pum.product_id = p.id
    left join public.price_sources ps on ps.id = pum.source_id
    where p.is_active = true
    order by p.id, pum.last_seen_at desc nulls last
    limit ${limit}
  `).catch(() => ({ rows: [] as any[] }));

  let processed = 0;
  let updated = 0;
  const samples: any[] = [];

  for (const row of (r.rows as any[]) ?? []) {
    processed += 1;

    const matched = matchCategoryOverride(overrides, {
      sourceId: row.source_id ? String(row.source_id) : null,
      domain: row.domain ? String(row.domain) : null,
      url: row.url ? String(row.url) : null,
      name: row.name_ar ?? row.name_en ?? null,
      description: row.description_ar ?? row.description_en ?? null,
    });

    if (!matched) continue;

    const catManual = Boolean(row.category_manual ?? false);
    const subManual = Boolean(row.subcategory_manual ?? false);

    if (!force && catManual) {
      // Respect existing manual lock
      continue;
    }

    const newCat = String(matched.category || row.category || 'general');
    const newSub = matched.subcategory ? String(matched.subcategory) : null;

    const lockCat = Boolean(matched.lock_category ?? true);
    const lockSub = Boolean(matched.lock_subcategory ?? true);

    await db.execute(sql`
      update public.products
      set
        category = ${newCat},
        category_manual = case when ${lockCat} then true else coalesce(category_manual,false) end,
        category_override_id = case when ${lockCat} then ${matched.id}::uuid else category_override_id end,
        subcategory = case
          when ${newSub} is null then subcategory
          when ${lockSub} then ${newSub}
          when ${subManual} = true and ${force} = false then subcategory
          else ${newSub}
        end,
        subcategory_manual = case when ${lockSub} then true else coalesce(subcategory_manual,false) end,
        subcategory_override_id = case when ${lockSub} then ${matched.id}::uuid else subcategory_override_id end,
        updated_at = now()
      where id = ${String(row.id)}::uuid
    `).catch(() => {});

    updated += 1;
    if (samples.length < 50) samples.push({ id: row.id, from: row.category, to: newCat, sub: newSub, override: matched.id });
  }

  return { ok: true, processed, updated, force, samples };
}
