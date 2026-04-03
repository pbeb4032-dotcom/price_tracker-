import { sql } from 'drizzle-orm';
import { getDb, type Env } from '../db';
import { validateImageUrl } from '../ingestion/sanity';

const BATCH_SIZE = 10;
const MAX_IMAGES_PER_PRODUCT = 4;
const FETCH_TIMEOUT_MS = 10_000;
const MIN_IMAGE_SIZE = 20_000; // 20KB

export async function recrawlProductImages(env: Env, opts?: { limit?: number }): Promise<any> {
  const db = getDb(env);
  const limit = Math.max(1, Math.min(50, Number(opts?.limit ?? BATCH_SIZE)));

  const q = await db.execute(sql`
    select id, product_id, attempts
    from public.image_recrawl_queue
    where status = 'pending'
    order by created_at asc
    limit ${limit}
  `);

  const items = (q.rows as any[]) ?? [];
  if (!items.length) return { processed: 0, images_inserted: 0, message: 'No pending items' };

  let imagesInserted = 0;

  for (const item of items) {
    const queueId = String(item.id);
    const productId = String(item.product_id);
    const attempts = Number(item.attempts ?? 0);

    try {
      await db.execute(sql`
        update public.image_recrawl_queue
        set status='processing', updated_at=now()
        where id = ${queueId}::uuid
      `);

      const obs = await db.execute(sql`
        select source_url
        from public.source_price_observations
        where product_id = ${productId}::uuid
        order by observed_at desc
        limit 5
      `);

      const urls = ((obs.rows as any[]) ?? []).map((r) => String(r.source_url)).filter(Boolean);
      if (!urls.length) {
        await markQueue(db, queueId, 'done', null);
        continue;
      }

      const candidates: Array<{ url: string; sourceUrl: string; sourceDomain: string }> = [];
      const seen = new Set<string>();

      for (const pageUrl of urls) {
        if (candidates.length >= MAX_IMAGES_PER_PRODUCT * 3) break;

        const html = await fetchHtml(pageUrl);
        if (!html) continue;

        const sourceDomain = safeDomain(pageUrl);

        const raw = [
          ...extractJsonLdImages(html),
          ...extractOgImages(html),
          ...extractImgTagImages(html),
        ];

        for (const r of raw) {
          if (candidates.length >= MAX_IMAGES_PER_PRODUCT * 3) break;
          const abs = normalizeUrl(r, pageUrl);
          if (!abs || seen.has(abs)) continue;
          if (!isLikelyProductImage(abs)) continue;
          if (!isAllowedImageHost(abs, pageUrl)) continue;
          const v = validateImageUrl(abs);
          if (!v) continue;
          seen.add(v);
          candidates.push({ url: v, sourceUrl: pageUrl, sourceDomain });
        }
      }

      const verified: Array<{ url: string; sourceUrl: string; sourceDomain: string }> = [];
      for (const c of candidates) {
        if (verified.length >= MAX_IMAGES_PER_PRODUCT) break;
        const ok = await verifyImage(c.url);
        if (ok) verified.push(c);
      }

      if (verified.length) {
        const inserts = verified.map((img, idx) => ({
          product_id: productId,
          image_url: img.url,
          source_site: img.sourceDomain,
          source_page_url: img.sourceUrl,
          position: idx,
          confidence_score: idx === 0 ? 0.85 : 0.75,
          is_primary: idx === 0,
          is_verified: true,
        }));

        const json = JSON.stringify(inserts);
        await db.execute(sql`
          with input as (
            select * from json_to_recordset(${json}::json)
            as x(
              product_id uuid,
              image_url text,
              source_site text,
              source_page_url text,
              position int,
              confidence_score float,
              is_primary boolean,
              is_verified boolean
            )
          )
          insert into public.product_images (
            product_id, image_url, source_site, source_page_url,
            position, confidence_score, is_primary, is_verified
          )
          select i.product_id, i.image_url, i.source_site, i.source_page_url,
                 i.position, i.confidence_score, i.is_primary, i.is_verified
          from input i
          on conflict (product_id, image_url) do nothing
        `);

        imagesInserted += inserts.length;

        // Backfill products.image_url if missing
        await db.execute(sql`
          update public.products
          set image_url = coalesce(image_url, ${verified[0]!.url}), updated_at = now()
          where id = ${productId}::uuid
        `).catch(() => {});
      }

      await markQueue(db, queueId, 'done', null);
    } catch (e: any) {
      const msg = String(e?.message ?? e).slice(0, 500);
      const nextStatus = attempts >= 2 ? 'failed' : 'pending';
      await markQueue(db, queueId, nextStatus, msg);
      await db.execute(sql`
        update public.image_recrawl_queue
        set attempts = coalesce(attempts,0) + 1
        where id = ${queueId}::uuid
      `).catch(() => {});
    }
  }

  return { processed: items.length, images_inserted: imagesInserted };
}

async function markQueue(db: any, id: string, status: string, lastError: string | null) {
  await db.execute(sql`
    update public.image_recrawl_queue
    set status = ${status}, last_error = ${lastError}, updated_at = now()
    where id = ${id}::uuid
  `);
}

function safeDomain(pageUrl: string): string {
  try {
    return new URL(pageUrl).hostname.toLowerCase();
  } catch {
    return '';
  }
}

async function fetchHtml(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'PriceTrackerIraq/1.0',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ar,en;q=0.9',
        'Accept-Encoding': 'identity',
      },
    });
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('html')) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function extractJsonLdImages(html: string): string[] {
  const out: string[] = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const raw = (m[1] || '').trim();
    if (!raw) continue;
    try {
      const j = JSON.parse(raw);
      const nodes = Array.isArray(j) ? j : [j];
      for (const n of nodes) {
        const prod = findProductNode(n);
        if (!prod) continue;
        const img = (prod as any).image;
        if (typeof img === 'string') out.push(img);
        else if (Array.isArray(img)) out.push(...img.filter((x) => typeof x === 'string'));
      }
    } catch {
      // ignore
    }
  }
  return out;
}

function findProductNode(node: any): any | null {
  if (!node || typeof node !== 'object') return null;
  const t = node['@type'];
  if (typeof t === 'string' && t.toLowerCase() === 'product') return node;
  if (Array.isArray(t) && t.map(String).some((x) => x.toLowerCase() === 'product')) return node;
  // common wrapper
  if (Array.isArray(node['@graph'])) {
    for (const g of node['@graph']) {
      const found = findProductNode(g);
      if (found) return found;
    }
  }
  return null;
}

function extractOgImages(html: string): string[] {
  const out: string[] = [];
  const re = /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["'][^>]*>/gi;
  let m;
  while ((m = re.exec(html)) !== null) out.push(String(m[1]).trim());
  return out;
}

function extractImgTagImages(html: string): string[] {
  const out: string[] = [];
  const re = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const src = String(m[1] || '').trim();
    if (src) out.push(src);
  }
  return out;
}

function normalizeUrl(url: string, baseUrl: string): string | null {
  try {
    let abs = String(url ?? '').trim();
    if (!abs) return null;
    if (abs.startsWith('//')) abs = 'https:' + abs;
    if (abs.startsWith('/')) {
      const b = new URL(baseUrl);
      abs = b.origin + abs;
    }
    const parsed = new URL(abs);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return null;
  }
}

function baseDomain(host: string): string {
  const parts = host.toLowerCase().split('.');
  return parts.slice(-2).join('.');
}

function isAllowedImageHost(imageUrl: string, pageUrl: string): boolean {
  try {
    const ih = new URL(imageUrl).hostname.toLowerCase();
    const ph = new URL(pageUrl).hostname.toLowerCase();

    if (/(picsum\.photos|placehold|placeholder|dummyimage|fakeimg|source\.unsplash\.com|lorempixel|unsplash)/i.test(ih)) return false;
    if (/(no[-_ ]?image|default[-_ ]?image|image[-_ ]?not[-_ ]?available|\blogo\b|\bicon\b|favicon|sprite|1x1|pixel\.gif)/i.test(imageUrl)) return false;

    if (baseDomain(ih) === baseDomain(ph)) return true;
    if (/(cdn|img|images|media|static)/i.test(ih)) return true;
    return false;
  } catch {
    return false;
  }
}

function isLikelyProductImage(url: string): boolean {
  const u = url.toLowerCase();
  if (!/^https?:\/\//.test(u)) return false;
  if (!/\.(png|jpe?g|webp|avif)(\?|$)/.test(u)) return false;
  if (/(favicon|sprite|logo|icon)/.test(u)) return false;
  return true;
}

async function verifyImage(url: string): Promise<boolean> {
  try {
    // HEAD
    {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(url, { method: 'HEAD', signal: controller.signal, headers: { 'User-Agent': 'PriceTrackerIraq/1.0' } });
      clearTimeout(timeout);
      if (res.ok) {
        const ct = (res.headers.get('content-type') || '').toLowerCase();
        const len = Number(res.headers.get('content-length') || 0);
        if (ct.startsWith('image/') && (!len || len >= MIN_IMAGE_SIZE)) return true;
      }
    }

    // GET range fallback
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'User-Agent': 'PriceTrackerIraq/1.0',
        Range: 'bytes=0-65535',
      },
    });
    clearTimeout(timeout);

    if (!res.ok && res.status !== 206) return false;
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (!ct.startsWith('image/')) return false;
    const buf = await res.arrayBuffer();
    return buf.byteLength >= MIN_IMAGE_SIZE;
  } catch {
    return false;
  }
}
