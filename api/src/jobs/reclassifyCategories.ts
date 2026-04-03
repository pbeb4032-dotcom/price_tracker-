import { sql } from 'drizzle-orm';
import { getDb, type Env } from '../db';
import { inferCategoryKeyDetailed } from '../ingestion/categoryInfer';

function safeDomainFromUrl(url: string | null | undefined): string {
  try {
    if (!url) return '';
    const u = new URL(url);
    return String(u.hostname || '').toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function shouldUpdateCategory(current: string | null | undefined, next: string, textScore: number, force: boolean): boolean {
  const cur = String(current ?? 'general').trim() || 'general';
  if (force) return cur !== next;
  if (cur === next) return false;
  if (next === 'general') return false; // never downgrade to general unless force
  if (!current || cur === 'general') return next !== 'general';

  // Treat these as broad/messy buckets that can be upgraded away from.
  const broad = new Set(['general', 'groceries', 'beverages', 'home', 'essentials']);
  if (broad.has(cur)) {
    // Require at least a little text support to avoid domain-only flips.
    return textScore >= 2;
  }

  // Strong correction for polluted categories: only flip when text evidence is very strong.
  if (textScore >= 4) return true;

  return false;
}

export async function reclassifyCategories(env: Env, opts?: { limit?: number; force?: boolean }): Promise<any> {
  const db = getDb(env);
  const limit = Math.max(1, Math.min(50000, Number(opts?.limit ?? 5000)));
  const force = Boolean(opts?.force ?? false);

  // Use a representative source URL (latest seen) to get the domain.
  const rows = await db.execute(sql`
    select
      p.id,
      p.name_ar,
      p.name_en,
      p.description_ar,
      p.description_en,
      p.category,
      (
        select pum.url
        from public.product_url_map pum
        where pum.product_id = p.id
        order by pum.last_seen_at desc nulls last
        limit 1
      ) as url
    from public.products p
    where p.is_active = true
    order by p.updated_at desc nulls last
    limit ${limit}
  `);

  let updated = 0;
  let skipped = 0;
  const samples: any[] = [];

  for (const r of (rows.rows as any[])) {
    const url = r.url as string | null;
    const domain = safeDomainFromUrl(url);
    const cur = r.category as string | null;
    const name = [r.name_ar, r.name_en].filter(Boolean).join(' | ') as string;
    const desc = [r.description_ar, r.description_en].filter(Boolean).join(' | ') as string;

    const det = inferCategoryKeyDetailed({ name, description: desc, domain, url, siteCategory: null });
    const next = det.category;
    const ok = shouldUpdateCategory(cur, next, det.textScore, force);
    if (!ok) {
      skipped++;
      continue;
    }
    await db.execute(sql`
      update public.products
      set category = ${next}, updated_at = now()
      where id = ${r.id}::uuid
    `);
    updated++;
    if (samples.length < 25) {
      samples.push({ id: r.id, cur, next, textScore: det.textScore, domain, name });
    }
  }

  return { ok: true, updated, skipped, limit, force, samples };
}
