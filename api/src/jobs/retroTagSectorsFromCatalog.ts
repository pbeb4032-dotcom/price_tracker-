import { sql } from 'drizzle-orm';
import { getDb, type Env } from '../db';
import { DISCOVERY_SECTORS } from './coverageStats';

type CatalogRetroTagOpts = {
  limit?: number;
  days?: number;
  minSamples?: number;
  force?: boolean;
  dryRun?: boolean;
  // quality gate
  minConfidence?: number; // if below -> needs_review
  reviewMinConfidence?: number; // if below -> skip (too noisy)
  onlyMissingOrLowConfidence?: boolean;
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
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

function addScore(m: Map<string, number>, sector: string, v: number) {
  const k = String(sector || '').trim();
  if (!k) return;
  m.set(k, (m.get(k) ?? 0) + v);
}

function topN(m: Map<string, number>, n: number): { name: string; score: number }[] {
  return Array.from(m.entries())
    .map(([name, score]) => ({ name, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, n);
}

const KW: Record<string, RegExp> = {
  'موبايلات': /(iphone|samsung|galaxy|android|smartphone|phones?|mobile|ايفون|سامسونج|موبايل|هاتف|هواتف)/i,
  'أحذية': /(shoes|footwear|احذيه|احذية|أحذية)/i,
  'عطور': /(perfume|fragrance|parfum|عطر|عطور)/i,
  'مكياج': /(makeup|cosmetic|cosmetics|skincare|beauty|مكياج|كوزمتك|عنايه|عناية)/i,
  'صيدلية': /(pharmacy|medicine|vitamin|supplement|صيدلية|ادوية|ادويه|فيتامين)/i,
  'أجهزة منزلية': /(appliances|refrigerator|microwave|washer|dryer|oven|ثلاجه|ثلاجة|غساله|غسالة|مايكرويف|فرن)/i,
  'أثاث': /(furniture|sofa|bed|table|chair|اثاث|أثاث|كنبه|كنبة|سرير|طاوله|طاولة)/i,
  'مواد بناء': /(cement|steel|tile|construction|building materials|اسمنت|حديد|سيراميك|طابوق|مواد بناء)/i,
  'سيارات': /(auto|automotive|car parts|engine oil|tires?|بطارية|اطار|اطارات|زيت محرك|سيارات)/i,
  'رياضة': /(sport|sports|fitness|gym|رياضة|رياضه)/i,
  'أطفال': /(kids|baby|toys?|أطفال|اطفال|baby)/i,
};

function sectorFromCategory(cat: string): string | null {
  const c = String(cat || '').trim();
  switch (c) {
    case 'groceries':
    case 'beverages':
      return 'سوبرماركت';
    case 'electronics':
      return 'الكترونيات';
    case 'clothing':
      return 'ملابس';
    case 'home':
      return 'أجهزة منزلية';
    case 'beauty':
      return 'مكياج';
    case 'sports':
      return 'رياضة';
    case 'toys':
      return 'أطفال';
    case 'automotive':
      return 'سيارات';
    case 'essentials':
      return 'صيدلية';
    default:
      return null;
  }
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

export async function retroTagSectorsFromCatalog(env: Env, opts?: CatalogRetroTagOpts): Promise<any> {
  const db = getDb(env);

  const limit = Math.max(1, Math.min(2000, Number(opts?.limit ?? 200)));
  const days = Math.max(7, Math.min(365, Number(opts?.days ?? 90)));
  const minSamples = Math.max(25, Math.min(2000, Number(opts?.minSamples ?? 120)));
  const dryRun = Boolean(opts?.dryRun ?? true);
  const force = Boolean(opts?.force ?? false);
  const minConfidence = clamp(Number(opts?.minConfidence ?? 0.78), 0.1, 0.99);
  const reviewMinConfidence = clamp(Number(opts?.reviewMinConfidence ?? 0.55), 0.0, minConfidence);
  const onlyMissingOrLowConfidence = Boolean(opts?.onlyMissingOrLowConfidence ?? false);

  const where = onlyMissingOrLowConfidence
    ? sql`and (
        ps.discovery_tags->'sectors' is null
        or jsonb_array_length(coalesce(ps.discovery_tags->'sectors','[]'::jsonb))=0
        or coalesce((ps.discovery_tags->'retro_tag_catalog'->>'confidence')::numeric, 0) < ${minConfidence}::numeric
        or (ps.discovery_tags->'needs_review'->'sectors_catalog') is not null
      )`
    : sql``;

  const rows = await db
    .execute(sql`
      select ps.id, ps.domain, ps.base_url, ps.discovery_tags
      from public.price_sources ps
      where ps.country_code='IQ'
      ${where}
      order by
        (case when ps.discovery_tags->'sectors' is null or jsonb_array_length(coalesce(ps.discovery_tags->'sectors','[]'::jsonb))=0 then 0 else 1 end) asc,
        coalesce((ps.discovery_tags->'retro_tag_catalog'->>'computed_at')::timestamptz, ps.updated_at, ps.created_at) asc
      limit ${limit}::int
    `)
    .catch(() => ({ rows: [] as any[] }));

  const items = (rows.rows as any[]) ?? [];
  if (!items.length) return { ok: true, scanned: 0, tagged: 0, reviewQueued: 0, dryRun, message: 'no_sources' };

  let scanned = 0;
  let tagged = 0;
  let reviewQueued = 0;

  const sample: any[] = [];

  const CONC = 6;
  let idx = 0;

  const runOne = async (row: any) => {
    scanned += 1;
    const sourceId = String(row.id);
    const domain = String(row.domain || '').trim();

    // Category distribution
    const catR = await db
      .execute(sql`
        select coalesce(p.category,'general') as category, count(*)::int as cnt
        from public.source_price_observations spo
        join public.products p on p.id = spo.product_id
        where spo.source_id=${sourceId}::uuid
          and spo.observed_at >= now() - (${days}::int * interval '1 day')
        group by 1
        order by cnt desc
        limit 20
      `)
      .catch(() => ({ rows: [] as any[] }));

    const cats = (catR.rows as any[]) ?? [];
    const totalSamples = cats.reduce((n, r) => n + Number((r as any).cnt ?? 0), 0);

    // Early exit when not enough evidence
    if (totalSamples < minSamples) {
      const existing = (row.discovery_tags ?? {}) as any;
      const next = { ...(existing || {}) } as any;
      next.retro_tag_catalog = {
        computed_at: new Date().toISOString(),
        days,
        samples: totalSamples,
        confidence: 0,
        reason: 'LOW_SAMPLES',
        categories_top: cats,
      };

      if (!next.needs_review) next.needs_review = {};
      next.needs_review.sectors_catalog = {
        computed_at: new Date().toISOString(),
        reason: 'LOW_SAMPLES',
        days,
        minSamples,
        samples: totalSamples,
      };

      reviewQueued += 1;
      if (!dryRun) {
        await db.execute(sql`update public.price_sources set discovery_tags=${JSON.stringify(next)}::jsonb where id=${sourceId}::uuid`);
      }

      sample.push({ domain, action: 'needs_review', reason: 'LOW_SAMPLES', samples: totalSamples });
      return;
    }

    // Sample product names + urls for keyword scoring
    const sampleR = await db
      .execute(sql`
        select p.name_ar, p.name_en, p.subcategory, spo.source_url
        from public.source_price_observations spo
        join public.products p on p.id = spo.product_id
        where spo.source_id=${sourceId}::uuid
          and spo.observed_at >= now() - (${days}::int * interval '1 day')
        order by spo.observed_at desc
        limit 300
      `)
      .catch(() => ({ rows: [] as any[] }));

    const texts = ((sampleR.rows as any[]) ?? []).map((r) => {
      const t = [r.name_ar, r.name_en, r.subcategory, r.source_url].filter(Boolean).join(' | ');
      return String(t);
    });

    const scores = new Map<string, number>();

    // Category weights
    for (const r of cats) {
      const category = String((r as any).category ?? 'general');
      const cnt = Number((r as any).cnt ?? 0);
      const sec = sectorFromCategory(category);
      if (sec) addScore(scores, sec, cnt * 3);
      // extra: electronics might actually be phones
      if (category === 'electronics') addScore(scores, 'موبايلات', cnt * 1);
      if (category === 'beauty') addScore(scores, 'عطور', cnt * 1);
      if (category === 'home') addScore(scores, 'أثاث', cnt * 0.5);
    }

    // Keyword weights
    for (const t of texts) {
      const raw = String(t || '');
      if (!raw) continue;
      for (const s of DISCOVERY_SECTORS) {
        const re = KW[s];
        if (re && re.test(raw)) addScore(scores, s, 2);
      }
      // general electronics keywords
      if (/(laptop|pc|computer|كمبيوتر|حاسبه|حاسبة)/i.test(raw)) addScore(scores, 'الكترونيات', 1.5);
      if (/(cart|checkout|basket|add to cart|سلة|الدفع)/i.test(raw)) addScore(scores, 'سوبرماركت', 0.2);
    }

    const top = topN(scores, 3);
    const s1 = top[0]?.score ?? 0;
    const s2 = top[1]?.score ?? 0;
    const sum = Array.from(scores.values()).reduce((a, b) => a + b, 0);
    const ratio = sum > 0 ? s1 / sum : 0;
    const margin = s1 > 0 ? (s1 - s2) / s1 : 0;
    const confidence = clamp(0.55 * ratio + 0.45 * margin, 0, 1);

    const suggested = top.map((x) => ({ sector: x.name, score: x.score }));
    const chosen = top.length && top[0] ? [top[0].name] : [];

    const existing = (row.discovery_tags ?? {}) as any;
    const manual = (existing.manual ?? {}) as any;

    const next = { ...(existing || {}) } as any;
    next.retro_tag_catalog = {
      computed_at: new Date().toISOString(),
      days,
      minSamples,
      samples: totalSamples,
      confidence,
      categories_top: cats.slice(0, 10),
      suggested: suggested.slice(0, 3),
    };

    if (!next.needs_review) next.needs_review = {};

    // Decide: tag vs review
    const canWrite = confidence >= minConfidence;
    const shouldReview = confidence >= reviewMinConfidence && !canWrite;

    let action: 'tagged' | 'needs_review' | 'skipped' = 'skipped';

    if (canWrite) {
      // Respect manual sectors unless force
      if (force || !Array.isArray(manual.sectors) || manual.sectors.length === 0) {
        const prev = Array.isArray(next.sectors) ? next.sectors : [];
        const merged = uniq([...prev, ...chosen]);
        next.sectors = merged;
        // clear review if any
        if (next.needs_review?.sectors_catalog) delete next.needs_review.sectors_catalog;
        action = 'tagged';
      } else {
        // manual present: just clear review noise
        if (next.needs_review?.sectors_catalog) delete next.needs_review.sectors_catalog;
        action = 'skipped';
      }
    } else if (shouldReview) {
      next.needs_review.sectors_catalog = {
        computed_at: new Date().toISOString(),
        reason: 'LOW_CONFIDENCE',
        days,
        minSamples,
        samples: totalSamples,
        confidence,
        suggested: suggested.slice(0, 3),
      };
      action = 'needs_review';
    } else {
      // too noisy: remove any old queue item
      if (next.needs_review?.sectors_catalog) delete next.needs_review.sectors_catalog;
      action = 'skipped';
    }

    if (action === 'tagged') tagged += 1;
    if (action === 'needs_review') reviewQueued += 1;

    if (!dryRun) {
      await db.execute(sql`update public.price_sources set discovery_tags=${JSON.stringify(next)}::jsonb where id=${sourceId}::uuid`);
    }

    if (sample.length < 40) {
      sample.push({ domain, action, confidence: Number(confidence.toFixed(3)), samples: totalSamples, suggested: suggested.slice(0, 2) });
    }
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

  return { ok: true, scanned, tagged, reviewQueued, dryRun, force, minConfidence, reviewMinConfidence, sample };
}
