import { sql } from 'drizzle-orm';
import type { DbClient } from '../db';

export type PriceAnomalyAssessment = {
  suspicious: boolean;
  score: number;
  reasons: string[];
  context: Record<string, unknown>;
};

export type PriceAnomalyQuarantineInput = {
  observationId?: string | null;
  productId?: string | null;
  regionId?: string | null;
  sourceId?: string | null;
  sourceDomain?: string | null;
  sourceName?: string | null;
  productName?: string | null;
  productUrl?: string | null;
  pageUrl?: string | null;
  rawPrice?: string | null;
  rawPriceText?: string | null;
  parsedPriceIqd: number;
  deliveryFeeIqd?: number | null;
  currency?: string | null;
  unit?: string | null;
  reasonCode?: string | null;
  anomalyReason?: string | null;
  reasonDetail?: string | null;
  observedPayload?: unknown;
  anomalyContext?: unknown;
  fingerprint?: string | null;
  observedAt?: string | Date | null;
};

// Iraq lowest practical denomination is 250 IQD.
const HARD_MIN_IQD = 250;
const HARD_MAX_IQD = 50_000_000;

function robustMedian(values: number[]): number | null {
  const arr = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!arr.length) return null;
  const mid = Math.floor(arr.length / 2);
  return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
}

function percentile(values: number[], p: number): number | null {
  const arr = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!arr.length) return null;
  const idx = (arr.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return arr[lo];
  const t = idx - lo;
  return arr[lo] * (1 - t) + arr[hi] * t;
}

async function historyAssessment(
  db: DbClient | any,
  args: { productId?: string | null; sourceId?: string | null; priceIqd: number },
): Promise<{ score: number; reasons: string[]; historyMedian?: number | null; sourceMedian?: number | null }> {
  const reasons: string[] = [];
  let score = 0;
  let historyMedian: number | null = null;
  let sourceMedian: number | null = null;

  if (!args.productId) return { score, reasons, historyMedian, sourceMedian };

  try {
    const rowsRes = await db.execute(sql`
      select normalized_price_iqd::numeric as price
      from public.source_price_observations
      where product_id = ${args.productId}::uuid
        and normalized_price_iqd is not null
        and normalized_price_iqd > 0
        and observed_at >= now() - interval '120 days'
      order by observed_at desc
      limit 120
    `);
    const prices = ((rowsRes.rows as any[]) ?? [])
      .map((r) => Number(r?.price))
      .filter((v) => Number.isFinite(v) && v > 0);

    if (prices.length >= 6) {
      historyMedian = robustMedian(prices);
      const q1 = percentile(prices, 0.25);
      const q3 = percentile(prices, 0.75);
      const iqr = q1 != null && q3 != null ? Math.max(1, q3 - q1) : null;
      if (historyMedian && iqr != null) {
        const delta = Math.abs(args.priceIqd - historyMedian);
        const ratio = Math.max(args.priceIqd, historyMedian) / Math.max(1, Math.min(args.priceIqd, historyMedian));
        if (ratio >= 4) {
          score += 0.55;
          reasons.push('history_ratio_extreme');
        } else if (ratio >= 2.5) {
          score += 0.3;
          reasons.push('history_ratio_high');
        }
        if (delta > iqr * 6) {
          score += 0.35;
          reasons.push('history_iqr_outlier');
        } else if (delta > iqr * 3.5) {
          score += 0.2;
          reasons.push('history_iqr_warning');
        }
      }
    }
  } catch {
    // Graceful: historical baseline may be unavailable in some deployments.
  }

  if (args.productId && args.sourceId) {
    try {
      const rowsRes = await db.execute(sql`
        select normalized_price_iqd::numeric as price
        from public.source_price_observations
        where product_id = ${args.productId}::uuid
          and source_id = ${args.sourceId}::uuid
          and normalized_price_iqd is not null
          and normalized_price_iqd > 0
          and observed_at >= now() - interval '90 days'
        order by observed_at desc
        limit 80
      `);
      const prices = ((rowsRes.rows as any[]) ?? [])
        .map((r) => Number(r?.price))
        .filter((v) => Number.isFinite(v) && v > 0);
      if (prices.length >= 3) {
        sourceMedian = robustMedian(prices);
        if (sourceMedian) {
          const ratio = Math.max(args.priceIqd, sourceMedian) / Math.max(1, Math.min(args.priceIqd, sourceMedian));
          if (ratio >= 3) {
            score += 0.35;
            reasons.push('source_ratio_extreme');
          } else if (ratio >= 2) {
            score += 0.18;
            reasons.push('source_ratio_high');
          }
        }
      }
    } catch {
      // optional baseline
    }
  }

  return { score: Math.min(1, score), reasons, historyMedian, sourceMedian };
}

export async function assessPriceAnomaly(
  db: DbClient | any,
  args: { productId?: string | null; sourceId?: string | null; priceIqd: number; currency?: string | null },
): Promise<PriceAnomalyAssessment> {
  const reasons: string[] = [];
  let score = 0;

  if (!Number.isFinite(args.priceIqd) || args.priceIqd <= 0) {
    return { suspicious: true, score: 1, reasons: ['invalid_non_positive'], context: { priceIqd: args.priceIqd } };
  }

  if (args.priceIqd < HARD_MIN_IQD) {
    score += 0.9;
    reasons.push('hard_too_low');
  }
  if (args.priceIqd > HARD_MAX_IQD) {
    score += 0.9;
    reasons.push('hard_too_high');
  }

  if (Number.isInteger(args.priceIqd) && args.priceIqd > 0 && args.priceIqd < 10_000) {
    const digits = String(Math.trunc(args.priceIqd));
    if (digits.length <= 2 || /^\d0?$/.test(digits)) {
      score += 0.25;
      reasons.push('possible_minor_unit_bug');
    }
  }

  const hist = await historyAssessment(db, {
    productId: args.productId ?? null,
    sourceId: args.sourceId ?? null,
    priceIqd: args.priceIqd,
  });

  score = Math.min(1, score + hist.score);
  reasons.push(...hist.reasons);

  const suspicious = score >= 0.5 || reasons.some((r) => r.startsWith('hard_'));
  return {
    suspicious,
    score,
    reasons: Array.from(new Set(reasons)),
    context: {
      priceIqd: args.priceIqd,
      currency: args.currency ?? null,
      historyMedian: hist.historyMedian ?? null,
      sourceMedian: hist.sourceMedian ?? null,
    },
  };
}

export async function enqueuePriceAnomalyQuarantine(db: DbClient | any, input: PriceAnomalyQuarantineInput): Promise<void> {
  const productUrl = input.productUrl ?? input.pageUrl ?? null;
  const rawPrice = input.rawPrice ?? input.rawPriceText ?? null;
  const reasonCode = (input.reasonCode ?? input.anomalyReason ?? 'price_anomaly') || 'price_anomaly';
  const reasonDetail = input.reasonDetail ?? null;
  const observedPayload = input.observedPayload ?? input.anomalyContext ?? null;
  const observedAt = input.observedAt ? new Date(input.observedAt) : new Date();

  try {
    await db.execute(sql`
      insert into public.price_anomaly_quarantine (
        observation_id, product_id, source_id, region_id, source_domain, source_name,
        product_name, page_url, raw_price_text, parsed_price_iqd, currency,
        anomaly_reason, anomaly_score, anomaly_context, fingerprint, observed_at, created_at
      ) values (
        ${input.observationId ?? null},
        ${input.productId ?? null},
        ${input.sourceId ?? null},
        ${input.regionId ?? null},
        ${input.sourceDomain ?? null},
        ${input.sourceName ?? null},
        ${input.productName ?? null},
        ${productUrl},
        ${rawPrice},
        ${input.parsedPriceIqd},
        ${input.currency ?? null},
        ${reasonCode},
        ${null},
        ${observedPayload as any},
        ${input.fingerprint ?? null},
        ${observedAt.toISOString()},
        now()
      )
      on conflict do nothing
    `);
    return;
  } catch {
    // Fallback to the simpler v1/v2 schema used in this project checkpoint.
  }

  await db.execute(sql`
    insert into public.price_anomaly_quarantine (
      observation_id, product_id, source_id, source_domain, source_name,
      product_name, product_url, raw_price, parsed_price, currency,
      reason_code, reason_detail, observed_payload, status
    ) values (
      ${input.observationId ?? null},
      ${input.productId ?? null},
      ${input.sourceId ?? null},
      ${input.sourceDomain ?? null},
      ${input.sourceName ?? null},
      ${input.productName ?? null},
      ${productUrl},
      ${rawPrice},
      ${input.parsedPriceIqd},
      ${input.currency ?? null},
      ${reasonCode},
      ${reasonDetail},
      ${observedPayload as any},
      'pending'
    )
    on conflict do nothing
  `);
}

export async function assessAndMaybeQuarantinePrice(
  db: DbClient | any,
  args: PriceAnomalyQuarantineInput & {
    sourceId?: string | null;
    productId?: string | null;
    parsedPriceIqd: number;
    currency?: string | null;
  },
): Promise<PriceAnomalyAssessment & { quarantined: boolean }> {
  const assessment = await assessPriceAnomaly(db, {
    productId: args.productId ?? null,
    sourceId: args.sourceId ?? null,
    priceIqd: args.parsedPriceIqd,
    currency: args.currency ?? null,
  });

  if (!assessment.suspicious) {
    return { ...assessment, quarantined: false };
  }

  const reasonCode = args.reasonCode ?? args.anomalyReason ?? assessment.reasons[0] ?? 'price_anomaly';
  const reasonDetail = [
    args.reasonDetail ?? null,
    assessment.reasons.length ? `detectors=${assessment.reasons.join(',')}` : null,
  ]
    .filter(Boolean)
    .join(' | ') || null;

  await enqueuePriceAnomalyQuarantine(db, {
    ...args,
    reasonCode,
    reasonDetail,
    observedPayload: args.observedPayload ?? {
      assessmentScore: assessment.score,
      reasons: assessment.reasons,
      context: assessment.context,
      ...(args.anomalyContext && typeof args.anomalyContext === 'object' ? { inputContext: args.anomalyContext } : {}),
    },
  });

  return { ...assessment, quarantined: true };
}
