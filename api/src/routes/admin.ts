import { Hono } from 'hono';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { getDb, type Env } from '../db';
import type { AppAuthContext } from '../auth/appUser';
import { seedCrawlFrontier } from '../jobs/seedFrontier';
import { ingestProductPages } from '../jobs/ingestProductPages';
import { discoverProductApis } from '../jobs/discoverProductApis';
import { recrawlProductImages } from '../jobs/recrawlProductImages';
import { discoverSources } from '../jobs/discoverSources';
import { validateCandidateSources } from '../jobs/validateCandidateSources';
import { activateCandidateSources } from '../jobs/activateCandidateSources';
import { retroTagSources } from '../jobs/retroTagSources';
import { retroTagSectorsFromCatalog } from '../jobs/retroTagSectorsFromCatalog';
import { rollupSourceHealth } from '../jobs/rollupSourceHealth';
import { fxUpdateDaily } from '../jobs/fxUpdateDaily';
import { patchSourceAutoDisableSchema } from '../jobs/patchSourceAutoDisableSchema';
import { patchSitemapQueueSchema } from '../jobs/patchSitemapQueueSchema';
import { patchProbeQueueSchema } from '../jobs/patchProbeQueueSchema';
import { patchObservationRollupsSchema } from '../jobs/patchObservationRollupsSchema';
import { rollupAndRetainObservations } from '../jobs/rollupAndRetainObservations';
import { seedProbeQueue } from '../jobs/seedProbeQueue';
import { runProbeQueue } from '../jobs/runProbeQueue';
import { patchRenderQueueSchema } from '../jobs/patchRenderQueueSchema';
import { seedRenderQueue } from '../jobs/seedRenderQueue';
import { cleanupRenderCache } from '../jobs/cleanupRenderCache';
import { rebalanceRenderQueuePriorities } from '../jobs/rebalanceRenderQueuePriorities';
import { resetRenderHealth } from '../jobs/resetRenderHealth';
import { patchViewsBestOffers } from '../jobs/patchViewsBestOffers';
import { repairSmallUsdPrices } from '../jobs/repairSmallUsdPrices';
import { reclassifyCategories } from '../jobs/reclassifyCategories';
import { patchCategoryConflictSchema } from '../jobs/patchCategoryConflictSchema';
import { fixLowPriceOutliers } from '../jobs/fixLowPriceOutliers';
import { repairPricesFromRawText } from '../jobs/repairPricesFromRawText';
import { reclassifyCategoriesSmart } from '../jobs/reclassifyCategoriesSmart';
import { patchTaxonomyOverridesSchema } from '../jobs/patchTaxonomyOverridesSchema';
import { backfillGrocerySubcategories } from '../jobs/backfillGrocerySubcategories';
import { applyCategoryOverrides } from '../jobs/applyCategoryOverrides';
import { extractProductFromHtml } from '../ingestion/productExtract';
import { patchTaxonomyV2Schema } from '../jobs/patchTaxonomyV2Schema';
import { patchPublicationGateSchema } from '../jobs/patchPublicationGateSchema';
import { patchCanonicalIdentitySchema } from '../jobs/patchCanonicalIdentitySchema';
import { patchCatalogTaxonomyGovernanceSchema } from '../jobs/patchCatalogTaxonomyGovernanceSchema';
import { patchBarcodeResolutionSchema } from '../jobs/patchBarcodeResolutionSchema';
import { patchGovernedFxSchema } from '../jobs/patchGovernedFxSchema';
import { seedTaxonomyV2 } from '../jobs/seedTaxonomyV2';
import { backfillTaxonomyV2 } from '../jobs/backfillTaxonomyV2';
import { backfillCanonicalIdentity } from '../jobs/backfillCanonicalIdentity';
import { reclassifyCanonicalTaxonomyShadow } from '../jobs/reclassifyCanonicalTaxonomyShadow';
import { normalizeSiteCategory, taxonomyKeyToCategoryAndSubcategory } from '../ingestion/taxonomyV2';
import { patchAppSettingsSchemaJob } from '../jobs/patchAppSettingsSchema';
import { autoDiscoveryDaily } from '../jobs/autoDiscoveryDaily';
import { autoTagSectorsCatalogDaily } from '../jobs/autoTagSectorsCatalogDaily';
import { getCoverageStats } from '../jobs/coverageStats';
import { getAppSetting } from '../lib/appSettings';
import { patchAdminHealthSchema } from '../jobs/patchAdminHealthSchema';
import { getLatestFxPublications, rolloverLatestFxPublicationToLegacy } from '../fx/governedFx';

type Ctx = { Bindings: Env; Variables: { auth: AppAuthContext | null } };

export const adminRoutes = new Hono<Ctx>();

type AdminGate = {
  ok: boolean;
  auth: AppAuthContext | null;
  db: ReturnType<typeof getDb> | null;
  res: Response | null;
  internal?: boolean;
};

async function requireAdmin(c: any): Promise<AdminGate> {
  const auth = c.get('auth') as AppAuthContext | null;
  if (!auth) return { ok: false, auth: null, db: null, res: c.json({ error: 'UNAUTHORIZED' }, 401) };
  const db = getDb(c.env);
  const r = await db.execute(sql`select public.has_role(${auth.appUserId}::uuid, 'admin'::app_role) as ok`);
  const ok = Boolean((r.rows as any[])[0]?.ok);
  if (!ok) return { ok: false, auth, db: null, res: c.json({ error: 'FORBIDDEN' }, 403) };
  return { ok: true, auth, db, res: null };
}

async function requireAdminOrInternal(c: any): Promise<AdminGate> {
  const secret = c.req.header('x-job-secret');
  if (secret && c.env.INTERNAL_JOB_SECRET && secret === c.env.INTERNAL_JOB_SECRET) {
    return { ok: true, auth: null, db: getDb(c.env), res: null, internal: true };
  }
  const gate = await requireAdmin(c);
  return { ...gate, internal: false };
}

function normalizeDomain(input: string): string {
  return String(input || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '');
}

function normalizeUrl(input: string): { url: string; domain: string } {
  const raw = String(input ?? '').trim();
  if (!raw) return { url: '', domain: '' };
  const withProto = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  const u = new URL(withProto);
  u.hash = '';
  const domain = String(u.hostname || '').toLowerCase().replace(/^www\./, '');
  return { url: u.toString(), domain };
}

function safeRegex(pattern: string, fallback: RegExp) {
  try {
    return new RegExp(String(pattern), 'i');
  } catch {
    return fallback;
  }
}

adminRoutes.get('/dashboard', async (c) => {
  const gate = await requireAdmin(c);
  if (!gate.ok || !gate.db) return gate.res!;
  const r = await gate.db.execute(sql`select public.get_ingestion_dashboard() as data`);
  return c.json((r.rows as any[])[0]?.data ?? {});
});

adminRoutes.get('/app_report', async (c) => {
  const gate = await requireAdminOrInternal(c);
  if (!gate.ok || !gate.db) return gate.res!;

  const hours = Math.max(1, Math.min(720, Number(c.req.query('hours') ?? 24)));
  const db = gate.db;

  const run = async (p: Promise<any>, fallback: any) => {
    try { return await p; } catch { return fallback; }
  };

  const products = await run(db.execute(sql`
    select
      count(*)::bigint as total,
      count(*) filter (where is_active=true)::bigint as active,
      count(*) filter (where coalesce(category,'general')='general')::bigint as general,
      count(*) filter (where coalesce(category,'')<>'' and coalesce(category,'general')<>'general')::bigint as categorized
    from public.products
  `), { rows: [] as any[] });

  const categoriesTop = await run(db.execute(sql`
    select coalesce(category,'general') as category, count(*)::bigint as count
    from public.products
    group by 1
    order by count desc
    limit 30
  `), { rows: [] as any[] });

  const subcategoriesTop = await run(db.execute(sql`
    select coalesce(subcategory,'') as subcategory, count(*)::bigint as count
    from public.products
    where subcategory is not null and btrim(subcategory) <> ''
    group by 1
    order by count desc
    limit 30
  `), { rows: [] as any[] });

  const observations = await run(db.execute(sql`
    select
      count(*)::bigint as total,
      count(*) filter (where observed_at >= now() - (::int * interval '1 hour'))::bigint as last_window,
      count(*) filter (where coalesce(in_stock,true)=true)::bigint as in_stock_total,
      count(*) filter (where coalesce(is_price_anomaly,false)=true)::bigint as anomalies_total
    from public.source_price_observations
  `), { rows: [] as any[] });

  const sources = await run(db.execute(sql`
    select
      count(*)::int as total,
      count(*) filter (where is_active=true)::int as active,
      count(*) filter (where coalesce(js_only,false)=true)::int as js_only,
      count(*) filter (where render_paused_until is not null and render_paused_until > now())::int as render_paused,
      count(*) filter (where paused_until is not null and paused_until > now())::int as ingest_paused,
      count(*) filter (where coalesce(auto_disabled,false)=true)::int as auto_disabled
    from public.price_sources
    where country_code='IQ'
  `), { rows: [] as any[] });

  const frontier = await run(db.execute(sql`
    select status, count(*)::bigint as count
    from public.crawl_frontier
    group by status
    order by status
  `), { rows: [] as any[] });

  const frontierByDomain = await run(db.execute(sql`
    select source_domain, count(*)::bigint as pending
    from public.crawl_frontier
    where status='pending'
    group by source_domain
    order by pending desc
    limit 25
  `), { rows: [] as any[] });

  const ingestionErrors = await run(db.execute(sql`
    select error_code, count(*)::bigint as count
    from public.ingestion_error_events
    where created_at >= now() - (::int * interval '1 hour')
    group by error_code
    order by count desc
    limit 30
  `), { rows: [] as any[] });

  const renderQueueExists = await run(db.execute(sql`select to_regclass('public.render_queue') as t`), { rows: [] as any[] });
  const hasRenderQueue = Boolean((renderQueueExists.rows as any[])[0]?.t);

  const renderByStatus = hasRenderQueue
    ? await run(db.execute(sql`
        select status, count(*)::bigint as count
        from public.render_queue
        where created_at >= now() - (::int * interval '1 hour')
        group by status
        order by status
      `), { rows: [] as any[] })
    : { rows: [] as any[] };

  return c.json({
    ok: true,
    hours,
    products: (products.rows as any[])[0] ?? {},
    categories_top: categoriesTop.rows ?? [],
    subcategories_top: subcategoriesTop.rows ?? [],
    observations: (observations.rows as any[])[0] ?? {},
    sources: (sources.rows as any[])[0] ?? {},
    crawl_frontier: frontier.rows ?? [],
    frontier_pending_by_domain: frontierByDomain.rows ?? [],
    ingestion_error_counts: ingestionErrors.rows ?? [],
    render_queue: {
      enabled: hasRenderQueue,
      by_status: renderByStatus.rows ?? [],
    },
  });
});

adminRoutes.get('/price_sources', async (c) => {
  const gate = await requireAdmin(c);
  if (!gate.ok || !gate.db) return gate.res!;
  const r = await gate.db.execute(sql`select * from public.price_sources order by created_at desc`);
  return c.json(r.rows ?? []);
});

adminRoutes.get('/sitemap_queue_stats', async (c) => {
  const gate = await requireAdminOrInternal(c);
  if (!gate.ok || !gate.db) return gate.res!;

  const exists = await gate.db.execute(sql`select to_regclass('public.domain_sitemap_queue') as t`);
  if (!((exists.rows as any[])[0]?.t)) return c.json({ ok: false, error: 'SCHEMA_NOT_PATCHED' }, 400);

  const byStatus = await gate.db.execute(sql`
    select status, count(*)::int as count
    from public.domain_sitemap_queue
    group by status
    order by status
  `);

  const backlogByDomain = await gate.db.execute(sql`
    select
      source_domain,
      count(*) filter (where status='pending')::int as pending_sitemaps,
      count(*) filter (where status='processing')::int as processing_sitemaps,
      count(*) filter (where status='processed')::int as processed_sitemaps,
      sum(greatest(coalesce(loc_total,0) - loc_cursor, 0))::bigint as remaining_locs_est
    from public.domain_sitemap_queue
    group by source_domain
    order by remaining_locs_est desc nulls last
    limit 50
  `);

  const topErrors = await gate.db.execute(sql`
    select source_domain, last_error, count(*)::int as count
    from public.domain_sitemap_queue
    where last_error is not null and status in ('pending','processing')
    group by source_domain, last_error
    order by count desc
    limit 50
  `);

  return c.json({
    ok: true,
    by_status: byStatus.rows ?? [],
    backlog_by_domain: backlogByDomain.rows ?? [],
    top_errors: topErrors.rows ?? [],
  });
});

adminRoutes.get('/render_queue_stats', async (c) => {
  const gate = await requireAdminOrInternal(c);
  if (!gate.ok || !gate.db) return gate.res!;

  const hours = Math.max(1, Math.min(168, Number(c.req.query('hours') ?? 24)));

  const exists = await gate.db.execute(sql`select to_regclass('public.render_queue') as t`).catch(() => ({ rows: [] as any[] }));
  if (!((exists.rows as any[])[0]?.t)) return c.json({ ok: false, error: 'SCHEMA_NOT_PATCHED' }, 400);

  const byStatus = await gate.db.execute(sql`
    select status, count(*)::int as count
    from public.render_queue
    where created_at >= now() - (${hours}::int * interval '1 hour')
    group by status
    order by status
  `).catch(() => ({ rows: [] as any[] }));

  const backlogByDomain = await gate.db.execute(sql`
    select
      source_domain,
      count(*) filter (where status='pending')::int as pending,
      count(*) filter (where status='processing')::int as processing,
      count(*) filter (where status='succeeded')::int as succeeded,
      count(*) filter (where status like 'failed%')::int as failed
    from public.render_queue
    where created_at >= now() - (${hours}::int * interval '1 hour')
    group by source_domain
    order by pending desc, failed desc
    limit 50
  `).catch(() => ({ rows: [] as any[] }));

  const topErrors = await gate.db.execute(sql`
    select source_domain, last_error_code, count(*)::int as count
    from public.render_queue
    where created_at >= now() - (${hours}::int * interval '1 hour')
      and last_error_code is not null
    group by source_domain, last_error_code
    order by count desc
    limit 50
  `).catch(() => ({ rows: [] as any[] }));

  const topOffenders = await gate.db.execute(sql`
    with recent as (
      select
        rq.source_domain,
        count(*) filter (where rq.status like 'failed%')::int as failed,
        count(*) filter (where rq.status='succeeded')::int as succeeded,
        count(*)::int as total,
        max(rq.completed_at) filter (where rq.status like 'failed%') as last_failed_at,
        (array_agg(rq.last_error_code order by rq.completed_at desc nulls last, rq.updated_at desc))[1] as last_error_code
      from public.render_queue rq
      where rq.created_at >= now() - (${hours}::int * interval '1 hour')
      group by rq.source_domain
    )
    select
      r.source_domain as domain,
      r.failed,
      r.succeeded,
      r.total,
      r.last_failed_at,
      r.last_error_code,
      coalesce(ps.render_consecutive_failures,0)::int as render_consecutive_failures,
      ps.last_render_success_at,
      ps.last_render_failure_at,
      ps.render_paused_until,
      coalesce(ps.render_cache_ttl_min,720)::int as render_cache_ttl_min,
      coalesce(ps.render_stale_serve_min,1440)::int as render_stale_serve_min,
      coalesce(ps.render_budget_per_hour,80)::int as render_budget_per_hour,
      coalesce(ps.js_only,false) as js_only,
      coalesce(ps.js_only_hits,0)::int as js_only_hits
    from recent r
    left join public.price_sources ps on ps.domain = r.source_domain
    where r.failed > 0
    order by r.failed desc, coalesce(ps.render_consecutive_failures,0) desc, r.last_failed_at desc nulls last
    limit 25
  `).catch(() => ({ rows: [] as any[] }));

  const rec = (code: string, row: any) => {
    switch (code) {
      case 'BOT_CHALLENGE': return 'Bot challenge: خفّض budget أو أوقف الدومين مؤقتاً.';
      case 'HTTP_429': return 'Rate limit: قلّل budget وارفع TTL حتى تقلّ إعادة الرندر.';
      case 'HTTP_403': return '403: راجع الحظر أو عطّل الرندر لهذا الدومين مؤقتاً.';
      case 'NAV_ERROR': return 'Navigation: غالباً JS ثقيل/timeout. جرّب TTL أعلى أو stale serve أطول.';
      case 'EMPTY': return 'HTML فارغ: غالباً الصفحة تغيّرت أو المحتوى ما اكتمل بالرندر.';
      case 'RENDER_BUDGET': return 'ميزانية الرندر ممتلئة: زد budget أو خلّ stale-while-revalidate يخدم الكاش.';
      default:
        return Number(row?.render_consecutive_failures ?? 0) >= 3
          ? 'فشل متكرر: فعّل pause قصير وراجع الدومين.'
          : 'راجع آخر خطأ واضبط TTL / stale window حسب سلوك الموقع.';
    }
  };

  return c.json({
    ok: true,
    hours,
    by_status: byStatus.rows ?? [],
    backlog_by_domain: backlogByDomain.rows ?? [],
    top_errors: topErrors.rows ?? [],
    top_offenders: ((topOffenders.rows as any[]) ?? []).map((r) => ({
      domain: String(r.domain),
      failed: Number(r.failed ?? 0),
      succeeded: Number(r.succeeded ?? 0),
      total: Number(r.total ?? 0),
      last_failed_at: r.last_failed_at,
      last_error_code: r.last_error_code,
      render_consecutive_failures: Number(r.render_consecutive_failures ?? 0),
      last_render_success_at: r.last_render_success_at,
      last_render_failure_at: r.last_render_failure_at,
      render_paused_until: r.render_paused_until,
      render_cache_ttl_min: Number(r.render_cache_ttl_min ?? 720),
      render_stale_serve_min: Number(r.render_stale_serve_min ?? 1440),
      render_budget_per_hour: Number(r.render_budget_per_hour ?? 80),
      js_only: Boolean(r.js_only),
      js_only_hits: Number(r.js_only_hits ?? 0),
      recommendation: rec(String(r.last_error_code ?? ''), r),
    })),
  });
});

// Coverage: provinces + sectors (Iraq) so we know what to fill next
adminRoutes.get('/coverage_stats', async (c) => {
  const gate = await requireAdminOrInternal(c);
  if (!gate.ok || !gate.db) return gate.res!;
  const result = await getCoverageStats(c.env);
  return c.json(result);
});

// Auto-discovery status (settings + last run + last metrics)
adminRoutes.get('/auto_discovery_status', async (c) => {
  const gate = await requireAdminOrInternal(c);
  if (!gate.ok || !gate.db) return gate.res!;
  const settings = await getAppSetting<any>(gate.db, 'auto_discovery_settings').catch(() => null);
  const state = await getAppSetting<any>(gate.db, 'auto_discovery_state').catch(() => null);
  const metrics = await getAppSetting<any>(gate.db, 'auto_discovery_metrics').catch(() => null);
  return c.json({ ok: true, settings: settings ?? {}, state: state ?? {}, metrics: metrics ?? { runs: [] } });
});

adminRoutes.get('/probe_queue_stats', async (c) => {
  const gate = await requireAdmin(c);
  if (!gate.ok || !gate.db) return gate.res!;

  const hours = Math.max(1, Math.min(168, Number(c.req.query('hours') ?? 24)));

  const exists = await gate.db.execute(sql`select to_regclass('public.domain_probe_queue') as t`).catch(() => ({ rows: [] as any[] }));
  if (!((exists.rows as any[])[0]?.t)) return c.json({ ok: false, error: 'SCHEMA_NOT_PATCHED' }, 400);

  const counts = await gate.db.execute(sql`
    select status, count(*)::int as c
    from public.domain_probe_queue
    where created_at >= now() - (${hours}::int * interval '1 hour')
    group by status
  `).catch(() => ({ rows: [] as any[] }));

  const topFailed = await gate.db.execute(sql`
    select source_domain as domain,
           count(*)::int as failed,
           max(completed_at) as last_failed_at,
           (array_agg(last_error_code order by completed_at desc))[1] as last_error_code
    from public.domain_probe_queue
    where created_at >= now() - (${hours}::int * interval '1 hour')
      and status = 'failed'
    group by 1
    order by failed desc
    limit 50
  `).catch(() => ({ rows: [] as any[] }));

  const rec = (code: string) => {
    switch (code) {
      case 'BOT_CHALLENGE': return 'Captcha/Bot: قلّل الزحف وفعّل budgets أو عطّل المصدر (لا bypass).';
      case 'HTTP_429': return 'Rate limit: قلّل perDomain/concurrency وفعّل budgets.';
      case 'HTTP_403': return 'Blocked 403: غالباً حظر. خفّف الزحف أو عطّل المصدر فترة أطول.';
      case 'TIMEOUT': return 'Timeout: قلّل concurrency وزِد timeout للدومين.';
      case 'DNS_ERROR': return 'DNS/Down: الموقع غير متاح. عطّله فترة أطول.';
      default: return 'تحقق من المصدر.';
    }
  };

  return c.json({
    ok: true,
    hours,
    counts: counts.rows ?? [],
    top_failed: ((topFailed.rows as any[]) ?? []).map((r) => ({
      domain: String(r.domain),
      failed: Number(r.failed ?? 0),
      last_failed_at: r.last_failed_at,
      last_error_code: r.last_error_code,
      recommendation: rec(String(r.last_error_code ?? '')),
    })),
  });
});

adminRoutes.get('/probe_queue', async (c) => {
  const gate = await requireAdmin(c);
  if (!gate.ok || !gate.db) return gate.res!;

  const status = String(c.req.query('status') ?? 'pending');
  const domain = c.req.query('domain');
  const limit = Math.max(1, Math.min(200, Number(c.req.query('limit') ?? 50)));

  const r = await gate.db.execute(sql`
    select
      id::text as id,
      source_domain,
      probe_url,
      status,
      priority,
      error_count,
      next_retry_at,
      last_http_status,
      last_error_code,
      last_error,
      created_at,
      updated_at,
      claimed_at,
      completed_at
    from public.domain_probe_queue
    where status = ${status}
      ${domain ? sql`and source_domain = ${String(domain)}` : sql``}
    order by updated_at desc
    limit ${limit}
  `).catch(() => ({ rows: [] as any[] }));

  return c.json({ ok: true, status, items: r.rows ?? [] });
});

const addSourceSchema = z.object({
  name_ar: z.string().min(1),
  domain: z.string().min(1),
  source_kind: z.string().min(1),
  trust_weight: z.number().min(0).max(1),
  base_url: z.string().nullable().optional(),
  logo_url: z.string().nullable().optional(),
});

const DEFAULT_PRODUCT_REGEX = String.raw`\/(product|products|p|item|dp)\/`;
const DEFAULT_CATEGORY_REGEX = String.raw`\/(category|categories|collections|shop|store|department|c|offers)\/`;

adminRoutes.post('/price_sources', async (c) => {
  const gate = await requireAdmin(c);
  if (!gate.ok || !gate.db) return gate.res!;
  const payload = addSourceSchema.parse(await c.req.json());

  const domain = payload.domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '');
  const baseUrl = (payload.base_url?.trim() || `https://${domain}`).replace(/\/$/, '');

  const inserted = await gate.db.execute(sql`
    insert into public.price_sources (name_ar, domain, source_kind, trust_weight, base_url, logo_url, is_active, country_code)
    values (
      ${payload.name_ar.trim()},
      ${domain},
      ${payload.source_kind},
      ${payload.trust_weight},
      ${baseUrl},
      ${payload.logo_url?.trim() || null},
      true,
      'IQ'
    )
    returning id, domain
  `);

  const sourceId = (inserted.rows as any[])[0]?.id;

  await gate.db.execute(sql`
    insert into public.domain_url_patterns (domain, product_regex, category_regex)
    values (${domain}, ${DEFAULT_PRODUCT_REGEX}, ${DEFAULT_CATEGORY_REGEX})
    on conflict (domain) do update set
      product_regex = excluded.product_regex,
      category_regex = excluded.category_regex
  `);

  await gate.db.execute(sql`
    insert into public.source_entrypoints (domain, url, page_type, priority, is_active)
    values (${domain}, ${baseUrl}, 'category', 10, true)
    on conflict (domain, url) do update set
      is_active = true,
      priority = excluded.priority
  `);

  // Ensure a baseline adapter exists
  const existing = await gate.db.execute(sql`
    select id from public.source_adapters
    where source_id = ${sourceId}::uuid and adapter_type = 'jsonld'
    limit 1
  `);

  if (!(existing.rows as any[])[0]?.id) {
    await gate.db.execute(sql`
      insert into public.source_adapters (source_id, adapter_type, priority, is_active, selectors)
      values (
        ${sourceId}::uuid,
        'jsonld',
        10,
        true,
        ${JSON.stringify({
          productName: ['jsonld.name', 'meta:og:title'],
          description: ['jsonld.description', 'jsonld.offers.description'],
          price: ['jsonld.offers.price', 'jsonld.offers.lowPrice', 'meta:product:price:amount'],
          currency: ['jsonld.offers.priceCurrency', 'meta:product:price:currency'],
          image: ['jsonld.image', 'meta:og:image'],
          inStock: ['jsonld.offers.availability'],
        })}::jsonb
      )
    `);
  }

  return c.json({ id: sourceId, domain });
});

adminRoutes.patch('/price_sources/:id', async (c) => {
  const gate = await requireAdmin(c);
  if (!gate.ok || !gate.db) return gate.res!;
  const id = c.req.param('id');
  const patch = z.record(z.any()).parse(await c.req.json());

  // Only allow a safe subset of fields.
  const allowed = ['is_active', 'trust_weight', 'name_ar', 'logo_url', 'base_url', 'source_kind', 'render_budget_per_hour', 'render_cache_ttl_min', 'render_stale_serve_min', 'js_only', 'js_only_reason', 'js_only_hits', 'last_js_shell_at', 'probe_enabled', 'render_paused_until'];
  const entries = Object.entries(patch).filter(([k]) => allowed.includes(k));
  if (entries.length === 0) return c.json({ ok: true });

  // Build dynamic SET list safely.
  const sets = entries.map(([k, v]) => sql`${sql.raw(k)} = ${v}`);

  await gate.db.execute(sql`
    update public.price_sources
    set ${sql.join(sets, sql`, `)}
    where id = ${id}::uuid
  `);

  return c.json({ ok: true });
});

adminRoutes.get('/ingestion_runs', async (c) => {
  const gate = await requireAdmin(c);
  if (!gate.ok || !gate.db) return gate.res!;
  const r = await gate.db.execute(sql`
    select run_id,function_name,status,processed,succeeded,failed,started_at,ended_at,notes
    from public.ingestion_runs
    order by started_at desc
    limit 25
  `);
  return c.json(r.rows ?? []);
});

adminRoutes.get('/ingestion_errors', async (c) => {
  const gate = await requireAdmin(c);
  if (!gate.ok || !gate.db) return gate.res!;
  const r = await gate.db.execute(sql`
    select created_at,source_domain,url,error_code,http_status,blocked_reason,error_message
    from public.ingestion_error_events
    order by created_at desc
    limit 50
  `);
  return c.json(r.rows ?? []);
});

adminRoutes.get('/site_plugins', async (c) => {
  const gate = await requireAdmin(c);
  if (!gate.ok || !gate.db) return gate.res!;

  // v_site_plugins may not exist in early schema versions.
  const r = await gate.db.execute(sql`
    select * from public.v_site_plugins order by domain asc
  `).catch(() => ({ rows: [] as any[] }));

  return c.json(r.rows ?? []);
});

// -----------------------------
// Category overrides (admin-managed)
// -----------------------------

adminRoutes.get('/category_overrides', async (c) => {
  const gate = await requireAdmin(c);
  if (!gate.ok || !gate.db) return gate.res!;
  const r = await gate.db.execute(sql`
    select *
    from public.category_overrides
    order by is_active desc, priority asc, created_at desc
    limit 500
  `).catch(() => ({ rows: [] as any[] }));
  return c.json(r.rows ?? []);
});

const upsertCategoryOverrideSchema = z.object({
  match_kind: z.enum(['source_id', 'domain', 'pattern']),
  match_value: z.string().min(1),
  category: z.string().min(1),
  subcategory: z.string().optional().nullable(),
  priority: z.number().int().min(0).max(100000).optional(),
  lock_category: z.boolean().optional(),
  lock_subcategory: z.boolean().optional(),
  is_active: z.boolean().optional(),
  note: z.string().max(500).optional().nullable(),
});

adminRoutes.post('/category_overrides', async (c) => {
  const gate = await requireAdmin(c);
  if (!gate.ok || !gate.db) return gate.res!;
  const body = upsertCategoryOverrideSchema.parse(await c.req.json());
  const r = await gate.db.execute(sql`
    insert into public.category_overrides (
      match_kind, match_value, category, subcategory,
      priority, lock_category, lock_subcategory, is_active, note
    ) values (
      ${body.match_kind},
      ${body.match_value.trim()},
      ${body.category.trim()},
      ${body.subcategory ? String(body.subcategory).trim() : null},
      ${body.priority ?? 100},
      ${body.lock_category ?? true},
      ${body.lock_subcategory ?? true},
      ${body.is_active ?? true},
      ${body.note ?? null}
    )
    returning id
  `);
  return c.json({ ok: true, id: (r.rows as any[])[0]?.id ?? null });
});

adminRoutes.patch('/category_overrides/:id', async (c) => {
  const gate = await requireAdmin(c);
  if (!gate.ok || !gate.db) return gate.res!;
  const id = c.req.param('id');
  const patch = z.record(z.any()).parse(await c.req.json());
  const allowed = ['match_kind', 'match_value', 'category', 'subcategory', 'priority', 'lock_category', 'lock_subcategory', 'is_active', 'note'];
  const entries = Object.entries(patch).filter(([k]) => allowed.includes(k));
  if (!entries.length) return c.json({ ok: true });
  const sets = entries.map(([k, v]) => sql`${sql.raw(k)} = ${v}`);
  await gate.db.execute(sql`
    update public.category_overrides
    set ${sql.join(sets, sql`, `)}, updated_at = now()
    where id = ${id}::uuid
  `);
  return c.json({ ok: true });
});

adminRoutes.delete('/category_overrides/:id', async (c) => {
  const gate = await requireAdmin(c);
  if (!gate.ok || !gate.db) return gate.res!;
  const id = c.req.param('id');
  await gate.db.execute(sql`delete from public.category_overrides where id = ${id}::uuid`).catch(() => {});
  return c.json({ ok: true });
});

// -----------------------------
// Source health monitor (metrics + auto-disable)
// -----------------------------

adminRoutes.get('/source_health', async (c) => {
  const gate = await requireAdmin(c);
  if (!gate.ok || !gate.db) return gate.res!;
  const hours = Math.max(6, Math.min(168, Number(c.req.query('hours') ?? 24)));

  let r: any;
  try {
    r = await gate.db.execute(sql`
    with src as (
      select id, domain, name_ar, is_active,
             trust_weight,
             lifecycle_status,
             crawl_enabled,
             validation_state,
             validation_score,
             last_probe_at,
             validated_at,
             activated_at,
             discovered_via,
             discovery_tags,
             
             trust_weight_dynamic,
             coalesce(trust_weight_dynamic, trust_weight) as trust_effective,
             trust_score_meta,
             coalesce(auto_disabled,false) as auto_disabled,
             auto_disabled_reason, auto_disabled_at, auto_recovered_at,
             disabled_until, disable_level, paused_until,
             budget_per_hour, budget_used,
             last_error_code, last_http_status,
             last_ingest_success_at, last_ingest_failure_at
      from public.price_sources
      where country_code = 'IQ'
    ),
    ok as (
      select source_id, count(*)::int as successes, max(created_at) as last_success_at,
             sum(case when coalesce(is_price_anomaly,false) then 1 else 0 end)::int as anomalies
      from public.source_price_observations
      where created_at >= now() - (${hours}::int * interval '1 hour')
      group by source_id
    ),
    err as (
      select source_domain, count(*)::int as failures, max(created_at) as last_error_at
      from public.ingestion_error_events
      where created_at >= now() - (${hours}::int * interval '1 hour')
      group by source_domain
    )
    select
      s.*,
      coalesce(ok.successes,0) as successes,
      coalesce(err.failures,0) as failures,
      case when (coalesce(ok.successes,0)+coalesce(err.failures,0)) = 0 then null
           else round(err.failures::numeric / (ok.successes + err.failures), 2) end as error_rate,
      ok.last_success_at,
      err.last_error_at,
      case when coalesce(ok.successes,0) = 0 then null else round(ok.anomalies::numeric / ok.successes, 2) end as anomaly_rate
    from src s
    left join ok on ok.source_id = s.id
    left join err on err.source_domain = s.domain
    order by coalesce(error_rate,0) desc, failures desc, successes desc
  `);
  } catch (e: any) {
    const message = String(e?.message ?? e ?? 'unknown');
    return c.json(
      {
        error: 'SOURCE_HEALTH_FAILED',
        message,
        hint:
          'DB schema mismatch. Re-run start-windows.bat to apply compatibility patches. If you upgraded from an older DB volume, run: docker compose down -v (will reset DB) and start again.',
      },
      500
    );
  }

  return c.json({ hours, sources: r.rows ?? [] });
});

// Coverage stats: how many active sources per province/sector (based on discovery_tags)
adminRoutes.get('/coverage_stats', async (c) => {
  const gate = await requireAdmin(c);
  if (!gate.ok || !gate.db) return gate.res!;
  const onlyActive = String(c.req.query('active') ?? '1') !== '0';

  const activeClause = onlyActive ? sql`and is_active = true` : sql``;

  const summary = await gate.db
    .execute(sql`
      with src as (
        select id, discovery_tags
        from public.price_sources
        where country_code = 'IQ'
        ${activeClause}
      )
      select
        count(*)::int as total,
        sum(
          case
            when coalesce(jsonb_array_length(coalesce(discovery_tags->'provinces','[]'::jsonb)), 0) = 0 then 1
            else 0
          end
        )::int as missing_provinces,
        sum(
          case
            when coalesce(jsonb_array_length(coalesce(discovery_tags->'sectors','[]'::jsonb)), 0) = 0 then 1
            else 0
          end
        )::int as missing_sectors
      from src
    `)
    .catch(() => ({ rows: [] as any[] }));

  const provinces = await gate.db
    .execute(sql`
      with src as (
        select discovery_tags
        from public.price_sources
        where country_code = 'IQ'
        ${activeClause}
      )
      select lower(trim(p)) as province, count(*)::int as sources
      from src, lateral jsonb_array_elements_text(coalesce(src.discovery_tags->'provinces', '[]'::jsonb)) as p
      group by 1
      order by sources asc, province asc
    `)
    .catch(() => ({ rows: [] as any[] }));

  const sectors = await gate.db
    .execute(sql`
      with src as (
        select discovery_tags
        from public.price_sources
        where country_code = 'IQ'
        ${activeClause}
      )
      select lower(trim(s)) as sector, count(*)::int as sources
      from src, lateral jsonb_array_elements_text(coalesce(src.discovery_tags->'sectors', '[]'::jsonb)) as s
      group by 1
      order by sources asc, sector asc
    `)
    .catch(() => ({ rows: [] as any[] }));

  return c.json({
    onlyActive,
    summary: (summary.rows ?? [])[0] ?? { total: 0, missing_provinces: 0, missing_sectors: 0 },
    provinces: provinces.rows ?? [],
    sectors: sectors.rows ?? [],
  });
});

// List sources missing province/sector tags (for quick manual edits)
adminRoutes.get('/sources_missing_tags', async (c) => {
  const gate = await requireAdmin(c);
  if (!gate.ok || !gate.db) return gate.res!;
  const kind = String(c.req.query('kind') ?? 'provinces');
  const limit = Math.max(1, Math.min(300, Number(c.req.query('limit') ?? 80)));

  const clause = kind === 'sectors'
    ? sql`coalesce(jsonb_array_length(coalesce(discovery_tags->'sectors','[]'::jsonb)),0) = 0`
    : sql`coalesce(jsonb_array_length(coalesce(discovery_tags->'provinces','[]'::jsonb)),0) = 0`;

  const r = await gate.db
    .execute(sql`
      select id, domain, is_active, discovery_tags
      from public.price_sources
      where country_code = 'IQ'
        and is_active = true
        and ${clause}
      order by domain asc
      limit ${limit}::int
    `)
    .catch(() => ({ rows: [] as any[] }));

  return c.json({ kind: kind === 'sectors' ? 'sectors' : 'provinces', limit, sources: r.rows ?? [] });
});

// Review queue: sources where catalog sector inference was low-confidence (quality gate)
adminRoutes.get('/sector_review_queue', async (c) => {
  const gate = await requireAdminOrInternal(c);
  if (!gate.ok || !gate.db) return gate.res!;
  const limit = Math.max(1, Math.min(300, Number(c.req.query('limit') ?? 80)));

  const r = await gate.db
    .execute(sql`
      select
        id,
        domain,
        base_url,
        discovery_tags->'sectors' as sectors,
        discovery_tags->'needs_review'->'sectors_catalog' as review
      from public.price_sources
      where country_code='IQ'
        and (discovery_tags->'needs_review'->'sectors_catalog') is not null
      order by coalesce((discovery_tags->'needs_review'->'sectors_catalog'->>'computed_at')::timestamptz, updated_at, created_at) desc
      limit ${limit}::int
    `)
    .catch(() => ({ rows: [] as any[] }));

  return c.json({ ok: true, limit, sources: r.rows ?? [] });
});

// Accept a catalog sector suggestion for a source (writes sectors + clears review flag)
const acceptCatalogSectorSchema = z.object({
  id: z.string().min(10),
  sector: z.string().optional(),
  mode: z.enum(['merge', 'replace']).optional(),
});

adminRoutes.post('/jobs/accept_sector_catalog_suggestion', async (c) => {
  const gate = await requireAdminOrInternal(c);
  if (!gate.ok || !gate.db) return gate.res!;
  const body = acceptCatalogSectorSchema.parse(await c.req.json().catch(() => ({})));
  const id = body.id;
  const mode = body.mode ?? 'merge';

  const cur = await gate.db.execute(sql`select discovery_tags from public.price_sources where id=${id}::uuid`);
  const tags = ((cur.rows as any[])[0]?.discovery_tags ?? {}) as any;
  const review = tags?.needs_review?.sectors_catalog;
  const suggested = (review?.suggested ?? []) as any[];
  const pick = String(body.sector ?? suggested?.[0]?.sector ?? '').trim();
  if (!pick) return c.json({ ok: false, error: 'NO_SUGGESTION' }, 400);

  const curSec = Array.isArray(tags?.sectors) ? tags.sectors.map((x: any) => String(x).trim()).filter(Boolean) : [];
  const nextSec = mode === 'replace' ? [pick] : Array.from(new Set([...curSec, pick]));

  // Ensure manual container exists
  if (!tags.manual) tags.manual = {};
  // preserve manual settings; we do not auto-write to manual

  tags.sectors = nextSec;
  if (tags.needs_review?.sectors_catalog) delete tags.needs_review.sectors_catalog;

  await gate.db.execute(sql`
    update public.price_sources
    set discovery_tags=${JSON.stringify(tags)}::jsonb
    where id=${id}::uuid
  `);

  return c.json({ ok: true, id, sectors: nextSec, applied: pick, mode });
});

// Run the catalog sector auto-run daily job (force run when needed)
adminRoutes.post('/jobs/auto_tag_sectors_catalog_daily', async (c) => {
  const gate = await requireAdminOrInternal(c);
  if (!gate.ok || !gate.db) return gate.res!;
  const body = await c.req.json().catch(() => ({}));
  const force = Boolean((body as any).force ?? false);
  const result = await autoTagSectorsCatalogDaily(c.env, { force });
  return c.json(result);
});

// Status of last auto catalog-sector tagging run
adminRoutes.get('/auto_sector_catalog_status', async (c) => {
  const gate = await requireAdminOrInternal(c);
  if (!gate.ok || !gate.db) return gate.res!;
  const st = await getAppSetting<any>(gate.db, 'auto_sector_catalog_last_day');
  return c.json({ ok: true, state: st ?? null });
});

// Manual tags override (provinces/sectors)
const patchSourceTagsSchema = z.object({
  provinces: z.array(z.string()).optional(),
  sectors: z.array(z.string()).optional(),
  mode: z.enum(['merge', 'replace']).optional(),
});

adminRoutes.patch('/price_sources/:id/tags', async (c) => {
  const gate = await requireAdmin(c);
  if (!gate.ok || !gate.db) return gate.res!;
  const id = c.req.param('id');
  const body = patchSourceTagsSchema.parse(await c.req.json());
  const mode = body.mode ?? 'merge';

  const cur = await gate.db.execute(sql`select discovery_tags from public.price_sources where id = ${id}::uuid`);
  const existing = (cur.rows as any[])[0]?.discovery_tags ?? {};

  const curProv = Array.isArray(existing?.provinces) ? existing.provinces.map((x: any) => String(x).trim().toLowerCase()).filter(Boolean) : [];
  const curSec = Array.isArray(existing?.sectors) ? existing.sectors.map((x: any) => String(x).trim().toLowerCase()).filter(Boolean) : [];

  const nextProvIn = (body.provinces ?? []).map((x) => String(x).trim().toLowerCase()).filter(Boolean);
  const nextSecIn = (body.sectors ?? []).map((x) => String(x).trim().toLowerCase()).filter(Boolean);

  const nextProv = mode === 'replace' ? nextProvIn : Array.from(new Set([...curProv, ...nextProvIn]));
  const nextSec = mode === 'replace' ? nextSecIn : Array.from(new Set([...curSec, ...nextSecIn]));

  const manual = { provinces: nextProv, sectors: nextSec, mode, updated_at: new Date().toISOString() };

  await gate.db.execute(sql`
    update public.price_sources
    set discovery_tags = jsonb_set(
          jsonb_set(
            jsonb_set(
              coalesce(discovery_tags,'{}'::jsonb),
              '{manual}',
              ${JSON.stringify(manual)}::jsonb,
              true
            ),
            '{provinces}',
            ${JSON.stringify(nextProv)}::jsonb,
            true
          ),
          '{sectors}',
          ${JSON.stringify(nextSec)}::jsonb,
          true
        )
    where id = ${id}::uuid
  `);

  return c.json({ ok: true, id, provinces: nextProv, sectors: nextSec, mode });
});

// Manual override: force enable/disable a domain (reversible)
const sourceHealthOverrideSchema = z.object({
  domain: z.string().min(2),
  action: z.enum(['enable', 'disable']),
  minutes: z.number().int().min(5).max(7 * 24 * 60).optional(),
  reason: z.string().optional().nullable(),
});

adminRoutes.post('/source_health_override', async (c) => {
  const gate = await requireAdmin(c);
  if (!gate.ok || !gate.db) return gate.res!;
  const body = sourceHealthOverrideSchema.parse(await c.req.json());
  const domain = String(body.domain).toLowerCase();
  const action = body.action;

  if (action === 'enable') {
    await gate.db.execute(sql`
      update public.price_sources
      set auto_disabled=false,
          auto_disabled_reason=null,
          auto_recovered_at=now(),
          auto_disabled_at=null,
          disabled_until=null,
          disable_level=0,
          paused_until=null,
          consecutive_failures=0,
          consecutive_bot_challenges=0,
          consecutive_403=0,
          consecutive_429=0,
          consecutive_timeouts=0,
          consecutive_dns_errors=0
      where domain=${domain}
    `);
    return c.json({ ok: true, domain, action: 'enable' });
  }

  const minutes = Math.max(5, Math.min(7 * 24 * 60, Number(body.minutes ?? 24 * 60)));
  const reason = String(body.reason ?? 'manual_disable');

  await gate.db.execute(sql`
    update public.price_sources
    set auto_disabled=true,
        auto_disabled_reason=${reason},
        auto_disabled_at=now(),
        auto_recovered_at=null,
        disabled_until = now() + make_interval(mins => ${minutes}),
        disable_level = greatest(coalesce(disable_level,0), 1)
    where domain=${domain}
  `);

  return c.json({ ok: true, domain, action: 'disable', minutes, reason });
});

adminRoutes.post('/jobs/health_scan', async (c) => {
  const gate = await requireAdminOrInternal(c);
  if (!gate.ok || !gate.db) return gate.res!;
  const body = await c.req.json().catch(() => ({}));
  const hours = Math.max(6, Math.min(168, Number((body as any).hours ?? 24)));

  const metrics = await gate.db.execute(sql`
    with src as (
      select id, domain, name_ar, is_active,
             trust_weight,
             lifecycle_status,
             crawl_enabled,
             validation_state,
             validation_score,
             last_probe_at,
             validated_at,
             activated_at,
             discovered_via,
             discovery_tags,
             
             trust_weight_dynamic,
             coalesce(trust_weight_dynamic, trust_weight) as trust_effective,
             coalesce(auto_disabled,false) as auto_disabled,
             coalesce(auto_disabled_forced_inactive,false) as forced,
             auto_disabled_reason,
             disabled_until,
             disable_level,
             paused_until,
             budget_per_hour,
             budget_used,
             last_error_code,
             last_http_status,
             last_ingest_success_at,
             last_ingest_failure_at
      from public.price_sources
      where country_code='IQ'
    ),
    ok as (
      select source_id, count(*)::int as successes, max(created_at) as last_success_at
      from public.source_price_observations
      where created_at >= now() - (${hours}::int * interval '1 hour')
      group by source_id
    ),
    err as (
      select source_domain, count(*)::int as failures, max(created_at) as last_error_at
      from public.ingestion_error_events
      where created_at >= now() - (${hours}::int * interval '1 hour')
      group by source_domain
    )
    select
      s.id, s.domain, s.name_ar, s.is_active, s.auto_disabled, s.forced,
      coalesce(ok.successes,0) as successes,
      coalesce(err.failures,0) as failures,
      case when (coalesce(ok.successes,0)+coalesce(err.failures,0)) = 0 then null
           else (err.failures::numeric / (ok.successes + err.failures)) end as error_rate,
      ok.last_success_at,
      err.last_error_at
    from src s
    left join ok on ok.source_id = s.id
    left join err on err.source_domain = s.domain
  `);

  let disabled = 0;
  let recovered = 0;
  const actions: any[] = [];

  for (const row of (metrics.rows as any[]) ?? []) {
    const successes = Number(row.successes ?? 0);
    const failures = Number(row.failures ?? 0);
    const errorRate = row.error_rate == null ? null : Number(row.error_rate);
    const isAutoDisabled = Boolean(row.auto_disabled);
    const forced = Boolean(row.forced);

    const disabledUntilMs = row.disabled_until ? new Date(row.disabled_until).getTime() : 0;
    const isBackoffActive = Boolean(disabledUntilMs && disabledUntilMs > Date.now());

    const shouldDisable = !isAutoDisabled && failures >= 20 && (successes <= 2 || (errorRate != null && errorRate >= 0.85));
    const shouldRecover = isAutoDisabled && !isBackoffActive && successes >= 5 && (errorRate == null || errorRate <= 0.60);

    if (shouldDisable) {
      const level = Math.min(10, Number(row.disable_level ?? 0) + 1);
      const baseMins = 360; // 6h backoff base for high error-rate sources
      const mins = Math.max(60, Math.min(7 * 24 * 60, Math.round(baseMins * Math.pow(2, level - 1))));

      const reason = `auto_disable: failures=${failures} successes=${successes} rate=${errorRate == null ? 'n/a' : errorRate.toFixed(2)} window=${hours}h level=${level} mins=${mins}`;
      await gate.db.execute(sql`
        update public.price_sources
        set auto_disabled=true,
            auto_disabled_reason=${reason},
            auto_disabled_at=now(),
            auto_recovered_at=null,
            disabled_until = greatest(coalesce(disabled_until, now()), now() + make_interval(mins => ${mins})),
            disable_level = ${level},
            paused_until = case when paused_until is not null and paused_until <= now() then null else paused_until end
        where id=${String(row.id)}::uuid
      `);
      disabled++;
      actions.push({ domain: row.domain, action: 'disabled', reason, disabled_until_minutes: mins });
    } else if (shouldRecover) {
      await gate.db.execute(sql`
        update public.price_sources
        set auto_disabled=false,
            auto_disabled_reason=null,
            auto_recovered_at=now(),
            auto_disabled_at=null,
            disabled_until=null,
            disable_level=0,
            paused_until=null,
            consecutive_failures=0,
            consecutive_bot_challenges=0,
            consecutive_403=0,
            consecutive_429=0,
            consecutive_timeouts=0,
            consecutive_dns_errors=0
        where id=${String(row.id)}::uuid
      `);
      recovered++;
      actions.push({ domain: row.domain, action: 'recovered' });
    }
  }

  return c.json({ ok: true, job: 'health_scan', window_hours: hours, result: { disabled, recovered, actions } });
});

// -----------------------------
// Crowd signals admin: recent reports + apply corrections
// -----------------------------

adminRoutes.get('/offer_reports', async (c) => {
  const gate = await requireAdmin(c);
  if (!gate.ok || !gate.db) return gate.res!;
  const limit = Math.max(10, Math.min(200, Number(c.req.query('limit') ?? 50)));
  const r = await gate.db.execute(sql`
    select
      r.created_at,
      r.report_type,
      r.severity,
      r.note,
      r.offer_id,
      p.name_ar as product_name_ar,
      ps.domain as source_domain,
      ps.name_ar as source_name_ar,
      spo.source_url,
      spo.price as base_price,
      coalesce(spo.discount_price, spo.price) as final_price
    from public.offer_reports r
    join public.source_price_observations spo on spo.id = r.offer_id
    join public.products p on p.id = spo.product_id
    join public.price_sources ps on ps.id = spo.source_id
    order by r.created_at desc
    limit ${limit}
  `);
  return c.json({ limit, items: r.rows ?? [] });
});

adminRoutes.post('/jobs/apply_offer_reports', async (c) => {
  const gate = await requireAdminOrInternal(c);
  if (!gate.ok || !gate.db) return gate.res!;
  const body = await c.req.json().catch(() => ({}));
  const days = Math.max(3, Math.min(90, Number((body as any).days ?? 30)));

  const r = await gate.db.execute(sql`
    with agg as (
      select offer_id,
             sum(case when report_type='wrong_price' then 1 else 0 end)::int as wrong_price,
             sum(case when report_type='unavailable' then 1 else 0 end)::int as unavailable,
             sum(case when report_type='duplicate' then 1 else 0 end)::int as duplicate,
             sum(case when report_type='other' then 1 else 0 end)::int as other
      from public.offer_reports
      where created_at >= now() - (${days}::int * interval '1 day')
      group by offer_id
    ), upd as (
      update public.source_price_observations spo
      set
        in_stock = case when agg.unavailable >= 3 then false else spo.in_stock end,
        is_price_anomaly = case when agg.wrong_price >= 3 then true else spo.is_price_anomaly end,
        anomaly_reason = case
          when agg.wrong_price >= 3 then coalesce(nullif(spo.anomaly_reason,''), 'crowd_wrong_price')
          else spo.anomaly_reason
        end,
        price_confidence = greatest(
          0.05,
          least(
            1,
            coalesce(spo.price_confidence,0.50)
            - least(0.50, (agg.wrong_price*0.12 + agg.unavailable*0.08 + agg.duplicate*0.05 + agg.other*0.03))
          )
        )
      from agg
      where spo.id = agg.offer_id
        and spo.observed_at >= now() - (${days}::int * interval '1 day')
      returning spo.id
    )
    select count(*)::int as updated from upd;
  `);

  const updated = (r.rows as any[])?.[0]?.updated ?? 0;
  // -----------------------------
// Price alerts dispatch (create notifications from triggered alerts)
// -----------------------------

const dispatchAlertsSchema = z.object({
  limit: z.number().int().min(1).max(500).optional(),
  cooldown_minutes: z.number().int().min(15).max(1440).optional(),
});

adminRoutes.post('/jobs/dispatch_price_alerts', async (c) => {
  const gate = await requireAdminOrInternal(c);
  if (!gate.ok || !gate.db) return gate.res!;
  const body = await c.req.json().catch(() => ({}));
  const parsed = dispatchAlertsSchema.safeParse(body);
  const limit = Math.max(1, Math.min(500, Number(parsed.success ? (parsed.data.limit ?? 200) : 200)));
  const cooldown = Math.max(15, Math.min(1440, Number(parsed.success ? (parsed.data.cooldown_minutes ?? 180) : 180)));

  const r = await gate.db.execute(sql`
    select count(*)::int as inserted
    from public.enqueue_triggered_price_alert_notifications(${limit}::int, ${cooldown}::int)
  `).catch(() => ({ rows: [{ inserted: 0 }] as any[] }));

  const inserted = Number((r.rows as any[])?.[0]?.inserted ?? 0);
  return c.json({ ok: true, job: 'dispatch_price_alerts', result: { inserted, limit, cooldown_minutes: cooldown } });
});

// -----------------------------
// Trust graph (dynamic trust weight) — recompute from health + anomalies + crowd signals
// -----------------------------

const trustRecomputeSchema = z.object({
  hours: z.number().int().min(6).max(720).optional(),
});

adminRoutes.post('/jobs/recompute_trust', async (c) => {
  const gate = await requireAdminOrInternal(c);
  if (!gate.ok || !gate.db) return gate.res!;
  const body = await c.req.json().catch(() => ({}));
  const parsed = trustRecomputeSchema.safeParse(body);
  const hours = Math.max(6, Math.min(720, Number(parsed.success ? (parsed.data.hours ?? 168) : 168)));

  // Ensure columns exist (older DBs) — if not, return a safe message.
  try {
    await gate.db.execute(sql`
      alter table public.price_sources
        add column if not exists trust_weight_dynamic numeric(3,2),
        add column if not exists trust_last_scored_at timestamptz,
        add column if not exists trust_score_meta jsonb
    `);
  } catch {
    // ignore
  }

  const r = await gate.db.execute(sql`
    with ok as (
      select source_id,
             count(*)::int as successes,
             sum(case when coalesce(is_price_anomaly,false) then 1 else 0 end)::int as anomalies
      from public.source_price_observations
      where created_at >= now() - (${hours}::int * interval '1 hour')
      group by source_id
    ),
    err as (
      select source_domain,
             count(*)::int as failures
      from public.ingestion_error_events
      where created_at >= now() - (${hours}::int * interval '1 hour')
      group by source_domain
    ),
    rep as (
      select spo.source_id,
             sum(case when r.report_type='wrong_price' then 1 else 0 end)::int as wrong_price,
             sum(case when r.report_type='unavailable' then 1 else 0 end)::int as unavailable,
             sum(case when r.report_type='duplicate' then 1 else 0 end)::int as duplicate,
             sum(case when r.report_type='other' then 1 else 0 end)::int as other,
             count(*)::int as total
      from public.offer_reports r
      join public.source_price_observations spo on spo.id = r.offer_id
      where r.created_at >= now() - (${hours}::int * interval '1 hour')
      group by spo.source_id
    ),
    calc as (
      select
        ps.id,
        coalesce(ps.trust_weight, 0.50)::numeric as base,
        coalesce(ok.successes,0)::int as successes,
        coalesce(ok.anomalies,0)::int as anomalies,
        coalesce(err.failures,0)::int as failures,
        coalesce(rep.wrong_price,0)::int as wrong_price,
        coalesce(rep.unavailable,0)::int as unavailable,
        coalesce(rep.duplicate,0)::int as duplicate,
        coalesce(rep.other,0)::int as other,
        coalesce(rep.total,0)::int as reports_total,
        case when (coalesce(ok.successes,0) + coalesce(err.failures,0)) = 0 then 0
             else (coalesce(err.failures,0)::numeric / (coalesce(ok.successes,0) + coalesce(err.failures,0))) end as error_rate,
        case when coalesce(ok.successes,0) = 0 then 0
             else (coalesce(ok.anomalies,0)::numeric / ok.successes) end as anomaly_rate
      from public.price_sources ps
      left join ok on ok.source_id = ps.id
      left join err on err.source_domain = ps.domain
      left join rep on rep.source_id = ps.id
      where ps.country_code='IQ'
    ),
    upd as (
      update public.price_sources ps
      set
        trust_weight_dynamic = greatest(
          0.10,
          least(
            1,
            c.base
            - least(0.30, (c.wrong_price*0.02 + c.unavailable*0.01 + c.duplicate*0.01 + c.other*0.005))
            - least(0.20, (c.anomaly_rate * 0.25))
            - least(0.30, (c.error_rate * 0.30))
          )
        )::numeric(3,2),
        trust_last_scored_at = now(),
        trust_score_meta = jsonb_build_object(
          'window_hours', ${hours}::int,
          'base', c.base,
          'successes', c.successes,
          'failures', c.failures,
          'error_rate', round(c.error_rate::numeric, 2),
          'anomalies', c.anomalies,
          'anomaly_rate', round(c.anomaly_rate::numeric, 2),
          'reports', jsonb_build_object(
            'total', c.reports_total,
            'wrong_price', c.wrong_price,
            'unavailable', c.unavailable,
            'duplicate', c.duplicate,
            'other', c.other
          ),
          'computed_at', now()
        )
      from calc c
      where ps.id = c.id
      returning ps.id
    )
    select count(*)::int as updated from upd;
  `);

  const updated = Number((r.rows as any[])?.[0]?.updated ?? 0);
  return c.json({ ok: true, job: 'recompute_trust', result: { updated, window_hours: hours } });
});

return c.json({ ok: true, job: 'apply_offer_reports', result: { days, updated } });
});

// -----------------------------
// Smart import: add any URL (creates source if missing)
// -----------------------------

const smartImportSchema = z.object({
  url: z.string().min(5),
  name_ar: z.string().optional().nullable(),
  source_kind: z.string().optional().nullable(),
  trust_weight: z.number().min(0).max(1).optional().nullable(),
});

adminRoutes.post('/smart_import_url', async (c) => {
  const gate = await requireAdmin(c);
  if (!gate.ok || !gate.db) return gate.res!;
  const body = smartImportSchema.parse(await c.req.json());
  const parsed = normalizeUrl(body.url);
  if (!parsed.url || !parsed.domain) return c.json({ error: 'BAD_URL' }, 400);

  const domain = parsed.domain;
  const url = parsed.url;

  // Ensure source exists (create minimal row if missing)
  const existing = await gate.db.execute(sql`select id from public.price_sources where domain=${domain} limit 1`);
  let sourceId = (existing.rows as any[])[0]?.id as string | undefined;

  if (!sourceId) {
    const kind = ['retailer','marketplace','official'].includes(String(body.source_kind ?? '').toLowerCase())
      ? String(body.source_kind).toLowerCase()
      : 'retailer';
    const trust = Math.max(0, Math.min(1, Number(body.trust_weight ?? 0.5)));
    const baseUrl = `https://${domain}`;
    const ins = await gate.db.execute(sql`
      insert into public.price_sources (name_ar, domain, source_kind, trust_weight, is_active, country_code, base_url)
      values (${String(body.name_ar ?? domain)}, ${domain}, ${kind}, ${trust}, true, 'IQ', ${baseUrl})
      returning id
    `);
    sourceId = (ins.rows as any[])[0]?.id;

    await gate.db.execute(sql`
      insert into public.domain_url_patterns (domain, product_regex, category_regex)
      values (${domain}, ${DEFAULT_PRODUCT_REGEX}, ${DEFAULT_CATEGORY_REGEX})
      on conflict (domain) do update set
        product_regex = excluded.product_regex,
        category_regex = excluded.category_regex
    `);
  }

  // Classify
  const pat = await gate.db.execute(sql`
    select product_regex, category_regex
    from public.domain_url_patterns
    where domain = ${domain}
    limit 1
  `);
  const prodRe = safeRegex(String((pat.rows as any[])[0]?.product_regex ?? DEFAULT_PRODUCT_REGEX), /\/product\//i);
  const catRe = safeRegex(String((pat.rows as any[])[0]?.category_regex ?? DEFAULT_CATEGORY_REGEX), /\/category\//i);
  const pageType = prodRe.test(url) ? 'product' : (catRe.test(url) ? 'category' : 'unknown');

  if (pageType === 'category' || pageType === 'unknown') {
    await gate.db.execute(sql`
      insert into public.source_entrypoints (domain, url, page_type, priority, is_active)
      values (${domain}, ${url}, 'category', 5, true)
      on conflict (domain, url) do update set
        is_active = true,
        priority = excluded.priority,
        updated_at = now()
    `);
  } else {
    await gate.db.execute(sql`
      insert into public.crawl_frontier (source_domain, url, page_type, depth, parent_url, status, discovered_from)
      values (${domain}, ${url}, 'product', 0, null, 'pending', 'smart_import')
      on conflict (url_hash) do update set
        status = 'pending',
        last_error = null,
        updated_at = now(),
        discovered_from = 'smart_import'
    `);
  }

  return c.json({ ok: true, domain, source_id: sourceId, url, classified_as: pageType });
});

// -----------------------------
// Jobs (Seed → APIs → Ingest → Images)
// -----------------------------

adminRoutes.post('/jobs/seed', async (c) => {
  const gate = await requireAdminOrInternal(c);
  if (!gate.ok || !gate.db) return gate.res!;
  const body = await c.req.json().catch(() => ({}));
  // Higher defaults to support real coverage. These are per-run budgets.
  const maxUrls = Number((body as any).limit ?? 20000);
  const sitemapMaxPerDomain = Number((body as any).sitemapMaxPerDomain ?? 20000);
  const result = await seedCrawlFrontier(c.env, { maxUrls, sitemapMaxPerDomain });
  return c.json({ ok: true, job: 'seed', result });
});

adminRoutes.post('/jobs/apis', async (c) => {
  const gate = await requireAdminOrInternal(c);
  if (!gate.ok || !gate.db) return gate.res!;
  const body = await c.req.json().catch(() => ({}));
  const domain = (body as any).domain ? normalizeDomain(String((body as any).domain)) : undefined;
  const maxPages = Number((body as any).maxPages ?? 3);
  const result = await discoverProductApis(c.env, { domain, ingestNow: true, maxPages });
  return c.json({ ok: true, job: 'apis', result });
});

adminRoutes.post('/jobs/ingest', async (c) => {
  const gate = await requireAdminOrInternal(c);
  if (!gate.ok || !gate.db) return gate.res!;
  const body = await c.req.json().catch(() => ({}));
  const limit = Number((body as any).limit ?? 200);
  const concurrency = Number((body as any).concurrency ?? 16);
  const perDomain = Number((body as any).perDomain ?? 40);
  const result = await ingestProductPages(c.env, { limit, concurrency, perDomain });
  return c.json({ ok: true, job: 'ingest', result });
});

adminRoutes.post('/jobs/images', async (c) => {
  const gate = await requireAdminOrInternal(c);
  if (!gate.ok || !gate.db) return gate.res!;
  const body = await c.req.json().catch(() => ({}));
  const limit = Number((body as any).limit ?? 10);
  const result = await recrawlProductImages(c.env, { limit });
  return c.json({ ok: true, job: 'images', result });
});

adminRoutes.post('/jobs/run_all', async (c) => {
  const gate = await requireAdminOrInternal(c);
  if (!gate.ok || !gate.db) return gate.res!;
  const body = await c.req.json().catch(() => ({}));
  const ingestLimit = Number((body as any).ingestLimit ?? 50);
  const imagesLimit = Number((body as any).imagesLimit ?? 10);
  const maxPages = Number((body as any).maxPages ?? 3);

  const seed = await seedCrawlFrontier(c.env);
  const apis = await discoverProductApis(c.env, { ingestNow: true, maxPages });

  // Recover probes (best-effort): if the schema isn't applied, these return ok:false and we continue.
  const probe_seed = await seedProbeQueue(c.env, { limitDomains: 200 }).catch(() => ({ ok: false }));
  const probe_run = await runProbeQueue(c.env, { limit: 50, concurrency: 2 }).catch(() => ({ ok: false }));

  // Render queue maintenance (best-effort)
  const render_cleanup = await cleanupRenderCache(c.env, { maxAgeDays: 7 }).catch(() => ({ ok: false }));
  const render_seed = await seedRenderQueue(c.env, { limit: 2000 }).catch(() => ({ ok: false }));
  const render_rebalance = await rebalanceRenderQueuePriorities(c.env, { limit: 20000 }).catch(() => ({ ok: false }));

  // Observation retention/rollups (best-effort). Default: dry-run in run_all for safety.
  const obs_maintenance = await rollupAndRetainObservations(c.env, {
    dryRun: Boolean((body as any).obsDryRun ?? true),
    rawKeepDays: (body as any).obsRawKeepDays,
    rollupKeepDays: (body as any).obsRollupKeepDays,
    chunkDays: (body as any).obsChunkDays,
    deleteMaxRows: (body as any).obsDeleteMaxRows,
  }).catch(() => ({ ok: false }));

  const ingest = await ingestProductPages(c.env, { limit: ingestLimit });
  const images = await recrawlProductImages(c.env, { limit: imagesLimit });

  return c.json({
    ok: true,
    job: 'run_all',
    result: { seed, apis, probe_seed, probe_run, render_cleanup, render_seed, render_rebalance, obs_maintenance, ingest, images },
  });
});

// Local/dev helper: ensure there is a row for "today" by copying the latest FX rates.
// (Real FX fetching can be added later; this keeps the UI stable in dev.)

// Shadow Mode: auto-discover candidate sources via SearxNG (Docker-local search aggregator)
adminRoutes.post('/jobs/discover_sources', async (c) => {
  const gate = await requireAdminOrInternal(c);
  if (!gate.ok || !gate.db) return gate.res!;
  const body = await c.req.json().catch(() => ({}));

  const target = Math.max(1, Math.min(5000, Number((body as any).target ?? 300)));
  const sectors = Array.isArray((body as any).sectors) ? (body as any).sectors : [];
  const provinces = Array.isArray((body as any).provinces) ? (body as any).provinces : [];
  const dryRun = Boolean((body as any).dryRun ?? false);

  const result = await discoverSources(c.env, { target, sectors, provinces, dryRun });
  return c.json(result);
});

// Shadow Mode: validate candidate sources (probe cart/sitemap/hints) then mark passed/failed/needs_review
adminRoutes.post('/jobs/validate_candidates', async (c) => {
  const gate = await requireAdminOrInternal(c);
  if (!gate.ok || !gate.db) return gate.res!;
  const body = await c.req.json().catch(() => ({}));
  const limit = Math.max(1, Math.min(500, Number((body as any).limit ?? 200)));
  const result = await validateCandidateSources(c.env, { limit });
  return c.json(result);
});

// Shadow Mode: activate candidate sources that passed validation
adminRoutes.post('/jobs/activate_candidates', async (c) => {
  const gate = await requireAdminOrInternal(c);
  if (!gate.ok || !gate.db) return gate.res!;
  const body = await c.req.json().catch(() => ({}));
  const limit = Math.max(1, Math.min(2000, Number((body as any).limit ?? 300)));
  const minScore = Math.max(0, Math.min(1, Number((body as any).minScore ?? 0.70)));
  const result = await activateCandidateSources(c.env, { limit, minScore });
  return c.json(result);
});

// Retro-tag existing sources (best-effort inference of provinces/sectors)
adminRoutes.post('/jobs/retro_tag_sources', async (c) => {
  const gate = await requireAdminOrInternal(c);
  if (!gate.ok || !gate.db) return gate.res!;
  const body = await c.req.json().catch(() => ({}));
  const limit = Math.max(1, Math.min(2000, Number((body as any).limit ?? 200)));
  const force = Boolean((body as any).force ?? false);
  const dryRun = Boolean((body as any).dryRun ?? true);
  const result = await retroTagSources(c.env, { limit, force, dryRun });
  return c.json(result);
});


// Retro-tag sectors using product catalog signals (category distribution + name/url keywords)
adminRoutes.post('/jobs/retro_tag_sectors_catalog', async (c) => {
  const gate = await requireAdminOrInternal(c);
  if (!gate.ok || !gate.db) return gate.res!;
  const body = await c.req.json().catch(() => ({}));
  const limit = Math.max(1, Math.min(2000, Number((body as any).limit ?? 200)));
  const days = Math.max(7, Math.min(365, Number((body as any).days ?? 90)));
  const minSamples = Math.max(25, Math.min(2000, Number((body as any).minSamples ?? 120)));
  const force = Boolean((body as any).force ?? false);
  const dryRun = Boolean((body as any).dryRun ?? true);
  const result = await retroTagSectorsFromCatalog(c.env, { limit, days, minSamples, force, dryRun });
  return c.json(result);
});


// Health: roll up per-source daily metrics (stored in source_health_daily)
adminRoutes.post('/jobs/rollup_source_health', async (c) => {
  const gate = await requireAdminOrInternal(c);
  if (!gate.ok || !gate.db) return gate.res!;
  const body = await c.req.json().catch(() => ({}));
  const hours = Math.max(6, Math.min(168, Number((body as any).hours ?? 24)));
  const result = await rollupSourceHealth(c.env, { hours });
  return c.json(result);
});

// FX: update official + market rates for today (best-effort, non-blocking)
adminRoutes.post('/jobs/fx_update_daily', async (c) => {
  const gate = await requireAdminOrInternal(c);
  if (!gate.ok || !gate.db) return gate.res!;
  const body = await c.req.json().catch(() => ({}));
  const govUrl = (body as any).govUrl;
  const marketUrl = (body as any).marketUrl;
  const premiumPct = (body as any).premiumPct;
  const govOverride = (body as any).govOverride;
  const marketOverride = (body as any).marketOverride;
  const result = await fxUpdateDaily(c.env, { govUrl, marketUrl, premiumPct, govOverride, marketOverride });
  return c.json(result);
});

adminRoutes.post('/jobs/patch_governed_fx_schema', async (c) => {
  const gate = await requireAdminOrInternal(c);
  if (!gate.ok || !gate.db) return gate.res!;
  const result = await patchGovernedFxSchema(c.env);
  return c.json(result);
});

adminRoutes.get('/fx_sources', async (c) => {
  const gate = await requireAdminOrInternal(c);
  if (!gate.ok || !gate.db) return gate.res!;
  const rows = await gate.db.execute(sql`
    select
      id,
      source_code,
      source_name,
      source_kind,
      rate_type,
      region_key,
      fetch_url,
      parser_type,
      parser_version,
      trust_score,
      freshness_sla_minutes,
      publication_enabled,
      is_active,
      priority,
      meta,
      updated_at
    from public.fx_sources
    order by rate_type asc, priority asc, source_name asc
  `).catch(() => ({ rows: [] as any[] }));
  return c.json({ ok: true, items: rows.rows ?? [] });
});

adminRoutes.get('/fx_publications/recent', async (c) => {
  const gate = await requireAdminOrInternal(c);
  if (!gate.ok || !gate.db) return gate.res!;
  const items = await getLatestFxPublications(gate.db);
  return c.json({ ok: true, items });
});

// Schema: add auto-disable columns for sources (bot challenge protection)
adminRoutes.post('/jobs/patch_source_auto_disable_schema', async (c) => {
  const gate = await requireAdminOrInternal(c);
  if (!gate.ok || !gate.db) return gate.res!;
  const result = await patchSourceAutoDisableSchema(c.env);
  return c.json(result);
});


// Schema: persistent sitemap queue (cursor + retry/backoff + conditional caching)
adminRoutes.post('/jobs/patch_sitemap_queue_schema', async (c) => {
  const gate = await requireAdminOrInternal(c);
  if (!gate.ok || !gate.db) return gate.res!;
  const result = await patchSitemapQueueSchema(c.env);
  return c.json(result);
});


// Schema: domain recover probe queue (light probe before resuming full ingestion)
adminRoutes.post('/jobs/patch_probe_queue_schema', async (c) => {
  const gate = await requireAdminOrInternal(c);
  if (!gate.ok || !gate.db) return gate.res!;
  const result = await patchProbeQueueSchema(c.env);
  return c.json(result);
});



// Schema: observation rollups (daily aggregates) + settings for retention
adminRoutes.post('/jobs/patch_observation_rollups_schema', async (c) => {
  const gate = await requireAdminOrInternal(c);
  if (!gate.ok || !gate.db) return gate.res!;
  const result = await patchObservationRollupsSchema(c.env);
  return c.json(result);
});

// Schema: ingestion staging + publication gate foundation
adminRoutes.post('/jobs/patch_publication_gate_schema', async (c) => {
  const gate = await requireAdminOrInternal(c);
  if (!gate.ok || !gate.db) return gate.res!;
  const result = await patchPublicationGateSchema(c.env);
  return c.json(result);
});

adminRoutes.post('/jobs/patch_canonical_identity_schema', async (c) => {
  const gate = await requireAdminOrInternal(c);
  if (!gate.ok || !gate.db) return gate.res!;
  const result = await patchCanonicalIdentitySchema(c.env);
  return c.json(result);
});

adminRoutes.post('/jobs/backfill_canonical_identity', async (c) => {
  const gate = await requireAdminOrInternal(c);
  if (!gate.ok || !gate.db) return gate.res!;
  const body = await c.req.json().catch(() => ({}));
  const result = await backfillCanonicalIdentity(c.env, {
    limit: (body as any).limit,
    offset: (body as any).offset,
  });
  return c.json(result);
});

adminRoutes.post('/jobs/patch_catalog_taxonomy_governance_schema', async (c) => {
  const gate = await requireAdminOrInternal(c);
  if (!gate.ok || !gate.db) return gate.res!;
  const result = await patchCatalogTaxonomyGovernanceSchema(c.env);
  return c.json(result);
});

adminRoutes.post('/jobs/patch_barcode_resolution_schema', async (c) => {
  const gate = await requireAdminOrInternal(c);
  if (!gate.ok || !gate.db) return gate.res!;
  const result = await patchBarcodeResolutionSchema(c.env);
  return c.json(result);
});

adminRoutes.post('/jobs/reclassify_canonical_taxonomy_shadow', async (c) => {
  const gate = await requireAdminOrInternal(c);
  if (!gate.ok || !gate.db) return gate.res!;
  const body = await c.req.json().catch(() => ({}));
  const result = await reclassifyCanonicalTaxonomyShadow(c.env, {
    limit: (body as any).limit,
    offset: (body as any).offset,
    applyApproved: Boolean((body as any).applyApproved ?? (body as any).apply_approved ?? false),
  });
  return c.json(result);
});

adminRoutes.get('/catalog_taxonomy/quarantine', async (c) => {
  const gate = await requireAdmin(c);
  if (!gate.ok || !gate.db) return gate.res!;
  const status = String(c.req.query('status') ?? 'pending');
  const limit = Math.max(1, Math.min(200, Number(c.req.query('limit') ?? 50)));
  const where = status === 'all' ? sql`` : sql`where q.status = ${status}`;

  const rows = await gate.db.execute(sql`
    select
      q.id,
      q.status,
      q.variant_id,
      q.family_id,
      q.legacy_product_id,
      q.source_domain,
      q.source_url,
      q.product_name,
      q.current_taxonomy_key,
      q.inferred_taxonomy_key,
      q.inferred_category,
      q.inferred_subcategory,
      q.confidence,
      q.margin,
      q.review_priority,
      q.deny_rules,
      q.conflict,
      q.conflict_reasons,
      q.reviewer_note,
      q.reviewed_at,
      q.created_at
    from public.catalog_taxonomy_quarantine q
    ${where}
    order by q.review_priority asc, q.created_at desc
    limit ${limit}
  `).catch(() => ({ rows: [] as any[] }));

  return c.json({ ok: true, items: rows.rows ?? [] });
});

adminRoutes.get('/barcode_resolution/recent', async (c) => {
  const gate = await requireAdmin(c);
  if (!gate.ok || !gate.db) return gate.res!;
  const limit = Math.max(1, Math.min(200, Number(c.req.query('limit') ?? 50)));

  const rows = await gate.db.execute(sql`
    select
      r.id,
      r.input_text,
      r.parsed_code,
      r.identifier_type,
      r.parse_source,
      r.resolution_status,
      r.variant_id,
      r.family_id,
      r.legacy_product_id,
      r.region_id,
      r.external_source,
      r.confidence,
      r.created_at,
      r.completed_at
    from public.barcode_resolution_runs r
    order by r.created_at desc
    limit ${limit}
  `).catch(() => ({ rows: [] as any[] }));

  return c.json({ ok: true, items: rows.rows ?? [] });
});

// Maintenance: roll up historical observations + delete old raw rows safely (batch + cursor)
adminRoutes.post('/jobs/rollup_and_retention_observations', async (c) => {
  const gate = await requireAdminOrInternal(c);
  if (!gate.ok || !gate.db) return gate.res!;
  const body = await c.req.json().catch(() => ({}));
  const rawKeepDays = (body as any).rawKeepDays;
  const rollupKeepDays = (body as any).rollupKeepDays;
  const chunkDays = (body as any).chunkDays;
  const deleteMaxRows = (body as any).deleteMaxRows;
  const rollupDeleteMaxRows = (body as any).rollupDeleteMaxRows;
  const dryRun = (body as any).dryRun;
  const result = await rollupAndRetainObservations(c.env, { rawKeepDays, rollupKeepDays, chunkDays, deleteMaxRows, rollupDeleteMaxRows, dryRun });
  return c.json(result);
});

// Schema: create app_settings KV store (for scheduler state/cursors)
adminRoutes.post('/jobs/patch_app_settings_schema', async (c) => {
  const gate = await requireAdminOrInternal(c);
  if (!gate.ok || !gate.db) return gate.res!;
  const result = await patchAppSettingsSchemaJob(c.env);
  return c.json(result);
});

// Auto-Discovery: daily pipeline (discover -> validate -> activate -> seed)
adminRoutes.post('/jobs/auto_discovery_daily', async (c) => {
  const gate = await requireAdminOrInternal(c);
  if (!gate.ok || !gate.db) return gate.res!;
  const body = await c.req.json().catch(() => ({}));
  const force = Boolean((body as any).force ?? false);
  const dryRun = Boolean((body as any).dryRun ?? false);
  const autotune = (body as any).autotune;
  const addPerDay = (body as any).addPerDay;
  const underservedTopN = (body as any).underservedTopN;
  const result = await autoDiscoveryDaily(c.env, { force, dryRun, autotune, addPerDay, underservedTopN });
  return c.json(result);
});

adminRoutes.post('/jobs/seed_probe_queue', async (c) => {
  const gate = await requireAdminOrInternal(c);
  if (!gate.ok || !gate.db) return gate.res!;
  const body = await c.req.json().catch(() => ({}));
  const limitDomains = Math.max(1, Math.min(500, Number((body as any).limitDomains ?? 200)));
  const result = await seedProbeQueue(c.env, { limitDomains });
  return c.json(result);
});

adminRoutes.post('/jobs/run_probe_queue', async (c) => {
  const gate = await requireAdminOrInternal(c);
  if (!gate.ok || !gate.db) return gate.res!;
  const body = await c.req.json().catch(() => ({}));
  const limit = Math.max(1, Math.min(500, Number((body as any).limit ?? 50)));
  const concurrency = Math.max(1, Math.min(10, Number((body as any).concurrency ?? 2)));
  const result = await runProbeQueue(c.env, { limit, concurrency });
  return c.json(result);
});

// Schema: render queue for JS-only pages (Playwright worker)
adminRoutes.post('/jobs/patch_render_queue_schema', async (c) => {
  const gate = await requireAdminOrInternal(c);
  if (!gate.ok || !gate.db) return gate.res!;
  const result = await patchRenderQueueSchema(c.env);
  return c.json(result);
});

adminRoutes.post('/jobs/seed_render_queue', async (c) => {
  const gate = await requireAdminOrInternal(c);
  if (!gate.ok || !gate.db) return gate.res!;
  const body = await c.req.json().catch(() => ({}));
  const domain = (body as any).domain ? String((body as any).domain) : undefined;
  const limit = Math.max(1, Math.min(20000, Number((body as any).limit ?? 2000)));
  const result = await seedRenderQueue(c.env, { domain, limit });
  return c.json(result);
});

adminRoutes.post('/jobs/rebalance_render_queue_priorities', async (c) => {
  const gate = await requireAdminOrInternal(c);
  if (!gate.ok || !gate.db) return gate.res!;
  const body = await c.req.json().catch(() => ({}));
  const domain = (body as any).domain ? String((body as any).domain) : undefined;
  const limit = Math.max(1, Math.min(200000, Number((body as any).limit ?? 20000)));
  const result = await rebalanceRenderQueuePriorities(c.env, { domain, limit });
  return c.json(result);
});

adminRoutes.post('/jobs/reset_render_health', async (c) => {
  const gate = await requireAdminOrInternal(c);
  if (!gate.ok || !gate.db) return gate.res!;
  const body = await c.req.json().catch(() => ({}));
  const domain = String((body as any).domain ?? '').trim();
  const result = await resetRenderHealth(c.env, { domain });
  return c.json(result);
});

adminRoutes.post('/jobs/cleanup_render_cache', async (c) => {
  const gate = await requireAdminOrInternal(c);
  if (!gate.ok || !gate.db) return gate.res!;
  const body = await c.req.json().catch(() => ({}));
  const maxAgeDays = Number((body as any).maxAgeDays ?? 7);
  const result = await cleanupRenderCache(c.env, { maxAgeDays });
  return c.json(result);
});

// Views: relax v_best_offers gate (prevents empty category pages while keeping quality via confidence/anomaly filters)
adminRoutes.post('/jobs/patch_views_best_offers', async (c) => {
  const gate = await requireAdminOrInternal(c);
  if (!gate.ok || !gate.db) return gate.res!;
  const result = await patchViewsBestOffers(c.env);
  return c.json(result);
});

// Prices: repair USD prices stored as tiny IQD (e.g., 110 instead of 110*FX) in electronics/beauty/automotive
adminRoutes.post('/jobs/repair_small_usd_prices', async (c) => {
  const gate = await requireAdminOrInternal(c);
  if (!gate.ok || !gate.db) return gate.res!;
  const body = await c.req.json().catch(() => ({}));
  const limit = Math.max(1, Math.min(200000, Number((body as any).limit ?? 50000)));
  const min = Number((body as any).min ?? 1);
  const max = Number((body as any).max ?? 999);
  const dryRun = Boolean((body as any).dryRun ?? false);
  const result = await repairSmallUsdPrices(c.env, { limit, min, max, dryRun });
  return c.json(result);
});

// Categories:
// reclassify existing products using 3-pass inference (text + site hint when available + specialized-domain hint)
adminRoutes.post('/jobs/reclassify_categories', async (c) => {
  const gate = await requireAdminOrInternal(c);
  if (!gate.ok || !gate.db) return gate.res!;
  const body = await c.req.json().catch(() => ({}));
  const limit = Math.max(1, Math.min(50000, Number((body as any).limit ?? 5000)));
  const force = Boolean((body as any).force ?? false);
  const result = await reclassifyCategories(c.env, { limit, force });
  return c.json(result);
});

// Prices: mark suspiciously-low prices (common parsing error: "100.000" -> 100)
adminRoutes.post('/jobs/fix_low_price_outliers', async (c) => {
  const gate = await requireAdminOrInternal(c);
  if (!gate.ok || !gate.db) return gate.res!;
  const body = await c.req.json().catch(() => ({}));
  const limit = Math.max(1, Math.min(200000, Number((body as any).limit ?? 20000)));
  const min = Number((body as any).min ?? 1);
  const max = Number((body as any).max ?? 999);
  const dryRun = Boolean((body as any).dryRun ?? false);
  const result = await fixLowPriceOutliers(c.env, { limit, min, max, dryRun });
  return c.json(result);
});

// Prices: re-parse raw_price_text and repair legacy parsing errors (e.g., "100.000" -> 100)
adminRoutes.post('/jobs/repair_prices_from_raw_text', async (c) => {
  const gate = await requireAdminOrInternal(c);
  if (!gate.ok || !gate.db) return gate.res!;
  const body = await c.req.json().catch(() => ({}));
  const limit = Math.max(1, Math.min(200000, Number((body as any).limit ?? 50000)));
  const min = Number((body as any).min ?? 1);
  const max = Number((body as any).max ?? 999);
  const dryRun = Boolean((body as any).dryRun ?? false);
  const result = await repairPricesFromRawText(c.env, { limit, min, max, dryRun });
  return c.json(result);
});

// Categories: smart reclassify using observation hints + site breadcrumbs + text (not name-only)
adminRoutes.post('/jobs/reclassify_categories_smart', async (c) => {
  const gate = await requireAdminOrInternal(c);
  if (!gate.ok || !gate.db) return gate.res!;
  const body = await c.req.json().catch(() => ({}));
  const limit = Math.max(1, Math.min(100000, Number((body as any).limit ?? 20000)));
  const force = Boolean((body as any).force ?? false);
  const result = await reclassifyCategoriesSmart(c.env, { limit, force });
  return c.json(result);
});

// Schema: taxonomy + overrides + FX monitoring (safe, non-destructive)
adminRoutes.post('/jobs/patch_taxonomy_overrides_schema', async (c) => {
  const gate = await requireAdminOrInternal(c);
  if (!gate.ok || !gate.db) return gate.res!;
  const result = await patchTaxonomyOverridesSchema(c.env);
  return c.json(result);
});

// Schema: guardrails for admin/health endpoints on older DB volumes
adminRoutes.post('/jobs/patch_admin_health_schema', async (c) => {
  const gate = await requireAdminOrInternal(c);
  if (!gate.ok || !gate.db) return gate.res!;
  const result = await patchAdminHealthSchema(c.env);
  return c.json(result);
});


// Schema: Taxonomy v2 (nodes + quarantine + domain mappings)
adminRoutes.post('/jobs/patch_taxonomy_v2_schema', async (c) => {
  const gate = await requireAdminOrInternal(c);
  if (!gate.ok || !gate.db) return gate.res!;
  const result = await patchTaxonomyV2Schema(c.env);
  return c.json(result);
});

// Taxonomy v2: seed default Iraqi taxonomy nodes (safe upsert)
adminRoutes.post('/jobs/seed_taxonomy_v2', async (c) => {
  const gate = await requireAdminOrInternal(c);
  if (!gate.ok || !gate.db) return gate.res!;
  const result = await seedTaxonomyV2(c.env);
  return c.json(result);
});

// Taxonomy v2: backfill + quarantine generation from existing products/observations
adminRoutes.post('/jobs/backfill_taxonomy_v2', async (c) => {
  const gate = await requireAdminOrInternal(c);
  if (!gate.ok || !gate.db) return gate.res!;
  const body = await c.req.json().catch(() => ({}));
  const limit = Math.max(1, Math.min(200000, Number((body as any).limit ?? 5000)));
  const result = await backfillTaxonomyV2(c.env, { limit });
  return c.json(result);
});

// Taxonomy: backfill groceries subcategories
adminRoutes.post('/jobs/backfill_grocery_subcategories', async (c) => {
  const gate = await requireAdminOrInternal(c);
  if (!gate.ok || !gate.db) return gate.res!;
  const body = await c.req.json().catch(() => ({}));
  const limit = Math.max(1, Math.min(200000, Number((body as any).limit ?? 20000)));
  const result = await backfillGrocerySubcategories(c.env, { limit });
  return c.json(result);
});

// Overrides: apply category_overrides to existing products
adminRoutes.post('/jobs/apply_category_overrides', async (c) => {
  const gate = await requireAdminOrInternal(c);
  if (!gate.ok || !gate.db) return gate.res!;
  const body = await c.req.json().catch(() => ({}));
  const limit = Math.max(1, Math.min(200000, Number((body as any).limit ?? 50000)));
  const force = Boolean((body as any).force ?? false);
  const result = await applyCategoryOverrides(c.env, { limit, force });
  return c.json(result);
});


// Health latest (from rollup table)
adminRoutes.get('/source_health_latest', async (c) => {
  const gate = await requireAdmin(c);
  if (!gate.ok || !gate.db) return gate.res!;
  const r = await gate.db.execute(sql`select * from public.v_source_health_latest`);
  return c.json({ sources: r.rows ?? [] });
});




// ✅ One-time schema patch (safe): adds category meta columns + conflict quarantine table
adminRoutes.post('/jobs/patch_category_conflict_schema', async (c) => {
  const gate = await requireAdminOrInternal(c);
  if (!gate.ok || !gate.db) return gate.res!;
  const result = await patchCategoryConflictSchema(c.env);
  return c.json(result);
});


adminRoutes.get('/category_conflicts', async (c) => {
  const gate = await requireAdmin(c);
  if (!gate.ok || !gate.db) return gate.res!;

  const statusRaw = String(c.req.query('status') ?? 'open').trim().toLowerCase();
  const status = ['open', 'resolved', 'ignored', 'all'].includes(statusRaw) ? statusRaw : 'open';
  const q = String(c.req.query('q') ?? '').trim();
  const limit = Math.max(1, Math.min(200, Number(c.req.query('limit') ?? 50)));
  const offset = Math.max(0, Number(c.req.query('offset') ?? 0));

  const conds: any[] = [];
  if (status !== 'all') conds.push(sql`ccq.status = ${status}`);
  if (q) {
    const like = `%${q}%`;
    conds.push(sql`(
      coalesce(p.name_ar, '') ilike ${like}
      or coalesce(p.name_en, '') ilike ${like}
      or coalesce(p.category, '') ilike ${like}
      or coalesce(ccq.decided_category, '') ilike ${like}
      or coalesce(ccq.review_note, '') ilike ${like}
      or coalesce(ccq.evidence::text, '') ilike ${like}
    )`);
  }
  const where = conds.length ? sql`where ${sql.join(conds, sql` and `)}` : sql``;

  const rows = await gate.db.execute(sql`
    select
      ccq.id,
      ccq.status,
      ccq.review_note,
      ccq.decided_category,
      ccq.created_at,
      ccq.updated_at,
      ccq.first_seen_at,
      ccq.last_seen_at,
      ccq.seen_count,
      ccq.product_id,
      p.name_ar as product_name_ar,
      p.name_en as product_name_en,
      p.category as current_category,
      ccq.evidence
    from public.category_conflict_quarantine ccq
    left join public.products p on p.id = ccq.product_id
    ${where}
    order by case ccq.status when 'open' then 0 when 'resolved' then 1 else 2 end, ccq.updated_at desc, ccq.created_at desc
    limit ${limit}
    offset ${offset}
  `).catch(() => ({ rows: [] as any[] }));

  const totalResult = await gate.db.execute(sql`
    select count(*)::int as total
    from public.category_conflict_quarantine ccq
    left join public.products p on p.id = ccq.product_id
    ${where}
  `).catch(() => ({ rows: [{ total: 0 }] as any[] }));

  const items = ((rows.rows as any[]) ?? []).map((r) => ({
    ...r,
    evidence: r.evidence ?? {},
    suggested_category: r?.evidence?.decided ?? null,
    site_category_raw: r?.evidence?.siteCategoryRaw ?? null,
    signal_site: r?.evidence?.site ?? null,
    signal_domain: r?.evidence?.domain ?? null,
    signal_text_score: typeof r?.evidence?.textScore === 'number' ? r.evidence.textScore : null,
  }));

  return c.json({ ok: true, items, total: Number(((totalResult.rows as any[])?.[0]?.total ?? 0)) });
});

adminRoutes.post('/category_conflicts/:id/review', async (c) => {
  const gate = await requireAdmin(c);
  if (!gate.ok || !gate.db) return gate.res!;

  const id = String(c.req.param('id') ?? '').trim();
  if (!id) return c.json({ ok: false, error: 'id_required' }, 400);

  const body = await c.req.json().catch(() => ({}));
  const statusRaw = String((body as any).status ?? '').trim().toLowerCase();
  const status = ['open', 'resolved', 'ignored'].includes(statusRaw) ? statusRaw : null;
  if (!status) return c.json({ ok: false, error: 'invalid_status' }, 400);

  const note = String((body as any).note ?? '').trim() || null;
  const decidedCategory = String((body as any).decided_category ?? '').trim() || null;
  const applyToProduct = Boolean((body as any).apply_to_product ?? false);

  const current = await gate.db.execute(sql`
    select id, product_id, status, evidence
    from public.category_conflict_quarantine
    where id = ${id}::uuid
    limit 1
  `);
  const row = (current.rows as any[])[0];
  if (!row) return c.json({ ok: false, error: 'not_found' }, 404);

  if (status === 'open') {
    const alreadyOpen = await gate.db.execute(sql`
      select id
      from public.category_conflict_quarantine
      where product_id = ${String(row.product_id)}::uuid and status = 'open'
      limit 1
    `);
    const existingOpenId = String(((alreadyOpen.rows as any[])?.[0]?.id ?? ''));
    if (existingOpenId && existingOpenId !== id) {
      return c.json({ ok: false, error: 'open_conflict_exists' }, 409);
    }
  }

  await gate.db.execute(sql`
    update public.category_conflict_quarantine
    set
      status = ${status},
      review_note = coalesce(${note}, review_note),
      decided_category = ${decidedCategory},
      updated_at = now()
    where id = ${id}::uuid
  `);

  if (applyToProduct && decidedCategory) {
    await gate.db.execute(sql`
      update public.products
      set category = ${decidedCategory}
      where id = ${String(row.product_id)}::uuid
    `).catch(() => {});
  }

  return c.json({ ok: true, id, status, decided_category: decidedCategory, applied_to_product: applyToProduct && !!decidedCategory });
});
adminRoutes.post('/jobs/fx_rollover_today', async (c) => {
  const gate = await requireAdminOrInternal(c);
  if (!gate.ok || !gate.db) return gate.res!;
  const result = await rolloverLatestFxPublicationToLegacy(gate.db);
  return c.json({ ok: true, job: 'fx_rollover_today', result });
});

// -----------------------------
// Site Plugins (export/import/test)
// -----------------------------

adminRoutes.post('/site_plugins/export', async (c) => {
  const gate = await requireAdminOrInternal(c);
  if (!gate.ok || !gate.db) return gate.res!;
  const body = await c.req.json().catch(() => ({}));
  const domain = normalizeDomain(String((body as any).domain ?? ''));
  if (!domain) return c.json({ success: false, error: 'domain_required' }, 400);

  const db = gate.db;
  const source = await db.execute(sql`
    select id, domain, name_ar, source_kind, trust_weight, is_active, base_url, logo_url
    from public.price_sources
    where domain = ${domain}
    limit 1
  `);
  const src = (source.rows as any[])[0];
  if (!src) return c.json({ success: false, error: 'domain_not_found' }, 404);

  const patterns = await db.execute(sql`
    select domain, product_regex, category_regex
    from public.domain_url_patterns
    where domain = ${domain}
    limit 1
  `);

  const entrypoints = await db.execute(sql`
    select url, page_type, priority, is_active
    from public.source_entrypoints
    where domain = ${domain}
    order by priority asc
  `);

  const adapters = await db.execute(sql`
    select adapter_type, selectors, priority, is_active
    from public.source_adapters
    where source_id = ${String(src.id)}::uuid
    order by priority asc
  `);

  const apiEndpoints = await db.execute(sql`
    select url, endpoint_type, priority, is_active
    from public.source_api_endpoints
    where domain = ${domain}
    order by priority asc
  `);

  const bootstrap = await db.execute(sql`
    select path, page_type, priority, is_active
    from public.domain_bootstrap_paths
    where source_domain = ${domain}
    order by priority asc
  `);

  const plugin = {
    version: '1.0',
    exported_at: new Date().toISOString(),
    source: src,
    patterns: (patterns.rows as any[])[0] ?? {
      domain,
      product_regex: String.raw`\/(product|products|p|item|dp)\/`,
      category_regex: String.raw`\/(category|categories|collections|shop|store|department|c|offers)\/`,
    },
    entrypoints: entrypoints.rows ?? [],
    adapters: adapters.rows ?? [],
    api_endpoints: apiEndpoints.rows ?? [],
    bootstrap_paths: bootstrap.rows ?? [],
  };

  return c.json({ success: true, plugin });
});

adminRoutes.post('/site_plugins/import', async (c) => {
  const gate = await requireAdminOrInternal(c);
  if (!gate.ok || !gate.db) return gate.res!;

  const body = await c.req.json().catch(() => ({}));
  const plugin = (body as any).plugin;
  const mode = (body as any).mode === 'merge' ? 'merge' : 'replace';
  if (!plugin || typeof plugin !== 'object') return c.json({ success: false, error: 'plugin_required' }, 400);

  const domain = normalizeDomain(String(plugin?.source?.domain ?? plugin?.patterns?.domain ?? ''));
  if (!domain) return c.json({ success: false, error: 'domain_required' }, 400);

  const db = gate.db;

  const src = plugin.source ?? {};
  const sourceKind = ['retailer', 'marketplace', 'official'].includes(String(src.source_kind ?? '').toLowerCase())
    ? String(src.source_kind).toLowerCase()
    : 'retailer';

  const trust = Math.max(0, Math.min(1, Number(src.trust_weight ?? 0.6)));
  const baseUrl = String(src.base_url ?? `https://${domain}`).replace(/\/$/, '');
  const logoUrl = src.logo_url ? String(src.logo_url) : null;

  const existing = await db.execute(sql`select id from public.price_sources where domain=${domain} limit 1`);
  let sourceId = (existing.rows as any[])[0]?.id as string | undefined;

  if (sourceId) {
    await db.execute(sql`
      update public.price_sources
      set name_ar=${String(src.name_ar ?? domain)}, source_kind=${sourceKind}, trust_weight=${trust},
          is_active=${src.is_active !== false}, country_code='IQ', base_url=${baseUrl}, logo_url=${logoUrl}
      where id=${sourceId}::uuid
    `);
  } else {
    const ins = await db.execute(sql`
      insert into public.price_sources (name_ar, domain, source_kind, trust_weight, is_active, country_code, base_url, logo_url)
      values (${String(src.name_ar ?? domain)}, ${domain}, ${sourceKind}, ${trust}, ${src.is_active !== false}, 'IQ', ${baseUrl}, ${logoUrl})
      returning id
    `);
    sourceId = (ins.rows as any[])[0]?.id;
  }

  if (!sourceId) return c.json({ success: false, error: 'insert_failed' }, 500);

  const pat = plugin.patterns ?? {};
  await db.execute(sql`
    insert into public.domain_url_patterns (domain, product_regex, category_regex)
    values (
      ${domain},
      ${String(pat.product_regex ?? String.raw`\/(product|products|p|item|dp)\/`)},
      ${String(pat.category_regex ?? String.raw`\/(category|categories|collections|shop|store|department|c|offers)\/`)}
    )
    on conflict (domain) do update set
      product_regex = excluded.product_regex,
      category_regex = excluded.category_regex
  `);

  if (mode === 'replace') {
    await db.execute(sql`delete from public.source_entrypoints where domain=${domain}`);
    await db.execute(sql`delete from public.source_adapters where source_id=${sourceId}::uuid`);
    await db.execute(sql`delete from public.source_api_endpoints where domain=${domain}`);
    await db.execute(sql`delete from public.domain_bootstrap_paths where source_domain=${domain}`);
  }

  const entrypoints = Array.isArray(plugin.entrypoints) ? plugin.entrypoints : [];
  if (entrypoints.length) {
    const rows = entrypoints
      .map((e: any) => ({
        domain,
        url: String(e.url ?? '').trim(),
        page_type: String(e.page_type ?? 'category'),
        priority: Number(e.priority ?? 100),
        is_active: e.is_active !== false,
      }))
      .filter((r: any) => /^https?:\/\//i.test(r.url));

    if (rows.length) {
      const json = JSON.stringify(rows);
      await db.execute(sql`
        with input as (
          select * from json_to_recordset(${json}::json)
          as x(domain text, url text, page_type text, priority int, is_active boolean)
        )
        insert into public.source_entrypoints(domain, url, page_type, priority, is_active)
        select domain, url, page_type, priority, is_active from input
        on conflict (domain, url) do update set
          page_type = excluded.page_type,
          priority = excluded.priority,
          is_active = excluded.is_active,
          updated_at = now()
      `);
    }
  }

  const adapters = Array.isArray(plugin.adapters) ? plugin.adapters : [];
  if (adapters.length) {
    for (const a of adapters) {
      const adapterType = String(a.adapter_type ?? 'jsonld');
      if (!['jsonld', 'meta', 'dom', 'api'].includes(adapterType)) continue;
      await db.execute(sql`
        insert into public.source_adapters (source_id, adapter_type, priority, is_active, selectors)
        values (${sourceId}::uuid, ${adapterType}, ${Number(a.priority ?? 100)}, ${a.is_active !== false}, ${JSON.stringify(a.selectors ?? {})}::jsonb)
        on conflict (source_id, adapter_type) do update set
          priority = excluded.priority,
          is_active = excluded.is_active,
          selectors = excluded.selectors,
          updated_at = now()
      `);
    }
  }

  const apiEndpoints = Array.isArray(plugin.api_endpoints) ? plugin.api_endpoints : [];
  if (apiEndpoints.length) {
    const rows = apiEndpoints
      .map((e: any) => ({
        domain,
        url: String(e.url ?? '').trim(),
        endpoint_type: String(e.endpoint_type ?? 'generic_json'),
        priority: Number(e.priority ?? 100),
        is_active: e.is_active !== false,
      }))
      .filter((r: any) => /^https?:\/\//i.test(r.url));

    if (rows.length) {
      const json = JSON.stringify(rows);
      await db.execute(sql`
        with input as (
          select * from json_to_recordset(${json}::json)
          as x(domain text, url text, endpoint_type text, priority int, is_active boolean)
        )
        insert into public.source_api_endpoints(domain, url, endpoint_type, priority, is_active)
        select domain, url, endpoint_type, priority, is_active from input
        on conflict (domain, url) do update set
          endpoint_type = excluded.endpoint_type,
          priority = excluded.priority,
          is_active = excluded.is_active,
          updated_at = now()
      `);
    }
  }

  const bootstrap = Array.isArray(plugin.bootstrap_paths) ? plugin.bootstrap_paths : [];
  if (bootstrap.length) {
    const rows = bootstrap
      .map((b: any) => ({
        source_domain: domain,
        path: String(b.path ?? '').trim(),
        page_type: String(b.page_type ?? 'category'),
        priority: Number(b.priority ?? 100),
        is_active: b.is_active !== false,
      }))
      .filter((r: any) => r.path.startsWith('/'));
    if (rows.length) {
      const json = JSON.stringify(rows);
      await db.execute(sql`
        with input as (
          select * from json_to_recordset(${json}::json)
          as x(source_domain text, path text, page_type text, priority int, is_active boolean)
        )
        insert into public.domain_bootstrap_paths(source_domain, path, page_type, priority, is_active)
        select source_domain, path, page_type, priority, is_active from input
        on conflict (source_domain, path) do update set
          page_type = excluded.page_type,
          priority = excluded.priority,
          is_active = excluded.is_active,
          updated_at = now()
      `);
    }
  }

  return c.json({ success: true, domain, source_id: sourceId, mode });
});

adminRoutes.post('/site_plugins/test', async (c) => {
  const gate = await requireAdminOrInternal(c);
  if (!gate.ok || !gate.db) return gate.res!;

  const body = await c.req.json().catch(() => ({}));
  const url = String((body as any).url ?? '').trim();
  if (!/^https?:\/\//i.test(url)) return c.json({ success: false, error: 'url_required' }, 400);
  const domain = normalizeDomain(String((body as any).domain ?? new URL(url).hostname));

  const db = gate.db;
  const src = await db.execute(sql`select id, domain from public.price_sources where domain=${domain} limit 1`);
  const source = (src.rows as any[])[0];
  if (!source) return c.json({ success: false, error: 'domain_not_found' }, 404);

  const ad = await db.execute(sql`
    select adapter_type, selectors, priority
    from public.source_adapters
    where source_id = ${String(source.id)}::uuid and is_active=true
    order by priority asc
  `);

  const html = await fetchHtmlForTest(url);
  if (!html) return c.json({ success: false, error: 'fetch_failed' }, 502);

  const extracted = extractProductFromHtml(html, url, (ad.rows as any[]) ?? []);
  return c.json({ success: true, domain, extracted: extracted ?? null });
});

async function fetchHtmlForTest(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
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

// ─────────────────────────────────────────────
// Taxonomy v2 (nodes + quarantine review)
// ─────────────────────────────────────────────

adminRoutes.get('/taxonomy_v2/nodes', async (c) => {
  const gate = await requireAdmin(c);
  if (!gate.ok || !gate.db) return gate.res!;
  // If schema is not patched, return empty list safely.
  try {
    const r = await gate.db.execute(sql`select key, parent_key, label_ar, label_en, synonyms, is_leaf from public.taxonomy_nodes order by key asc`);
    return c.json({ ok: true, nodes: r.rows ?? [] });
  } catch {
    return c.json({ ok: true, nodes: [], table_ready: false });
  }
});

adminRoutes.get('/taxonomy_v2/quarantine', async (c) => {
  const gate = await requireAdmin(c);
  if (!gate.ok || !gate.db) return gate.res!;
  const status = String(c.req.query('status') ?? 'pending');
  const limit = Math.max(1, Math.min(200, Number(c.req.query('limit') ?? 50)));

  try {
    const where = status === 'all' ? sql`` : sql`where q.status = ${status}`;
    const r = await gate.db.execute(sql`
      select
        q.id, q.status, q.product_id, q.domain, q.url, q.product_name,
        q.site_category_raw, q.site_category_norm,
        q.current_taxonomy_key, q.inferred_taxonomy_key, q.chosen_taxonomy_key,
        q.confidence, q.reason, q.conflict, q.conflict_reason,
        q.reviewer_note, q.reviewed_at, q.created_at
      from public.taxonomy_quarantine q
      ${where}
      order by q.created_at desc
      limit ${limit}
    `);
    return c.json({ ok: true, items: r.rows ?? [], table_ready: true });
  } catch {
    return c.json({ ok: true, items: [], table_ready: false });
  }
});

adminRoutes.post('/taxonomy_v2/quarantine/:id/review', async (c) => {
  const gate = await requireAdmin(c);
  if (!gate.ok || !gate.db) return gate.res!;
  const id = String(c.req.param('id') ?? '');
  const body = await c.req.json().catch(() => ({}));

  const status = String((body as any).status ?? 'approved');
  const chosen = (body as any).taxonomy_key ? String((body as any).taxonomy_key) : null;
  const applyMapping = Boolean((body as any).apply_mapping ?? false);
  const note = ((body as any).note ? String((body as any).note).slice(0, 500) : null);

  // Load row
  const rowRes = await gate.db.execute(sql`select * from public.taxonomy_quarantine where id = ${id}::uuid limit 1`);
  const row = (rowRes.rows as any[])[0];
  if (!row) return c.json({ ok: false, error: 'not_found' }, 404);

  const inferred = row.inferred_taxonomy_key ? String(row.inferred_taxonomy_key) : null;
  const finalKey = (status === 'approved') ? (chosen || inferred) : (chosen || row.chosen_taxonomy_key || null);
  if (status === 'approved' && !finalKey) return c.json({ ok: false, error: 'taxonomy_key_required' }, 400);

  await gate.db.execute(sql`
    update public.taxonomy_quarantine
    set
      status = ${status},
      chosen_taxonomy_key = ${finalKey},
      reviewer_note = ${note},
      reviewed_at = case when ${status} in ('approved','rejected') then now() else reviewed_at end,
      updated_at = now()
    where id = ${id}::uuid
  `).catch(() => {});

  if (status === 'approved' && finalKey) {
    const mapped = taxonomyKeyToCategoryAndSubcategory(finalKey);
    // Update product taxonomy + (safe) category/subcategory if not manually locked.
    await gate.db.execute(sql`
      update public.products
      set
        taxonomy_key = ${finalKey},
        taxonomy_manual = true,
        taxonomy_confidence = 0.99,
        taxonomy_reason = 'manual_review',
        category = case when coalesce(category_manual,false)=true then category else ${mapped.category} end,
        subcategory = case when coalesce(subcategory_manual,false)=true then subcategory else ${mapped.subcategory} end,
        updated_at = now()
      where id = ${String(row.product_id)}::uuid
    `).catch(() => {});

    if (applyMapping) {
      const domain = row.domain ? String(row.domain) : null;
      const sc = normalizeSiteCategory(row.site_category_raw ? String(row.site_category_raw) : null);
      if (domain && sc) {
        await gate.db.execute(sql`
          insert into public.domain_taxonomy_mappings (domain, site_category_norm, taxonomy_key, is_active)
          values (${domain}, ${sc}, ${finalKey}, true)
          on conflict (domain, site_category_norm) do update set
            taxonomy_key = excluded.taxonomy_key,
            is_active = true,
            updated_at = now()
        `).catch(() => {});
      }
    }
  }

  return c.json({ ok: true, id, status, taxonomy_key: finalKey });
});

adminRoutes.get('/price_anomaly_quarantine', async (c) => {
  const gate = await requireAdminOrInternal(c);
  if (!gate.ok || !gate.db) return gate.res!;

  const db = gate.db;
  const status = (c.req.query('status') || 'pending').trim();
  const limitRaw = Number(c.req.query('limit') || 50);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, Math.trunc(limitRaw))) : 50;

  try {
    const hasTable = await db.execute(sql`
      select exists (
        select 1 from information_schema.tables
        where table_schema = 'public' and table_name = 'price_anomaly_quarantine'
      ) as exists
    `);
    const tableReady = Boolean((hasTable.rows?.[0] as any)?.exists);
    if (!tableReady) return c.json({ items: [], count: 0, table_ready: false });

    const whereClause = status === 'all' ? sql`true` : sql`status = ${status}`;
    const rows = await db.execute(sql`
      select
        id, status, review_note, created_at, updated_at, reviewed_at,
        product_id, source_id, source_domain, source_name,
        product_name, product_url, raw_price, parsed_price, currency,
        reason_code, reason_detail, observed_payload
      from public.price_anomaly_quarantine
      where ${whereClause}
      order by created_at desc
      limit ${limit}
    `);

    return c.json({ items: (rows.rows as any[]) ?? [], count: rows.rows?.length ?? 0, table_ready: true });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to fetch quarantine list' }, 500);
  }
});

adminRoutes.post('/price_anomaly_quarantine/:id/review', async (c) => {
  const gate = await requireAdminOrInternal(c);
  if (!gate.ok || !gate.db) return gate.res!;

  const db = gate.db;
  const id = String(c.req.param('id') || '').trim();
  const body = await c.req.json().catch(() => ({} as any));
  const status = String((body as any)?.status || (body as any)?.decision || '').trim();
  const reviewNote = (body as any)?.review_note == null ? null : String((body as any).review_note);
  const restoreObservation = Boolean((body as any)?.restoreObservation ?? (body as any)?.restore_observation ?? false);

  if (!id) return c.json({ error: 'id_required' }, 400);
  if (!['pending', 'approved', 'rejected', 'ignored'].includes(status)) {
    return c.json({ error: 'invalid_status' }, 400);
  }

  try {
    const rowRes = await db.execute(sql`select * from public.price_anomaly_quarantine where id = ${id}::uuid limit 1`);
    const item = (rowRes.rows as any[])?.[0] as Record<string, any> | undefined;
    if (!item) return c.json({ error: 'not_found' }, 404);

    let restore: any = null;
    if (status === 'approved' && restoreObservation) {
      const productId = item.product_id ?? null;
      const sourceId = item.source_id ?? null;
      const sourceUrl = item.source_url ?? item.product_url ?? item.page_url ?? null;
      const rawPriceText = item.raw_price_text ?? item.raw_price ?? null;
      const parsedCurrency = String(item.parsed_currency ?? item.currency ?? 'IQD');
      const parsedPrice = Number(item.parsed_price ?? item.parsed_price_iqd ?? item.normalized_price_iqd ?? NaN);
      const normalizedIqd = Number(item.normalized_price_iqd ?? item.parsed_price_iqd ?? item.parsed_price ?? NaN);
      let regionId = item.region_id ?? null;
      let inferredRegion = false;

      if (!productId || !sourceId) {
        restore = { ok: false, skipped_reason: 'missing_product_or_source' };
      } else if (!Number.isFinite(parsedPrice) && !Number.isFinite(normalizedIqd)) {
        restore = { ok: false, skipped_reason: 'missing_price' };
      } else {
        if (!regionId) {
          const recentRegion = await db.execute(sql`
            select region_id
            from public.source_price_observations
            where product_id = ${productId}::uuid
              and source_id = ${sourceId}::uuid
              and region_id is not null
            order by observed_at desc
            limit 1
          `);
          regionId = (recentRegion.rows as any[])?.[0]?.region_id ?? null;
          inferredRegion = Boolean(regionId);
        }
        if (!regionId) {
          const fallbackRegion = await db.execute(sql`
            select id
            from public.regions
            where is_active = true
            order by case when code = 'BGD' then 0 else 1 end, created_at asc
            limit 1
          `);
          regionId = (fallbackRegion.rows as any[])?.[0]?.id ?? null;
          inferredRegion = Boolean(regionId);
        }

        if (!regionId) {
          restore = { ok: false, skipped_reason: 'missing_region' };
        } else {
          const priceValue = Number.isFinite(parsedPrice) ? parsedPrice : Number(normalizedIqd);
          const normalizedValue = Number.isFinite(normalizedIqd) ? Number(normalizedIqd) : (parsedCurrency === 'IQD' ? priceValue : null);

          const dup = await db.execute(sql`
            select id
            from public.source_price_observations
            where product_id = ${productId}::uuid
              and source_id = ${sourceId}::uuid
              and coalesce(source_url, '') = coalesce(${sourceUrl}, '')
              and abs(coalesce(normalized_price_iqd, price) - ${normalizedValue ?? priceValue}) <= 1
              and observed_at >= now() - interval '7 days'
            order by observed_at desc
            limit 1
          `);
          const dupId = (dup.rows as any[])?.[0]?.id ?? null;
          if (dupId) {
            restore = { ok: true, observation_id: dupId, duplicate: true, inferred_region: inferredRegion };
          } else {
            const insert = await db.execute(sql`
              insert into public.source_price_observations (
                source_id, product_id, region_id, price, currency, unit, source_url,
                observed_at, is_verified, verification_note, raw_price_text, parsed_currency,
                normalized_price_iqd, normalization_factor, is_price_anomaly, anomaly_reason,
                price_confidence
              ) values (
                ${sourceId}::uuid,
                ${productId}::uuid,
                ${regionId}::uuid,
                ${priceValue},
                ${parsedCurrency || 'IQD'},
                ${item.unit ?? null},
                ${sourceUrl},
                now(),
                true,
                ${`restored_from_quarantine:${id}`},
                ${rawPriceText},
                ${parsedCurrency || 'IQD'},
                ${normalizedValue},
                ${normalizedValue != null && Number.isFinite(priceValue) && priceValue ? (Number(normalizedValue) / Number(priceValue)) : 1},
                false,
                ${'restored_after_manual_review'},
                ${0.95}
              )
              returning id
            `);
            restore = {
              ok: true,
              observation_id: (insert.rows as any[])?.[0]?.id ?? null,
              duplicate: false,
              inferred_region: inferredRegion,
            };
          }
        }
      }
    }

    const mergedNote = [reviewNote, restoreObservation && restore && !restore.ok ? `restore_skip:${restore.skipped_reason}` : null]
      .filter(Boolean)
      .join(' | ') || null;

    const result = await db.execute(sql`
      update public.price_anomaly_quarantine
      set
        status = ${status},
        review_note = ${mergedNote},
        reviewed_at = now(),
        updated_at = now()
      where id = ${id}::uuid
      returning id, status, review_note, reviewed_at, updated_at
    `);
    const updated = (result.rows as any[])?.[0];
    if (!updated) return c.json({ error: 'not_found' }, 404);
    return c.json({ success: true, item: updated, restore_requested: restoreObservation, restore });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to update quarantine item' }, 500);
  }
});
