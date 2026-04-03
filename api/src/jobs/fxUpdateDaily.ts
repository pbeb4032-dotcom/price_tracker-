import { sql } from 'drizzle-orm';
import { getDb, type Env } from '../db';

type FxOpts = {
  govUrl?: string;
  marketUrl?: string;
  govOverride?: number;
  marketOverride?: number;
  premiumPct?: number;
};

const DEFAULT_TIMEOUT_MS = 12000;
const DEFAULT_USD_RATES_API = 'https://open.er-api.com/v6/latest/USD';

async function fetchJson(url: string, timeoutMs: number) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ac.signal, headers: { 'User-Agent': 'price-tracker-iraq/1.0' } });
    if (!res.ok) return null;
    return await res.json().catch(() => null);
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function fetchText(url: string, timeoutMs: number) {
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

function pickLikelyIqdRate(text: string): number | null {
  const t = String(text || '');

  const parseToken = (s: string): number | null => {
    const cleaned = String(s || '').replace(/[٬،,]/g, '').trim();
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  };

  const usdPatterns: RegExp[] = [
    /\bUSD\b[^0-9]{0,60}([\d٬،,]{3,6}(?:\.\d+)?)/i,
    /U\.S\.?\s*dollar[^0-9]{0,60}([\d٬،,]{3,6}(?:\.\d+)?)/i,
    /\bUS\s*Dollar\b[^0-9]{0,60}([\d٬،,]{3,6}(?:\.\d+)?)/i,
    /دولار[^0-9]{0,60}([\d٬،,]{3,6}(?:\.\d+)?)/i,
  ];

  for (const re of usdPatterns) {
    const m = t.match(re);
    const n = m?.[1] ? parseToken(m[1]) : null;
    if (n && n >= 1000 && n <= 2000) return n;
  }

  const nums = t.match(/\b\d{3,5}(?:\.\d+)?\b/g) ?? [];
  const cand = nums.map(parseToken).filter((n): n is number => typeof n === 'number' && n >= 1000 && n <= 2000);
  if (!cand.length) return null;
  cand.sort((a, b) => a - b);
  return cand[Math.floor(cand.length / 2)];
}

function median(values: number[]): number | null {
  const v = (values ?? []).filter((n) => Number.isFinite(n));
  if (!v.length) return null;
  v.sort((a, b) => a - b);
  return v[Math.floor(v.length / 2)];
}

type FxSample = {
  url: string | null;
  hostname: string | null;
  mid: number | null;
  ok: boolean;
  error: string | null;
  sourceKind: 'cbi' | 'bank' | 'exchange_house' | 'media' | 'crowd' | 'api_fallback' | 'override' | 'legacy_db';
  city?: string | null;
};

async function collectSamples(urls: string[], timeoutMs: number, sourceKind: FxSample['sourceKind']): Promise<FxSample[]> {
  const out: FxSample[] = [];
  for (const u of urls) {
    if (!u) continue;
    try {
      const t = await fetchText(u, timeoutMs);
      const rate = t.ok ? pickLikelyIqdRate(t.text) : null;
      out.push({
        url: u,
        hostname: (() => { try { return new URL(u).hostname; } catch { return null; } })(),
        mid: rate,
        ok: Boolean(t.ok && rate),
        error: t.ok ? (rate ? null : 'parse_failed') : `http_${t.status}`,
        sourceKind,
      });
    } catch (e: any) {
      out.push({
        url: u,
        hostname: (() => { try { return new URL(u).hostname; } catch { return null; } })(),
        mid: null,
        ok: false,
        error: String(e?.message ?? 'fetch_failed').slice(0, 200),
        sourceKind,
      });
    }
  }
  return out;
}

function normalizeOverride(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n > 5000 && n < 300000) return Math.round(n / 100);
  if (n > 1000 && n < 3000) return Math.round(n);
  return null;
}

async function upsertLegacyRate(db: any, sourceType: 'gov' | 'market', sourceName: string, mid: number | null, buy: number | null, sell: number | null, isActive: boolean, meta: any) {
  if (!mid) return null;
  return db.execute(sql`
    insert into public.exchange_rates (
      source_type, source_name, rate_date,
      mid_iqd_per_usd, buy_iqd_per_usd, sell_iqd_per_usd,
      is_active, meta
    )
    values (
      ${sourceType}, ${sourceName}, current_date,
      ${mid}::numeric, ${buy}::numeric, ${sell}::numeric,
      ${isActive}, ${JSON.stringify(meta)}::jsonb
    )
    on conflict (rate_date, source_type, source_name) do update set
      mid_iqd_per_usd = excluded.mid_iqd_per_usd,
      buy_iqd_per_usd = excluded.buy_iqd_per_usd,
      sell_iqd_per_usd = excluded.sell_iqd_per_usd,
      is_active = excluded.is_active,
      meta = excluded.meta
  `).catch(() => null);
}

export async function fxUpdateDaily(env: Env, opts?: FxOpts): Promise<any> {
  const db = getDb(env);

  const govUrl = opts?.govUrl || process.env.FX_GOV_URL || '';
  const marketUrl = opts?.marketUrl || process.env.FX_MARKET_URL || '';
  const govOverride = normalizeOverride(opts?.govOverride ?? process.env.FX_GOV_OVERRIDE);
  const marketOverride = normalizeOverride(opts?.marketOverride ?? process.env.FX_MARKET_OVERRIDE);

  const govUrls = Array.from(new Set([govUrl, ...(String(process.env.FX_GOV_URLS ?? '').split(',').map((s) => s.trim()))].filter(Boolean)));
  const marketUrls = Array.from(new Set([marketUrl, ...(String(process.env.FX_MARKET_URLS ?? '').split(',').map((s) => s.trim()))].filter(Boolean)));

  const govSamples: FxSample[] = [];
  const marketSamples: FxSample[] = [];

  if (govOverride) govSamples.push({ url: null, hostname: 'override', mid: govOverride, ok: true, error: null, sourceKind: 'override' });
  if (marketOverride) marketSamples.push({ url: null, hostname: 'override', mid: marketOverride, ok: true, error: null, sourceKind: 'override' });

  if (govUrls.length) govSamples.push(...(await collectSamples(govUrls, DEFAULT_TIMEOUT_MS, 'cbi')));
  if (marketUrls.length) marketSamples.push(...(await collectSamples(marketUrls, DEFAULT_TIMEOUT_MS, 'exchange_house')));

  let govMid = median(govSamples.filter((s) => s.ok && s.mid).map((s) => Number(s.mid))) ?? null;
  let govMeta: any = { mode: 'direct', sources: govSamples };
  let govName = 'Gov: verified';

  if (!govMid) {
    const j = await fetchJson(DEFAULT_USD_RATES_API, DEFAULT_TIMEOUT_MS);
    const iqd = j?.rates?.IQD;
    if (typeof iqd === 'number' && iqd > 1000 && iqd < 2000) {
      govMid = iqd;
      govName = 'Gov: estimated fallback';
      govMeta = {
        mode: 'estimated_api_fallback',
        quality_flag: 'estimated',
        sources: [...govSamples, { url: DEFAULT_USD_RATES_API, hostname: 'open.er-api.com', mid: iqd, ok: true, error: null, sourceKind: 'api_fallback' }],
      };
    }
  }

  if (!govMid) {
    const latestGov = await db.execute(sql`
      select mid_iqd_per_usd
      from public.exchange_rates
      where source_type='gov'
      order by rate_date desc, created_at desc
      limit 1
    `).catch(() => ({ rows: [] as any[] }));
    const fallbackGov = Number((latestGov.rows as any[])[0]?.mid_iqd_per_usd ?? 0);
    if (fallbackGov > 0) {
      govMid = fallbackGov;
      govName = 'Gov: stale db fallback';
      govMeta = { mode: 'stale_db_fallback', quality_flag: 'stale', sources: govSamples };
    }
  }

  let marketMid = median(marketSamples.filter((s) => s.ok && s.mid).map((s) => Number(s.mid))) ?? null;
  let marketMeta: any = { mode: 'direct', quality_flag: 'verified', sources: marketSamples };
  let marketName = 'Market: verified';

  if (!marketMid) {
    const latestMarket = await db.execute(sql`
      select mid_iqd_per_usd, meta
      from public.exchange_rates
      where source_type='market'
      order by rate_date desc, created_at desc
      limit 1
    `).catch(() => ({ rows: [] as any[] }));
    const staleMarket = Number((latestMarket.rows as any[])[0]?.mid_iqd_per_usd ?? 0);
    if (staleMarket > 0) {
      marketMid = staleMarket;
      marketName = 'Market: stale db fallback';
      marketMeta = {
        mode: 'stale_db_fallback',
        quality_flag: 'stale',
        inherited_meta: (latestMarket.rows as any[])[0]?.meta ?? null,
        sources: marketSamples,
      };
    }
  }

  const govBuy = govMid ? Math.round(govMid - 2) : null;
  const govSell = govMid ? Math.round(govMid + 2) : null;
  const marketBuy = marketMid ? Math.round(marketMid - 5) : null;
  const marketSell = marketMid ? Math.round(marketMid + 5) : null;

  const rawSamples = [
    ...govSamples.map((s) => ({ ...s, source_type: 'gov' as const })),
    ...marketSamples.map((s) => ({ ...s, source_type: 'market' as const })),
  ];

  for (const s of rawSamples) {
    await db.execute(sql`
      insert into public.exchange_rate_samples (rate_date, source_type, source_name, source_url, hostname, mid_iqd_per_usd, ok, error, fetched_at)
      values (current_date, ${s.source_type}, ${String(s.hostname ?? 'unknown')}, ${s.url}, ${s.hostname}, ${s.mid}, ${s.ok}, ${s.error}, now())
    `).catch(() => {});

    await db.execute(sql`
      insert into public.fx_rate_raw (
        rate_date, source_name, source_kind, city,
        buy_rate, sell_rate, mid_rate, unit,
        source_url, observed_at, fetched_at,
        parser_confidence, raw_payload, is_valid, error
      )
      values (
        current_date,
        ${String(s.hostname ?? s.sourceKind)},
        ${s.sourceKind},
        ${s.city ?? null},
        ${s.mid ? Math.round(Number(s.mid) - 5) : null},
        ${s.mid ? Math.round(Number(s.mid) + 5) : null},
        ${s.mid},
        'per_1_usd',
        ${s.url},
        now(),
        now(),
        ${s.ok ? 0.95 : 0.20},
        ${JSON.stringify({ hostname: s.hostname, source_type: s.source_type })}::jsonb,
        ${s.ok},
        ${s.error}
      )
    `).catch(() => {});
  }

  const effectiveRateForPricing = marketMid ?? govMid ?? null;
  const qualityFlag = marketMid
    ? (marketMeta.quality_flag ?? 'verified')
    : govMid
      ? (govMeta.quality_flag === 'estimated' ? 'estimated_official_only' : 'official_only')
      : 'unavailable';

  await db.execute(sql`
    insert into public.fx_rate_effective (
      rate_date,
      official_rate,
      market_buy_baghdad,
      market_sell_baghdad,
      market_mid_baghdad,
      effective_rate_for_pricing,
      quality_flag,
      based_on_n_sources,
      meta,
      last_verified_at,
      updated_at
    )
    values (
      current_date,
      ${govMid},
      ${marketBuy},
      ${marketSell},
      ${marketMid},
      ${effectiveRateForPricing},
      ${qualityFlag},
      ${rawSamples.filter((s) => s.ok && s.mid).length},
      ${JSON.stringify({ gov: govMeta, market: marketMeta })}::jsonb,
      now(),
      now()
    )
    on conflict (rate_date) do update set
      official_rate = excluded.official_rate,
      market_buy_baghdad = excluded.market_buy_baghdad,
      market_sell_baghdad = excluded.market_sell_baghdad,
      market_mid_baghdad = excluded.market_mid_baghdad,
      effective_rate_for_pricing = excluded.effective_rate_for_pricing,
      quality_flag = excluded.quality_flag,
      based_on_n_sources = excluded.based_on_n_sources,
      meta = excluded.meta,
      last_verified_at = excluded.last_verified_at,
      updated_at = now()
  `).catch(() => {});

  await upsertLegacyRate(db, 'gov', govName, govMid, govBuy, govSell, Boolean(govMid), {
    ...govMeta,
    quality_flag: govMeta.quality_flag ?? (govName.includes('verified') ? 'verified' : 'stale'),
    authoritative: !String(govName).includes('estimated'),
  });

  if (marketMid) {
    await upsertLegacyRate(db, 'market', marketName, marketMid, marketBuy, marketSell, true, {
      ...marketMeta,
      authoritative: marketMeta.mode === 'direct' || marketMeta.mode === 'override',
      allow_pricing: marketMeta.mode !== 'derived',
    });
  }

  return {
    ok: true,
    gov: { mid: govMid, name: govName, meta: govMeta },
    market: { mid: marketMid, name: marketName, meta: marketMeta },
    effective_rate_for_pricing: effectiveRateForPricing,
    quality_flag: qualityFlag,
  };
}
