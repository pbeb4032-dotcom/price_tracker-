import { sql } from 'drizzle-orm';
import { getDb, type Env } from '../db';
import { DISCOVERY_SECTORS, IRAQ_PROVINCES } from './coverageStats';

type RetroTagOpts = {
  limit?: number;
  force?: boolean;
  dryRun?: boolean;
};

async function fetchText(url: string, timeoutMs: number): Promise<{ ok: boolean; status: number; text: string }> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      headers: { 'User-Agent': 'price-tracker-iraq/1.0' },
      redirect: 'follow',
    });
    const text = await res.text().catch(() => '');
    return { ok: res.ok, status: res.status, text: String(text || '') };
  } catch {
    return { ok: false, status: 0, text: '' };
  } finally {
    clearTimeout(t);
  }
}

function norm(s: unknown): string {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[ً-\u065F\u0670\u0640]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[\s\p{P}\p{S}]+/gu, ' ')
    .trim();
}

function countHits(hay: string, needle: string): number {
  if (!hay || !needle) return 0;
  const n = needle.trim();
  if (!n) return 0;
  let i = 0;
  let from = 0;
  while (true) {
    const at = hay.indexOf(n, from);
    if (at === -1) break;
    i += 1;
    from = at + n.length;
    if (i > 50) break;
  }
  return i;
}

const SECTOR_PATTERNS: Record<string, RegExp> = {
  'سوبرماركت': /(سوبر|هايبر|ماركت|بقاله|بقالة|grocery|supermarket|hypermarket|store)/i,
  'الكترونيات': /(الكترونيات|electronics|electronic|computer|laptop|pc|كمبيوتر|حاسبه|حاسبة)/i,
  'موبايلات': /(موبايل|هواتف|هاتف|جوال|ايفون|سامسونج|iphone|samsung|mobile|smartphone|phones?)/i,
  'ملابس': /(ملابس|ازياء|أزياء|clothing|apparel|fashion)/i,
  'أحذية': /(احذيه|احذية|أحذية|shoes|footwear)/i,
  'صيدلية': /(صيدليه|صيدلية|pharmacy|drugstore|medicine|ادويه|ادوية)/i,
  'عطور': /(عطور|perfume|fragrance|parfum)/i,
  'أجهزة منزلية': /(اجهزه منزليه|أجهزه منزليه|أجهزة منزلية|appliances|home appliances|microwave|washer|refrigerator|ثلاجه|ثلاجة)/i,
  'أثاث': /(اثاث|أثاث|furniture|sofa|bed|مفرش|كنبه|كنبة|سرير)/i,
  'مواد بناء': /(مواد بناء|building materials|construction|cement|steel|طابوق|اسمنت|حديد)/i,
  'سيارات': /(سيارات|automotive|car parts|auto parts|بطاريه|بطارية|اطارات|اطار|tires?)/i,
  'رياضة': /(رياضه|رياضة|sport|sports|fitness|gym)/i,
  'أطفال': /(اطفال|أطفال|kids|baby|toys|toy)/i,
  'مكياج': /(مكياج|cosmetic|cosmetics|makeup|beauty|skincare|عنايه|عناية)/i,
  'كتب': /(كتب|book|books|stationery|قرطاسيه|قرطاسية)/i,
};

function inferFromHtml(html: string): {
  provinces: { name: string; hits: number }[];
  sectors: { name: string; hits: number }[];
} {
  const text = norm(html);

  const provinces = IRAQ_PROVINCES.map((p) => ({ name: p, hits: countHits(text, norm(p)) }))
    .filter((x) => x.hits > 0)
    .sort((a, b) => b.hits - a.hits);

  const sectors = DISCOVERY_SECTORS.map((s) => ({ name: s, hits: SECTOR_PATTERNS[s]?.test(html) ? 1 : 0 }))
    .filter((x) => x.hits > 0)
    .sort((a, b) => b.hits - a.hits);

  return { provinces, sectors };
}

function uniq(arr: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of arr) {
    const v = String(x || '').trim();
    if (!v) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

export async function retroTagSources(env: Env, opts?: RetroTagOpts): Promise<any> {
  const db = getDb(env);
  const limit = Math.max(1, Math.min(2000, Number(opts?.limit ?? 200)));
  const dryRun = Boolean(opts?.dryRun ?? true);
  const force = Boolean(opts?.force ?? false);

  // Prioritize missing tags first.
  const rows = await db
    .execute(sql`
      select id, domain, base_url, discovery_tags
      from public.price_sources
      where country_code='IQ'
      order by
        (case when discovery_tags->'provinces' is null or jsonb_array_length(coalesce(discovery_tags->'provinces','[]'::jsonb))=0 then 0 else 1 end) asc,
        (case when discovery_tags->'sectors' is null or jsonb_array_length(coalesce(discovery_tags->'sectors','[]'::jsonb))=0 then 0 else 1 end) asc,
        coalesce(updated_at, created_at) desc
      limit ${limit}::int
    `)
    .catch(() => ({ rows: [] as any[] }));

  const items = (rows.rows as any[]) ?? [];
  if (!items.length) return { ok: true, scanned: 0, tagged: 0, dryRun, message: 'no_sources' };

  let scanned = 0;
  let tagged = 0;
  const results: any[] = [];

  const CONC = 8;
  let idx = 0;

  const runOne = async (row: any) => {
    scanned += 1;
    const domain = String(row.domain || '').trim();
    const base = String(row.base_url || `https://${domain}`).replace(/\/$/, '');

    const home = await fetchText(base, 12000);
    const about = await fetchText(`${base}/about`, 9000);
    const contact = await fetchText(`${base}/contact`, 9000);

    const merged = [home.text, about.text, contact.text].filter(Boolean).join('\n\n');
    const inferred = inferFromHtml(merged);

    const existing = (row.discovery_tags ?? {}) as any;
    const manual = (existing.manual ?? {}) as any;

    const provinces = inferred.provinces.map((x) => x.name).slice(0, 3);
    const sectors = inferred.sectors.map((x) => x.name).slice(0, 2);

    const next = { ...(existing || {}) } as any;
    next.retro_tag = {
      computed_at: new Date().toISOString(),
      sources: { home: home.status, about: about.status, contact: contact.status },
      provinces_hits: inferred.provinces.slice(0, 6),
      sectors_hits: inferred.sectors.slice(0, 6),
    };

    let changed = false;

    if (force || !Array.isArray(manual.provinces) || manual.provinces.length === 0) {
      if (provinces.length) {
        const prev = Array.isArray(next.provinces) ? next.provinces : [];
        const mergedProv = uniq([...prev, ...provinces]);
        if (JSON.stringify(mergedProv) !== JSON.stringify(prev)) {
          next.provinces = mergedProv;
          changed = true;
        }
      }
    }

    if (force || !Array.isArray(manual.sectors) || manual.sectors.length === 0) {
      if (sectors.length) {
        const prev = Array.isArray(next.sectors) ? next.sectors : [];
        const mergedSec = uniq([...prev, ...sectors]);
        if (JSON.stringify(mergedSec) !== JSON.stringify(prev)) {
          next.sectors = mergedSec;
          changed = true;
        }
      }
    }

    if (changed) tagged += 1;

    if (!dryRun && changed) {
      await db.execute(sql`
        update public.price_sources
        set discovery_tags=${JSON.stringify(next)}::jsonb
        where id=${String(row.id)}::uuid
      `);
    }

    results.push({ domain, changed, provinces, sectors });
  };

  const workers = Array.from({ length: CONC }, async () => {
    while (true) {
      const cur = idx;
      idx += 1;
      if (cur >= items.length) break;
      await runOne(items[cur]).catch(() => {});
    }
  });

  await Promise.all(workers);

  return { ok: true, scanned, tagged, dryRun, force, sample: results.slice(0, 40) };
}
