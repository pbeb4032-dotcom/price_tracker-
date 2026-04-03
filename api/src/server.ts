import { serve } from '@hono/node-server';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import * as fs from 'node:fs';
import { dirname, resolve } from 'node:path';
import app from './index';
import { sql } from 'drizzle-orm';
import { getDb } from './db';
import { rollupSourceHealth } from './jobs/rollupSourceHealth';
import { fxUpdateDaily } from './jobs/fxUpdateDaily';
import { patchSourceAutoDisableSchema } from './jobs/patchSourceAutoDisableSchema';
import { patchViewsBestOffers } from './jobs/patchViewsBestOffers';
import { patchCategoryGroceriesKey } from './jobs/patchCategoryGroceriesKey';
import { patchTaxonomyOverridesSchema } from './jobs/patchTaxonomyOverridesSchema';
import { patchTaxonomyV2Schema } from './jobs/patchTaxonomyV2Schema';
import { patchPublicationGateSchema } from './jobs/patchPublicationGateSchema';
import { patchCanonicalIdentitySchema } from './jobs/patchCanonicalIdentitySchema';
import { patchCatalogTaxonomyGovernanceSchema } from './jobs/patchCatalogTaxonomyGovernanceSchema';
import { patchBarcodeResolutionSchema } from './jobs/patchBarcodeResolutionSchema';
import { patchGovernedFxSchema } from './jobs/patchGovernedFxSchema';
import { seedTaxonomyV2 } from './jobs/seedTaxonomyV2';
import { validateCandidateSources } from './jobs/validateCandidateSources';
import { activateCandidateSources } from './jobs/activateCandidateSources';
import { autoDiscoveryDaily } from './jobs/autoDiscoveryDaily';
import { autoTagSectorsCatalogDaily } from './jobs/autoTagSectorsCatalogDaily';
import { patchAppSettingsSchemaJob } from './jobs/patchAppSettingsSchema';
import { patchAdminHealthSchema } from './jobs/patchAdminHealthSchema';

// Monitoring imports
import {
  initSentry,
  getLogger,
  createPerformanceMiddleware,
  getSystemMetrics,
  monitorBackgroundJob,
  withErrorReporting
} from './lib/monitoring';

// New feature imports
import { initializeRedis } from './lib/cache.js';
import { initializeNotifications } from './lib/notifications.js';
import { metricsMiddleware, metrics } from './lib/metrics.js';
import { createRateLimiter } from './lib/rate-limiting.js';

// Load root .env (repo root)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Load .env from repo root (preferred), but also support api/.env for safety.
const envCandidates = [
  resolve(__dirname, '../../.env'), // repo root
  resolve(__dirname, '../.env'),   // api/.env (fallback)
  resolve(process.cwd(), '.env'),  // current working directory
];
let envLoadedFrom: string | null = null;
for (const candidate of envCandidates) {
  try {
    if (fs.existsSync(candidate)) {
      dotenv.config({ path: candidate });
      envLoadedFrom = candidate;
      break;
    }
  } catch {}
}

// Initialize monitoring
const logger = getLogger();
logger.info(`[api] env loaded from: ${envLoadedFrom ?? '(none)'}`);

// Initialize Sentry (if configured)
initSentry({
  SENTRY_DSN: process.env.SENTRY_DSN,
  SENTRY_ENVIRONMENT: process.env.NODE_ENV || 'development',
  LOG_LEVEL: process.env.LOG_LEVEL,
  ENABLE_PROFILING: process.env.ENABLE_SENTRY_PROFILING === 'true',
});

// Initialize Redis cache
await initializeRedis();

// Initialize notifications
await initializeNotifications();

// Initialize metrics collection
logger.info('All services initialized successfully');

const env = {
  DATABASE_URL: process.env.DATABASE_URL || '',
  APP_JWT_SECRET: process.env.APP_JWT_SECRET || process.env.JWT_SECRET || '',
  INTERNAL_JOB_SECRET: process.env.INTERNAL_JOB_SECRET,
  DEV_LOGIN_SECRET: process.env.DEV_LOGIN_SECRET,
};

const port = Number(process.env.API_PORT || 8787);

async function main() {
  logger.info('Starting Price Tracker API server', {
    port,
    environment: process.env.NODE_ENV || 'development',
    nodeVersion: process.version,
  });

  // Preflight: patch minimal schema needed by admin/health endpoints.
  // This avoids "first request 500" on older DB volumes.
  try {
    await patchAdminHealthSchema(env as any);
    logger.info('Admin health schema patched successfully');
  } catch (e: any) {
    logger.warn('patchAdminHealthSchema failed', {
      error: e?.message ?? e,
      stack: e?.stack,
    });
  }

  try {
    await patchPublicationGateSchema(env as any);
    logger.info('Publication gate schema patched successfully');
  } catch (e: any) {
    logger.warn('patchPublicationGateSchema failed', {
      error: e?.message ?? e,
      stack: e?.stack,
    });
  }

  try {
    await patchCanonicalIdentitySchema(env as any);
    logger.info('Canonical identity schema patched successfully');
  } catch (e: any) {
    logger.warn('patchCanonicalIdentitySchema failed', {
      error: e?.message ?? e,
      stack: e?.stack,
    });
  }

  try {
    await patchCatalogTaxonomyGovernanceSchema(env as any);
    logger.info('Catalog taxonomy governance schema patched successfully');
  } catch (e: any) {
    logger.warn('patchCatalogTaxonomyGovernanceSchema failed', {
      error: e?.message ?? e,
      stack: e?.stack,
    });
  }

  try {
    await patchBarcodeResolutionSchema(env as any);
    logger.info('Barcode resolution schema patched successfully');
  } catch (e: any) {
    logger.warn('patchBarcodeResolutionSchema failed', {
      error: e?.message ?? e,
      stack: e?.stack,
    });
  }

  try {
    await patchGovernedFxSchema(env as any);
    logger.info('Governed FX schema patched successfully');
  } catch (e: any) {
    logger.warn('patchGovernedFxSchema failed', {
      error: e?.message ?? e,
      stack: e?.stack,
    });
  }

  // Add middleware to the app
  app.use('*', metricsMiddleware);
  app.use('*', createRateLimiter());

  serve({
    port,
    fetch: (req) => app.fetch(req, env as any),
  });

  logger.info('API server started successfully', {
    port,
    healthEndpoint: `http://localhost:${port}/health`,
  });

  // Optional local scheduler (dev/standalone): dispatch price alerts + recompute trust periodically.
  // In production/Supabase, use pg_cron or the provided edge functions instead.
  const enableScheduler = (process.env.ENABLE_LOCAL_SCHEDULER ?? '1') !== '0';
  if (enableScheduler) {
    logger.info('Local scheduler enabled');

    let db;
    try {
      db = getDb(env as any);
      logger.info('Database connection established');
    } catch (e: any) {
      logger.error('FATAL: Database connection failed', {
        error: e?.message ?? e,
        stack: e?.stack,
      });
      process.exit(1);
    }

  // One-time schema compatibility (non-destructive) for Shadow Mode + health rollups + public-safe views.
  void safeRun('schema_compat_shadow_health', async () => {
    await db.execute(sql`
      alter table public.price_sources
        add column if not exists lifecycle_status text,
        add column if not exists crawl_enabled boolean,
        add column if not exists validation_state text,
        add column if not exists validation_score numeric(4,3),
        add column if not exists discovered_via text,
        add column if not exists discovery_tags jsonb,
        add column if not exists last_probe_at timestamptz,
        add column if not exists validated_at timestamptz,
        add column if not exists activated_at timestamptz
    `).catch(() => {});

    await db.execute(sql`
      update public.price_sources
        set lifecycle_status = coalesce(nullif(lifecycle_status,''), case when coalesce(is_active,false) then 'active' else 'active' end),
            crawl_enabled = coalesce(crawl_enabled, true),
            validation_state = coalesce(nullif(validation_state,''), 'unvalidated'),
            discovery_tags = coalesce(discovery_tags, '{}'::jsonb)
      where country_code='IQ'
    `).catch(() => {});

    await db.execute(sql`
      create table if not exists public.source_health_daily (
        day date not null,
        source_id uuid not null references public.price_sources(id) on delete cascade,
        domain text not null,
        successes int not null default 0,
        failures int not null default 0,
        anomalies int not null default 0,
        error_rate numeric(5,4) null,
        anomaly_rate numeric(5,4) null,
        last_success_at timestamptz null,
        last_error_at timestamptz null,
        created_at timestamptz not null default now(),
        primary key(day, source_id)
      )
    `).catch(() => {});


// Ensure ingestion_error_events exists (older DB volumes may miss it).
// Used by source_health and ingestion diagnostics.
await db.execute(sql`
  create table if not exists public.ingestion_error_events (
    id uuid primary key default gen_random_uuid(),
    run_id uuid null,
    frontier_id uuid null,
    source_domain text not null,
    url text not null,
    http_status int null,
    blocked_reason text null,
    error_code text null,
    error_message text null,
    created_at timestamptz not null default now()
  );
  create index if not exists idx_ingestion_error_events_domain_created
    on public.ingestion_error_events (source_domain, created_at desc);
  create index if not exists idx_ingestion_error_events_created
    on public.ingestion_error_events (created_at desc);
`).catch(() => {});

// Ensure domain_probe_queue exists (prevents 400 on /admin/probe_queue_stats).
await db.execute(sql`
  create table if not exists public.domain_probe_queue (
    id uuid primary key default gen_random_uuid(),
    source_domain text not null,
    probe_url text not null,
    status text not null default 'queued',
    priority int not null default 100,
    attempts int not null default 0,
    last_http_status int null,
    last_error_code text null,
    last_error_message text null,
    next_retry_at timestamptz null,
    started_at timestamptz null,
    completed_at timestamptz null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );
  create index if not exists idx_domain_probe_queue_status_retry
    on public.domain_probe_queue(status, next_retry_at);
  create index if not exists idx_domain_probe_queue_domain
    on public.domain_probe_queue(source_domain);
  create unique index if not exists uq_domain_probe_queue_active_domain
    on public.domain_probe_queue(source_domain)
    where status in ('queued','running');
`).catch(() => {});

    await db.execute(sql`
      create or replace view public.v_source_health_latest
      with (security_invoker = on) as
      select distinct on (sh.source_id)
        sh.source_id, sh.day, sh.domain, sh.successes, sh.failures, sh.anomalies,
        sh.error_rate, sh.anomaly_rate, sh.last_success_at, sh.last_error_at, sh.created_at
      from public.source_health_daily sh
      order by sh.source_id, sh.day desc, sh.created_at desc
    `).catch(() => {});

    // Ensure public views don't leak inactive/auto-disabled sources (critical for Shadow Mode)
    await db.execute(sql`
      create or replace view public.v_best_offers as
      select distinct on (spo.product_id, spo.region_id)
        spo.id as offer_id,
        spo.product_id,
        p.name_ar as product_name_ar,
        p.name_en as product_name_en,
        p.image_url as product_image_url,
        p.category,
        p.subcategory,
        p.unit,
        p.brand_ar,
        p.brand_en,
        p.barcode,
        p.size_value,
        p.size_unit,
        spo.price as base_price,
        spo.discount_price,
        coalesce(spo.discount_price, spo.price) as final_price,
        spo.delivery_fee,
        spo.currency,
        spo.in_stock,
        spo.source_url,
        spo.merchant_name,
        spo.observed_at,
        spo.region_id,
        r.name_ar as region_name_ar,
        r.name_en as region_name_en,
        ps.name_ar as source_name_ar,
        ps.domain as source_domain,
        ps.logo_url as source_logo_url,
        ps.source_kind,
        spo.source_id,
        spo.is_verified,
        spo.raw_price_text,
        spo.normalized_price_iqd,
        spo.is_price_anomaly,
        spo.anomaly_reason,
        spo.price_confidence
      from public.source_price_observations spo
      join public.products p on spo.product_id = p.id
      join public.regions r on spo.region_id = r.id
      join public.price_sources ps on spo.source_id = ps.id
      where spo.is_verified = true
        and p.is_active = true
        and p.condition = 'new'
        and spo.product_condition = 'new'
        and spo.in_stock = true
        and ps.is_active = true
        and coalesce(ps.auto_disabled,false) = false
      order by spo.product_id, spo.region_id, coalesce(spo.discount_price, spo.price) asc, spo.observed_at desc
    `).catch(() => {});

    await db.execute(sql`
      create or replace view public.v_product_all_offers
      with (security_invoker = on) as
      select
        spo.id as offer_id,
        spo.product_id,
        p.name_ar as product_name_ar,
        p.name_en as product_name_en,
        p.image_url as product_image_url,
        p.category,
        p.subcategory,
        p.unit,
        p.brand_ar,
        p.brand_en,
        spo.price as base_price,
        spo.discount_price,
        coalesce(spo.discount_price, spo.price) as final_price,
        spo.delivery_fee,
        spo.currency,
        spo.in_stock,
        spo.source_url,
        spo.merchant_name,
        spo.observed_at,
        spo.region_id,
        r.name_ar as region_name_ar,
        r.name_en as region_name_en,
        ps.name_ar as source_name_ar,
        ps.domain as source_domain,
        ps.logo_url as source_logo_url,
        ps.source_kind,
        spo.source_id,
        spo.is_verified,
        spo.raw_price_text,
        spo.normalized_price_iqd,
        spo.is_price_anomaly,
        spo.anomaly_reason,
        spo.price_confidence
      from public.source_price_observations spo
      join public.products p on spo.product_id = p.id
      join public.regions r on spo.region_id = r.id
      join public.price_sources ps on spo.source_id = ps.id
      where p.is_active = true
        and p.condition = 'new'
        and spo.product_condition = 'new'
        and ps.is_active = true
        and coalesce(ps.auto_disabled,false) = false
      order by coalesce(spo.discount_price, spo.price) asc, spo.observed_at desc
    `).catch(() => {});
  });

  // Ensure app_settings KV store exists (used by auto-discovery + rollups cursors)
  void safeRun('patch_app_settings_schema', async () => {
    await patchAppSettingsSchemaJob(env as any);
  });

  async function safeRun(label: string, fn: () => Promise<void>) {
    try {
      await fn();
      logger.debug(`Scheduler task completed: ${label}`);
    } catch (e) {
      logger.warn(`Scheduler task failed: ${label}`, {
        error: (e as any)?.message ?? e,
        stack: (e as any)?.stack,
      });
    }
  }

  // Dispatch triggered alerts into notifications every 10 minutes.
  setInterval(() => {
    void safeRun('dispatch_price_alerts', monitorBackgroundJob('dispatch_price_alerts', async () => {
      const result = await db.execute(sql`
        select count(*)::int as inserted
        from public.enqueue_triggered_price_alert_notifications(200, 180)
      `);
      const inserted = (result.rows as any[])[0]?.inserted || 0;
      logger.info('Price alerts dispatched', { count: inserted });
    }));
  }, 10 * 60 * 1000);

  // Recompute dynamic trust weights hourly (health + anomalies + crowd reports).
  setInterval(() => {
    void safeRun('recompute_trust', monitorBackgroundJob('recompute_trust', async () => {
      await db.execute(sql`
        alter table public.price_sources
          add column if not exists trust_weight_dynamic numeric(3,2),
          add column if not exists trust_last_scored_at timestamptz,
          add column if not exists trust_score_meta jsonb
      `);

      await db.execute(sql`
        with ok as (
          select source_id,
                 count(*)::int as successes,
                 sum(case when coalesce(is_price_anomaly,false) then 1 else 0 end)::int as anomalies
          from public.source_price_observations
          where created_at >= now() - (168 * interval '1 hour')
          group by source_id
        ),
        err as (
          select source_domain,
                 count(*)::int as failures
          from public.ingestion_error_events
          where created_at >= now() - (168 * interval '1 hour')
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
          where r.created_at >= now() - (168 * interval '1 hour')
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
        )
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
            'window_hours', 168,
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
      `);
      logger.info('Trust weights recomputed for all sources');
    }));
  }, 60 * 60 * 1000);

  
  // One-time patch: add auto-disable schema + relax best_offers view (prevents empty categories)
  void safeRun('schema_compat_auto_disable', async () => {
    await patchSourceAutoDisableSchema(env as any);
  });

  void safeRun('patch_views_best_offers', async () => {
    await patchViewsBestOffers(env as any);
  });

  // One-time data compat patch: normalize old category key 'grocery' -> 'groceries'
  void safeRun('patch_category_key_groceries', async () => {
    await patchCategoryGroceriesKey(env as any);
  });

  // One-time schema patch: grocery taxonomy + category overrides + FX meta/samples
  void safeRun('patch_taxonomy_overrides_schema', async () => {
    await patchTaxonomyOverridesSchema(env as any);
  });

  void safeRun('patch_taxonomy_v2_schema', async () => {
    await patchTaxonomyV2Schema(env as any);
  });

  void safeRun('patch_publication_gate_schema', async () => {
    await patchPublicationGateSchema(env as any);
  });

  void safeRun('patch_canonical_identity_schema', async () => {
    await patchCanonicalIdentitySchema(env as any);
  });

  void safeRun('patch_catalog_taxonomy_governance_schema', async () => {
    await patchCatalogTaxonomyGovernanceSchema(env as any);
  });

  void safeRun('patch_barcode_resolution_schema', async () => {
    await patchBarcodeResolutionSchema(env as any);
  });

  void safeRun('patch_governed_fx_schema', async () => {
    await patchGovernedFxSchema(env as any);
  });

  void safeRun('seed_taxonomy_v2', async () => {
    await seedTaxonomyV2(env as any);
  });

  // FX: ensure we have at least one rate row immediately (UI 'صيرفة' should not be empty)
  void safeRun('fx_update_daily_boot', async () => {
    await fxUpdateDaily(env as any, {});
  });


  // Roll up source health every hour (used by Source Health Dashboard)
  setInterval(() => {
    void safeRun('rollup_source_health', monitorBackgroundJob('rollup_source_health', async () => {
      await rollupSourceHealth(env as any, { hours: 24 });
      logger.info('Source health rolled up');
    }));
  }, 60 * 60 * 1000);

  // FX update: best-effort refresh every 6 hours (keeps gov/market rows current)
  setInterval(() => {
    void safeRun('fx_update_daily', monitorBackgroundJob('fx_update_daily', async () => {
      await fxUpdateDaily(env as any, {});
      logger.info('FX rates updated');
    }));
  }, 6 * 60 * 60 * 1000);

  // Shadow automation: validate candidates periodically; optional auto-activate passed candidates.
  const enableShadow = (process.env.ENABLE_SHADOW_AUTOMATION ?? '1') !== '0';
  if (enableShadow) {
    setInterval(() => {
      void safeRun('shadow_validate_candidates', async () => {
        await validateCandidateSources(env as any, { limit: 200 });
      });
    }, 6 * 60 * 60 * 1000);

    const autoActivate = (process.env.SHADOW_AUTO_ACTIVATE ?? '0') === '1';
    if (autoActivate) {
      setInterval(() => {
        void safeRun('shadow_activate_candidates', async () => {
          await activateCandidateSources(env as any, { limit: 200, minScore: 0.75 });
        });
      }, 12 * 60 * 60 * 1000);
    }
  }

  // Auto-Discovery Pipeline (Daily): continuously grow coverage across Iraq without manual clicks.
  // Runs best-effort. Safe: once per Baghdad day unless forced.
  const enableAutoDiscoveryScheduler = (process.env.ENABLE_AUTO_DISCOVERY_SCHEDULER ?? '1') !== '0';
  if (enableAutoDiscoveryScheduler) {
    setInterval(() => {
      void safeRun('auto_discovery_daily', async () => {
        await autoDiscoveryDaily(env as any, {});
      });
    }, 20 * 60 * 1000);
  }

  // Auto sector tagging from catalog (Daily): fills missing/weak sectors without polluting.
  // Runs best-effort. Safe: once per Baghdad day unless forced via API.
  const enableAutoSectorCatalogScheduler = (process.env.ENABLE_AUTO_SECTOR_TAG_CATALOG_SCHEDULER ?? '1') !== '0';
  if (enableAutoSectorCatalogScheduler) {
    setInterval(() => {
      void safeRun('auto_sector_tag_catalog_daily', async () => {
        await autoTagSectorsCatalogDaily(env as any, {});
      });
    }, 30 * 60 * 1000);
  }


  logger.info('Local scheduler enabled', {
    alertsInterval: '10 minutes',
    trustRecomputeInterval: '60 minutes',
    healthRollupInterval: '60 minutes',
    fxUpdateInterval: '6 hours',
    autoDiscoveryInterval: '20 minutes',
    autoSectorTagInterval: '30 minutes',
  });
  } else {
  // Scheduler disabled — still run the critical one-time startup patches so the app works.
  logger.info('Local scheduler disabled, running one-time startup patches only');
  const safeRun = async (label: string, fn: () => Promise<void>) => {
    try { await fn(); } catch (e) { console.warn(`[startup] ${label} failed:`, (e as any)?.message ?? e); }
  };

  void safeRun('schema_compat_auto_disable', async () => {
    await patchSourceAutoDisableSchema(env as any);
  });

  void safeRun('patch_views_best_offers', async () => {
    await patchViewsBestOffers(env as any);
  });

  void safeRun('patch_category_key_groceries', async () => {
    await patchCategoryGroceriesKey(env as any);
  });

  void safeRun('patch_taxonomy_overrides_schema', async () => {
    await patchTaxonomyOverridesSchema(env as any);
  });

  void safeRun('patch_taxonomy_v2_schema', async () => {
    await patchTaxonomyV2Schema(env as any);
  });

  void safeRun('patch_publication_gate_schema', async () => {
    await patchPublicationGateSchema(env as any);
  });

  void safeRun('patch_canonical_identity_schema', async () => {
    await patchCanonicalIdentitySchema(env as any);
  });

  void safeRun('patch_catalog_taxonomy_governance_schema', async () => {
    await patchCatalogTaxonomyGovernanceSchema(env as any);
  });

  void safeRun('patch_barcode_resolution_schema', async () => {
    await patchBarcodeResolutionSchema(env as any);
  });

  void safeRun('patch_governed_fx_schema', async () => {
    await patchGovernedFxSchema(env as any);
  });

  void safeRun('seed_taxonomy_v2', async () => {
    await seedTaxonomyV2(env as any);
  });

  void safeRun('fx_update_daily_boot', async () => {
    await fxUpdateDaily(env as any, {});
  });

  logger.info('Startup patches completed, scheduler disabled');
  }

}

// Create logs directory if it doesn't exist
import { mkdirSync } from 'fs';
try {
  mkdirSync('logs', { recursive: true });
} catch (error) {
  // Directory might already exist, ignore
}

// Start the server
void main().catch((error) => {
  console.error('FATAL: Server startup failed:', error);
  process.exit(1);
});
