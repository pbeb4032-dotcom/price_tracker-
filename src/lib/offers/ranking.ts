/**
 * Best price ranking engine.
 */

import type { ProductOffer } from './types';

/** Compute final price with optional delivery fee */
export function computeFinalPrice(offer: ProductOffer, includeDelivery: boolean): number {
  const base = offer.final_price;
  if (includeDelivery && offer.delivery_fee) {
    return base + offer.delivery_fee;
  }
  return base;
}

/** Rank offers: lowest price → availability → recency → source reliability */
export function rankOffers(
  offers: ProductOffer[],
  includeDelivery = false,
): ProductOffer[] {
  return [...offers].sort((a, b) => {
    // 1. Price (lowest first)
    const priceA = computeFinalPrice(a, includeDelivery);
    const priceB = computeFinalPrice(b, includeDelivery);
    if (priceA !== priceB) return priceA - priceB;

    // 2. In stock first
    if (a.in_stock !== b.in_stock) return a.in_stock ? -1 : 1;

    // 3. Most recent first
    const timeA = new Date(a.observed_at).getTime();
    const timeB = new Date(b.observed_at).getTime();
    if (timeA !== timeB) return timeB - timeA;

    return 0;
  });
}

/** Generate Arabic reason string for why this offer is "best" */
export function getBestOfferReason(offer: ProductOffer, allOffers: ProductOffer[]): string {
  const reasons: string[] = [];

  // Check if cheapest
  const cheapest = allOffers.length === 0 ||
    offer.final_price <= Math.min(...allOffers.map((o) => o.final_price));
  if (cheapest) reasons.push('الأرخص');

  // Recency
  const observedAt = new Date(offer.observed_at);
  const minutesAgo = (Date.now() - observedAt.getTime()) / 60_000;
  if (minutesAgo < 60) reasons.push(`محدّث قبل ${Math.round(minutesAgo)} دقيقة`);
  else if (minutesAgo < 1440) reasons.push(`محدّث قبل ${Math.round(minutesAgo / 60)} ساعة`);

  if (offer.in_stock) reasons.push('متوفر');
  if (offer.discount_price && offer.discount_price < offer.base_price) reasons.push('خصم');

  return reasons.join(' • ') || 'أفضل عرض';
}
