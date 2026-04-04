type OfferRow = Record<string, unknown>;
export type RankedOfferRow = OfferRow & { comparison: ReturnType<typeof rankOfferRow> };

const asNum = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

const asBool = (v: unknown): boolean => {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return ['true', '1', 'yes', 'y', 'available', 'in_stock', 'in-stock'].includes(v.toLowerCase());
  return false;
};

const clamp01 = (value: number | null | undefined, fallback = 0): number => {
  const n = Number(value ?? fallback);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
};

export const pickOfferPrice = (row: OfferRow): number | null => {
  return (
    asNum(row.final_price) ??
    asNum(row.display_price_iqd) ??
    asNum(row.current_price) ??
    asNum(row.price_iqd) ??
    asNum(row.price) ??
    null
  );
};

export const pickOfferDelivery = (row: OfferRow): number => {
  return asNum(row.delivery_fee_iqd) ?? asNum(row.delivery_fee) ?? 0;
};

const certificationTierScore = (row: OfferRow): number => {
  const tier = String(row.source_certification_tier ?? row.certification_tier ?? '').toLowerCase();
  if (tier === 'anchor') return 1;
  if (tier === 'published') return 0.92;
  if (tier === 'observed') return 0.68;
  if (tier === 'sandbox') return 0.32;
  if (tier === 'suspended') return 0.05;
  return 0.55;
};

const sourceQualityScore = (row: OfferRow): number => {
  return clamp01(
    asNum(row.source_quality_score) ??
    asNum(row.quality_score) ??
    asNum(row.trust_score) ??
    asNum(row.price_confidence) ??
    0.5,
    0.5,
  );
};

const trustScore = (row: OfferRow): number => {
  let score = clamp01(asNum(row.trust_score) ?? asNum(row.confidence_score) ?? asNum(row.price_confidence), 0.45);
  if (asBool(row.is_price_trusted)) score = Math.max(score, 0.82);
  if (asBool(row.is_verified) || asBool(row.store_is_verified)) score = Math.max(score, 0.74);
  if (asBool(row.in_stock) || asBool(row.is_in_stock)) score += 0.04;
  score = Math.max(score, sourceQualityScore(row) * 0.65 + certificationTierScore(row) * 0.35);
  const crowdPenalty = clamp01(asNum(row.crowd_penalty), 0);
  if (crowdPenalty > 0) score = Math.max(0, score - Math.min(0.45, crowdPenalty * 0.9));
  return clamp01(score, 0.45);
};

const freshnessScore = (row: OfferRow): number => {
  const ts = (row.last_seen_at ?? row.last_observed_at ?? row.observed_at ?? row.created_at) as string | undefined;
  if (!ts) return 0.45;
  const ms = Date.parse(ts);
  if (!Number.isFinite(ms)) return 0.45;
  const ageHours = Math.max(0, (Date.now() - ms) / 36e5);
  if (ageHours <= 6) return 1;
  if (ageHours <= 24) return 0.92;
  if (ageHours <= 72) return 0.78;
  if (ageHours <= 168) return 0.56;
  return 0.34;
};

const availabilityScore = (row: OfferRow): number => {
  const status = String(row.availability_status ?? '').toLowerCase();
  if (status.includes('out')) return 0.1;
  if (status.includes('limited')) return 0.62;
  if (status.includes('in')) return 1;
  if (asBool(row.in_stock) || asBool(row.is_in_stock)) return 1;
  return 0.5;
};

const isSuspicious = (row: OfferRow): boolean => {
  return asBool(row.is_price_anomaly) || asBool(row.is_suspected) || asBool(row.is_price_suspected);
};

export function rankOfferRow(row: OfferRow, opts?: { cheapestPrice?: number | null }) {
  const price = pickOfferPrice(row);
  const delivery = pickOfferDelivery(row);
  const effectivePrice = price == null ? null : Math.max(0, price + Math.max(0, delivery));
  const cheapestPrice = opts?.cheapestPrice ?? null;
  const priceScore = cheapestPrice && effectivePrice ? Math.min(1, cheapestPrice / effectivePrice) : 0;
  const trust = trustScore(row);
  const freshness = freshnessScore(row);
  const availability = availabilityScore(row);
  const publishEnabled = asBool(row.source_publish_enabled ?? row.catalog_publish_enabled ?? true);
  const publishScore = publishEnabled ? 1 : 0;
  const suspicious = isSuspicious(row);
  const deliveryImpact = effectivePrice && effectivePrice > 0 ? Math.min(1, Math.max(0, delivery) / effectivePrice) : 0;
  const suspiciousPenalty = suspicious ? 0.18 : 0;
  const deliveryPenalty = deliveryImpact >= 0.35 ? 0.07 : 0;
  const unpublishedPenalty = publishEnabled ? 0 : 0.4;

  const total = Number(Math.max(
    0,
    (priceScore * 0.38 + trust * 0.24 + freshness * 0.14 + availability * 0.12 + publishScore * 0.12) -
      suspiciousPenalty -
      deliveryPenalty -
      unpublishedPenalty,
  ).toFixed(4));

  const reasons: string[] = [];
  if (priceScore >= 0.95) reasons.push('أفضل سعر فعلي تقريبًا');
  else if (priceScore >= 0.8) reasons.push('سعر منافس');
  else if (effectivePrice != null) reasons.push('السعر أعلى من البدائل');
  if (delivery > 0) reasons.push(`رسوم توصيل: ${Math.round(delivery)} د.ع`);
  if (trust >= 0.84) reasons.push('ثقة مصدر/عرض عالية');
  if (freshness >= 0.8) reasons.push('بيانات حديثة');
  if (!publishEnabled) reasons.push('مصدر مراقب ولم يُعتمد للنشر العام بعد');
  if (suspicious) reasons.push('تنبيه: العرض يحمل إشارات اشتباه');
  if (availability < 0.5) reasons.push('التوفر ضعيف أو غير مؤكد');

  return {
    effectivePrice,
    breakdown: {
      priceScore: Number(priceScore.toFixed(4)),
      trust: Number(trust.toFixed(4)),
      freshness: Number(freshness.toFixed(4)),
      availability: Number(availability.toFixed(4)),
      publish: Number(publishScore.toFixed(4)),
      suspiciousPenalty: Number(suspiciousPenalty.toFixed(4)),
      deliveryPenalty: Number(deliveryPenalty.toFixed(4)),
      unpublishedPenalty: Number(unpublishedPenalty.toFixed(4)),
      total,
    },
    suspicious,
    publishEnabled,
    reasons,
  };
}

export function rankOfferRows(rows: OfferRow[], opts?: { includeUnpublished?: boolean; limit?: number | null }) {
  const items = Array.isArray(rows) ? rows : [];
  if (!items.length) return [] as RankedOfferRow[];
  const validPrices = items
    .map((row) => {
      const p = pickOfferPrice(row);
      const d = pickOfferDelivery(row);
      return p == null ? null : Math.max(0, p + Math.max(0, d));
    })
    .filter((x): x is number => x != null && Number.isFinite(x));
  const cheapestPrice = validPrices.length ? Math.min(...validPrices) : null;

  const ranked: RankedOfferRow[] = items
    .map((row) => ({
      ...row,
      comparison: rankOfferRow(row, { cheapestPrice }),
    }))
    .filter((row) => opts?.includeUnpublished ? true : row.comparison.publishEnabled)
    .sort((a, b) => {
      const total = Number(b.comparison.breakdown.total ?? 0) - Number(a.comparison.breakdown.total ?? 0);
      if (total !== 0) return total;
      const priceA = pickOfferPrice(a) ?? Number.MAX_SAFE_INTEGER;
      const priceB = pickOfferPrice(b) ?? Number.MAX_SAFE_INTEGER;
      if (priceA !== priceB) return priceA - priceB;
      const rawA = a as Record<string, unknown>;
      const rawB = b as Record<string, unknown>;
      const obsA = Date.parse(String(rawA.last_observed_at ?? rawA.observed_at ?? '')) || 0;
      const obsB = Date.parse(String(rawB.last_observed_at ?? rawB.observed_at ?? '')) || 0;
      return obsB - obsA;
    });

  const limit = opts?.limit == null ? null : Math.max(1, Number(opts.limit));
  return limit ? ranked.slice(0, limit) : ranked;
}

export function scoreProductRow(bestOfferRow: OfferRow | null, offerCount: number) {
  if (!bestOfferRow) {
    return {
      total: 0,
      breakdown: { price: 0, trust: 0, freshness: 0, availability: 0, coverage: 0, publish: 0, suspiciousPenalty: 0 },
      reasons: ['لا توجد عروض كافية للمقارنة'],
    };
  }

  const ranked = rankOfferRow(bestOfferRow, {
    cheapestPrice: pickOfferPrice(bestOfferRow),
  });
  const coverage = offerCount <= 0 ? 0 : Math.min(1, offerCount / 5);
  const total = Number(Math.max(
    0,
    ranked.breakdown.priceScore * 0.32 +
      ranked.breakdown.trust * 0.24 +
      ranked.breakdown.freshness * 0.14 +
      ranked.breakdown.availability * 0.12 +
      coverage * 0.1 +
      ranked.breakdown.publish * 0.08 -
      ranked.breakdown.suspiciousPenalty,
  ).toFixed(4));

  const reasons = [...ranked.reasons];
  if (coverage >= 0.6) reasons.push('تغطية جيدة من عدة عروض');

  return {
    total,
    breakdown: {
      price: ranked.breakdown.priceScore,
      trust: ranked.breakdown.trust,
      freshness: ranked.breakdown.freshness,
      availability: ranked.breakdown.availability,
      coverage: Number(coverage.toFixed(4)),
      publish: ranked.breakdown.publish,
      suspiciousPenalty: ranked.breakdown.suspiciousPenalty,
    },
    reasons,
  };
}
