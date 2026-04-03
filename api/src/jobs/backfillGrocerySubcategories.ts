import { sql } from 'drizzle-orm';
import { getDb, type Env } from '../db';
import { classifyGrocerySubcategory } from '../ingestion/groceryTaxonomy';

export async function backfillGrocerySubcategories(env: Env, opts?: { limit?: number }): Promise<any> {
  const db = getDb(env);
  const limit = Math.max(1, Math.min(200000, Number(opts?.limit ?? 20000)));

  const r = await db.execute(sql`
    select id, name_ar, name_en, description_ar, description_en, subcategory,
           coalesce(subcategory_manual,false) as sub_manual
    from public.products
    where is_active = true
      and category = 'groceries'
      and (subcategory is null or length(trim(subcategory)) = 0)
      and coalesce(subcategory_manual,false) = false
    order by updated_at desc nulls last
    limit ${limit}
  `).catch(() => ({ rows: [] as any[] }));

  let processed = 0;
  let updated = 0;
  const samples: any[] = [];

  for (const p of (r.rows as any[]) ?? []) {
    processed += 1;
    const det = classifyGrocerySubcategory({
      name: [p.name_ar, p.name_en].filter(Boolean).join(' | '),
      description: [p.description_ar, p.description_en].filter(Boolean).join(' | '),
      siteCategory: null,
    });

    if (!det.subcategory) continue;
    if (!(det.badge === 'trusted' || det.badge === 'medium')) continue;

    await db.execute(sql`
      update public.products
      set subcategory = ${String(det.subcategory)}, updated_at = now()
      where id = ${String(p.id)}::uuid
    `).catch(() => {});

    updated += 1;
    if (samples.length < 50) samples.push({ id: p.id, sub: det.subcategory, badge: det.badge, conf: det.confidence });
  }

  return { ok: true, processed, updated, samples };
}
