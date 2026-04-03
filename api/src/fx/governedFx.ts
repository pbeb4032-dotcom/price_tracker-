import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Env } from '../db';
import { getDb } from '../db';

export type FxOpts = {
  govUrl?: string;
  marketUrl?: string;
  govOverride?: number;
  marketOverride?: number;
  premiumPct?: number;
  timeoutMs?: number;
};

type DbLike = {
  execute: (query: any) => Promise<{ rows?: unknown[] }>;
};

type SourceKind =
  | 'official'
  | 'market_exchange_house'
  | 'bank'
  | 'transfer'
  | 'regional_market'
  | 'media_reference'
  | 'api_fallback'
  | 'override';

type RateType = 'official' | 'market' | 'bank' | 'transfer' | 'regional';
type PublicationStatus = 'current' | 'stale' | 'frozen' | 'fallback' | 'unavailable';

type GovernedFxSource = {
  id: string;
  sourceCode: string;
  sourceName: string;
  sourceKind: SourceKind;
  rateType: RateType;
  regionKey: string;
  fetchUrl: string | null;
  parserType: 'text_iqd' | 'json_usd_rates' | 'manual_override';
  parserVersion: string;
  trustScore: number;
  freshnessSlaMinutes: number;
  priority: number;
  parserConfig: Record<string, unknown>;
};

export type GovernedFxObservation = {
  observationId?: string | null;
  sourceId: string;
  sourceCode: string;
  sourceName: string;
  sourceKind: SourceKind;
  rateType: RateType;
  regionKey: string;
  observedAt: string;
  parseStatus: 'ok' | 'parse_failed' | 'http_error' | 'stale' | 'invalid';
  midRate: number | null;
  buyRate: number | null;
  sellRate: number | null;
  trustScore: number;
  freshnessSlaMinutes: number;
  priority: number;
  parserVersion: string;
  rawPayload?: Record<string, unknown>;
  anomalyFlags?: string[];
  error?: string | null;
};

type PreviousPublication = {
  midRate: number | null;
  buyRate: number | null;
  sellRate: number | null;
  publicationStatus: PublicationStatus | null;
  qualityFlag: string | null;
  publishedAt: string | null;
  sourceSummary?: unknown;
  decisionMeta?: unknown;
};

export type FxPublicationInputDecision = {
  sourceId: string;
  sourceCode: string;
  sourceName: string;
  sourceKind: SourceKind;
  observationId: string | null;
  accepted: boolean;
  weight: number;
  rejectReason: string | null;
  midRate: number | null;
  observedAt: string | null;
};

export type FxPublicationDecision = {
  rateType: RateType;
  regionKey: string;
  publicationStatus: PublicationStatus;
  buyRate: number | null;
  sellRate: number | null;
  midRate: number | null;
  effectiveForPricing: boolean;
  qualityFlag: string;
  basedOnNSources: number;
  confidence: number | null;
  freshnessSeconds: number | null;
  sourceSummary: Record<string, unknown>[];
  decisionMeta: Record<string, unknown>;
  inputs: FxPublicationInputDecision[];
};

type ExchangeRateRow = {
  id: string;
  rate_date: string;
  source_type: 'gov' | 'market';
  source_name: string;
  buy_iqd_per_usd: number | null;
  sell_iqd_per_usd: number | null;
  mid_iqd_per_usd: number | null;
  is_active: boolean;
  created_at: string | null;
  meta: Record<string, unknown>;
};

const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_USD_RATES_API = 'https://open.er-api.com/v6/latest/USD';
const DEFAULT_FALLBACK_FX = 1470;
const OFFICIAL_REGION_KEY = 'country:iq';
const MARKET_REGION_KEY = 'city:baghdad';

function shaShort(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 10);
}

function asNum(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function roundRate(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(Number(value))) return null;
  return Number(Number(value).toFixed(4));
}

function normalizeOverride(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n > 5000 && n < 300000) return Math.round(n / 100);
  if (n > 1000 && n < 3000) return Math.round(n);
  return null;
}

function normalizeUrlList(primary: string | undefined, csv: string | undefined): string[] {
  const values = [primary ?? '', ...(String(csv ?? '').split(',').map((item) => item.trim()))]
    .map((item) => item.trim())
    .filter(Boolean);
  return Array.from(new Set(values));
}

function parseTokenNumber(s: string): number | null {
  const cleaned = String(s || '').replace(/[٬،,]/g, '').trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function pickLikelyIqdRate(text: string): number | null {
  const t = String(text || '');
  const usdPatterns: RegExp[] = [
    /\bUSD\b[^0-9]{0,60}([\d٬،,]{3,6}(?:\.\d+)?)/i,
    /U\.S\.?\s*dollar[^0-9]{0,60}([\d٬،,]{3,6}(?:\.\d+)?)/i,
    /\bUS\s*Dollar\b[^0-9]{0,60}([\d٬،,]{3,6}(?:\.\d+)?)/i,
    /دولار[^0-9]{0,60}([\d٬،,]{3,6}(?:\.\d+)?)/i,
  ];

  for (const re of usdPatterns) {
    const m = t.match(re);
    const n = m?.[1] ? parseTokenNumber(m[1]) : null;
    if (n && n >= 1000 && n <= 2000) return n;
  }

  const nums = t.match(/\b\d{3,5}(?:\.\d+)?\b/g) ?? [];
  const candidates = nums
    .map(parseTokenNumber)
    .filter((n): n is number => typeof n === 'number' && n >= 1000 && n <= 2000);
  if (!candidates.length) return null;
  candidates.sort((a, b) => a - b);
  return candidates[Math.floor(candidates.length / 2)];
}

async function fetchJson(url: string, timeoutMs: number): Promise<{ ok: boolean; status: number; body: any | null }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'price-tracker-iraq/1.0' },
    });
    if (!res.ok) return { ok: false, status: res.status, body: null };
    return { ok: true, status: res.status, body: await res.json().catch(() => null) };
  } catch {
    return { ok: false, status: 0, body: null };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchText(url: string, timeoutMs: number): Promise<{ ok: boolean; status: number; text: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'price-tracker-iraq/1.0' },
    });
    return {
      ok: res.ok,
      status: res.status,
      text: await res.text().catch(() => ''),
    };
  } catch {
    return { ok: false, status: 0, text: '' };
  } finally {
    clearTimeout(timeout);
  }
}

export function weightedMedian(entries: Array<{ value: number; weight: number }>): number | null {
  const usable = entries
    .filter((entry) => Number.isFinite(entry.value) && Number.isFinite(entry.weight) && entry.weight > 0)
    .sort((a, b) => a.value - b.value);
  if (!usable.length) return null;
  const totalWeight = usable.reduce((sum, entry) => sum + entry.weight, 0);
  let cumulative = 0;
  for (const entry of usable) {
    cumulative += entry.weight;
    if (cumulative >= totalWeight / 2) return entry.value;
  }
  return usable[usable.length - 1]?.value ?? null;
}

function freshnessSeconds(observation: GovernedFxObservation, nowMs: number = Date.now()): number {
  const ts = Date.parse(observation.observedAt);
  if (!Number.isFinite(ts)) return Number.MAX_SAFE_INTEGER;
  return Math.max(0, Math.round((nowMs - ts) / 1000));
}

function isFreshObservation(observation: GovernedFxObservation, nowMs: number = Date.now()): boolean {
  return freshnessSeconds(observation, nowMs) <= observation.freshnessSlaMinutes * 60;
}

function midInExpectedRange(midRate: number | null): boolean {
  return midRate != null && Number.isFinite(midRate) && midRate >= 1000 && midRate <= 2000;
}

function sourceWeight(observation: GovernedFxObservation): number {
  const freshnessFactor = Math.max(
    0.2,
    1 - Math.min(1, freshnessSeconds(observation) / Math.max(60, observation.freshnessSlaMinutes * 60)),
  );
  const trust = Math.max(0.1, Math.min(1, observation.trustScore));
  const authoritativeBoost = observation.sourceKind === 'official' || observation.sourceKind === 'override' ? 1.2 : 1;
  const priorityFactor = Math.max(0.5, 1.25 - Math.min(1, observation.priority / 200));
  return Number((trust * freshnessFactor * authoritativeBoost * priorityFactor).toFixed(4));
}

function buildSourceSummary(inputs: FxPublicationInputDecision[]): Record<string, unknown>[] {
  return inputs
    .filter((input) => input.accepted)
    .sort((left, right) => right.weight - left.weight)
    .map((input) => ({
      source_code: input.sourceCode,
      source_name: input.sourceName,
      source_kind: input.sourceKind,
      weight: input.weight,
      mid_rate: input.midRate,
      observed_at: input.observedAt,
    }));
}

function deriveBandAroundMid(mid: number | null, spread: number): { buy: number | null; sell: number | null } {
  if (mid == null) return { buy: null, sell: null };
  return {
    buy: roundRate(mid - spread),
    sell: roundRate(mid + spread),
  };
}

function normalizePublicationFallback(
  rateType: RateType,
  regionKey: string,
  previous: PreviousPublication | null,
  status: PublicationStatus,
  qualityFlag: string,
  reason: string,
  inputs: FxPublicationInputDecision[],
  effectiveForPricing: boolean,
): FxPublicationDecision {
  return {
    rateType,
    regionKey,
    publicationStatus: status,
    buyRate: previous?.buyRate ?? null,
    sellRate: previous?.sellRate ?? null,
    midRate: previous?.midRate ?? null,
    effectiveForPricing,
    qualityFlag,
    basedOnNSources: inputs.filter((item) => item.accepted).length,
    confidence: previous?.midRate ? 0.55 : 0,
    freshnessSeconds: previous?.publishedAt ? Math.max(0, Math.round((Date.now() - Date.parse(previous.publishedAt)) / 1000)) : null,
    sourceSummary: buildSourceSummary(inputs),
    decisionMeta: {
      mode: 'fallback_previous_publication',
      reason,
      previous_publication_status: previous?.publicationStatus ?? null,
      previous_quality_flag: previous?.qualityFlag ?? null,
    },
    inputs,
  };
}

function buildInputDecisions(
  observations: GovernedFxObservation[],
  nowMs: number,
): FxPublicationInputDecision[] {
  return observations.map((observation) => {
    let rejectReason: string | null = null;
    if (observation.parseStatus !== 'ok') rejectReason = observation.parseStatus;
    else if (!midInExpectedRange(observation.midRate)) rejectReason = 'mid_out_of_range';
    else if (!isFreshObservation(observation, nowMs)) rejectReason = 'stale';

    return {
      sourceId: observation.sourceId,
      sourceCode: observation.sourceCode,
      sourceName: observation.sourceName,
      sourceKind: observation.sourceKind,
      observationId: observation.observationId ?? null,
      accepted: rejectReason == null,
      weight: rejectReason == null ? sourceWeight(observation) : 0,
      rejectReason,
      midRate: observation.midRate,
      observedAt: observation.observedAt,
    };
  });
}

export function decideOfficialPublication(args: {
  observations: GovernedFxObservation[];
  previous: PreviousPublication | null;
  nowMs?: number;
}): FxPublicationDecision {
  const nowMs = args.nowMs ?? Date.now();
  const inputs = buildInputDecisions(args.observations, nowMs);
  const accepted = args.observations
    .map((observation, index) => ({ observation, input: inputs[index] }))
    .filter((row) => row.input.accepted);

  if (!accepted.length) {
    return normalizePublicationFallback(
      'official',
      OFFICIAL_REGION_KEY,
      args.previous,
      args.previous?.midRate ? 'stale' : 'unavailable',
      args.previous?.midRate ? 'stale' : 'unavailable',
      'no_fresh_official_observations',
      inputs,
      !args.previous?.midRate,
    );
  }

  const authoritative = accepted
    .filter((row) => row.observation.sourceKind === 'official' || row.observation.sourceKind === 'override')
    .sort((left, right) => {
      const trustDiff = right.observation.trustScore - left.observation.trustScore;
      if (trustDiff !== 0) return trustDiff;
      const priorityDiff = left.observation.priority - right.observation.priority;
      if (priorityDiff !== 0) return priorityDiff;
      return freshnessSeconds(left.observation, nowMs) - freshnessSeconds(right.observation, nowMs);
    });

  const selected = authoritative[0] ?? accepted.sort((left, right) => right.input.weight - left.input.weight)[0];
  const selectedMid = roundRate(selected?.observation.midRate ?? null);

  if (
    selectedMid != null &&
    args.previous?.midRate != null &&
    selected.observation.sourceKind === 'api_fallback'
  ) {
    const delta = Math.abs(selectedMid - args.previous.midRate) / Math.max(args.previous.midRate, 1);
    if (delta > 0.01 && authoritative.length === 0) {
      return {
        ...normalizePublicationFallback(
          'official',
          OFFICIAL_REGION_KEY,
          args.previous,
          'frozen',
          'anomaly_frozen',
          'official_api_fallback_delta_too_large',
          inputs,
          false,
        ),
        basedOnNSources: accepted.length,
        sourceSummary: buildSourceSummary(inputs),
        decisionMeta: {
          mode: 'frozen_previous_publication',
          reason: 'official_api_fallback_delta_too_large',
          previous_mid_rate: args.previous.midRate,
          candidate_mid_rate: selectedMid,
          delta_ratio: Number(delta.toFixed(6)),
        },
      };
    }
  }

  const band = deriveBandAroundMid(selectedMid, 2);
  const qualityFlag = selected.observation.sourceKind === 'api_fallback' ? 'estimated' : 'verified';
  const publicationStatus: PublicationStatus = selected.observation.sourceKind === 'api_fallback' ? 'fallback' : 'current';
  const confidence = selected.observation.sourceKind === 'api_fallback' ? 0.72 : 0.97;

  return {
    rateType: 'official',
    regionKey: OFFICIAL_REGION_KEY,
    publicationStatus,
    buyRate: roundRate(selected.observation.buyRate ?? band.buy),
    sellRate: roundRate(selected.observation.sellRate ?? band.sell),
    midRate: selectedMid,
    effectiveForPricing: false,
    qualityFlag,
    basedOnNSources: accepted.length,
    confidence,
    freshnessSeconds: freshnessSeconds(selected.observation, nowMs),
    sourceSummary: buildSourceSummary(inputs),
    decisionMeta: {
      mode: authoritative.length ? 'authoritative_pick' : 'fallback_pick',
      selected_source_code: selected.observation.sourceCode,
      selected_source_kind: selected.observation.sourceKind,
    },
    inputs,
  };
}

export function decideMarketPublication(args: {
  observations: GovernedFxObservation[];
  previous: PreviousPublication | null;
  officialDecision: FxPublicationDecision | null;
  premiumPct?: number | null;
  nowMs?: number;
}): FxPublicationDecision {
  const nowMs = args.nowMs ?? Date.now();
  const inputs = buildInputDecisions(args.observations, nowMs);
  const accepted = args.observations
    .map((observation, index) => ({ observation, input: inputs[index] }))
    .filter((row) => row.input.accepted);

  if (!accepted.length) {
    const premiumPct = Number(args.premiumPct ?? 0);
    const officialMid = args.officialDecision?.midRate ?? null;
    if (officialMid != null && Number.isFinite(premiumPct) && premiumPct > 0) {
      const derivedMid = roundRate(officialMid * (1 + premiumPct / 100));
      const band = deriveBandAroundMid(derivedMid, 5);
      return {
        rateType: 'market',
        regionKey: MARKET_REGION_KEY,
        publicationStatus: 'fallback',
        buyRate: band.buy,
        sellRate: band.sell,
        midRate: derivedMid,
        effectiveForPricing: true,
        qualityFlag: 'derived_premium',
        basedOnNSources: 0,
        confidence: 0.45,
        freshnessSeconds: args.officialDecision?.freshnessSeconds ?? null,
        sourceSummary: [],
        decisionMeta: {
          mode: 'derived_from_official',
          premium_pct: premiumPct,
          official_mid_rate: officialMid,
        },
        inputs,
      };
    }

    return normalizePublicationFallback(
      'market',
      MARKET_REGION_KEY,
      args.previous,
      args.previous?.midRate ? 'stale' : 'unavailable',
      args.previous?.midRate ? 'stale' : 'unavailable',
      'no_fresh_market_observations',
      inputs,
      Boolean(args.previous?.midRate),
    );
  }

  const initialMedian = weightedMedian(
    accepted.map((row) => ({ value: Number(row.observation.midRate), weight: row.input.weight })),
  );
  const filtered = accepted.filter((row, index) => {
    const mid = Number(row.observation.midRate ?? 0);
    if (!initialMedian || !Number.isFinite(mid)) return false;
    const diffRatio = Math.abs(mid - initialMedian) / Math.max(initialMedian, 1);
    if (diffRatio > 0.03) {
      inputs[index].accepted = false;
      inputs[index].rejectReason = 'outlier';
      inputs[index].weight = 0;
      return false;
    }
    return true;
  });

  if (!filtered.length) {
    return normalizePublicationFallback(
      'market',
      MARKET_REGION_KEY,
      args.previous,
      args.previous?.midRate ? 'frozen' : 'unavailable',
      args.previous?.midRate ? 'anomaly_frozen' : 'unavailable',
      'all_market_observations_outliers',
      inputs,
      Boolean(args.previous?.midRate),
    );
  }

  const chosenMid = roundRate(
    weightedMedian(filtered.map((row) => ({ value: Number(row.observation.midRate), weight: row.input.weight }))),
  );
  const acceptedMids = filtered.map((row) => Number(row.observation.midRate));
  const minMid = Math.min(...acceptedMids);
  const maxMid = Math.max(...acceptedMids);
  const dispersion = chosenMid ? (maxMid - minMid) / Math.max(chosenMid, 1) : 0;
  const deltaRatio =
    args.previous?.midRate && chosenMid != null
      ? Math.abs(chosenMid - args.previous.midRate) / Math.max(args.previous.midRate, 1)
      : 0;

  if (chosenMid != null && args.previous?.midRate != null && deltaRatio > 0.015 && (filtered.length < 2 || dispersion > 0.02)) {
    return {
      ...normalizePublicationFallback(
        'market',
        MARKET_REGION_KEY,
        args.previous,
        'frozen',
        'anomaly_frozen',
        'market_delta_too_large_for_quorum',
        inputs,
        true,
      ),
      basedOnNSources: filtered.length,
      sourceSummary: buildSourceSummary(inputs),
      decisionMeta: {
        mode: 'frozen_previous_publication',
        reason: 'market_delta_too_large_for_quorum',
        previous_mid_rate: args.previous.midRate,
        candidate_mid_rate: chosenMid,
        delta_ratio: Number(deltaRatio.toFixed(6)),
        dispersion_ratio: Number(dispersion.toFixed(6)),
        accepted_sources: filtered.length,
      },
    };
  }

  const buyMid = weightedMedian(
    filtered
      .map((row) => ({ value: row.observation.buyRate ?? NaN, weight: row.input.weight }))
      .filter((row) => Number.isFinite(row.value)),
  );
  const sellMid = weightedMedian(
    filtered
      .map((row) => ({ value: row.observation.sellRate ?? NaN, weight: row.input.weight }))
      .filter((row) => Number.isFinite(row.value)),
  );
  const band = deriveBandAroundMid(chosenMid, 5);
  const qualityFlag =
    filtered.length >= 2 ? (dispersion <= 0.01 ? 'verified' : 'multi_source') : 'single_source';
  const confidence = Math.max(
    0.55,
    Math.min(0.96, 0.55 + filtered.length * 0.12 - Math.min(0.18, dispersion * 3)),
  );

  return {
    rateType: 'market',
    regionKey: MARKET_REGION_KEY,
    publicationStatus: 'current',
    buyRate: roundRate(buyMid ?? band.buy),
    sellRate: roundRate(sellMid ?? band.sell),
    midRate: chosenMid,
    effectiveForPricing: true,
    qualityFlag,
    basedOnNSources: filtered.length,
    confidence: Number(confidence.toFixed(3)),
    freshnessSeconds: Math.min(...filtered.map((row) => freshnessSeconds(row.observation, nowMs))),
    sourceSummary: buildSourceSummary(inputs),
    decisionMeta: {
      mode: 'weighted_median',
      accepted_sources: filtered.length,
      dispersion_ratio: Number(dispersion.toFixed(6)),
      delta_ratio: Number(deltaRatio.toFixed(6)),
    },
    inputs,
  };
}

function urlHostname(value: string | null | undefined): string | null {
  try {
    return value ? new URL(value).hostname : null;
  } catch {
    return null;
  }
}

async function upsertFxSource(db: DbLike, input: {
  sourceCode: string;
  sourceName: string;
  sourceKind: SourceKind;
  rateType: RateType;
  regionKey: string;
  fetchUrl: string | null;
  parserType: 'text_iqd' | 'json_usd_rates' | 'manual_override';
  parserVersion?: string;
  parserConfig?: Record<string, unknown>;
  trustScore: number;
  freshnessSlaMinutes: number;
  priority: number;
  meta?: Record<string, unknown>;
}): Promise<GovernedFxSource> {
  const result = await db.execute(sql`
    insert into public.fx_sources (
      source_code,
      source_name,
      source_kind,
      rate_type,
      region_key,
      fetch_url,
      parser_type,
      parser_version,
      parser_config,
      trust_score,
      freshness_sla_minutes,
      publication_enabled,
      is_active,
      priority,
      meta,
      updated_at
    ) values (
      ${input.sourceCode},
      ${input.sourceName},
      ${input.sourceKind},
      ${input.rateType},
      ${input.regionKey},
      ${input.fetchUrl},
      ${input.parserType},
      ${input.parserVersion ?? 'v1'},
      ${JSON.stringify(input.parserConfig ?? {})}::jsonb,
      ${input.trustScore},
      ${input.freshnessSlaMinutes},
      true,
      true,
      ${input.priority},
      ${JSON.stringify(input.meta ?? {})}::jsonb,
      now()
    )
    on conflict (source_code) do update set
      source_name = excluded.source_name,
      source_kind = excluded.source_kind,
      rate_type = excluded.rate_type,
      region_key = excluded.region_key,
      fetch_url = excluded.fetch_url,
      parser_type = excluded.parser_type,
      parser_version = excluded.parser_version,
      parser_config = excluded.parser_config,
      trust_score = excluded.trust_score,
      freshness_sla_minutes = excluded.freshness_sla_minutes,
      publication_enabled = true,
      is_active = true,
      priority = excluded.priority,
      meta = excluded.meta,
      updated_at = now()
    returning
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
      priority,
      parser_config
  `);
  const row = (result.rows as any[])[0];
  return {
    id: String(row.id),
    sourceCode: String(row.source_code),
    sourceName: String(row.source_name),
    sourceKind: row.source_kind,
    rateType: row.rate_type,
    regionKey: String(row.region_key),
    fetchUrl: row.fetch_url ? String(row.fetch_url) : null,
    parserType: row.parser_type,
    parserVersion: String(row.parser_version ?? 'v1'),
    trustScore: Number(row.trust_score ?? 0.5),
    freshnessSlaMinutes: Number(row.freshness_sla_minutes ?? 1440),
    priority: Number(row.priority ?? 100),
    parserConfig: (row.parser_config as Record<string, unknown>) ?? {},
  };
}

async function syncConfiguredFxSources(db: DbLike, opts?: FxOpts): Promise<GovernedFxSource[]> {
  const sources: GovernedFxSource[] = [];
  const govUrls = normalizeUrlList(opts?.govUrl, process.env.FX_GOV_URLS ?? process.env.FX_GOV_URL);
  const marketUrls = normalizeUrlList(opts?.marketUrl, process.env.FX_MARKET_URLS ?? process.env.FX_MARKET_URL);

  for (const url of govUrls) {
    const host = urlHostname(url) ?? 'unknown';
    sources.push(await upsertFxSource(db, {
      sourceCode: `fx_official_text_${shaShort(url)}`,
      sourceName: `Official: ${host}`,
      sourceKind: 'official',
      rateType: 'official',
      regionKey: OFFICIAL_REGION_KEY,
      fetchUrl: url,
      parserType: 'text_iqd',
      trustScore: 0.97,
      freshnessSlaMinutes: 24 * 60,
      priority: 10,
      meta: { origin: 'env_url' },
    }));
  }

  for (const url of marketUrls) {
    const host = urlHostname(url) ?? 'unknown';
    sources.push(await upsertFxSource(db, {
      sourceCode: `fx_market_text_${shaShort(url)}`,
      sourceName: `Market: ${host}`,
      sourceKind: 'market_exchange_house',
      rateType: 'market',
      regionKey: MARKET_REGION_KEY,
      fetchUrl: url,
      parserType: 'text_iqd',
      trustScore: 0.88,
      freshnessSlaMinutes: 120,
      priority: 20,
      meta: { origin: 'env_url' },
    }));
  }

  sources.push(await upsertFxSource(db, {
    sourceCode: 'fx_official_api_fallback',
    sourceName: 'Official: API fallback',
    sourceKind: 'api_fallback',
    rateType: 'official',
    regionKey: OFFICIAL_REGION_KEY,
    fetchUrl: DEFAULT_USD_RATES_API,
    parserType: 'json_usd_rates',
    trustScore: 0.38,
    freshnessSlaMinutes: 24 * 60,
    priority: 500,
    meta: { origin: 'default_fallback' },
  }));

  sources.push(await upsertFxSource(db, {
    sourceCode: 'fx_official_override',
    sourceName: 'Official: manual override',
    sourceKind: 'override',
    rateType: 'official',
    regionKey: OFFICIAL_REGION_KEY,
    fetchUrl: null,
    parserType: 'manual_override',
    trustScore: 1,
    freshnessSlaMinutes: 24 * 60,
    priority: 1,
    meta: { origin: 'manual_override' },
  }));

  sources.push(await upsertFxSource(db, {
    sourceCode: 'fx_market_override',
    sourceName: 'Market: manual override',
    sourceKind: 'override',
    rateType: 'market',
    regionKey: MARKET_REGION_KEY,
    fetchUrl: null,
    parserType: 'manual_override',
    trustScore: 1,
    freshnessSlaMinutes: 120,
    priority: 1,
    meta: { origin: 'manual_override' },
  }));

  return sources;
}

async function insertObservation(db: DbLike, observation: GovernedFxObservation): Promise<string | null> {
  const result = await db.execute(sql`
    insert into public.fx_observations (
      source_id,
      observed_at,
      fetched_at,
      rate_type,
      region_key,
      buy_rate,
      sell_rate,
      mid_rate,
      currency_pair,
      parse_status,
      parser_version,
      raw_payload,
      anomaly_flags,
      error
    ) values (
      ${observation.sourceId}::uuid,
      ${observation.observedAt}::timestamptz,
      now(),
      ${observation.rateType},
      ${observation.regionKey},
      ${observation.buyRate},
      ${observation.sellRate},
      ${observation.midRate},
      'USD/IQD',
      ${observation.parseStatus},
      ${observation.parserVersion},
      ${JSON.stringify(observation.rawPayload ?? {})}::jsonb,
      ${JSON.stringify(observation.anomalyFlags ?? [])}::jsonb,
      ${observation.error ?? null}
    )
    returning id
  `).catch(() => ({ rows: [] as any[] }));
  return ((result.rows as any[])[0]?.id ? String((result.rows as any[])[0].id) : null);
}

async function collectObservationForSource(source: GovernedFxSource, opts?: FxOpts): Promise<GovernedFxObservation | null> {
  const timeoutMs = Math.max(2_000, Number(opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS));
  const observedAt = new Date().toISOString();
  const govOverride = normalizeOverride(opts?.govOverride ?? process.env.FX_GOV_OVERRIDE);
  const marketOverride = normalizeOverride(opts?.marketOverride ?? process.env.FX_MARKET_OVERRIDE);

  if (source.parserType === 'manual_override') {
    const value = source.rateType === 'official' ? govOverride : source.rateType === 'market' ? marketOverride : null;
    if (!value) return null;
    const spread = source.rateType === 'official' ? 2 : 5;
    const band = deriveBandAroundMid(value, spread);
    return {
      sourceId: source.id,
      sourceCode: source.sourceCode,
      sourceName: source.sourceName,
      sourceKind: source.sourceKind,
      rateType: source.rateType,
      regionKey: source.regionKey,
      observedAt,
      parseStatus: 'ok',
      midRate: roundRate(value),
      buyRate: band.buy,
      sellRate: band.sell,
      trustScore: source.trustScore,
      freshnessSlaMinutes: source.freshnessSlaMinutes,
      priority: source.priority,
      parserVersion: source.parserVersion,
      rawPayload: { mode: 'manual_override', value },
      anomalyFlags: [],
      error: null,
    };
  }

  if (!source.fetchUrl) return null;

  if (source.parserType === 'json_usd_rates') {
    const response = await fetchJson(source.fetchUrl, timeoutMs);
    const rate = asNum(response.body?.rates?.IQD);
    const ok = response.ok && rate != null && rate >= 1000 && rate <= 2000;
    return {
      sourceId: source.id,
      sourceCode: source.sourceCode,
      sourceName: source.sourceName,
      sourceKind: source.sourceKind,
      rateType: source.rateType,
      regionKey: source.regionKey,
      observedAt,
      parseStatus: ok ? 'ok' : response.ok ? 'parse_failed' : 'http_error',
      midRate: ok ? roundRate(rate) : null,
      buyRate: ok ? roundRate(rate) : null,
      sellRate: ok ? roundRate(rate) : null,
      trustScore: source.trustScore,
      freshnessSlaMinutes: source.freshnessSlaMinutes,
      priority: source.priority,
      parserVersion: source.parserVersion,
      rawPayload: {
        url: source.fetchUrl,
        http_status: response.status,
        has_rates: Boolean(response.body?.rates),
      },
      anomalyFlags: [],
      error: ok ? null : response.ok ? 'json_parse_failed' : `http_${response.status}`,
    };
  }

  const response = await fetchText(source.fetchUrl, timeoutMs);
  const rate = response.ok ? pickLikelyIqdRate(response.text) : null;
  const spread = source.rateType === 'official' ? 2 : 5;
  const band = deriveBandAroundMid(rate, spread);

  return {
    sourceId: source.id,
    sourceCode: source.sourceCode,
    sourceName: source.sourceName,
    sourceKind: source.sourceKind,
    rateType: source.rateType,
    regionKey: source.regionKey,
    observedAt,
    parseStatus: response.ok ? (rate ? 'ok' : 'parse_failed') : 'http_error',
    midRate: roundRate(rate),
    buyRate: band.buy,
    sellRate: band.sell,
    trustScore: source.trustScore,
    freshnessSlaMinutes: source.freshnessSlaMinutes,
    priority: source.priority,
    parserVersion: source.parserVersion,
    rawPayload: {
      url: source.fetchUrl,
      http_status: response.status,
      text_excerpt: String(response.text ?? '').slice(0, 1000),
    },
    anomalyFlags: [],
    error: response.ok ? (rate ? null : 'text_parse_failed') : `http_${response.status}`,
  };
}

async function getPreviousPublication(db: DbLike, rateType: RateType, regionKey: string): Promise<PreviousPublication | null> {
  const publication = await db.execute(sql`
    select
      mid_rate,
      buy_rate,
      sell_rate,
      publication_status,
      quality_flag,
      published_at,
      source_summary,
      decision_meta
    from public.fx_publications
    where rate_type = ${rateType}
      and region_key = ${regionKey}
    order by published_at desc, created_at desc
    limit 1
  `).catch(() => ({ rows: [] as any[] }));
  const row = (publication.rows as any[])[0];
  if (row) {
    return {
      midRate: asNum(row.mid_rate),
      buyRate: asNum(row.buy_rate),
      sellRate: asNum(row.sell_rate),
      publicationStatus: (row.publication_status as PublicationStatus) ?? null,
      qualityFlag: row.quality_flag ? String(row.quality_flag) : null,
      publishedAt: row.published_at ? String(row.published_at) : null,
      sourceSummary: row.source_summary ?? null,
      decisionMeta: row.decision_meta ?? null,
    };
  }

  if (rateType === 'official' || rateType === 'market') {
    const effective = await db.execute(sql`
      select
        official_rate,
        market_buy_baghdad,
        market_sell_baghdad,
        market_mid_baghdad,
        quality_flag,
        last_verified_at,
        updated_at
      from public.fx_rate_effective
      order by rate_date desc, updated_at desc
      limit 1
    `).catch(() => ({ rows: [] as any[] }));
    const fx = (effective.rows as any[])[0];
    if (fx) {
      const midRate = rateType === 'official' ? asNum(fx.official_rate) : asNum(fx.market_mid_baghdad);
      if (midRate != null) {
        return {
          midRate,
          buyRate: rateType === 'official' ? midRate : asNum(fx.market_buy_baghdad),
          sellRate: rateType === 'official' ? midRate : asNum(fx.market_sell_baghdad),
          publicationStatus: 'stale',
          qualityFlag: fx.quality_flag ? String(fx.quality_flag) : 'stale',
          publishedAt: fx.updated_at ? String(fx.updated_at) : fx.last_verified_at ? String(fx.last_verified_at) : null,
        };
      }
    }

    const legacy = await db.execute(sql`
      select
        mid_iqd_per_usd,
        buy_iqd_per_usd,
        sell_iqd_per_usd,
        created_at,
        meta
      from public.exchange_rates
      where source_type = ${rateType === 'official' ? 'gov' : 'market'}
        and is_active = true
      order by rate_date desc, created_at desc
      limit 1
    `).catch(() => ({ rows: [] as any[] }));
    const old = (legacy.rows as any[])[0];
    if (old) {
      return {
        midRate: asNum(old.mid_iqd_per_usd),
        buyRate: asNum(old.buy_iqd_per_usd),
        sellRate: asNum(old.sell_iqd_per_usd),
        publicationStatus: 'stale',
        qualityFlag: old.meta?.quality_flag ? String(old.meta.quality_flag) : 'stale',
        publishedAt: old.created_at ? String(old.created_at) : null,
        sourceSummary: old.meta?.sources ?? null,
        decisionMeta: old.meta ?? null,
      };
    }
  }

  return null;
}

async function insertPublication(db: DbLike, decision: FxPublicationDecision): Promise<string | null> {
  const result = await db.execute(sql`
    insert into public.fx_publications (
      rate_date,
      rate_type,
      region_key,
      publication_status,
      buy_rate,
      sell_rate,
      mid_rate,
      effective_for_pricing,
      quality_flag,
      based_on_n_sources,
      confidence,
      freshness_seconds,
      source_summary,
      decision_meta,
      published_at,
      updated_at
    ) values (
      current_date,
      ${decision.rateType},
      ${decision.regionKey},
      ${decision.publicationStatus},
      ${decision.buyRate},
      ${decision.sellRate},
      ${decision.midRate},
      ${decision.effectiveForPricing},
      ${decision.qualityFlag},
      ${decision.basedOnNSources},
      ${decision.confidence},
      ${decision.freshnessSeconds},
      ${JSON.stringify(decision.sourceSummary)}::jsonb,
      ${JSON.stringify(decision.decisionMeta)}::jsonb,
      now(),
      now()
    )
    returning id
  `).catch(() => ({ rows: [] as any[] }));
  return ((result.rows as any[])[0]?.id ? String((result.rows as any[])[0].id) : null);
}

async function insertPublicationInputs(db: DbLike, publicationId: string | null, inputs: FxPublicationInputDecision[]): Promise<void> {
  if (!publicationId) return;
  for (const input of inputs) {
    await db.execute(sql`
      insert into public.fx_publication_inputs (
        publication_id,
        source_id,
        observation_id,
        accepted,
        weight,
        reject_reason
      ) values (
        ${publicationId}::uuid,
        ${input.sourceId}::uuid,
        ${input.observationId ?? null}::uuid,
        ${input.accepted},
        ${input.weight},
        ${input.rejectReason ?? null}
      )
      on conflict (publication_id, source_id, observation_id) do nothing
    `).catch(() => {});
  }
}

async function upsertLegacyRate(
  db: DbLike,
  sourceType: 'gov' | 'market',
  sourceName: string,
  decision: FxPublicationDecision,
): Promise<void> {
  if (decision.midRate == null) return;
  await db.execute(sql`
    insert into public.exchange_rates (
      source_type,
      source_name,
      rate_date,
      mid_iqd_per_usd,
      buy_iqd_per_usd,
      sell_iqd_per_usd,
      is_active,
      meta
    ) values (
      ${sourceType},
      ${sourceName},
      current_date,
      ${decision.midRate},
      ${decision.buyRate},
      ${decision.sellRate},
      true,
      ${JSON.stringify({
        governed_fx: true,
        publication_status: decision.publicationStatus,
        quality_flag: decision.qualityFlag,
        based_on_n_sources: decision.basedOnNSources,
        confidence: decision.confidence,
        freshness_seconds: decision.freshnessSeconds,
        sources: decision.sourceSummary,
        decision_meta: decision.decisionMeta,
      })}::jsonb
    )
    on conflict (rate_date, source_type, source_name) do update set
      mid_iqd_per_usd = excluded.mid_iqd_per_usd,
      buy_iqd_per_usd = excluded.buy_iqd_per_usd,
      sell_iqd_per_usd = excluded.sell_iqd_per_usd,
      is_active = excluded.is_active,
      meta = excluded.meta
  `).catch(() => {});
}

async function syncFxRateEffective(
  db: DbLike,
  official: FxPublicationDecision,
  market: FxPublicationDecision,
): Promise<void> {
  const effectiveRate = market.midRate ?? official.midRate ?? null;
  const qualityFlag = market.midRate != null ? market.qualityFlag : official.qualityFlag;

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
    ) values (
      current_date,
      ${official.midRate},
      ${market.buyRate},
      ${market.sellRate},
      ${market.midRate},
      ${effectiveRate},
      ${qualityFlag},
      ${Math.max(official.basedOnNSources, market.basedOnNSources)},
      ${JSON.stringify({
        official: {
          publication_status: official.publicationStatus,
          quality_flag: official.qualityFlag,
          source_summary: official.sourceSummary,
          decision_meta: official.decisionMeta,
        },
        market: {
          publication_status: market.publicationStatus,
          quality_flag: market.qualityFlag,
          source_summary: market.sourceSummary,
          decision_meta: market.decisionMeta,
        },
      })}::jsonb,
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
}

export async function getLatestFxRateForPricing(db: DbLike, fallback: number = DEFAULT_FALLBACK_FX): Promise<number> {
  const publication = await db.execute(sql`
    select mid_rate
    from public.fx_publications
    where effective_for_pricing = true
      and mid_rate is not null
      and publication_status in ('current', 'fallback', 'stale', 'frozen')
    order by published_at desc, created_at desc
    limit 1
  `).catch(() => ({ rows: [] as any[] }));
  const published = asNum((publication.rows as any[])[0]?.mid_rate);
  if (published != null && published > 500) return published;

  const effective = await db.execute(sql`
    select effective_rate_for_pricing
    from public.fx_rate_effective
    order by rate_date desc, updated_at desc
    limit 1
  `).catch(() => ({ rows: [] as any[] }));
  const effectiveRate = asNum((effective.rows as any[])[0]?.effective_rate_for_pricing);
  if (effectiveRate != null && effectiveRate > 500) return effectiveRate;

  const legacy = await db.execute(sql`
    select mid_iqd_per_usd
    from public.exchange_rates
    where source_type = 'market' and is_active = true
    order by rate_date desc, created_at desc
    limit 1
  `).catch(() => ({ rows: [] as any[] }));
  const legacyMid = asNum((legacy.rows as any[])[0]?.mid_iqd_per_usd);
  return legacyMid != null && legacyMid > 500 ? legacyMid : fallback;
}

export async function getLatestFxPublications(db: DbLike): Promise<Record<string, unknown>[]> {
  const result = await db.execute(sql`
    select distinct on (rate_type, region_key)
      id,
      rate_date,
      rate_type,
      region_key,
      publication_status,
      buy_rate,
      sell_rate,
      mid_rate,
      effective_for_pricing,
      quality_flag,
      based_on_n_sources,
      confidence,
      freshness_seconds,
      source_summary,
      decision_meta,
      published_at,
      created_at
    from public.fx_publications
    where rate_type in ('official', 'market')
    order by rate_type, region_key, published_at desc, created_at desc
  `).catch(() => ({ rows: [] as any[] }));
  return (result.rows as Record<string, unknown>[]) ?? [];
}

export function mapFxPublicationsToLegacyRows(rows: Record<string, unknown>[]): ExchangeRateRow[] {
  const output: ExchangeRateRow[] = [];
  const official = rows.find((row) => row.rate_type === 'official' && row.region_key === OFFICIAL_REGION_KEY) ?? null;
  const market = rows.find((row) => row.rate_type === 'market' && row.region_key === MARKET_REGION_KEY) ?? null;

  if (official && asNum(official.mid_rate) != null) {
    output.push({
      id: String(official.id ?? `gov-${official.rate_date ?? 'current'}`),
      rate_date: String(official.rate_date ?? ''),
      source_type: 'gov',
      source_name: 'Gov: governed publication',
      buy_iqd_per_usd: asNum(official.buy_rate) ?? asNum(official.mid_rate),
      sell_iqd_per_usd: asNum(official.sell_rate) ?? asNum(official.mid_rate),
      mid_iqd_per_usd: asNum(official.mid_rate),
      is_active: true,
      created_at: official.published_at ? String(official.published_at) : null,
      meta: {
        governed_fx: true,
        publication_status: official.publication_status,
        quality_flag: official.quality_flag,
        based_on_n_sources: official.based_on_n_sources,
        confidence: official.confidence,
        freshness_seconds: official.freshness_seconds,
        sources: official.source_summary ?? [],
        decision_meta: official.decision_meta ?? {},
      },
    });
  }

  if (market && asNum(market.mid_rate) != null) {
    output.push({
      id: String(market.id ?? `market-${market.rate_date ?? 'current'}`),
      rate_date: String(market.rate_date ?? ''),
      source_type: 'market',
      source_name: 'Market: governed publication',
      buy_iqd_per_usd: asNum(market.buy_rate),
      sell_iqd_per_usd: asNum(market.sell_rate),
      mid_iqd_per_usd: asNum(market.mid_rate),
      is_active: true,
      created_at: market.published_at ? String(market.published_at) : null,
      meta: {
        governed_fx: true,
        publication_status: market.publication_status,
        quality_flag: market.quality_flag,
        based_on_n_sources: market.based_on_n_sources,
        confidence: market.confidence,
        freshness_seconds: market.freshness_seconds,
        sources: market.source_summary ?? [],
        decision_meta: market.decision_meta ?? {},
      },
    });
  }

  return output;
}

export async function rolloverLatestFxPublicationToLegacy(db: DbLike): Promise<{ inserted: number }> {
  const rows = mapFxPublicationsToLegacyRows(await getLatestFxPublications(db));
  let inserted = 0;

  for (const row of rows) {
    const result = await db.execute(sql`
      insert into public.exchange_rates (
        rate_date,
        source_type,
        source_name,
        buy_iqd_per_usd,
        sell_iqd_per_usd,
        mid_iqd_per_usd,
        is_active,
        meta
      ) values (
        current_date,
        ${row.source_type},
        ${row.source_name},
        ${row.buy_iqd_per_usd},
        ${row.sell_iqd_per_usd},
        ${row.mid_iqd_per_usd},
        ${row.is_active},
        ${JSON.stringify(row.meta)}::jsonb
      )
      on conflict (rate_date, source_type, source_name) do nothing
      returning 1 as inserted
    `).catch(() => ({ rows: [] as any[] }));
    inserted += Number((result.rows as any[])[0]?.inserted ?? 0);
  }

  return { inserted };
}

export async function runGovernedFxUpdate(env: Env, opts?: FxOpts): Promise<any> {
  const db = getDb(env);
  const sources = await syncConfiguredFxSources(db, opts);

  const observations: GovernedFxObservation[] = [];
  for (const source of sources) {
    const observation = await collectObservationForSource(source, opts);
    if (!observation) continue;
    const observationId = await insertObservation(db, observation);
    observations.push({ ...observation, observationId });
  }

  const previousOfficial = await getPreviousPublication(db, 'official', OFFICIAL_REGION_KEY);
  const previousMarket = await getPreviousPublication(db, 'market', MARKET_REGION_KEY);

  const officialDecision = decideOfficialPublication({
    observations: observations.filter((row) => row.rateType === 'official'),
    previous: previousOfficial,
  });
  const marketDecision = decideMarketPublication({
    observations: observations.filter((row) => row.rateType === 'market'),
    previous: previousMarket,
    officialDecision,
    premiumPct: opts?.premiumPct ?? null,
  });

  officialDecision.effectiveForPricing = marketDecision.midRate == null && officialDecision.midRate != null;
  marketDecision.effectiveForPricing = marketDecision.midRate != null;

  const officialPublicationId = await insertPublication(db, officialDecision);
  await insertPublicationInputs(db, officialPublicationId, officialDecision.inputs);
  const marketPublicationId = await insertPublication(db, marketDecision);
  await insertPublicationInputs(db, marketPublicationId, marketDecision.inputs);

  await syncFxRateEffective(db, officialDecision, marketDecision);
  await upsertLegacyRate(db, 'gov', 'Gov: governed publication', officialDecision);
  if (marketDecision.midRate != null) {
    await upsertLegacyRate(db, 'market', 'Market: governed publication', marketDecision);
  }

  return {
    ok: true,
    official: {
      mid: officialDecision.midRate,
      publication_status: officialDecision.publicationStatus,
      quality_flag: officialDecision.qualityFlag,
      based_on_n_sources: officialDecision.basedOnNSources,
    },
    market: {
      mid: marketDecision.midRate,
      publication_status: marketDecision.publicationStatus,
      quality_flag: marketDecision.qualityFlag,
      based_on_n_sources: marketDecision.basedOnNSources,
    },
    effective_rate_for_pricing: marketDecision.midRate ?? officialDecision.midRate ?? null,
    observations_recorded: observations.length,
  };
}
