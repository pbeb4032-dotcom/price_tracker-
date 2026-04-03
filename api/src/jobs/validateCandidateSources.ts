import { sql } from 'drizzle-orm';
import { extractProductFromHtml } from '../ingestion/productExtract';
import { getDb, type Env } from '../db';

type ValidateOpts = {
  limit?: number;
  countryCode?: string;
  force?: boolean;
};

function scoreFromSignals(signals: { hasCart: boolean; hasProductHints: boolean; hasSitemap: boolean; statusOk: boolean; hasExtraction: boolean }) {
  let s = 0;
  if (signals.statusOk) s += 0.25;
  if (signals.hasCart) s += 0.25;
  if (signals.hasProductHints) s += 0.25;
  if (signals.hasSitemap) s += 0.20;
  if (signals.hasExtraction) s += 0.30;
  return Math.max(0, Math.min(1, s));
}

async function fetchText(url: string, timeoutMs: number): Promise<{ ok: boolean; status: number; text: string }> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ac.signal, headers: { 'User-Agent': 'price-tracker-iraq/1.0' } });
    const text = await res.text().catch(() => '');
    return { ok: res.ok, status: res.status, text: String(text || '') };
  } catch {
    return { ok: false, status: 0, text: '' };
  } finally {
    clearTimeout(t);
  }
}

function looksLikeEcommerce(html: string): { hasCart: boolean; hasProductHints: boolean } {
  const h = (html || '').toLowerCase();
  const hasCart = /(cart|checkout|basket|add\s*to\s*cart|سلة|الدفع|اضف\s*للسلة)/.test(h);
  const hasProductHints = /(product|products|sku|price|woocommerce|shopify|متجر|منتجات|السعر)/.test(h);
  return { hasCart, hasProductHints };
}

export async function validateCandidateSources(env: Env, opts?: ValidateOpts): Promise<any> {
  const db = getDb(env);
  const countryCode = (opts?.countryCode ?? 'IQ').toUpperCase();
  const limit = Math.max(1, Math.min(500, Number(opts?.limit ?? 200)));

  // Pick candidates (or force re-validate any that are candidate/passed/needs_review)
  const rows = await db.execute(sql`
    select id, domain, base_url, validation_state, validation_score
    from public.price_sources
    where country_code = ${countryCode}
      and lifecycle_status = 'candidate'
    order by coalesce(last_probe_at, created_at) asc
    limit ${limit}::int
  `);

  const items = (rows.rows as any[]) ?? [];
  if (!items.length) return { ok: true, validated: 0, message: 'no_candidates' };

  const results: any[] = [];

  // modest concurrency
  const CONC = 10;
  let i = 0;
  const runOne = async (row: any) => {
    const domain = String(row.domain);
    const base = String(row.base_url || `https://${domain}`).replace(/\/$/, '');
    const home = await fetchText(base, 12000);
    const robots = await fetchText(`${base}/robots.txt`, 8000);
    const sitemap = await fetchText(`${base}/sitemap.xml`, 10000);

    const ec = looksLikeEcommerce(home.text);
    const hasSitemap = sitemap.ok && /<urlset|<sitemapindex/i.test(sitemap.text);

    // Try a real extraction from 1 sitemap URL (stronger than keyword-only)
    let hasExtraction = false;
    let sampleUrl: string | null = null;
    if (hasSitemap) {
      const locs = (sitemap.text.match(/<loc>[^<]+<\/loc>/gi) ?? [])
        .map((x) => x.replace(/<\/??loc>/gi, '').trim())
        .filter(Boolean);
      // pick product-like URLs first
      const candidates = locs.filter((u) => /(\/product\b|\/products\b|\/p\b|\/item\b|\/dp\b)/i.test(u));
      sampleUrl = (candidates[0] || locs[0] || null);
      if (sampleUrl) {
        const sample = await fetchText(sampleUrl, 12000);
        if (sample.ok && sample.text && sample.text.length > 500) {
          const extracted = extractProductFromHtml(sample.text, sampleUrl, []);
          if (extracted && extracted.price && extracted.price > 0 && extracted.name && extracted.name.length >= 3) {
            hasExtraction = true;
          }
        }
      }
    }

    const statusOk = home.ok || robots.ok || sitemap.ok;
    const score = scoreFromSignals({ ...ec, hasSitemap, statusOk, hasExtraction });

    let state: 'failed' | 'needs_review' | 'passed' = 'needs_review';
    if (score >= 0.70) state = 'passed';
    else if (score <= 0.30) state = 'failed';

    await db.execute(sql`
      update public.price_sources
      set validation_score=${score}::numeric,
          validation_state=${state},
          last_probe_at=now(),
          discovery_tags = jsonb_set(
            discovery_tags,
            '{probe}',
            ${JSON.stringify({ home_status: home.status, robots_status: robots.status, sitemap_status: sitemap.status, hasCart: ec.hasCart, hasProductHints: ec.hasProductHints, hasSitemap, hasExtraction, sampleUrl })}::jsonb,
            true
          )
      where id=${String(row.id)}::uuid
    `);

    results.push({ domain, score, state, signals: { ...ec, hasSitemap, home: home.status, robots: robots.status } });
  };

  const workers = Array.from({ length: CONC }, async () => {
    while (true) {
      const idx = i;
      i += 1;
      if (idx >= items.length) break;
      await runOne(items[idx]).catch(() => {});
    }
  });

  await Promise.all(workers);

  const passed = results.filter((r) => r.state === 'passed').length;
  const failed = results.filter((r) => r.state === 'failed').length;

  return { ok: true, validated: results.length, passed, failed, results: results.slice(0, 200) };
}
