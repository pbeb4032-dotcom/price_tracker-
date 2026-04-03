import { sql } from 'drizzle-orm';
import { getDb, type Env } from '../db';
import { extractProductFromHtml } from '../ingestion/productExtract';
import { isSaneIqdPrice, normalizeToIqdSmart, validateImageUrl as validateImageUrlShared } from '../ingestion/sanity';
import { assessAndMaybeQuarantinePrice, enqueuePriceAnomalyQuarantine } from '../ingestion/priceAnomalyQuarantine';
import { inferCategoryKeyDetailed, type CategoryKey } from '../ingestion/categoryInfer';
import { classifyGrocerySubcategory } from '../ingestion/groceryTaxonomy';
import { inferTaxonomySuggestion, normalizeSiteCategory, taxonomyKeyToCategoryAndSubcategory } from '../ingestion/taxonomyV2';
import { loadCategoryOverrides, matchCategoryOverride, type CategoryOverrideRow } from '../ingestion/categoryOverrides';
import { computeRenderPriority } from '../lib/renderPriority';

const BATCH_SIZE = 25;
const DEFAULT_CONCURRENCY = 16;
const FETCH_TIMEOUT_MS = 15_000;
const DEFAULT_FALLBACK_FX = 1470;
const LOCK_NAME = 'ingest-product-pages';
const LOCK_TTL_SECONDS = 900;

// Recover Probe Queue (lightweight unblock test before resuming full ingestion)
const PROBE_ENABLED = String(process.env.PROBE_ENABLED ?? 'true') !== 'false';
const PROBE_SUCCESS_TTL_MIN = Math.max(10, Number(process.env.PROBE_SUCCESS_TTL_MIN ?? 360));
const PROBE_DEFER_MIN = Math.max(5, Number(process.env.PROBE_DEFER_MIN ?? 30));

// Render Queue (Playwright Worker)
const RENDER_QUEUE_ENABLED = String(process.env.RENDER_QUEUE_ENABLED ?? 'false') === 'true';
const RENDER_WAIT_MIN = Math.max(5, Number(process.env.RENDER_WAIT_MIN ?? 25));
const JS_SHELL_HITS_THRESHOLD = Math.max(2, Number(process.env.JS_SHELL_HITS_THRESHOLD ?? 3));

type ErrorCode =
  | 'HTTP_404' | 'HTTP_403' | 'HTTP_429'
  | 'DNS_ERROR' | 'TIMEOUT' | 'EMPTY_RESPONSE'
  | 'BOT_CHALLENGE' | 'NOT_HTML' | 'NO_PRODUCT_DATA'
  | 'PRODUCT_UPSERT_FAILED' | 'OBS_INSERT_FAILED'
  | 'INVALID_IMAGE_URL'
  | 'PRICE_SANITY_FAIL'
  | 'DOMAIN_BUDGET'
  | 'AUTO_DISABLED'
  | 'PROBE_REQUIRED'
  | 'BUDGET_PAUSED'
  | 'WAITING_RENDER'
  | 'RENDER_PAUSED'
  | 'UNKNOWN';

type EvidenceType = 'url' | 'screenshot' | 'api' | 'ai_scrape';

type FetchResult = {
  status: number;
  html: string | null;
  contentType: string | null;
  blocked: boolean;
  blockedReason: string | null;
  jsShell?: boolean;
  jsShellConfidence?: number;
  jsShellReason?: string | null;
  renderedBy?: 'http' | 'playwright' | 'worker_cache';
};

function classifyError(fetchResult: FetchResult | null, errorMsg?: string): ErrorCode {
  if (fetchResult) {
    // ✅ Bot challenges must take precedence over HTTP codes (some sites respond 200/404 with challenge HTML).
    if (fetchResult.blocked) return 'BOT_CHALLENGE';
    if (fetchResult.status === 404) return 'HTTP_404';
    if (fetchResult.status === 403) return 'HTTP_403';
    if (fetchResult.status === 429) return 'HTTP_429';
    if (fetchResult.contentType && !fetchResult.contentType.includes('html')) return 'NOT_HTML';
    if (fetchResult.status && fetchResult.status >= 200 && !fetchResult.html) return 'EMPTY_RESPONSE';
  }
  const msg = (errorMsg ?? '').toLowerCase();
  if (msg.includes('timeout') || msg.includes('abort')) return 'TIMEOUT';
  if (msg.includes('dns') || msg.includes('getaddrinfo') || msg.includes('notfound')) return 'DNS_ERROR';
  return 'UNKNOWN';
}

function methodToConfidence(method: string): number {
  switch ((method || '').toLowerCase()) {
    case 'jsonld': return 0.9;
    case 'nextdata':
    case 'nuxtdata': return 0.85;
    case 'meta': return 0.7;
    default: return 0.6;
  }
}


function hasStrongJsonLdProduct(html: string | null): boolean {
  if (!html) return false;
  const hasProduct = /<script[^>]+type=['"]application\/ld\+json['"][^>]*>[\s\S]*?"@type"\s*:\s*"?Product"?[\s\S]*?<\/script>/i.test(html);
  if (!hasProduct) return false;
  return /"offers"\s*:|"price"\s*:|"priceCurrency"\s*:/i.test(html);
}


function hasStrongJsonLdItemList(html: string): boolean {
  if (!html) return false;
  const block = html.slice(0, 450_000);
  if (!/application\/ld\+json/i.test(block)) return false;
  if (!/"@type"\s*:\s*"?ItemList"?/i.test(block)) return false;
  const urls = (block.match(/"url"\s*:\s*"https?:\/\//gi) || []).length;
  const ids = (block.match(/"@id"\s*:\s*"https?:\/\//gi) || []).length;
  return (urls + ids) >= 5;
}

function hasMicrodataProduct(html: string): boolean {
  if (!html) return false;
  return /itemscope[^>]*itemtype=["'][^"']*schema\.org\/(Product|IndividualProduct)[^"']*["']/i.test(html);
}

function hasObviousCommerceSignals(html: string): boolean {
  if (!html) return false;
  const h = html.toLowerCase();
  const price = /(?:iqd|usd|\$|د\.ع|دينار|price|السعر)\s*[:\-]?\s*[0-9]{1,3}(?:[,\.]?[0-9]{3})*/i.test(h);
  const cart = /(add to cart|add-to-cart|addtocart|سلة|اضف للسلة|أضف للسلة|اطلب الآن|buy now)/i.test(h);
  const qty = /(quantity|qty|الكمية)/i.test(h);
  return price || cart || qty;
}

function hasMeaningfulSsrContent(html: string): boolean {
  if (!html) return false;
  const lower = html.toLowerCase();
  if (hasStrongJsonLdProduct(html) || hasStrongJsonLdItemList(html) || hasMicrodataProduct(html)) return true;
  if (hasObviousCommerceSignals(html)) return true;

  const text = lower
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const textLen = text.length;
  const linkCount = (lower.match(/<a\s+[^>]*href=/g) || []).length;
  const h1Count = (lower.match(/<h1\b/g) || []).length;

  return (textLen > 2000 && linkCount > 12) || (h1Count >= 1 && textLen > 1200) || linkCount > 60;
}


function detectJsShell(html: string | null): { isShell: boolean; confidence: number; reason: string } {
  if (!html) return { isShell: false, confidence: 0, reason: '' };

  // Strong SSR content => NOT a JS shell (prevents false positives on React/Next SSR pages).
  if (hasMeaningfulSsrContent(html)) {
    return { isShell: false, confidence: 0.1, reason: 'meaningful_ssr_content' };
  }

  const lower = html.toLowerCase();
  const len = html.length;

  // Framework markers (required)
  const next =
    lower.includes('id="__next"') ||
    lower.includes("id='__next'") ||
    lower.includes('__next_data__') ||
    lower.includes('window.__next_data__');
  const nuxt =
    lower.includes('id="__nuxt"') ||
    lower.includes("id='__nuxt'") ||
    lower.includes('window.__nuxt__') ||
    lower.includes('__nuxt_data__');
  const react = lower.includes('data-reactroot') || lower.includes('react-dom') || lower.includes('webpack') || lower.includes('vite');
  const framework = next || nuxt || react;
  if (!framework) return { isShell: false, confidence: 0, reason: '' };

  // Strip scripts/styles to measure real text content
  const text = lower
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const textLen = text.length;
  const linkCount = (lower.match(/<a\s+[^>]*href=/g) || []).length;
  const scriptCount = (lower.match(/<script\b/g) || []).length;

  // Typical JS-shell hints
  const hasNoScriptJs = /<noscript>[\s\S]*enable javascript[\s\S]*<\/noscript>/i.test(html);
  const hasLoadingOnly = /(loading\.{0,3}|please wait|جار التحميل|الرجاء الانتظار)/i.test(text) && textLen < 700;

  // Scoring (conservative)
  let score = 0;

  // Small HTML + tiny text are strong shell signals
  if (len < 45_000) score += 0.30;
  if (textLen < 650) score += 0.35;
  if (linkCount < 10) score += 0.15;

  // Shell UX patterns
  if (hasNoScriptJs) score += 0.12;
  if (hasLoadingOnly) score += 0.10;

  // Heavy scripts but little content => shell
  if (scriptCount >= 15 && textLen < 800) score += 0.10;

  // Negative signals (avoid false positives)
  if (textLen > 1800) score -= 0.25;
  if (linkCount > 35) score -= 0.25;
  if (len > 140_000) score -= 0.20;

  const confidence = Math.max(0, Math.min(1, score));
  const isShell = confidence >= 0.82;
  return {
    isShell,
    confidence,
    reason: `framework=${next ? 'next' : nuxt ? 'nuxt' : react ? 'react' : 'fw'} len=${len} text=${textLen} links=${linkCount} scripts=${scriptCount} noscript=${hasNoScriptJs ? 1 : 0}`,
  };
}


/**
 * Category: root fix
 * - only UPGRADE broad categories to specific ones when strong hints exist
 * - never downgrade specific → broad
 */
// Treat these as "broad" buckets that are safe to upgrade away from when stronger evidence exists.
// Note: beverages is often mis-assigned on mixed catalogs (due to site menus), so we allow upgrades.
const BROAD_CATEGORIES = new Set<string>(['general', 'groceries', 'beverages', 'essentials', 'home']);

const CATEGORY_HINTS: Array<{ cat: string; rx: RegExp }> = [
  {
    cat: 'sports',
    rx: new RegExp(
      '(yoga|fitness|gym|workout|training|dumbbell|kettlebell|barbell|plate|weight|resistance\\s*band|hand\\s*grip|pull[-\\s]?up|treadmill|protein\\s*shaker|sports?\\b|sport\\s*iraq|mike\\s*sport|sportswear|gym\\s*equipment|' +
      'يوغا|رياض[هة]|رياضي|جيم|فتنس|تمارين|تدريب|دامبل|دمبل|كيتلبيل|باربل|اوزان|وزن|شريط\\s*مطاطي|مطاط|مقبض|مقباض|تقوية\\s*قبضة)',
      'i'
    ),
  },
  {
    cat: 'beauty',
    rx: new RegExp(
      '(spf|sunscreen|sun\\s*block|sunblock|lotion|body\\s*lotion|serum|hyaluronic|retinol|niacinamide|skincare|skin\\s*care|makeup|cosmetic|perfume|fragrance|shampoo|conditioner|soap|body\\s*wash|' +
      'واقي\\s*شمس|واقي|لوشن|سيروم|هيالورونيك|ريتينول|نياسيناميد|عناي[هة]|مكياج|تجميل|عطر|شامبو|بلسم|صابون|غسول)',
      'i'
    ),
  },
  {
    cat: 'electronics',
    rx: new RegExp(
      '(laptop|notebook|pc|computer|monitor|tv|phone|iphone|samsung|android|tablet|ipad|smartwatch|earbuds|headphones?|charger|cable|usb|router|modem|ssd|hdd|camera|printer|playstation|ps5|xbox|' +
      'لابتوب|كمبيوتر|حاسب|شاش[هة]|تلفزيون|موبايل|هاتف|تابلت|ايباد|ساع[هة]\\s*ذكي[هة]|سماعه|شاحن|كيبل|راوتر|مودم|كاميرا|طابع[هة]|بلايستيشن|اكس\\s*بوكس)',
      'i'
    ),
  },
  {
    cat: 'beverages',
    rx: new RegExp(
      '(coffee|tea|juice|water|cola|soda|energy\\s*drink|drink\\b|' +
      'قهو[هة]|شاي|عصير|ماء|مشروب|مشروبات|طاق[هة])',
      'i'
    ),
  },
  {
    cat: 'clothing',
    rx: new RegExp(
      '(t-?shirt|hoodie|jacket|pants|trousers|jeans|dress|skirt|shoe|shoes|sneaker|sneakers|sock|' +
      'تيشيرت|هودي|جاكيت|بنطلون|جينز|فستان|تنور[هة]|حذاء|جزمة|سنيكر|جوارب)',
      'i'
    ),
  },
  {
    cat: 'automotive',
    rx: new RegExp(
      '(engine|motor\\s*oil|oil\\s*filter|spark\\s*plug|brake|pad|car\\s*battery|tire|tyre|rim|car\\s*accessory|' +
      'محرك|زيت\s*محرك|زيت\s*سيارات|زيت\s*مكينه|زيت\s*مكينة|زيت\s*قير|زيت\s*فرامل|فلتر|بلك|بريكات|بطاري[هة]\\s*سيار[هة]|تاير|اطار|رنج)',
      'i'
    ),
  },
];

function refineCategory(
  inferred: string | null | undefined,
  name: string | null | undefined,
  description: string | null | undefined,
  domain: string,
  url: string
): string {
  let cat = String(inferred ?? 'general').trim() || 'general';

  const d = domain.toLowerCase();
  if (cat === 'general') {
    if (d.includes('sport') || d.includes('fitness') || d.includes('gym')) cat = 'sports';
    else if (d.includes('beauty') || d.includes('cosmetic') || d.includes('perfume')) cat = 'beauty';
    else if (d.includes('phone') || d.includes('mobile') || d.includes('electronic')) cat = 'electronics';
  }

  const text = `${name ?? ''} ${description ?? ''} ${url ?? ''} ${domain ?? ''}`;

  if (cat === 'general') {
    for (const h of CATEGORY_HINTS) {
      if (h.rx.test(text)) {
        cat = h.cat;
        break;
      }
    }
  }

  return cat;
}

function shouldUpgradeCategory(existing: string | null | undefined, nextCat: string): boolean {
  const cur = String(existing ?? '').trim() || 'general';
  if (cur === nextCat) return false;
  if (!existing) return true;
  if (cur === 'general') return true;
  if (BROAD_CATEGORIES.has(cur) && !BROAD_CATEGORIES.has(nextCat)) return true;
  return false; // no downgrade
}

export async function ingestProductPages(env: Env, opts?: { limit?: number; concurrency?: number; perDomain?: number }): Promise<any> {
  const db = getDb(env);

  const owner = crypto.randomUUID();
  const got = await db.execute(sql`select public.acquire_ingest_mutex(${LOCK_NAME}, ${owner}, ${LOCK_TTL_SECONDS}) as ok`);
  const ok = Boolean((got.rows as any[])[0]?.ok);
  if (!ok) return { skipped: true, reason: 'concurrent_run_in_progress' };

  const runId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  let processed = 0, succeeded = 0, failed = 0, linksDiscovered = 0;

  await db.execute(sql`
    insert into public.ingestion_runs (run_id, function_name, started_at, status)
    values (${runId}, 'ingest-product-pages', ${startedAt}::timestamptz, 'running')
  `);

  const errorCounts: Record<string, number> = {};

  async function logError(frontierId: string, sourceDomain: string, url: string, code: ErrorCode, httpStatus: number | null, blockedReason: string | null, message: string | null) {
    errorCounts[code] = (errorCounts[code] ?? 0) + 1;
    try {
      await db.execute(sql`
        insert into public.ingestion_error_events (run_id, frontier_id, source_domain, url, http_status, blocked_reason, error_code, error_message)
        values (${runId}::uuid, ${frontierId}::uuid, ${sourceDomain}, ${url}, ${httpStatus}, ${blockedReason}, ${code}, ${message})
      `);
    } catch {}
  }

  try {
    const regionId = await ensureOnlineRegion(db);

    const fxRow = await db.execute(sql`
      select mid_iqd_per_usd
      from public.exchange_rates
      where source_type='market' and is_active=true
      order by rate_date desc
      limit 1
    `);
    const fxRate = Number((fxRow.rows as any[])[0]?.mid_iqd_per_usd ?? DEFAULT_FALLBACK_FX);

    const limit = Math.max(1, Math.min(4000, Number(opts?.limit ?? BATCH_SIZE)));
    const perDomain = Math.max(1, Math.min(200, Number((opts as any)?.perDomain ?? 40)));
    const claimed = await db.execute(sql`
      select *
      from public.claim_crawl_frontier_batch(${limit}::int, '{}'::text[], ${perDomain}::int)
    `);
    const items = (claimed.rows as any[]) ?? [];

    if (!items.length) {
      await finalizeRun(db, runId, processed, succeeded, failed, { notes: 'no_pending_items' });
      return { processed, succeeded, failed, links_discovered: 0, error_counts: errorCounts };
    }

    // Domain health blocks (auto-disabled, backoff, budgets).
    // We load once per run for speed. If the schema isn't patched yet, we fall back safely.
    let domainRows: any[] = [];
    try {
      let r: any;
      try {
        // Full state (health + probe + render-worker)
        r = await db.execute(sql`
          select
            domain,
            coalesce(auto_disabled,false) as auto_disabled,
            auto_disabled_reason,
            auto_disabled_at,
            auto_recovered_at,
            disabled_until,
            paused_until,
            budget_per_hour,
            budget_hour_start,
            budget_used,
            probe_enabled,
            probe_required,
            probe_until,
            last_probe_at,
            last_probe_success_at,
            last_probe_failure_at,
            probe_consecutive_failures,
            last_probe_http_status,
            last_probe_error_code,
            coalesce(js_only,false) as js_only,
            js_only_reason,
            js_only_hits,
            last_js_shell_at,
            render_budget_per_hour,
            render_budget_hour_start,
            render_budget_used,
            render_paused_until,
            render_cache_ttl_min,
            render_stale_serve_min,
            last_render_success_at,
            last_render_failure_at,
            render_consecutive_failures,
            last_render_error_code,
            last_render_http_status
          from public.price_sources
          where country_code = 'IQ'
        `);
      } catch {
        try {
          // Health + probe (older schema)
          r = await db.execute(sql`
            select
              domain,
              coalesce(auto_disabled,false) as auto_disabled,
              auto_disabled_reason,
              auto_disabled_at,
              auto_recovered_at,
              disabled_until,
              paused_until,
              budget_per_hour,
              budget_hour_start,
              budget_used,
              probe_enabled,
              probe_required,
              probe_until,
              last_probe_at,
              last_probe_success_at,
              last_probe_failure_at,
              probe_consecutive_failures,
              last_probe_http_status,
              last_probe_error_code
            from public.price_sources
            where country_code = 'IQ'
          `);
        } catch {
          r = await db.execute(sql`
            select
              domain,
              coalesce(auto_disabled,false) as auto_disabled,
              auto_disabled_reason,
              auto_disabled_at,
              auto_recovered_at,
              disabled_until,
              paused_until,
              budget_per_hour,
              budget_hour_start,
              budget_used
            from public.price_sources
            where country_code = 'IQ'
          `);
        }
      }
      domainRows = (r.rows as any[]) ?? [];
    } catch {
      const r = await db.execute(sql`
        select domain, coalesce(auto_disabled,false) as auto_disabled, auto_disabled_reason
        from public.price_sources
        where country_code = 'IQ'
      `).catch(() => ({ rows: [] as any[] }));
      domainRows = (r.rows as any[]) ?? [];
    }

    const domainState = new Map<string, any>();
    for (const row of domainRows) domainState.set(String(row.domain), row);

    const disabledDomains = new Set<string>(
      domainRows
        .filter((r) => {
          const now = Date.now();
          const du = r.disabled_until ? new Date(r.disabled_until).getTime() : 0;
          const pu = r.paused_until ? new Date(r.paused_until).getTime() : 0;
          // Treat auto_disabled as active only while a backoff window exists (or legacy volumes without disabled_until).
          const auto = Boolean(r.auto_disabled) && (!du || du > now);
          return auto || (du && du > now) || (pu && pu > now);
        })
        .map((r) => String(r.domain))
    );


    // Category overrides (admin-defined): load once per run.
    const overrides: CategoryOverrideRow[] = await loadCategoryOverrides(db);

        const concurrency = Math.max(1, Math.min(60, Number((opts as any)?.concurrency ?? DEFAULT_CONCURRENCY)));

    let idx = 0;
    const processItem = async (item: any) => {
      processed++;

      const sourceDomain = String(item.source_domain);
      const url = String(item.url);

      const st = domainState.get(sourceDomain) ?? {};
      const nowMs = Date.now();
      const disabledUntilMs = st.disabled_until ? new Date(st.disabled_until).getTime() : 0;
      const pausedUntilMs = st.paused_until ? new Date(st.paused_until).getTime() : 0;
      const renderPausedUntilMs = st.render_paused_until ? new Date(st.render_paused_until).getTime() : 0;
      const autoDisabled = Boolean(st.auto_disabled);
      const jsOnly = Boolean(st.js_only);

      // If budget-paused, defer until pause ends (prevents hammering).
      if (pausedUntilMs && pausedUntilMs > nowMs) {
        await deferFrontier(db, item.id, 'pending', 'budget_paused', 'BUDGET_PAUSED', pausedUntilMs);
        failed++;
        return;
      }

      // If backoff expired but domain still marked auto_disabled, require a lightweight probe before full ingestion resumes.
      if (PROBE_ENABLED && autoDisabled && disabledUntilMs && disabledUntilMs <= nowMs) {
        const probeEnabled = st.probe_enabled == null ? true : Boolean(st.probe_enabled);
        if (probeEnabled) {
          const ttlMs = PROBE_SUCCESS_TTL_MIN * 60 * 1000;
          const lastOk = st.last_probe_success_at ? new Date(st.last_probe_success_at).getTime() : 0;
          const probeFresh = lastOk && (nowMs - lastOk) <= ttlMs;
          const probeUntilMs = st.probe_until ? new Date(st.probe_until).getTime() : 0;
          const stillWaiting = probeUntilMs && probeUntilMs > nowMs;

          if (!probeFresh) {
            if (!stillWaiting) {
              await ensureProbeQueued(db, sourceDomain, PROBE_DEFER_MIN).catch(() => {});
            }
            await deferFrontier(db, item.id, 'pending', 'probe_required', 'PROBE_REQUIRED', nowMs + PROBE_DEFER_MIN * 60 * 1000);
            failed++;
            return;
          }
        }
      }

      // JS-only domains: prefer Render Worker cache; serve stale HTML when allowed and revalidate in background.
      if (RENDER_QUEUE_ENABLED && jsOnly) {
        if (renderPausedUntilMs && renderPausedUntilMs > nowMs) {
          await deferFrontier(db, item.id, 'pending', 'render_paused', 'RENDER_PAUSED', renderPausedUntilMs);
          failed++;
          return;
        }

        const staleServeMin = Math.max(0, Number(st.render_stale_serve_min ?? 1440));
        const cached = await getRenderedPage(db, sourceDomain, url, staleServeMin);
        if (cached && cached.html && cached.html.length > 500) {
          // We'll use the cached HTML later; mark fetchResult accordingly by setting on item.
          (item as any).__rendered_html = cached.html;
          (item as any).__rendered_http_status = cached.http_status;
          (item as any).__rendered_content_type = cached.content_type;
          (item as any).__rendered_by = cached.served_mode === 'stale' ? 'worker_cache_stale' : 'worker_cache';
          if (cached.should_revalidate) {
            await ensureRenderQueued(db, sourceDomain, url, 25, { force: true, discoveredFrom: 'swr_revalidate' }).catch(() => {});
          }
        } else {
          await ensureRenderQueued(db, sourceDomain, url, 35, { force: true, discoveredFrom: 'missing_render_cache' }).catch(() => {});
          await deferFrontier(db, item.id, 'pending', 'waiting_render', 'WAITING_RENDER', nowMs + RENDER_WAIT_MIN * 60 * 1000);
          failed++;
          return;
        }
      }

      if (disabledDomains.has(sourceDomain)) {
        const st = domainState.get(sourceDomain) ?? {};
        const untilMs = Math.max(
          st.disabled_until ? new Date(st.disabled_until).getTime() : 0,
          st.paused_until ? new Date(st.paused_until).getTime() : 0
        );

        // If the DB had auto_disabled=true without a backoff window (older volumes),
        // give it a finite window so it can auto-recover later.
        let untilIso: string;
        if (!untilMs && Boolean(st.auto_disabled)) {
          untilIso = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
          await db.execute(sql`
            update public.price_sources
            set disabled_until = ${untilIso}::timestamptz
            where domain = ${sourceDomain} and disabled_until is null
          `).catch(() => {});
        } else {
          untilIso = untilMs && untilMs > Date.now()
            ? new Date(untilMs).toISOString()
            : new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
        }

        await db.execute(sql`
          update public.crawl_frontier
          set status='pending',
              next_retry_at = ${untilIso}::timestamptz,
              last_error = ${String(st.auto_disabled_reason ?? 'auto_disabled')},
              last_error_code = 'AUTO_DISABLED',
              updated_at = now()
          where id = ${String(item.id)}::uuid
        `).catch(() => {});
        failed++;
        return;
      }

      // Per-domain budget (prevents hammering a single domain / bot-war)
      const budget = await checkAndConsumeDomainBudget(db, sourceDomain).catch(() => ({ allowed: true } as any));
      if (budget && budget.allowed === false) {
        const untilIso = budget.paused_until ?? new Date(Date.now() + 30 * 60 * 1000).toISOString();
        await logError(item.id, sourceDomain, url, 'DOMAIN_BUDGET', null, null, `paused until ${untilIso}`);
        await db.execute(sql`
          update public.crawl_frontier
          set status='pending',
              retry_count = retry_count + 1,
              next_retry_at = ${untilIso}::timestamptz,
              last_error = 'domain_budget',
              last_error_code = 'DOMAIN_BUDGET',
              updated_at = now()
          where id = ${String(item.id)}::uuid
        `).catch(() => {});
        failed++;
        return;
      }

      let fetchResult: FetchResult;
      let fetchMs = 0;

      if ((item as any).__rendered_html) {
        fetchResult = {
          status: Number((item as any).__rendered_http_status ?? 200),
          html: String((item as any).__rendered_html),
          contentType: ((item as any).__rendered_content_type ? String((item as any).__rendered_content_type) : 'text/html'),
          blocked: false,
          blockedReason: null,
          jsShell: false,
          jsShellConfidence: 0,
          jsShellReason: null,
          renderedBy: ((item as any).__rendered_by === 'worker_cache_stale' ? 'worker_cache' : ((item as any).__rendered_by ?? 'worker_cache')) as any,
        };
      } else {
        const t0 = Date.now();
        fetchResult = await fetchHtml(url).catch(() => ({ status: 0, html: null, contentType: null, blocked: false, blockedReason: null } as FetchResult));
        fetchMs = Date.now() - t0;
      }


      if (!fetchResult.html || fetchResult.status < 200 || fetchResult.status >= 400) {
        const code = classifyError(fetchResult, `HTTP ${fetchResult.status}`);
        await logError(item.id, sourceDomain, url, code, fetchResult.status || null, fetchResult.blockedReason, `fetch failed`);
        await noteFailure(db, sourceDomain, code, fetchResult.status || null).catch(() => {});


        if (code === 'BOT_CHALLENGE') {
          await noteBotChallenge(db, sourceDomain, fetchResult.status || null);
          await markDone(db, item.id, fetchResult, fetchMs, 'blocked:bot_challenge');
          failed++;
          return;
        }

        await markRetry(db, item.id, `fetch failed`, fetchResult, fetchMs, code);
        failed++;
        return;
      }

      // Fetch succeeded (not blocked): update health state & allow auto-recovery when the backoff window passed.
      await noteFetchSuccess(db, sourceDomain, fetchResult.status).catch(() => {});

      if (String(item.page_type) !== 'product') {
        const links = extractInternalLinks(fetchResult.html, sourceDomain);
        if (links.length) {
          const inserted = await seedLinks(db, sourceDomain, url, links);
          linksDiscovered += inserted;
        }
        await markDone(db, item.id, fetchResult, fetchMs, null);
        succeeded++;
        return;
      }

      const src = await db.execute(sql`
        select id, name_ar, coalesce(trust_weight_dynamic, trust_weight) as trust_weight
        from public.price_sources
        where domain = ${sourceDomain} and is_active = true
        limit 1
      `);
      const source = (src.rows as any[])[0];
      if (!source?.id) {
        await logError(item.id, sourceDomain, url, 'UNKNOWN', fetchResult.status, null, 'source not found');
        await markRetry(db, item.id, 'source not found', fetchResult, fetchMs, 'UNKNOWN');
        failed++;
        return;
      }

      const adapters = await db.execute(sql`
        select adapter_type, selectors, priority
        from public.source_adapters
        where source_id = ${source.id}::uuid and is_active = true
        order by priority asc
      `);

      const extracted = extractProductFromHtml(fetchResult.html, url, (adapters.rows as any[]) ?? []);
      if (!extracted || !extracted.name || !extracted.price) {
        await logError(item.id, sourceDomain, url, 'NO_PRODUCT_DATA', fetchResult.status, fetchResult.blockedReason, 'no product data');
        await noteFailure(db, sourceDomain, 'NO_PRODUCT_DATA', fetchResult.status ?? null).catch(() => {});
        await markRetry(db, item.id, 'no product data', fetchResult, fetchMs, 'NO_PRODUCT_DATA');
        failed++;
        return;
      }

      // Category hint (3-pass): product text + siteCategory (if present) + specialized-domain hints.
      const catDet = inferCategoryKeyDetailed({
        name: extracted.name ?? null,
        description: extracted.description ?? null,
        domain: sourceDomain,
        url,
        siteCategory: (extracted as any).siteCategory ?? null,
      });
      const catHint = catDet.category;
      (extracted as any).__catDet = catDet;

      const nonGeneralSignals = [catDet.category, catDet.site, catDet.domain].filter((x) => x && x !== 'general');
      const counts = new Map<string, number>();
      for (const s of nonGeneralSignals) counts.set(s, (counts.get(s) ?? 0) + 1);
      const maxVote = Math.max(0, ...Array.from(counts.values()));
      const categoryConflict = nonGeneralSignals.length >= 2 && maxVote < 2;

      const categoryBadge = ((): 'trusted' | 'medium' | 'weak' => {
        if (catHint === 'general') return 'weak';
        if (maxVote >= 2) return 'trusted';
        if (catDet.textScore >= 3) return 'trusted';
        if (catDet.textScore >= 2) return 'medium';
        if (catDet.site !== 'general' && catDet.category === catDet.site) return 'medium';
        if (catDet.domain !== 'general' && catDet.category === catDet.domain) return 'medium';
        return 'weak';
      })();

      const categoryConfidence = ((): number => {
        if (categoryBadge === 'trusted') return 0.85;
        if (categoryBadge === 'medium') return 0.65;
        return 0.45;
      })();

      const categoryEvidence = {
        decided: catHint,
        textScore: catDet.textScore,
        site: catDet.site,
        domain: catDet.domain,
        siteCategoryRaw: (extracted as any).siteCategory ?? null,
        conflict: categoryConflict,
      };

      // Final category meta (may be overridden by admin rules)
      let categoryBadgeFinal: 'trusted' | 'medium' | 'weak' = categoryBadge;
      let categoryConfidenceFinal: number = categoryConfidence;
      let categoryConflictFinal: boolean = categoryConflict;

      // Grocery taxonomy (subcategory)
      const subDet = catHint === 'groceries'
        ? classifyGrocerySubcategory({
            name: extracted.name ?? null,
            description: extracted.description ?? null,
            siteCategory: (extracted as any).siteCategory ?? null,
          })
        : { subcategory: null, badge: 'weak' as const, confidence: 0.3, reasons: ['not_groceries'] };

      let decidedCategory = catHint;
      let decidedSubcategory: string | null = subDet.subcategory;
      let subBadge: string = subDet.badge;
      let subConfidence: number = subDet.confidence;
      const subEvidence = { decided: subDet.subcategory, badge: subDet.badge, confidence: subDet.confidence, reasons: subDet.reasons };

      // Admin overrides (category/subcategory force) — priority over inference
      const matchedOverride = matchCategoryOverride(overrides, {
        sourceId: String(source.id),
        domain: sourceDomain,
        url,
        name: extracted.name ?? null,
        description: extracted.description ?? null,
      });

      const overrideCategoryId: string | null = matchedOverride ? matchedOverride.id : null;
      const overrideSubcategoryId: string | null = matchedOverride?.subcategory ? matchedOverride.id : null;
      const lockCategory = Boolean(matchedOverride?.lock_category ?? false);
      const lockSubcategory = Boolean(matchedOverride?.lock_subcategory ?? false);

      if (matchedOverride?.category) {
        decidedCategory = String(matchedOverride.category) as CategoryKey;
        categoryBadgeFinal = 'trusted';
        categoryConfidenceFinal = 0.99;
        categoryConflictFinal = false;
        (categoryEvidence as any).decided = decidedCategory;
        (categoryEvidence as any).conflict = false;
      }
      if (matchedOverride?.subcategory) {
        decidedSubcategory = String(matchedOverride.subcategory);
        subBadge = 'trusted';
        subConfidence = 0.99;
      }

      (categoryEvidence as any).override = matchedOverride ? {
        id: matchedOverride.id,
        match_kind: matchedOverride.match_kind,
        match_value: matchedOverride.match_value,
        category: matchedOverride.category,
        subcategory: matchedOverride.subcategory,
      } : null;

      const { priceIqd, normalizationFactor, parsedCurrency } = normalizeToIqdSmart(
        Number(extracted.price),
        extracted.currency ?? 'IQD',
        fxRate,
        { categoryHint: decidedCategory, domain: sourceDomain, rawText: (extracted as any).priceText ?? String((extracted as any).price ?? ''), name: extracted.name ?? null }
      );

      const sanity = isSaneIqdPrice(priceIqd);

      // ✅ Category-aware minimum floor (prevents classic USD→IQD misses like 110 or 199 from being treated as valid IQD).
      const categoryFloor = (() => {
        switch (decidedCategory) {
          case 'electronics': return 5000;
          case 'automotive': return 2000;
          case 'clothing': return 1000;
          case 'home': return 1000;
          case 'sports': return 1000;
          case 'toys': return 1000;
          case 'beauty': return 500;
          case 'essentials': return 200;
          case 'groceries': return 250;
          case 'beverages': return 100;
          default: return 100;
        }
      })();

      let lowPriceCategoryAnomaly = false;
      if (Number.isFinite(priceIqd) && priceIqd > 0 && priceIqd < categoryFloor && decidedCategory !== 'groceries' && decidedCategory !== 'beverages') {
        lowPriceCategoryAnomaly = true;
      }
      if (!sanity.ok) {
        await enqueuePriceAnomalyQuarantine(db, {
          sourceId: source.id,
          sourceName: sourceDomain,
          productName: extracted.name ?? null,
          regionId,
          pageUrl: url,
          rawPriceText: String((extracted as any).priceText ?? extracted.price ?? ''),
          parsedPriceIqd: priceIqd,
          currency: parsedCurrency ?? 'IQD',
          anomalyReason: `sanity:${sanity.reason}`,
          anomalyContext: { stage: 'ingestProductPages', frontier_id: item.id },
        });
        await logError(item.id, sourceDomain, url, 'PRICE_SANITY_FAIL', fetchResult.status, null, `Rejected price: ${priceIqd} IQD (${sanity.reason})`);
        await noteFailure(db, sourceDomain, 'PRICE_SANITY_FAIL', fetchResult.status ?? null).catch(() => {});
        await markRetry(db, item.id, `Rejected price: ${sanity.reason}`, fetchResult, fetchMs, 'PRICE_SANITY_FAIL');
        failed++;
        return;
      }

      const productId = await upsertProduct(db, sourceDomain, url, extracted, {
        category: decidedCategory,
        subcategory: decidedSubcategory,
        lockCategory,
        lockSubcategory,
        overrideCategoryId,
        overrideSubcategoryId,
      });
      if (!productId) {
        await logError(item.id, sourceDomain, url, 'PRODUCT_UPSERT_FAILED', fetchResult.status, null, 'product upsert failed');
        await markRetry(db, item.id, 'product upsert failed', fetchResult, fetchMs, 'PRODUCT_UPSERT_FAILED');
        failed++;
        return;
      }

      // ✅ Taxonomy v2 (hierarchical): infer key + (optional) quarantine when uncertain.
      // Safe: if schema isn't patched yet, this will be ignored.
      try {
        const siteCategoryRaw = (categoryEvidence as any)?.siteCategoryRaw ?? null;
        const siteNorm = normalizeSiteCategory(siteCategoryRaw);
        let mappedTaxonomyKey: string | null = null;
        if (siteNorm) {
          try {
            const mr = await db.execute(sql`
              select taxonomy_key
              from public.domain_taxonomy_mappings
              where domain = ${sourceDomain} and site_category_norm = ${siteNorm} and is_active = true
              limit 1
            `);
            mappedTaxonomyKey = (mr.rows as any[])[0]?.taxonomy_key ?? null;
          } catch {
            mappedTaxonomyKey = null;
          }
        }

        const sug = inferTaxonomySuggestion({
          mappedTaxonomyKey,
          category: decidedCategory,
          subcategory: decidedSubcategory,
          name: extracted.name ?? null,
          description: extracted.description ?? null,
          siteCategoryRaw,
          siteCategoryKey: (catDet as any)?.site ?? 'general',
        });

        if (sug.taxonomyKey) {
          const mapped = taxonomyKeyToCategoryAndSubcategory(sug.taxonomyKey);

          await db.execute(sql`
            update public.products
            set
              taxonomy_key = case when coalesce(taxonomy_manual,false)=true then taxonomy_key else ${sug.taxonomyKey} end,
              taxonomy_confidence = case when coalesce(taxonomy_manual,false)=true then taxonomy_confidence else ${sug.confidence} end,
              taxonomy_reason = case when coalesce(taxonomy_manual,false)=true then taxonomy_reason else ${sug.reason} end,
              category = case when coalesce(category_manual,false)=true then category else ${mapped.category} end,
              subcategory = case when coalesce(subcategory_manual,false)=true then subcategory else ${mapped.subcategory} end,
              updated_at = now()
            where id = ${productId}::uuid
          `).catch(() => {});

          const needQuarantine = Boolean(sug.conflict) || sug.confidence < 0.85;
          if (needQuarantine) {
            await db.execute(sql`
              insert into public.taxonomy_quarantine (
                product_id, domain, url, product_name,
                site_category_raw, site_category_norm,
                current_taxonomy_key, inferred_taxonomy_key,
                confidence, reason,
                conflict, conflict_reason,
                status
              ) values (
                ${productId}::uuid,
                ${sourceDomain},
                ${url},
                ${String(extracted.name ?? '')},
                ${siteCategoryRaw},
                ${siteNorm || null},
                null,
                ${sug.taxonomyKey},
                ${sug.confidence},
                ${sug.reason},
                ${Boolean(sug.conflict)},
                ${sug.conflictReason},
                'pending'
              )
              on conflict (product_id, status) do nothing
            `).catch(() => {});
          }
        }
      } catch {
        // ignore taxonomy v2
      }




      // Auto-quarantine (category conflict): if signals disagree, record it so it doesn't silently pollute categories.
      if (categoryConflictFinal) {
        try {
          await db.execute(sql`
            insert into public.category_conflict_quarantine (
              product_id, status, evidence, first_seen_at, last_seen_at, seen_count
            ) values (
              ${productId}::uuid,
              'open',
              ${JSON.stringify(categoryEvidence)}::jsonb,
              now(),
              now(),
              1
            )
            on conflict (product_id, status) do update set
              last_seen_at = now(),
              seen_count = public.category_conflict_quarantine.seen_count + 1,
              evidence = excluded.evidence
          `);
        } catch {
          // schema may not exist yet; ignore
        }
      }
      const today = new Date().toISOString().slice(0, 10);
      const existing = await db.execute(sql`
        select id
        from public.source_price_observations
        where product_id = ${productId}::uuid
          and source_id = ${source.id}::uuid
          and source_url = ${url}
          and (observed_at at time zone 'UTC')::date >= ${today}::date
        limit 1
      `);

      if (!(existing.rows as any[])[0]?.id) {
        const quarantineCheck = await assessAndMaybeQuarantinePrice(db, {
          sourceId: source.id,
          sourceName: sourceDomain,
          productId,
          regionId,
          productName: extracted.name ?? null,
          pageUrl: url,
          rawPriceText: String(extracted.price ?? ''),
          parsedPriceIqd: priceIqd,
          currency: parsedCurrency ?? 'IQD',
          anomalyReason: 'ingest_price_anomaly',
          anomalyContext: { stage: 'ingestProductPages', frontier_id: item.id },
        });
        if (quarantineCheck.quarantined) {
          await markDone(db, item.id, fetchResult, fetchMs, `quarantined:${quarantineCheck.reasons[0]}`);
          succeeded++;
          return;
        }

        const isPriceAnomaly = Boolean(lowPriceCategoryAnomaly);
        const anomalyReason = isPriceAnomaly ? 'too_low_for_category' : null;
        const priceConfidenceBase = methodToConfidence(extracted.evidenceType);
        const evidenceType: EvidenceType = 'url';
        const evidenceRef = extracted.evidenceType;
        const priceConfidence = Math.min(1, priceConfidenceBase - (parsedCurrency !== 'IQD' ? 0.05 : 0));

        const autoVerified =
          !isPriceAnomaly &&
          priceConfidence >= 0.75 &&
          Number(source.trust_weight ?? 0.5) >= 0.4;
        try {
          // Prefer inserting category meta if schema has the columns.
          await db.execute(sql`
            insert into public.source_price_observations (
              product_id, source_id, source_url,
              price, normalized_price_iqd, currency,
              parsed_currency, raw_price_text, normalization_factor,
              is_price_anomaly, anomaly_reason,
              price_confidence, unit, region_id,
              evidence_type, evidence_ref,
              in_stock, is_synthetic, is_verified,
              observed_at, merchant_name,
              category_hint, category_badge, category_confidence, category_conflict, category_evidence,
              subcategory_hint, subcategory_badge, subcategory_confidence, subcategory_conflict, subcategory_evidence,
              category_override_id, subcategory_override_id
            ) values (
              ${productId}::uuid,
              ${source.id}::uuid,
              ${url},
              ${priceIqd},
              ${priceIqd},
              'IQD',
              ${parsedCurrency},
              ${String((extracted as any).priceText ?? extracted.price ?? '')} || ' ' || ${parsedCurrency},
              ${normalizationFactor},
              ${isPriceAnomaly},
              ${anomalyReason},
              ${priceConfidence},
              'pcs',
              ${regionId}::uuid,
              ${evidenceType},
              ${evidenceRef},
              ${Boolean(extracted.inStock ?? true)},
              false,
              ${autoVerified},
              now(),
              ${String(source.name_ar ?? sourceDomain)},
              ${decidedCategory},
              ${categoryBadgeFinal},
              ${categoryConfidenceFinal},
              ${categoryConflictFinal},
              ${JSON.stringify(categoryEvidence)}::jsonb,
              ${decidedSubcategory},
              ${subBadge},
              ${subConfidence},
              ${false},
              ${JSON.stringify(subEvidence)}::jsonb,
              ${overrideCategoryId},
              ${overrideSubcategoryId}
            )
          `);
        } catch (e: any) {
          const msg = String(e?.message ?? e);
          // Schema not patched yet: retry without the extra columns.
          if (msg.includes('category_hint') || msg.includes('subcategory_hint') || msg.includes('category_override_id')) {
            try {
              await db.execute(sql`
                insert into public.source_price_observations (
                  product_id, source_id, source_url,
                  price, normalized_price_iqd, currency,
                  parsed_currency, raw_price_text, normalization_factor,
                  is_price_anomaly, anomaly_reason,
                  price_confidence, unit, region_id,
                  evidence_type, evidence_ref,
                  in_stock, is_synthetic, is_verified,
                  observed_at, merchant_name
                ) values (
                  ${productId}::uuid,
                  ${source.id}::uuid,
                  ${url},
                  ${priceIqd},
                  ${priceIqd},
                  'IQD',
                  ${parsedCurrency},
                  ${String((extracted as any).priceText ?? extracted.price ?? '')} || ' ' || ${parsedCurrency},
                  ${normalizationFactor},
                  ${isPriceAnomaly},
                  ${anomalyReason},
                  ${priceConfidence},
                  'pcs',
                  ${regionId}::uuid,
                  ${evidenceType},
                  ${evidenceRef},
                  ${Boolean(extracted.inStock ?? true)},
                  false,
                  ${autoVerified},
                  now(),
                  ${String(source.name_ar ?? sourceDomain)}
                )
              `);
            } catch (e2: any) {
              await logError(item.id, sourceDomain, url, 'OBS_INSERT_FAILED', null, null, String(e2?.message ?? e2).slice(0, 300));
            }
          } else {
            await logError(item.id, sourceDomain, url, 'OBS_INSERT_FAILED', null, null, msg.slice(0, 300));
          }
        }
      }

      const validatedImage = validateImageUrlShared(extractPlainUrl(extracted.image));
      if (validatedImage) {
        const confidence = calculateImageConfidence(validatedImage, sourceDomain, extracted.evidenceType);
        await db.execute(sql`
          insert into public.product_images (
            product_id, image_url, source_site, source_page_url,
            is_primary, is_verified, confidence_score, position
          ) values (
            ${productId}::uuid,
            ${validatedImage},
            ${sourceDomain},
            ${url},
            true,
            ${confidence >= 0.7},
            ${confidence},
            0
          )
          on conflict (product_id, image_url) do nothing
        `).catch(() => {});
      } else if (extracted.image) {
        await logError(item.id, sourceDomain, url, 'INVALID_IMAGE_URL', null, null, `Rejected image: ${String(extracted.image).slice(0, 200)}`);
      }

      await markDone(db, item.id, fetchResult, fetchMs, extracted.canonicalUrl ?? null);
      succeeded++;

    };

    const workers = Array.from({ length: concurrency }, async () => {
      while (true) {
        const j = idx;
        idx += 1;
        if (j >= items.length) break;
        await processItem(items[j]).catch(() => {});
      }
    });

    await Promise.all(workers);


    await finalizeRun(db, runId, processed, succeeded, failed, { notes: `links_discovered=${linksDiscovered}` });
    return { processed, succeeded, failed, links_discovered: linksDiscovered, error_counts: errorCounts };

  } catch (err: any) {
    await finalizeRun(db, runId, processed, succeeded, failed, { status: 'failed', notes: String(err?.message ?? err).slice(0, 300) });
    return { processed, succeeded, failed, error: String(err?.message ?? err) };
  } finally {
    try { await db.execute(sql`select public.release_ingest_mutex(${LOCK_NAME}, ${owner})`); } catch {}
  }
}

async function ensureOnlineRegion(db: any): Promise<string> {
  const r = await db.execute(sql`select id from public.regions where name_ar = 'اونلاين' limit 1`);
  const existing = (r.rows as any[])[0]?.id as string | undefined;
  if (existing) return existing;

  const ins = await db.execute(sql`
    insert into public.regions (name_ar, name_en, is_active)
    values ('اونلاين', 'Online', true)
    returning id
  `);
  return (ins.rows as any[])[0]?.id as string;
}

async function upsertProduct(
  db: any,
  sourceDomain: string,
  url: string,
  extracted: any,
  decision?: {
    category?: string | null;
    subcategory?: string | null;
    lockCategory?: boolean;
    lockSubcategory?: boolean;
    overrideCategoryId?: string | null;
    overrideSubcategoryId?: string | null;
  },
): Promise<string | null> {
  const det = (extracted as any)?.__catDet ?? inferCategoryKeyDetailed({
    name: extracted?.name ?? null,
    description: extracted?.description ?? null,
    domain: sourceDomain,
    url,
    siteCategory: extracted?.siteCategory ?? null,
  });

  const inferred = det.category;

  const nonGeneralSignals = [det.category, det.site, det.domain].filter((x: any) => x && x !== 'general');
  const counts = new Map<string, number>();
  for (const s of nonGeneralSignals) counts.set(s, (counts.get(s) ?? 0) + 1);
  const maxVote = Math.max(0, ...Array.from(counts.values()));
  const categoryConflict = nonGeneralSignals.length >= 2 && maxVote < 2;
  const allowUpgradeSafe = !categoryConflict;

  const name = String(extracted?.name || '').trim();
  if (!name) return null;

  const desc = typeof extracted?.description === 'string' ? extracted.description : null;
  const img = extractPlainUrl(extracted?.image) ?? null;

  const inferredRefined = refineCategory(inferred, name, desc, sourceDomain, url);
  const nextCategory = String(decision?.category ?? inferredRefined).trim() || inferredRefined;
  const nextSubcategory = decision?.subcategory ? String(decision.subcategory).trim() : null;
  const lockCategory = Boolean(decision?.lockCategory ?? false);
  const lockSubcategory = Boolean(decision?.lockSubcategory ?? false);
  const overrideCategoryId = decision?.overrideCategoryId ? String(decision.overrideCategoryId) : null;
  const overrideSubcategoryId = decision?.overrideSubcategoryId ? String(decision.overrideSubcategoryId) : null;

  const src = await db.execute(sql`
    select id from public.price_sources where domain = ${sourceDomain} limit 1
  `).catch(() => ({ rows: [] as any[] }));
  const sourceId = (src.rows as any[])[0]?.id as string | undefined;

  // URL map first
  const mapped = await db.execute(sql`
    select product_id
    from public.product_url_map
    where url_hash = md5(lower(${url}))
      ${sourceId ? sql`and source_id = ${sourceId}::uuid` : sql``}
    limit 1
  `).catch(() => ({ rows: [] as any[] }));

  const mappedId = (mapped.rows as any[])[0]?.product_id as string | undefined;
  if (mappedId) {
    // Prefer writing manual locks + subcategory if schema has the columns.
    try {
      await db.execute(sql`
        update public.products
        set
          description_ar = coalesce(description_ar, ${desc}),
          image_url = coalesce(image_url, ${img}),
          category = case
            when ${lockCategory} then ${nextCategory}
            when coalesce(category_manual,false) = true then category
            when category is null then case when ${allowUpgradeSafe} then ${nextCategory} else 'general' end
            when category = 'general' then case when ${allowUpgradeSafe} then ${nextCategory} else 'general' end
            when ${allowUpgradeSafe} and category in ('groceries','beverages','essentials','home','general')
                 and ${nextCategory} in ('beauty','electronics','sports','clothing','beverages','automotive','toys')
                 and category <> ${nextCategory}
              then ${nextCategory}
            when ${allowUpgradeSafe} and ${det.textScore} >= 4 and category <> ${nextCategory}
              then ${nextCategory}
            else category
          end,
          category_manual = case when ${lockCategory} then true else coalesce(category_manual,false) end,
          category_override_id = case when ${lockCategory} then ${overrideCategoryId} else category_override_id end,
          subcategory = case
            when ${nextSubcategory} is null then subcategory
            when ${lockSubcategory} then ${nextSubcategory}
            when coalesce(subcategory_manual,false) = true then subcategory
            when ${nextCategory} = 'groceries' then ${nextSubcategory}
            else subcategory
          end,
          subcategory_manual = case when ${lockSubcategory} then true else coalesce(subcategory_manual,false) end,
          subcategory_override_id = case when ${lockSubcategory} then ${overrideSubcategoryId} else subcategory_override_id end,
          updated_at = now()
        where id = ${mappedId}::uuid
      `);
    } catch {
      // Fallback for older schema.
      await db.execute(sql`
        update public.products
        set
          description_ar = coalesce(description_ar, ${desc}),
          image_url = coalesce(image_url, ${img}),
          category = case
            when category is null then case when ${allowUpgradeSafe} then ${nextCategory} else 'general' end
            when category = 'general' then case when ${allowUpgradeSafe} then ${nextCategory} else 'general' end
            when ${allowUpgradeSafe} and category in ('groceries','beverages','essentials','home','general')
                 and ${nextCategory} in ('beauty','electronics','sports','clothing','beverages','automotive','toys')
                 and category <> ${nextCategory}
              then ${nextCategory}
            when ${allowUpgradeSafe} and ${det.textScore} >= 4 and category <> ${nextCategory}
              then ${nextCategory}
            else category
          end,
          updated_at = now()
        where id = ${mappedId}::uuid
      `).catch(() => {});
    }
    return mappedId;
  }

  // name match fallback
  const byName = await db.execute(sql`
    select id, category, subcategory,
           coalesce(category_manual,false) as category_manual,
           coalesce(subcategory_manual,false) as subcategory_manual
    from public.products
    where lower(coalesce(name_ar,'')) = lower(${name})
    limit 1
  `);

  let productId = (byName.rows as any[])[0]?.id as string | undefined;
  const existingCategory = (byName.rows as any[])[0]?.category as string | undefined;
  const existingCategoryManual = Boolean((byName.rows as any[])[0]?.category_manual ?? false);
  const existingSubManual = Boolean((byName.rows as any[])[0]?.subcategory_manual ?? false);

  if (!productId) {
    // Prefer extended columns if schema supports them.
    let created: any;
    try {
      created = await db.execute(sql`
        insert into public.products (
          name_ar, name_en, category, subcategory,
          category_manual, subcategory_manual,
          category_override_id, subcategory_override_id,
          unit, description_ar, image_url, is_active
        )
        values (
          ${name}, null, ${nextCategory}, ${nextSubcategory},
          ${lockCategory}, ${lockSubcategory},
          ${overrideCategoryId}, ${overrideSubcategoryId},
          'pcs', ${desc}, ${img}, true
        )
        returning id
      `);
    } catch {
      created = await db.execute(sql`
        insert into public.products (name_ar, name_en, category, unit, description_ar, image_url, is_active)
        values (${name}, null, ${nextCategory}, 'pcs', ${desc}, ${img}, true)
        returning id
      `);
    }
    productId = (created.rows as any[])[0]?.id as string | undefined;
  } else {
    const allowUpgrade =
      allowUpgradeSafe &&
      !existingCategoryManual &&
      (shouldUpgradeCategory(existingCategory, nextCategory) || (det.textScore >= 4 && String(existingCategory ?? 'general') !== nextCategory));

    try {
      await db.execute(sql`
        update public.products
        set
          description_ar = coalesce(description_ar, ${desc}),
          image_url = coalesce(image_url, ${img}),
          category = case
            when ${lockCategory} then ${nextCategory}
            when coalesce(category_manual,false) = true then category
            when ${allowUpgrade} then ${nextCategory}
            else category
          end,
          category_manual = case when ${lockCategory} then true else coalesce(category_manual,false) end,
          category_override_id = case when ${lockCategory} then ${overrideCategoryId} else category_override_id end,
          subcategory = case
            when ${nextSubcategory} is null then subcategory
            when ${lockSubcategory} then ${nextSubcategory}
            when coalesce(subcategory_manual,false) = true then subcategory
            when ${nextCategory} = 'groceries' and ${existingSubManual} = false then ${nextSubcategory}
            else subcategory
          end,
          subcategory_manual = case when ${lockSubcategory} then true else coalesce(subcategory_manual,false) end,
          subcategory_override_id = case when ${lockSubcategory} then ${overrideSubcategoryId} else subcategory_override_id end,
          updated_at = now()
        where id = ${productId}::uuid
      `);
    } catch {
      await db.execute(sql`
        update public.products
        set
          description_ar = coalesce(description_ar, ${desc}),
          image_url = coalesce(image_url, ${img}),
          category = case when ${allowUpgrade} then ${nextCategory} else category end,
          updated_at = now()
        where id = ${productId}::uuid
      `).catch(() => {});
    }
  }

  if (!productId) return null;

  if (sourceId) {
    await db.execute(sql`
      insert into public.product_url_map (source_id, url, canonical_url, product_id, status, last_seen_at)
      values (${sourceId}::uuid, ${url}, null, ${productId}::uuid, 'mapped', now())
      on conflict (source_id, url_hash) do update set
        source_id = excluded.source_id,
        product_id = excluded.product_id,
        status = 'mapped',
        last_seen_at = now(),
        updated_at = now()
    `).catch(() => {});
  }

  return productId;
}


async function deferFrontier(db: any, id: string, status: 'pending'|'failed', message: string, code: ErrorCode, untilMs: number) {
  const untilIso = new Date(untilMs).toISOString();
  await db.execute(sql`
    update public.crawl_frontier
    set status = ${status},
        last_error = ${message},
        last_error_code = ${code},
        next_retry_at = ${untilIso}::timestamptz,
        updated_at = now()
    where id = ${String(id)}::uuid
  `).catch(() => {});
}

async function ensureProbeQueued(db: any, domain: string, deferMins: number) {
  // This is best-effort. If the schema isn't patched yet, ignore.
  const defer = Math.max(5, Math.min(180, Number(deferMins || 30)));
  await db.execute(sql`
    with pick as (
      select coalesce(
        (select url from public.source_entrypoints se where se.domain = ${domain} and se.is_active = true order by se.priority asc limit 1),
        (select url from public.crawl_frontier cf where cf.source_domain = ${domain} order by cf.updated_at desc limit 1),
        ('https://' || ${domain} || '/')
      ) as probe_url
    )
    insert into public.domain_probe_queue (source_domain, probe_url, status, priority, next_retry_at)
    select ${domain}, p.probe_url, 'pending', 10, now()
    from pick p
    where not exists (
      select 1 from public.domain_probe_queue q
      where q.source_domain = ${domain} and q.status in ('pending','processing')
    )
    on conflict do nothing
  `);

  await db.execute(sql`
    update public.price_sources
    set probe_required = true,
        probe_until = now() + make_interval(mins => ${defer}),
        last_probe_at = coalesce(last_probe_at, now())
    where country_code = 'IQ' and domain = ${domain}
  `).catch(() => {});
}


async function noteJsOnly(db: any, domain: string, reason: string, confidence?: number) {
  // Conservative auto-learn: require multiple high-confidence hits before flipping js_only=true.
  const conf = Number(confidence ?? 0);
  if (conf && conf < 0.82) return;
try {
    await db.execute(sql`
      update public.price_sources
      set
        js_only_reason = coalesce(js_only_reason, ${reason}),
        js_only_hits = case
          when last_js_shell_at is null or last_js_shell_at < now() - interval '24 hours' then 1
          else coalesce(js_only_hits,0) + 1 end,
        last_js_shell_at = now(),
        js_only = case
          when coalesce(js_only,false)=true then true
          when (case when last_js_shell_at is null or last_js_shell_at < now() - interval '24 hours'
                then 1 else coalesce(js_only_hits,0) + 1 end) >= ${JS_SHELL_HITS_THRESHOLD}
          then true else false end
      where country_code='IQ' and domain = ${domain}
    `);
  } catch {
    // schema not patched
  }
}

async function getRenderedPage(
  db: any,
  _domain: string,
  url: string,
  staleServeMin: number,
): Promise<{ html: string; http_status: number; content_type: string | null; served_mode: 'fresh' | 'stale'; should_revalidate: boolean } | null> {
  try {
    const r = await db.execute(sql`
      select html,
             coalesce(http_status,200)::int as http_status,
             content_type,
             rendered_at,
             expires_at
      from public.rendered_pages
      where url = ${url}
      limit 1
    `);
    const row = (r.rows as any[])?.[0];
    if (!row?.html) return null;

    const expiresAtMs = row.expires_at ? new Date(row.expires_at).getTime() : 0;
    const nowMs = Date.now();
    const isFresh = expiresAtMs > nowMs;
    if (isFresh) {
      return {
        html: String(row.html),
        http_status: Number(row.http_status ?? 200),
        content_type: row.content_type ? String(row.content_type) : null,
        served_mode: 'fresh',
        should_revalidate: false,
      };
    }

    const staleWindowMs = Math.max(0, Number(staleServeMin ?? 0)) * 60 * 1000;
    if (!staleWindowMs) return null;
    if (!expiresAtMs || nowMs - expiresAtMs > staleWindowMs) return null;

    return {
      html: String(row.html),
      http_status: Number(row.http_status ?? 200),
      content_type: row.content_type ? String(row.content_type) : null,
      served_mode: 'stale',
      should_revalidate: true,
    };
  } catch {
    return null;
  }
}

async function ensureRenderQueued(
  db: any,
  domain: string,
  url: string,
  priority: number,
  opts?: { force?: boolean; discoveredFrom?: string }
) {
  const pr = computeRenderPriority(url, Number(priority ?? 10));
  const discoveredFrom = String(opts?.discoveredFrom ?? 'ingest_js_shell');
  const cooldownMin = Math.max(1, Math.min(180, Number(process.env.RENDER_ENQUEUE_COOLDOWN_MIN ?? 15)));
  const force = Boolean(opts?.force ?? false);

  // Best-effort: if schema isn't patched yet, ignore.
  // IMPORTANT: render_queue has a unique url_hash, so we must UPSERT (not do-nothing)
  // to allow revalidation / refreshing after success.
  await db.execute(sql`
    insert into public.render_queue (source_domain, url, status, priority, discovered_from, next_retry_at)
    values (${domain}, ${url}, 'pending', ${Math.max(0, Math.min(100, Number(pr ?? 10)))}, ${discoveredFrom}, now())
    on conflict (url_hash) do update
    set
      source_domain = excluded.source_domain,
      priority = greatest(public.render_queue.priority, excluded.priority),
      discovered_from = excluded.discovered_from,
      status = case
        when public.render_queue.status = 'processing' then public.render_queue.status
        when (public.render_queue.next_retry_at is not null and public.render_queue.next_retry_at > now()) then public.render_queue.status
        when (${force} = false and public.render_queue.updated_at > now() - make_interval(mins => ${cooldownMin})) then public.render_queue.status
        else 'pending'
      end,
      next_retry_at = case
        when public.render_queue.status = 'processing' then public.render_queue.next_retry_at
        when (public.render_queue.next_retry_at is not null and public.render_queue.next_retry_at > now()) then public.render_queue.next_retry_at
        when (${force} = false and public.render_queue.updated_at > now() - make_interval(mins => ${cooldownMin})) then public.render_queue.next_retry_at
        else now()
      end,
      updated_at = now()
  `).catch(() => {});
}

async function finalizeRun(db: any, runId: string, processed: number, succeeded: number, failed: number, opts?: { status?: string; notes?: string }) {
  const status = opts?.status ?? (failed === 0 ? 'success' : succeeded > 0 ? 'partial' : 'failed');
  await db.execute(sql`
    update public.ingestion_runs
    set ended_at = now(),
        status = ${status},
        processed = ${processed},
        succeeded = ${succeeded},
        failed = ${failed},
        notes = ${opts?.notes ?? null}
    where run_id = ${runId}
  `).catch(() => {});
}

async function markDone(db: any, id: string, fetchResult: FetchResult, fetchMs: number, canonicalUrl: string | null) {
  await db.execute(sql`
    update public.crawl_frontier
    set status = 'done',
        last_crawled_at = now(),
        http_status = ${fetchResult.status},
        content_type = ${fetchResult.contentType},
        fetch_ms = ${fetchMs},
        blocked_reason = ${fetchResult.blockedReason},
        last_error = null,
        canonical_url = coalesce(${canonicalUrl}, canonical_url)
    where id = ${id}::uuid
  `);
}

async function markRetry(db: any, id: string, message: string, fetchResult: FetchResult | null, fetchMs: number, code: ErrorCode) {
  const r = await db.execute(sql`select retry_count from public.crawl_frontier where id = ${id}::uuid`).catch(() => ({ rows: [] as any[] }));
  const retry = Number((r.rows as any[])[0]?.retry_count ?? 0);
  const delays = [10, 30, 120, 360];
  const mins = delays[Math.min(retry, delays.length - 1)];

  await db.execute(sql`
    update public.crawl_frontier
    set status = 'pending',
        retry_count = retry_count + 1,
        next_retry_at = now() + make_interval(mins => ${mins}),
        http_status = ${fetchResult?.status ?? null},
        content_type = ${fetchResult?.contentType ?? null},
        fetch_ms = ${fetchMs},
        blocked_reason = ${fetchResult?.blockedReason ?? null},
        last_error = ${message},
        last_error_code = ${code},
        updated_at = now()
    where id = ${id}::uuid
  `);
}


async function checkAndConsumeDomainBudget(db: any, domain: string): Promise<{ allowed: boolean; paused_until?: string; used?: number; per_hour?: number }> {
  // Best-effort: if schema isn't patched yet, just allow.
  const defaultPerHour = Math.max(50, Math.min(5000, Number(process.env.DOMAIN_BUDGET_PER_HOUR_DEFAULT ?? 300)));

  try {
    const r = await db.execute(sql`
      update public.price_sources
      set
        budget_per_hour = coalesce(budget_per_hour, ${defaultPerHour}),
        budget_hour_start = case
          when budget_hour_start is null or budget_hour_start < date_trunc('hour', now()) then date_trunc('hour', now())
          else budget_hour_start end,
        budget_used = case
          when budget_hour_start is null or budget_hour_start < date_trunc('hour', now()) then 1
          else budget_used + 1 end
      where domain = ${domain}
      returning budget_per_hour, budget_used, budget_hour_start, paused_until
    `);

    const row = (r.rows as any[])?.[0];
    if (!row) return { allowed: true };

    const perHour = Number(row.budget_per_hour ?? defaultPerHour);
    const used = Number(row.budget_used ?? 0);
    if (used <= perHour) return { allowed: true, used, per_hour: perHour };

    const hourStartMs = row.budget_hour_start ? new Date(row.budget_hour_start).getTime() : Date.now();
    const pausedUntil = new Date(hourStartMs + 60 * 60 * 1000).toISOString();

    await db.execute(sql`
      update public.price_sources
      set paused_until = ${pausedUntil}::timestamptz
      where domain = ${domain}
    `).catch(() => {});

    return { allowed: false, paused_until: pausedUntil, used, per_hour: perHour };
  } catch {
    return { allowed: true };
  }
}

function computeBackoffMinutes(code: ErrorCode, level: number): number {
  const lv = Math.max(1, Math.min(10, Number(level || 1)));
  const base = (() => {
    switch (code) {
      case 'BOT_CHALLENGE': return 180; // 3h
      case 'HTTP_429': return 60; // 1h
      case 'HTTP_403': return 240; // 4h
      case 'TIMEOUT': return 30; // 30m
      case 'DNS_ERROR': return 720; // 12h
      default: return 120; // 2h
    }
  })();

  const mins = Math.round(base * Math.pow(2, lv - 1));
  return Math.max(15, Math.min(7 * 24 * 60, mins));
}

async function noteFailure(db: any, domain: string, code: ErrorCode, httpStatus: number | null) {
  // Backoff policy: disable only on repeated "infrastructure" failures (blocked/rate-limited/timeouts),
  // not on extraction errors like NO_PRODUCT_DATA.
  try {
    const r = await db.execute(sql`
      update public.price_sources
      set
        last_http_status = ${httpStatus},
        last_error_code = ${code},
        last_ingest_failure_at = now(),
        consecutive_failures = coalesce(consecutive_failures,0) + 1,

        consecutive_bot_challenges = case when ${code} = 'BOT_CHALLENGE' then coalesce(consecutive_bot_challenges,0) + 1 else 0 end,
        consecutive_403 = case when ${code} = 'HTTP_403' then coalesce(consecutive_403,0) + 1 else 0 end,
        consecutive_429 = case when ${code} = 'HTTP_429' then coalesce(consecutive_429,0) + 1 else 0 end,
        consecutive_timeouts = case when ${code} = 'TIMEOUT' then coalesce(consecutive_timeouts,0) + 1 else 0 end,
        consecutive_dns_errors = case when ${code} = 'DNS_ERROR' then coalesce(consecutive_dns_errors,0) + 1 else 0 end,

        last_bot_challenge_at = case when ${code} = 'BOT_CHALLENGE' then now() else last_bot_challenge_at end
      where domain = ${domain}
      returning
        disable_level,
        consecutive_bot_challenges,
        consecutive_403,
        consecutive_429,
        consecutive_timeouts,
        consecutive_dns_errors,
        auto_disabled,
        disabled_until
    `);

    const row = (r.rows as any[])?.[0];
    if (!row) return;

    // Thresholds (conservative)
    const botHits = Number(row.consecutive_bot_challenges ?? 0);
    const hits403 = Number(row.consecutive_403 ?? 0);
    const hits429 = Number(row.consecutive_429 ?? 0);
    const hitsTo = Number(row.consecutive_timeouts ?? 0);
    const hitsDns = Number(row.consecutive_dns_errors ?? 0);

    let shouldDisable = false;
    if (code === 'BOT_CHALLENGE' && botHits >= 2) shouldDisable = true;
    else if (code === 'HTTP_429' && hits429 >= 3) shouldDisable = true;
    else if (code === 'HTTP_403' && hits403 >= 3) shouldDisable = true;
    else if (code === 'TIMEOUT' && hitsTo >= 5) shouldDisable = true;
    else if (code === 'DNS_ERROR' && hitsDns >= 2) shouldDisable = true;

    if (!shouldDisable) return;

    const prevLevel = Number(row.disable_level ?? 0);
    const level = Math.min(10, prevLevel + 1);
    const mins = computeBackoffMinutes(code, level);

    const reason = `auto_disable:${code.toLowerCase()} level=${level} mins=${mins}`;
    await db.execute(sql`
      update public.price_sources
      set
        auto_disabled = true,
        auto_disabled_reason = ${reason},
        auto_disabled_at = coalesce(auto_disabled_at, now()),
        disabled_until = greatest(coalesce(disabled_until, now()), now() + make_interval(mins => ${mins})),
        disable_level = ${level}
      where domain = ${domain}
    `).catch(() => {});
  } catch {
    // schema not patched yet
  }
}

async function noteFetchSuccess(db: any, domain: string, httpStatus: number) {
  try {
    await db.execute(sql`
      update public.price_sources
      set
        last_http_status = ${httpStatus},
        last_ingest_success_at = now(),
        consecutive_failures = 0,
        consecutive_bot_challenges = 0,
        consecutive_403 = 0,
        consecutive_429 = 0,
        consecutive_timeouts = 0,
        consecutive_dns_errors = 0,
        paused_until = case when paused_until is not null and paused_until <= now() then null else paused_until end,

        -- Auto-recover once the backoff window has passed.
        auto_recovered_at = case when coalesce(auto_disabled,false)=true and (disabled_until is null or disabled_until <= now()) then now() else auto_recovered_at end,
        auto_disabled = case when disabled_until is not null and disabled_until > now() then true else false end,
        auto_disabled_reason = case when disabled_until is not null and disabled_until > now() then auto_disabled_reason else null end,
        auto_disabled_at = case when disabled_until is not null and disabled_until > now() then auto_disabled_at else null end,
        disabled_until = case when disabled_until is not null and disabled_until <= now() then null else disabled_until end,
        disable_level = case when disabled_until is not null and disabled_until > now() then disable_level else 0 end
      where domain = ${domain}
    `);
  } catch {
    // schema not patched yet
  }
}

/**
 * Backward-compat wrapper.
 * (Some older code-paths still call noteBotChallenge directly.)
 */
async function noteBotChallenge(db: any, domain: string, status: number | null) {
  await noteFailure(db, domain, 'BOT_CHALLENGE', status ?? null).catch(() => {});
}

async function fetchHtml(url: string): Promise<FetchResult> {
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

    const ct = res.headers.get('content-type') || '';
    const isHtml = ct.includes('html') || ct.includes('xml');
    const html = isHtml ? await res.text().catch(() => null) : null;

    const blocked = Boolean(
      res.status === 403 ||
        (html &&
          /cf-chl|cloudflare|attention required|ddos|captcha|just a moment|checking your browser|verify you are human|sucuri|incapsula|access denied|bot protection/i.test(html))
    );

    const js = blocked ? { isShell: false, confidence: 0, reason: '' } : detectJsShell(html);

    return {
      status: res.status,
      html,
      contentType: ct || null,
      blocked,
      blockedReason: blocked ? 'bot_challenge' : null,
      jsShell: js.isShell,
      jsShellConfidence: js.confidence,
      jsShellReason: js.reason || null,
      renderedBy: 'http',
    };
  } finally {
    clearTimeout(timeout);
  }
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

function classifyUrl(url: string): 'product'|'category'|'unknown' {
  if (/\/(product|products|p|item|dp)\//i.test(url)) return 'product';
  if (/\/(category|categories|collections|shop|store|department|c|offers)\//i.test(url)) return 'category';
  return 'unknown';
}

async function seedLinks(db: any, domain: string, parentUrl: string, links: string[]): Promise<number> {
  const MAX = 200;
  const slice = links.slice(0, MAX);
  const rows = slice.map((u) => ({
    source_domain: domain,
    url: u,
    page_type: classifyUrl(u),
    depth: 1,
    parent_url: parentUrl,
    discovered_from: parentUrl,
  }));

  const json = JSON.stringify(rows);
  const r = await db.execute(sql`
    with input as (
      select * from json_to_recordset(${json}::json)
      as x(source_domain text, url text, page_type text, depth int, parent_url text, discovered_from text)
    ),
    ins as (
      insert into public.crawl_frontier (source_domain, url, page_type, depth, parent_url, status, discovered_from)
      select i.source_domain, i.url, i.page_type, coalesce(i.depth,1), i.parent_url, 'pending', i.discovered_from
      from input i
      where i.page_type <> 'unknown'
      on conflict (url_hash) do nothing
      returning 1
    )
    select count(*)::int as n from ins
  `);

  return Number((r.rows as any[])[0]?.n ?? 0);
}

function extractPlainUrl(input: any): string | null {
  const s = String(input ?? '').trim();
  if (!s) return null;
  if (s.startsWith('http://') || s.startsWith('https://')) return s;
  return null;
}

function calculateImageConfidence(url: string, domain: string, method: string): number {
  let score = 0.6;
  const u = url.toLowerCase();
  if (u.includes(domain)) score += 0.1;
  if (u.includes('cdn') || u.includes('media') || u.includes('image')) score += 0.1;
  if ((method || '').toLowerCase() === 'jsonld') score += 0.1;
  return Math.min(1, Math.max(0, score));
}