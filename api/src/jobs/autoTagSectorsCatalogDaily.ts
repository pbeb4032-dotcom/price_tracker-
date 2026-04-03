import { getDb, type Env } from '../db';
import { ensureAppSettingsSchema, getAppSetting, setAppSetting } from '../lib/appSettings';
import { retroTagSectorsFromCatalog } from './retroTagSectorsFromCatalog';

type AutoCatalogTagOpts = {
  force?: boolean;
};

function baghdadNowUtc(now: Date): Date {
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

export async function autoTagSectorsCatalogDaily(env: Env, opts?: AutoCatalogTagOpts): Promise<any> {
  const enabled = (process.env.AUTO_SECTOR_TAG_CATALOG_ENABLED ?? '0') === '1';
  if (!enabled && !opts?.force) return { ok: true, skipped: true, reason: 'disabled' };

  const scheduleHour = Math.max(0, Math.min(23, Number(process.env.AUTO_SECTOR_TAG_CATALOG_HOUR_BAGHDAD ?? 5)));
  const limitPerDay = Math.max(10, Math.min(2000, Number(process.env.AUTO_SECTOR_TAG_CATALOG_LIMIT_PER_DAY ?? 400)));
  const days = Math.max(7, Math.min(365, Number(process.env.AUTO_SECTOR_TAG_CATALOG_DAYS ?? 120)));
  const minSamples = Math.max(25, Math.min(2000, Number(process.env.AUTO_SECTOR_TAG_CATALOG_MIN_SAMPLES ?? 120)));
  const minConfidence = Math.max(0.1, Math.min(0.99, Number(process.env.AUTO_SECTOR_TAG_CATALOG_MIN_CONFIDENCE ?? 0.78)));
  const reviewMinConfidence = Math.max(0.0, Math.min(minConfidence, Number(process.env.AUTO_SECTOR_TAG_CATALOG_REVIEW_MIN_CONFIDENCE ?? 0.55)));
  const dryRun = (process.env.AUTO_SECTOR_TAG_CATALOG_DRY_RUN ?? '0') === '1';

  const now = new Date();
  const b = baghdadNowUtc(now);
  const today = ymd(b);

  // Only run after schedule hour (unless forced)
  if (!opts?.force) {
    const hh = b.getUTCHours();
    if (hh < scheduleHour) return { ok: true, skipped: true, reason: 'before_schedule', scheduleHour, now: b.toISOString() };
  }

  const db = getDb(env);
  await ensureAppSettingsSchema(db);

  const lockKey = 'auto_sector_catalog_lock';
  const hasLock = await tryAcquireLock(db, lockKey, 40);
  if (!hasLock) return { ok: true, skipped: true, reason: 'locked' };

  try {
    const last = await getAppSetting<any>(db, 'auto_sector_catalog_last_day');
    const lastDay = String(last?.day ?? '');
    if (!opts?.force && lastDay === today) return { ok: true, skipped: true, reason: 'already_ran', day: today };

    const r = await retroTagSectorsFromCatalog(env, {
      limit: limitPerDay,
      days,
      minSamples,
      dryRun,
      force: false,
      minConfidence,
      reviewMinConfidence,
      onlyMissingOrLowConfidence: true,
    });

    await setAppSetting(db, 'auto_sector_catalog_last_day', {
      day: today,
      ran_at: new Date().toISOString(),
      scheduleHour,
      limitPerDay,
      days,
      minSamples,
      minConfidence,
      reviewMinConfidence,
      dryRun,
      result: { scanned: r?.scanned ?? 0, tagged: r?.tagged ?? 0, reviewQueued: r?.reviewQueued ?? 0 },
    });

    return { ok: true, day: today, ...r };
  } finally {
    await releaseLock(db, lockKey);
  }
}
