import { sql } from 'drizzle-orm';
import { getDb, type Env } from '../db';
import { ensureSourceScaffold } from '../catalog/sourceRegistry';

type DiscoverOpts = {
  target?: number;
  sectors?: string[];
  provinces?: string[];
  countryCode?: string;
  dryRun?: boolean;
};

const DEFAULT_TARGET = 300;

const EXCLUDED_HOSTS = new Set([
  'facebook.com','www.facebook.com','instagram.com','www.instagram.com','tiktok.com','www.tiktok.com',
  'youtube.com','www.youtube.com','twitter.com','x.com','www.x.com','www.twitter.com',
  'linkedin.com','www.linkedin.com','google.com','www.google.com',
  'maps.google.com','play.google.com','apps.apple.com',
]);

function normalizeHost(host: string): string {
  return String(host || '').toLowerCase().replace(/^www\./, '').trim();
}

function hostFromUrl(u: string): string | null {
  try {
    const url = new URL(/^https?:\/\//i.test(u) ? u : `https://${u}`);
    const h = normalizeHost(url.hostname);
    return h || null;
  } catch {
    return null;
  }
}

function unique<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

function buildQueries(opts: DiscoverOpts): string[] {
  const sectors = (opts.sectors ?? []).map((s) => String(s).trim()).filter(Boolean);
  const provinces = (opts.provinces ?? []).map((s) => String(s).trim()).filter(Boolean);

  const base = [
    'site:.iq (shop OR store OR ecommerce OR product OR products OR cart OR checkout)',
    'site:.iq (متجر OR تسوق OR منتجات OR سلة OR دفع)',
    'site:.iq (woocommerce OR shopify OR "add to cart")',
  ];

  const sectorQs = sectors.length
    ? sectors.map((s) => `site:.iq (${s}) (متجر OR shop OR store OR منتجات OR product)`)
    : [];

  const provQs = provinces.length
    ? provinces.map((p) => `site:.iq (${p}) (متجر OR تسوق OR shop OR store)`)
    : [];

  return unique([...base, ...sectorQs, ...provQs]).slice(0, 25);
}

async function fetchJsonWithTimeout(url: string, timeoutMs: number): Promise<any> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'price-tracker-iraq/1.0',
        'Accept': 'application/json'
      }
    });
    const text = await res.text().catch(() => '');
    if (!res.ok) {
      const err: any = new Error(`HTTP ${res.status} from ${url}`);
      err.status = res.status;
      err.body = text.slice(0, 400);
      throw err;
    }
    try { return JSON.parse(text); } catch { return null; }
  } finally {
    clearTimeout(t);
  }
}

async function searxSearchJson(searxUrl: string, q: string): Promise<{ urls: string[]; error?: string }> {
  const url = new URL('/search', searxUrl);
  url.searchParams.set('q', q);
  url.searchParams.set('format', 'json');
  url.searchParams.set('language', 'all');
  url.searchParams.set('safesearch', '0');
  url.searchParams.set('categories', 'general');

  // retry a few times because searxng can take a moment to warm up
  let lastErr: any = null;
  for (let i = 0; i < 3; i++) {
    try {
      const data = await fetchJsonWithTimeout(url.toString(), 12_000);
      const results = Array.isArray(data?.results) ? data.results : [];
      const urls: string[] = [];
      for (const r of results) {
        if (r?.url) urls.push(String(r.url));
      }
      return { urls };
    } catch (e: any) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 500 * (i + 1)));
    }
  }
  return { urls: [], error: String(lastErr?.message || lastErr || 'searxng_error') };
}

async function crtshDomains(pattern: string): Promise<{ hosts: string[]; error?: string }> {
  // Certificate Transparency fallback (very effective for collecting many .iq domains)
  // Example pattern: %25.com.iq (URL-encoded %)
  const url = `https://crt.sh/?q=${pattern}&output=json`;
  try {
    const data = await fetchJsonWithTimeout(url, 15_000);
    if (!Array.isArray(data)) return { hosts: [] };
    const hosts: string[] = [];
    for (const row of data.slice(0, 2500)) {
      const nv = String((row as any)?.name_value || '');
      for (const line of nv.split(/\r?\n/)) {
        const h = normalizeHost(line.replace(/^\*\./, '').trim());
        if (!h || h.includes('*')) continue;
        hosts.push(h);
      }
    }
    return { hosts: unique(hosts) };
  } catch (e: any) {
    return { hosts: [], error: String(e?.message || e || 'crtsh_error') };
  }
}

export async function discoverSources(env: Env, opts?: DiscoverOpts): Promise<any> {
  const db = getDb(env);
  const target = Math.max(1, Math.min(5000, Number(opts?.target ?? DEFAULT_TARGET)));
  const countryCode = (opts?.countryCode ?? 'IQ').toUpperCase();

  // Require searxng URL (local container). If not set, return a safe error.
  const searxUrl = process.env.SEARXNG_URL || 'http://searxng:8080';
  const queries = buildQueries(opts ?? {});

  // current counts
  const existing = await db.execute(sql`
    select count(*)::int as n
    from public.price_sources
    where country_code = ${countryCode}
  `);
  const current = Number((existing.rows as any[])[0]?.n ?? 0);

  const toAdd = Math.max(0, target - current);
  if (toAdd <= 0) return { ok: true, target, current, inserted: 0, message: 'already_at_target' };

  const discoveredHosts: string[] = [];
const discoveryMeta: any = {
  searx: { url: searxUrl, queries, errors: [] as any[] },
  crtsh: { used: false, patterns: [] as string[], errors: [] as any[] },
};

for (const q of queries) {
  const r = await searxSearchJson(searxUrl, q);
  if (r.error) discoveryMeta.searx.errors.push({ q, error: r.error });
  for (const u of r.urls) {
    const h = hostFromUrl(u);
    if (!h) continue;
    if (EXCLUDED_HOSTS.has(h)) continue;
    if (h.endsWith('.gov.iq') || h.endsWith('.edu.iq')) continue;
    discoveredHosts.push(h);
  }
  if (unique(discoveredHosts).length >= toAdd * 3) break; // headroom
}

// If searxng is empty/unreachable in some environments, fallback to Certificate Transparency (.iq domains).
if (unique(discoveredHosts).length < Math.min(80, toAdd)) {
  const patterns = ['%25.com.iq', '%25.net.iq', '%25.org.iq', '%25.iq'];
  discoveryMeta.crtsh.used = true;
  discoveryMeta.crtsh.patterns = patterns;

  for (const p of patterns) {
    const r = await crtshDomains(p);
    if (r.error) discoveryMeta.crtsh.errors.push({ pattern: p, error: r.error });
    for (const h of r.hosts) {
      if (!h) continue;
      if (EXCLUDED_HOSTS.has(h)) continue;
      if (h.endsWith('.gov.iq') || h.endsWith('.edu.iq')) continue;
      if (!h.endsWith('.iq')) continue;
      discoveredHosts.push(h);
    }
    if (unique(discoveredHosts).length >= toAdd * 3) break;
  }
}

const discoveredUniq = unique(discoveredHosts);

if (discoveredUniq.length === 0) {
  return { ok: false, target, current, inserted: 0, message: 'discovery_no_results', meta: discoveryMeta };
}

const candidates = discoveredUniq.slice(0, Math.max(toAdd, 50));

const discoveredVia = discoveryMeta.crtsh.used
  ? (discoveryMeta.searx.errors.length ? 'crtsh' : 'mixed')
  : 'searxng';

  // Load existing domains to avoid extra insert attempts
  const rows = await db.execute(sql`
    select domain from public.price_sources where country_code=${countryCode}
  `);
  const existingDomains = new Set<string>(((rows.rows as any[]) ?? []).map((r) => String(r.domain)));

  const insertedDomains: string[] = [];
  const skipped: string[] = [];

  for (const domain of candidates) {
    if (insertedDomains.length >= toAdd) break;
    if (existingDomains.has(domain)) { skipped.push(domain); continue; }

    if (opts?.dryRun) { insertedDomains.push(domain); continue; }

    const nameAr = `مصدر جديد: ${domain}`;
    const baseUrl = `https://${domain}`;

    // Insert as candidate (shadow)
    const ins = await db.execute(sql`
      insert into public.price_sources (
        name_ar, domain, source_kind, trust_weight, base_url, logo_url,
        is_active, country_code,
        lifecycle_status, crawl_enabled, validation_state, discovered_via, discovery_tags,
        source_channel, adapter_strategy, catalog_condition_policy, condition_confidence,
        onboarding_origin, source_priority, onboarding_meta
      )
      values (
        ${nameAr},
        ${domain},
        'retailer',
        0.40,
        ${baseUrl},
        null,
        false,
        ${countryCode},
        'candidate',
        true,
        'unvalidated',
        'searxng',
        ${JSON.stringify({ sectors: opts?.sectors ?? [], provinces: opts?.provinces ?? [], queries })},
        'website',
        'html_sitemap',
        'unknown',
        0.50,
        'auto_discovery',
        180,
        ${JSON.stringify({ imported_by: 'discoverSources', discovered_via: discoveredVia, queries })}
      )
      returning id
    `).catch(() => null);

    if (!ins || !(ins.rows as any[])?.length) { skipped.push(domain); continue; }

    await ensureSourceScaffold(db, domain, baseUrl);
    insertedDomains.push(domain);
    existingDomains.add(domain);
  }

  return { ok: true, target, current, inserted: insertedDomains.length, inserted_domains: insertedDomains, skipped: skipped.slice(0, 50), meta: discoveryMeta };
}
