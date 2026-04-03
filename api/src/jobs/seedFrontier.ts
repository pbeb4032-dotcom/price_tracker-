import { sql } from 'drizzle-orm';
import { getDb, type Env } from '../db';

const MAX_URLS_PER_RUN = Number(process.env.FRONTIER_MAX_URLS_PER_RUN ?? 20000);
const FETCH_TIMEOUT_MS = 12_000;
// Per-domain URL budget per seed run (NOT a hard cap). The cursor makes this effectively unlimited over time.
const SITEMAP_MAX_URLS_PER_DOMAIN = Number(process.env.FRONTIER_SITEMAP_MAX_PER_DOMAIN ?? 20000);
const SITEMAP_DEPTH_LIMIT = 3;
const SITEMAP_TASK_BATCH = Number(process.env.SITEMAP_TASK_BATCH ?? 6);
const SITEMAP_LOC_BATCH = Number(process.env.SITEMAP_LOC_BATCH ?? 20000);
const SITEMAP_RECHECK_HOURS = Number(process.env.SITEMAP_RECHECK_HOURS ?? 24);
const SITEMAP_STALE_PROCESSING_MIN = Number(process.env.SITEMAP_STALE_PROCESSING_MIN ?? 30);

const DEFAULT_PRODUCT_RE = /\/(product|products|p|item|dp)\//i;
const DEFAULT_CATEGORY_RE = /\/(category|categories|collections|shop|store|department|c|offers)\//i;

type DomainRule = { product: RegExp; category: RegExp };

export async function seedCrawlFrontier(env: Env, opts?: { maxUrls?: number; sitemapMaxPerDomain?: number }): Promise<any> {
  const db = getDb(env);
  const maxUrls = Math.max(100, Math.min(200000, Number(opts?.maxUrls ?? MAX_URLS_PER_RUN)));
  const maxPerDomain = Math.max(50, Math.min(200000, Number(opts?.sitemapMaxPerDomain ?? SITEMAP_MAX_URLS_PER_DOMAIN)));

  // 1) Domain patterns
  const patterns = await db.execute(sql`select domain, product_regex, category_regex from public.domain_url_patterns`);
  const rulesMap = new Map<string, DomainRule>();
  for (const p of (patterns.rows as any[])) {
    try {
      rulesMap.set(String(p.domain), {
        product: new RegExp(String(p.product_regex), 'i'),
        category: new RegExp(String(p.category_regex), 'i'),
      });
    } catch {
      // ignore bad regex
    }
  }

  // 2) Active sources
  const sources = await db.execute(sql`
    select id, domain
    from public.price_sources
    where country_code = 'IQ'
      and coalesce(auto_disabled,false) = false
      and coalesce(crawl_enabled,true) = true
      and coalesce(lifecycle_status,'active') in ('active','candidate')
  `);
  const activeDomains = (sources.rows as any[]).map((s) => String(s.domain));
  if (!activeDomains.length) return { seeded_total: 0, message: 'No active sources' };

  let totalInserted = 0;
  const seededByDomain: Record<string, number> = {};
  let skippedDuplicates = 0;

  // 3) Bootstrap paths
  const bootstrap = await db.execute(sql`
    select source_domain, path, page_type, priority
    from public.domain_bootstrap_paths
    where is_active = true
    order by priority asc
  `);

  if ((bootstrap.rows as any[]).length) {
    const rows = (bootstrap.rows as any[])
      .filter((bp) => activeDomains.includes(String(bp.source_domain)))
      .map((bp) => ({
        source_domain: String(bp.source_domain),
        url: `https://${String(bp.source_domain)}${String(bp.path)}`,
        page_type: String(bp.page_type || 'category'),
        depth: 0,
        parent_url: null,
        status: 'pending',
        discovered_from: 'bootstrap',
      }));

    if (rows.length) {
      const inserted = await insertFrontierBatch(db, rows);
      for (const r of inserted) {
        seededByDomain[r.source_domain] = (seededByDomain[r.source_domain] ?? 0) + 1;
      }
      totalInserted += inserted.length;
      skippedDuplicates += rows.length - inserted.length;
    }
  }

  // 4) Source entrypoints (light link discovery)
  const entrypoints = await db.execute(sql`
    select domain, url, page_type, priority
    from public.source_entrypoints
    where is_active = true
    order by priority asc
  `);

  for (const entry of (entrypoints.rows as any[])) {
    if (totalInserted >= maxUrls) break;

    const domain = String(entry.domain);
    const url = String(entry.url);
    if (!activeDomains.includes(domain)) continue;

    const html = await fetchPage(url).catch(() => null);
    if (!html) continue;

    const links = extractInternalLinks(html, domain);
    if (!links.length) continue;

    const remaining = maxUrls - totalInserted;
    const rows = links
      .map((u) => ({
        source_domain: domain,
        url: u,
        page_type: classifyUrl(u, domain, rulesMap),
        depth: 1,
        parent_url: url,
        status: 'pending',
        discovered_from: url,
      }))
      .filter((r) => r.page_type !== 'unknown')
      .slice(0, remaining);

    if (!rows.length) continue;

    const inserted = await insertFrontierBatch(db, rows);
    for (const r of inserted) {
      seededByDomain[r.source_domain] = (seededByDomain[r.source_domain] ?? 0) + 1;
    }
    totalInserted += inserted.length;
    skippedDuplicates += rows.length - inserted.length;
  }

  // 5) Sitemap discovery (fastest, cheapest)
  // If the sitemap queue schema is present, we use a persistent cursor + conditional caching.
  // Otherwise we fall back to legacy sitemap crawling.
  const hasQueue = await hasSitemapQueue(db);
  if (hasQueue) {
    const r = await seedFromSitemapQueue(db, activeDomains, rulesMap, {
      maxUrls,
      perDomainBudget: maxPerDomain,
      seededByDomain,
    });
    totalInserted += r.inserted;
    skippedDuplicates += r.skipped_duplicates;
  } else {
    const SITEMAP_CONCURRENCY = 10;
    const domainsQueue = [...activeDomains];
    while (domainsQueue.length && totalInserted < maxUrls) {
      const batch = domainsQueue.splice(0, SITEMAP_CONCURRENCY);
      const results = await Promise.all(
        batch.map(async (domain) => {
          if (totalInserted >= maxUrls) return { domain, inserted: 0 };
          const remaining = maxUrls - totalInserted;
          const urls = await discoverFromSitemaps(domain, maxPerDomain).catch(() => []);
          if (!urls.length) return { domain, inserted: 0 };

          shuffleInPlace(urls);
          const slice = urls.slice(0, Math.min(remaining, maxPerDomain));

          const rows = slice.map((u) => ({
            source_domain: domain,
            url: u,
            page_type: classifyUrl(u, domain, rulesMap),
            depth: 0,
            parent_url: null,
            status: 'pending',
            discovered_from: 'sitemap',
          }));

          const inserted = await insertFrontierBatch(db, rows);
          for (const r of inserted) {
            seededByDomain[r.source_domain] = (seededByDomain[r.source_domain] ?? 0) + 1;
          }
          return { domain, inserted: inserted.length, attempted: rows.length };
        })
      );

      for (const r of results) {
        totalInserted += Number(r.inserted ?? 0);
        skippedDuplicates += Math.max(0, Number(r.attempted ?? 0) - Number(r.inserted ?? 0));
        if (totalInserted >= maxUrls) break;
      }
    }
  }

  return {
    seeded_total: totalInserted,
    seeded_by_domain: seededByDomain,
    skipped_duplicates: skippedDuplicates,
    active_domains: activeDomains.length,
  };
}

async function insertFrontierBatch(db: any, rows: any[]) {
  if (!rows.length) return [];
  const json = JSON.stringify(rows);
  // json_to_recordset avoids huge SQL strings and is safe here (server-side).
  const r = await db.execute(sql`
    with input as (
      select * from json_to_recordset(${json}::json)
      as x(
        source_domain text,
        url text,
        page_type text,
        depth int,
        parent_url text,
        status text,
        discovered_from text
      )
    ),
    ins as (
      insert into public.crawl_frontier (source_domain, url, page_type, depth, parent_url, status, discovered_from)
      select i.source_domain, i.url, i.page_type, coalesce(i.depth,0), i.parent_url, 'pending', i.discovered_from
      from input i
      on conflict (url_hash) do nothing
      returning id, source_domain
    )
    select * from ins
  `);
  return (r.rows as any[]) ?? [];
}

function classifyUrl(url: string, domain: string, rulesMap: Map<string, DomainRule>): 'product'|'category'|'unknown' {
  const r = rulesMap.get(domain);
  const prodRe = r?.product ?? DEFAULT_PRODUCT_RE;
  const catRe = r?.category ?? DEFAULT_CATEGORY_RE;
  if (prodRe.test(url)) return 'product';
  if (catRe.test(url)) return 'category';
  return 'unknown';
}

function extractInternalLinks(html: string, domain: string): string[] {
  const links: string[] = [];
  const hrefRegex = /href\s*=\s*["'](https?:\/\/[^"']+|\/[^"']+)["']/gi;
  let match;
  while ((match = hrefRegex.exec(html)) !== null) {
    let u = String(match[1] || '').trim();
    if (!u) continue;
    if (u.startsWith('/')) u = `https://${domain}${u}`;
    try {
      const parsed = new URL(u);
      if (parsed.hostname === domain || parsed.hostname.endsWith(`.${domain}`)) {
        parsed.hash = '';
        links.push(parsed.toString());
      }
    } catch {}
  }
  return [...new Set(links)];
}

async function fetchPage(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; PriceTrackerIraqBot/1.0; +https://example.local)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ar-IQ,ar;q=0.9,en;q=0.7',
      },
    });
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('html') && !ct.includes('xml')) return null;
    return await res.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function discoverFromSitemaps(domain: string, maxPerDomain: number): Promise<string[]> {
  const sitemapUrls = await discoverSitemapUrls(domain);
  if (!sitemapUrls.length) return [];

  const seen = new Set<string>();
  const productUrls: string[] = [];

  const queue: Array<{ url: string; depth: number }> = sitemapUrls.map((u) => ({ url: u, depth: 0 }));
  while (queue.length) {
    const { url, depth } = queue.shift()!;
    if (seen.has(url)) continue;
    seen.add(url);

    const xml = await fetchSitemap(url).catch(() => null);
    if (!xml) continue;

    const locs = extractXmlLocs(xml);
    if (!locs.length) continue;

    // Heuristic: sitemap index if many locs look like sitemaps
    const looksLikeIndex = locs.some((l) => /sitemap/i.test(l) && /\.xml(\.gz)?(\?|$)/i.test(l));
    if (looksLikeIndex && depth < SITEMAP_DEPTH_LIMIT) {
      for (const l of locs) {
        if (/\.xml(\.gz)?(\?|$)/i.test(l)) queue.push({ url: l, depth: depth + 1 });
      }
      continue;
    }

    for (const l of locs) {
      try {
        const u = new URL(l);
        if (u.hostname === domain || u.hostname.endsWith(`.${domain}`)) {
          u.hash = '';
          productUrls.push(u.toString());
        }
      } catch {}
    }

    if (productUrls.length >= maxPerDomain) break;
  }

  return productUrls.slice(0, maxPerDomain);
}

async function hasSitemapQueue(db: any): Promise<boolean> {
  try {
    const r = await db.execute(sql`select to_regclass('public.domain_sitemap_queue') as t`);
    return Boolean((r.rows as any[])[0]?.t);
  } catch {
    return false;
  }
}

async function seedFromSitemapQueue(
  db: any,
  activeDomains: string[],
  rulesMap: Map<string, DomainRule>,
  opts: { maxUrls: number; perDomainBudget: number; seededByDomain: Record<string, number> }
): Promise<{ inserted: number; skipped_duplicates: number }>
{
  let insertedTotal = 0;
  let skipped = 0;

  // Reclaim stuck processing rows.
  await db.execute(sql`
    update public.domain_sitemap_queue
    set status='pending', processing_started_at=null, updated_at=now()
    where status='processing'
      and processing_started_at is not null
      and processing_started_at < now() - make_interval(mins => ${SITEMAP_STALE_PROCESSING_MIN}::int)
  `);

  // Ensure root sitemaps are queued for each domain.
  const DISCOVERY_CONCURRENCY = 10;
  const domainsQueue = [...activeDomains];
  while (domainsQueue.length) {
    const batch = domainsQueue.splice(0, DISCOVERY_CONCURRENCY);
    await Promise.all(
      batch.map(async (domain) => {
        const roots = await discoverSitemapUrls(domain).catch(() => []);
        if (!roots.length) return;
        await enqueueSitemaps(db, domain, roots, 0);
      })
    );
  }

  // Process queue tasks until we hit the global limit.
  while (insertedTotal < opts.maxUrls) {
    const tasks = await claimSitemapTasks(db, activeDomains, SITEMAP_TASK_BATCH);
    if (!tasks.length) break;

    for (const t of tasks) {
      if (insertedTotal >= opts.maxUrls) {
        await releaseTask(db, t.id);
        continue;
      }

      const domain = String(t.source_domain);
      const domainInserted = Number(opts.seededByDomain[domain] ?? 0);
      const domainBudgetRemaining = Math.max(0, opts.perDomainBudget - domainInserted);
      if (domainBudgetRemaining <= 0) {
        // Let other domains proceed; retry this one later.
        await postponeTask(db, t.id, 10);
        continue;
      }

      const prevStatus = String(t.prev_status ?? 'pending');
      const completedBefore = prevStatus === 'processed' && Number(t.loc_total ?? 0) > 0 && Number(t.loc_cursor ?? 0) >= Number(t.loc_total ?? 0);
      const dueForRecheck = completedBefore && isOlderThanHours(t.last_checked_at, SITEMAP_RECHECK_HOURS);
      if (completedBefore && !dueForRecheck) {
        // Nothing to do, mark processed and move on.
        await markProcessedNoFetch(db, t.id);
        continue;
      }

      const conditional = completedBefore;
      const fetched = await fetchSitemapCached(String(t.sitemap_url), {
        ifNoneMatch: conditional ? String(t.etag ?? '') : '',
        ifModifiedSince: conditional ? String(t.last_modified ?? '') : '',
      });

      if (fetched.notModified) {
        await db.execute(sql`
          update public.domain_sitemap_queue
          set status='processed', last_checked_at=now(), processing_started_at=null, updated_at=now()
          where id = ${t.id}::uuid
        `);
        continue;
      }

      if (!fetched.xml) {
        const backoffMin = Math.min(720, 5 * Math.pow(2, Math.min(6, Number(t.error_count ?? 0))));
        await db.execute(sql`
          update public.domain_sitemap_queue
          set status='pending',
              error_count = coalesce(error_count,0) + 1,
              next_retry_at = now() + make_interval(mins => ${backoffMin}::int),
              last_error = ${fetched.error || 'fetch_failed'},
              processing_started_at=null,
              updated_at=now()
          where id = ${t.id}::uuid
        `);
        continue;
      }

      const kind = sniffSitemapKind(fetched.xml);

      // Update caching headers for the row.
      await db.execute(sql`
        update public.domain_sitemap_queue
        set etag = ${fetched.etag || null},
            last_modified = ${fetched.lastModified || null},
            last_fetched_at = now(),
            last_checked_at = now(),
            kind = ${kind},
            last_error = null,
            updated_at = now()
        where id = ${t.id}::uuid
      `);

      const locsRaw = extractXmlLocs(fetched.xml);

      if (kind === 'index') {
        if (Number(t.depth ?? 0) >= SITEMAP_DEPTH_LIMIT) {
          await db.execute(sql`
            update public.domain_sitemap_queue
            set status='processed', loc_total=${locsRaw.length}::int, loc_cursor=${locsRaw.length}::int, processing_started_at=null, updated_at=now()
            where id = ${t.id}::uuid
          `);
          continue;
        }
        const child = locsRaw.filter((l) => /\.xml(\.gz)?(\?|$)/i.test(l));
        await enqueueSitemaps(db, domain, child, Number(t.depth ?? 0) + 1);
        await db.execute(sql`
          update public.domain_sitemap_queue
          set status='processed', loc_total=${child.length}::int, loc_cursor=${child.length}::int, processing_started_at=null, updated_at=now()
          where id = ${t.id}::uuid
        `);
        continue;
      }

      // urlset
      const locs = filterInternalUrls(locsRaw, domain);
      const total = locs.length;
      const startCursor = (prevStatus === 'processed' ? 0 : Number(t.loc_cursor ?? 0));
      const batch = locs.slice(startCursor, startCursor + SITEMAP_LOC_BATCH);

      const remainingGlobal = opts.maxUrls - insertedTotal;
      const allowed = Math.max(0, Math.min(batch.length, remainingGlobal, domainBudgetRemaining));
      const slice = batch.slice(0, allowed);

      if (slice.length) {
        const rows = slice.map((u) => ({
          source_domain: domain,
          url: u,
          page_type: classifyUrl(u, domain, rulesMap),
          depth: 0,
          parent_url: null,
          status: 'pending',
          discovered_from: 'sitemap_queue',
        }));
        const inserted = await insertFrontierBatch(db, rows);
        insertedTotal += inserted.length;
        for (const r of inserted) {
          opts.seededByDomain[r.source_domain] = (opts.seededByDomain[r.source_domain] ?? 0) + 1;
        }
        skipped += rows.length - inserted.length;
      }

      const advanced = startCursor + slice.length;
      const done = advanced >= total;
      await db.execute(sql`
        update public.domain_sitemap_queue
        set status = ${done ? 'processed' : 'pending'},
            loc_total = ${total}::int,
            loc_cursor = ${done ? total : advanced}::int,
            next_retry_at = null,
            error_count = 0,
            processing_started_at = null,
            updated_at = now()
        where id = ${t.id}::uuid
      `);
    }
  }

  return { inserted: insertedTotal, skipped_duplicates: skipped };
}

async function discoverSitemapUrls(domain: string): Promise<string[]> {
  const urls: string[] = [];
  const robots = await fetchText(`https://${domain}/robots.txt`).catch(() => null);
  if (robots) {
    const re = /^\s*Sitemap:\s*(\S+)\s*$/gim;
    let m;
    while ((m = re.exec(robots)) !== null) {
      urls.push(m[1]);
    }
  }
  if (!urls.length) {
    urls.push(`https://${domain}/sitemap.xml`);
    urls.push(`https://${domain}/sitemap_index.xml`);
  }
  return [...new Set(urls)];
}

async function fetchText(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; PriceTrackerIraqBot/1.0)',
        'Accept': 'text/plain,application/xml,text/xml;q=0.9,*/*;q=0.8',
      },
    });
    if (!res.ok) return null;
    return await res.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchSitemap(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PriceTrackerIraqBot/1.0)' },
    });
    if (!res.ok) return null;

    const buf = new Uint8Array(await res.arrayBuffer());
    const ct = (res.headers.get('content-type') || '').toLowerCase();

    // Handle .gz sitemaps
    if (url.toLowerCase().endsWith('.gz') || ct.includes('gzip') || ct.includes('x-gzip')) {
      const { gunzipSync } = await import('node:zlib');
      return gunzipSync(buf).toString('utf-8');
    }

    return Buffer.from(buf).toString('utf-8');
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function extractXmlLocs(xml: string): string[] {
  const out: string[] = [];
  const re = /<loc>([^<]+)<\/loc>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) out.push(m[1].trim());
  return [...new Set(out)];
}

function sniffSitemapKind(xml: string): 'index' | 'urlset' {
  const head = xml.slice(0, 2500).toLowerCase();
  if (head.includes('<sitemapindex')) return 'index';
  return 'urlset';
}

function filterInternalUrls(urls: string[], domain: string): string[] {
  const out: string[] = [];
  for (const l of urls) {
    try {
      const u = new URL(l);
      if (u.hostname === domain || u.hostname.endsWith(`.${domain}`)) {
        u.hash = '';
        out.push(u.toString());
      }
    } catch {}
  }
  return [...new Set(out)];
}

function isOlderThanHours(ts: any, hours: number): boolean {
  if (!ts) return true;
  const t = new Date(ts).getTime();
  if (!Number.isFinite(t)) return true;
  return Date.now() - t > hours * 3600_000;
}

async function enqueueSitemaps(db: any, domain: string, sitemapUrls: string[], depth: number) {
  const cleaned: string[] = [];
  for (const u of sitemapUrls) {
    const raw = String(u || '').trim();
    if (!raw) continue;
    try {
      const p = new URL(raw);
      p.hash = '';
      cleaned.push(p.toString());
    } catch {
      // Some robots.txt entries can be non-URL; ignore.
    }
  }
  const unique = [...new Set(cleaned)];
  if (!unique.length) return;

  const json = JSON.stringify(unique.map((u) => ({ source_domain: domain, sitemap_url: u, depth })));
  await db.execute(sql`
    with input as (
      select * from json_to_recordset(${json}::json)
      as x(source_domain text, sitemap_url text, depth int)
    )
    insert into public.domain_sitemap_queue (source_domain, sitemap_url, depth, status, updated_at)
    select i.source_domain, i.sitemap_url, coalesce(i.depth,0), 'pending', now()
    from input i
    on conflict (source_domain, sitemap_url) do update set
      depth = least(public.domain_sitemap_queue.depth, excluded.depth),
      updated_at = now(),
      status = case when public.domain_sitemap_queue.status='processed' then public.domain_sitemap_queue.status else 'pending' end
  `);
}

async function claimSitemapTasks(db: any, activeDomains: string[], limit: number): Promise<any[]> {
  // We avoid passing JS arrays to SQL directly for compatibility.
  const json = JSON.stringify(activeDomains);
  const r = await db.execute(sql`
    with active as (
      select json_array_elements_text(${json}::json) as domain
    ),
    cte as (
      select q.id, q.status as prev_status
      from public.domain_sitemap_queue q
      join active a on a.domain = q.source_domain
      where (
        q.status = 'pending'
        or (
          q.status = 'processed'
          and coalesce(q.last_checked_at, '1970-01-01'::timestamptz) < now() - make_interval(hours => ${SITEMAP_RECHECK_HOURS}::int)
        )
      )
      and (q.next_retry_at is null or q.next_retry_at <= now())
      order by q.depth asc, coalesce(q.last_checked_at, '1970-01-01'::timestamptz) asc, q.created_at asc
      for update skip locked
      limit ${limit}::int
    ),
    upd as (
      update public.domain_sitemap_queue q
      set status='processing', processing_started_at=now(), updated_at=now()
      from cte
      where q.id = cte.id
      returning q.*, cte.prev_status
    )
    select * from upd
  `);
  return (r.rows as any[]) ?? [];
}

async function releaseTask(db: any, id: string) {
  await db.execute(sql`
    update public.domain_sitemap_queue
    set status='pending', processing_started_at=null, updated_at=now()
    where id = ${id}::uuid
  `);
}

async function postponeTask(db: any, id: string, minutes: number) {
  await db.execute(sql`
    update public.domain_sitemap_queue
    set status='pending', processing_started_at=null, next_retry_at = now() + make_interval(mins => ${minutes}::int), updated_at=now()
    where id = ${id}::uuid
  `);
}

async function markProcessedNoFetch(db: any, id: string) {
  await db.execute(sql`
    update public.domain_sitemap_queue
    set status='processed', processing_started_at=null, updated_at=now()
    where id = ${id}::uuid
  `);
}

type FetchSitemapCachedResult = {
  xml: string | null;
  etag: string | null;
  lastModified: string | null;
  notModified: boolean;
  status: number | null;
  error?: string;
};

async function fetchSitemapCached(
  url: string,
  opts?: { ifNoneMatch?: string; ifModifiedSince?: string }
): Promise<FetchSitemapCachedResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (compatible; PriceTrackerIraqBot/1.0)',
      'Accept': 'application/xml,text/xml;q=0.9,*/*;q=0.8',
    };
    if (opts?.ifNoneMatch) headers['If-None-Match'] = opts.ifNoneMatch;
    if (opts?.ifModifiedSince) headers['If-Modified-Since'] = opts.ifModifiedSince;

    const res = await fetch(url, { signal: controller.signal, headers });
    const etag = res.headers.get('etag');
    const lastModified = res.headers.get('last-modified');

    if (res.status === 304) {
      return { xml: null, etag, lastModified, notModified: true, status: 304 };
    }
    if (!res.ok) {
      return { xml: null, etag, lastModified, notModified: false, status: res.status, error: `http_${res.status}` };
    }

    const buf = new Uint8Array(await res.arrayBuffer());
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    const ce = (res.headers.get('content-encoding') || '').toLowerCase();
    const isGz = url.toLowerCase().endsWith('.gz') || ct.includes('gzip') || ct.includes('x-gzip') || ce.includes('gzip');
    if (isGz) {
      const { gunzipSync } = await import('node:zlib');
      const xml = gunzipSync(buf).toString('utf-8');
      return { xml, etag, lastModified, notModified: false, status: res.status };
    }
    const xml = Buffer.from(buf).toString('utf-8');
    return { xml, etag, lastModified, notModified: false, status: res.status };
  } catch (e: any) {
    const msg = String(e?.name || e?.message || 'fetch_error');
    return { xml: null, etag: null, lastModified: null, notModified: false, status: null, error: msg };
  } finally {
    clearTimeout(timeout);
  }
}

function shuffleInPlace<T>(arr: T[]) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
}
