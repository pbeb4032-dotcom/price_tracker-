import { sql } from 'drizzle-orm';
import { getDb, type Env } from '../db';
import { discoverSources } from './discoverSources';
import { validateCandidateSources } from './validateCandidateSources';
import { activateCandidateSources } from './activateCandidateSources';
import { seedCrawlFrontier } from './seedFrontier';
import { discoverProductApis } from './discoverProductApis';
import { ensureAppSettingsSchema, getAppSetting, setAppSetting } from '../lib/appSettings';
import { DISCOVERY_SECTORS, IRAQ_PROVINCES, getCoverageStats } from './coverageStats';

type AutoDiscoveryOpts = {
  force?: boolean;
  dryRun?: boolean;
  // override defaults (optional)
  scheduleHourBaghdad?: number;
  addPerDay?: number;
  bucketsPerRun?: number;
  validateLimit?: number;
  activateLimit?: number;
  minScore?: number;
  ingestApis?: boolean;
  apiMaxPages?: number;
  seedMaxUrls?: number;
  autotune?: boolean;
  underservedTopN?: number;
};

function baghdadNowUtc(now: Date): Date {
  // Convert "now" into Baghdad local date/time but represent it as a UTC Date.
  // (We only use YMD + hour, so this is sufficient.)
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Baghdad',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    const parts = fmt.formatToParts(now);
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? '0');
    const y = get('year');
    const m = get('month');
    const d = get('day');
    const hh = get('hour');
    const mm = get('minute');
    const ss = get('second');
    return new Date(Date.UTC(y, m - 1, d, hh, mm, ss));
  } catch {
    return new Date(now.getTime() + 3 * 60 * 60 * 1000);
  }
}

function ymd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

async function getActiveSourceCount(db: any): Promise<number> {
  const r = await db
    .execute(sql`select count(*)::int as n from public.price_sources where country_code='IQ'`)
    .catch(() => ({ rows: [] as any[] }));
  return Number((r.rows as any[])[0]?.n ?? 0);
}

async function tryAcquireLock(db: any, key: string, ttlMinutes: number): Promise<boolean> {
  const existing = await getAppSetting<any>(db, key).catch(() => null);
  const until = existing?.until ? Date.parse(String(existing.until)) : NaN;
  if (Number.isFinite(until) && until > Date.now()) return false;
  await setAppSetting(db, key, { until: new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString(), acquired_at: new Date().toISOString() });
  return true;
}

async function releaseLock(db: any, key: string): Promise<void> {
  await setAppSetting(db, key, { until: new Date(0).toISOString(), released_at: new Date().toISOString() });
}

function avg(nums: number[]): number {
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

type MetricsRun = {
  day: string;
  inserted: number;
  validated: number;
  passed: number;
  failed: number;
  activated: number;
  addPerDay: number;
  underservedProvinces: string[];
  duration_ms: number;
  ts: string;
};

async function loadMetrics(db: any): Promise<MetricsRun[]> {
  const m = await getAppSetting<any>(db, 'auto_discovery_metrics').catch(() => null);
  const runs = Array.isArray(m?.runs) ? m.runs : [];
  return runs as MetricsRun[];
}

async function saveMetrics(db: any, runs: MetricsRun[]) {
  const capped = runs.slice(-30);
  await setAppSetting(db, 'auto_discovery_metrics', { runs: capped });
}

function autotuneAddPerDay(current: number, runs: MetricsRun[], minAdd: number, maxAdd: number): { next: number; reason: string } {
  const recent = runs.slice(-3);
  if (!recent.length) return { next: clamp(current, minAdd, maxAdd), reason: 'no_history' };

  const qualities = recent.map((r) => (r.validated > 0 ? r.passed / r.validated : 0));
  const failRates = recent.map((r) => (r.validated > 0 ? r.failed / r.validated : 0));
  const actRates = recent.map((r) => (r.passed > 0 ? r.activated / r.passed : 0));

  const q = avg(qualities);
  const f = avg(failRates);
  const a = avg(actRates);

  if (q >= 0.75 && f <= 0.20 && a >= 0.50) {
    return { next: clamp(Math.round(current * 1.2), minAdd, maxAdd), reason: `increase (quality=${q.toFixed(2)}, act=${a.toFixed(2)})` };
  }
  if (q <= 0.40 || f >= 0.55) {
    return { next: clamp(Math.round(current * 0.7), minAdd, maxAdd), reason: `decrease (quality=${q.toFixed(2)}, fail=${f.toFixed(2)})` };
  }
  return { next: clamp(current, minAdd, maxAdd), reason: `keep (quality=${q.toFixed(2)})` };
}

export async function autoDiscoveryDaily(env: Env, opts?: AutoDiscoveryOpts): Promise<any> {
  const db = getDb(env);
  await ensureAppSettingsSchema(db);

  const now = new Date();
  const bg = baghdadNowUtc(now);
  const today = ymd(bg);
  const hour = bg.getUTCHours();

  const settings = (await getAppSetting<any>(db, 'auto_discovery_settings').catch(() => null)) ?? {};

  const enabled = typeof settings.enabled === 'boolean'
    ? Boolean(settings.enabled)
    : (process.env.AUTO_DISCOVERY_ENABLED ?? '0') === '1';

  const scheduleHour = clamp(Number(opts?.scheduleHourBaghdad ?? settings.scheduleHourBaghdad ?? process.env.AUTO_DISCOVERY_HOUR_BAGHDAD ?? 4), 0, 23);
  const bucketsPerRun = clamp(Number(opts?.bucketsPerRun ?? settings.bucketsPerRun ?? process.env.AUTO_DISCOVERY_BUCKETS ?? 6), 1, 20);
  const validateLimit = clamp(Number(opts?.validateLimit ?? settings.validateLimit ?? process.env.AUTO_DISCOVERY_VALIDATE_LIMIT ?? 200), 1, 500);
  const activateLimit = clamp(Number(opts?.activateLimit ?? settings.activateLimit ?? process.env.AUTO_DISCOVERY_ACTIVATE_LIMIT ?? 300), 1, 2000);
  const minScore = clamp(Number(opts?.minScore ?? settings.minScore ?? process.env.AUTO_DISCOVERY_MIN_SCORE ?? 0.75), 0, 1);
  const ingestApis = Boolean(opts?.ingestApis ?? settings.ingestApis ?? ((process.env.AUTO_DISCOVERY_INGEST_APIS ?? '1') === '1'));
  const apiMaxPages = clamp(Number(opts?.apiMaxPages ?? settings.apiMaxPages ?? process.env.AUTO_DISCOVERY_API_MAX_PAGES ?? 1), 0, 10);
  const seedMaxUrls = clamp(Number(opts?.seedMaxUrls ?? settings.seedMaxUrls ?? process.env.AUTO_DISCOVERY_SEED_MAX_URLS ?? 8000), 0, 50000);
  const dryRun = Boolean(opts?.dryRun ?? ((process.env.AUTO_DISCOVERY_DRY_RUN ?? '0') === '1'));

  const autotuneEnabled = Boolean(opts?.autotune ?? settings.autotune ?? ((process.env.AUTO_DISCOVERY_AUTOTUNE ?? '1') === '1'));
  const minAdd = clamp(Number(settings.addMin ?? process.env.AUTO_DISCOVERY_ADD_MIN ?? 20), 1, 5000);
  const maxAdd = clamp(Number(settings.addMax ?? process.env.AUTO_DISCOVERY_ADD_MAX ?? 600), minAdd, 10000);
  const underservedTopN = clamp(Number(opts?.underservedTopN ?? settings.underservedTopN ?? process.env.AUTO_DISCOVERY_UNDERSERVED_TOP ?? 6), 1, 18);

  let addPerDay = clamp(Number(opts?.addPerDay ?? settings.addPerDay ?? process.env.AUTO_DISCOVERY_ADD_PER_DAY ?? 60), minAdd, maxAdd);

  const state = (await getAppSetting<any>(db, 'auto_discovery_state').catch(() => null)) ?? {};
  const lastRunDay = String(state.last_run_day ?? '');

  if (!enabled && !opts?.force) return { ok: true, skipped: true, reason: 'disabled', enabled };
  if (!opts?.force) {
    if (lastRunDay === today) return { ok: true, skipped: true, reason: 'already_ran_today', today, enabled };
    if (hour < scheduleHour) return { ok: true, skipped: true, reason: 'too_early', today, hour, scheduleHour, enabled };
  }

  const lockOk = await tryAcquireLock(db, 'auto_discovery_lock', 45);
  if (!lockOk) return { ok: true, skipped: true, reason: 'locked', enabled };

  const start = Date.now();
  try {
    const runs = await loadMetrics(db);
    let tune = { next: addPerDay, reason: 'disabled' };
    if (autotuneEnabled) {
      tune = autotuneAddPerDay(addPerDay, runs, minAdd, maxAdd);
      addPerDay = tune.next;
    }

    // Pick underserved provinces automatically (bottom-N by active source count)
    const cov = await getCoverageStats(env);
    const underserved = (cov?.provinces ?? [])
      .slice(0, underservedTopN)
      .map((x: any) => String(x.name))
      .filter(Boolean);

    // Sector list: we still rotate sectors but keep it stable.
    let sectorIdx = Number(state.sector_idx ?? 0);
    if (!Number.isFinite(sectorIdx) || sectorIdx < 0) sectorIdx = 0;

    const perBucket = Math.max(1, Math.ceil(addPerDay / bucketsPerRun));

    let inserted = 0;
    let validated = 0;
    let passed = 0;
    let failed = 0;
    let activated = 0;
    const bucketReports: any[] = [];

    for (let b = 0; b < bucketsPerRun; b++) {
      const province = underserved.length ? underserved[b % underserved.length] : IRAQ_PROVINCES[b % IRAQ_PROVINCES.length];
      const sector = DISCOVERY_SECTORS[sectorIdx % DISCOVERY_SECTORS.length];
      sectorIdx += 1;

      const current = await getActiveSourceCount(db);
      const target = current + perBucket;

      const d = await discoverSources(env, {
        target,
        sectors: sector ? [sector] : [],
        provinces: province ? [province] : [],
        countryCode: 'IQ',
        dryRun,
      });

      inserted += Number(d?.inserted ?? 0);

      const v = await validateCandidateSources(env, { limit: validateLimit });
      validated += Number(v?.validated ?? 0);
      passed += Number(v?.passed ?? 0);
      failed += Number(v?.failed ?? 0);

      const a = await activateCandidateSources(env, { limit: activateLimit, minScore });
      activated += Number(a?.activated ?? 0);

      bucketReports.push({ bucket: b + 1, province, sector, target, discovered: d, validated: v?.validated ?? 0, passed: v?.passed ?? 0, failed: v?.failed ?? 0, activated: a?.activated ?? 0 });
    }

    // Seed crawl frontier for newly activated sources (best-effort)
    if (!dryRun) {
      await seedCrawlFrontier(env, { maxUrls: seedMaxUrls, sitemapMaxPerDomain: 20000 }).catch(() => null);
    }

    // Optional: discover product APIs for newly activated sources (cheap wins)
    if (!dryRun && ingestApis && apiMaxPages > 0) {
      await discoverProductApis(env, { ingestNow: true, maxPages: apiMaxPages }).catch(() => null);
    }

    const duration_ms = Date.now() - start;

    // Persist state for "once per day" + cursors
    await setAppSetting(db, 'auto_discovery_state', {
      last_run_day: today,
      last_run_at: new Date().toISOString(),
      sector_idx: sectorIdx,
      last_add_per_day: addPerDay,
      last_autotune_reason: autotuneEnabled ? tune.reason : null,
      last_underserved_provinces: underserved,
      dryRun,
    });

    // Append metrics
    const run: MetricsRun = {
      day: today,
      inserted,
      validated,
      passed,
      failed,
      activated,
      addPerDay,
      underservedProvinces: underserved,
      duration_ms,
      ts: new Date().toISOString(),
    };
    await saveMetrics(db, [...runs, run]);

    // Also keep settings current (so next day uses tuned addPerDay)
    await setAppSetting(db, 'auto_discovery_settings', {
      ...settings,
      enabled,
      scheduleHourBaghdad: scheduleHour,
      addPerDay,
      addMin: minAdd,
      addMax: maxAdd,
      bucketsPerRun,
      validateLimit,
      activateLimit,
      minScore,
      ingestApis,
      apiMaxPages,
      seedMaxUrls,
      autotune: autotuneEnabled,
      underservedTopN,
    });

    return {
      ok: true,
      today,
      scheduleHour,
      hour,
      enabled,
      dryRun,
      autotune: autotuneEnabled ? { applied: true, reason: tune.reason } : { applied: false },
      plan: { addPerDay, bucketsPerRun, perBucket, underservedProvinces: underserved },
      totals: { inserted, validated, passed, failed, activated },
      buckets: bucketReports,
      duration_ms,
    };
  } finally {
    await releaseLock(db, 'auto_discovery_lock');
  }
}
