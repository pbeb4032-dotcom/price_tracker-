/**
 * Unit tests for best price ranking engine.
 */

import { describe, it, expect } from 'vitest';
import { rankOffers, computeFinalPrice, getBestOfferReason } from '@/lib/offers/ranking';
import type { ProductOffer } from '@/lib/offers/types';

function makeOffer(overrides: Partial<ProductOffer> = {}): ProductOffer {
  return {
    offer_id: 'o1',
    product_id: 'p1',
    product_name_ar: 'تست',
    product_name_en: null,
    product_image_url: null,
    category: 'general',
    unit: 'pcs',
    brand_ar: null,
    brand_en: null,
    base_price: 50000,
    discount_price: null,
    final_price: 50000,
    delivery_fee: null,
    currency: 'IQD',
    in_stock: true,
    source_url: 'https://example.iq/p1',
    merchant_name: 'تاجر',
    observed_at: new Date().toISOString(),
    region_id: 'r1',
    region_name_ar: 'بغداد',
    region_name_en: 'Baghdad',
    source_name_ar: 'مصدر',
    source_domain: 'example.iq',
    source_logo_url: null,
    source_kind: 'marketplace',
    source_id: 's1',
    ...overrides,
  };
}

describe('computeFinalPrice', () => {
  it('returns final_price without delivery', () => {
    const offer = makeOffer({ final_price: 25000, delivery_fee: 5000 });
    expect(computeFinalPrice(offer, false)).toBe(25000);
  });

  it('includes delivery fee when requested', () => {
    const offer = makeOffer({ final_price: 25000, delivery_fee: 5000 });
    expect(computeFinalPrice(offer, true)).toBe(30000);
  });

  it('handles null delivery fee', () => {
    const offer = makeOffer({ final_price: 25000, delivery_fee: null });
    expect(computeFinalPrice(offer, true)).toBe(25000);
  });
});

describe('rankOffers', () => {
  it('sorts by lowest price first', () => {
    const offers = [
      makeOffer({ offer_id: 'a', final_price: 30000 }),
      makeOffer({ offer_id: 'b', final_price: 20000 }),
      makeOffer({ offer_id: 'c', final_price: 25000 }),
    ];
    const ranked = rankOffers(offers);
    expect(ranked.map((o) => o.offer_id)).toEqual(['b', 'c', 'a']);
  });

  it('prefers in-stock when price is equal', () => {
    const offers = [
      makeOffer({ offer_id: 'a', final_price: 20000, in_stock: false }),
      makeOffer({ offer_id: 'b', final_price: 20000, in_stock: true }),
    ];
    const ranked = rankOffers(offers);
    expect(ranked[0].offer_id).toBe('b');
  });

  it('prefers more recent when price and stock are equal', () => {
    const now = Date.now();
    const offers = [
      makeOffer({ offer_id: 'a', final_price: 20000, observed_at: new Date(now - 3600_000).toISOString() }),
      makeOffer({ offer_id: 'b', final_price: 20000, observed_at: new Date(now).toISOString() }),
    ];
    const ranked = rankOffers(offers);
    expect(ranked[0].offer_id).toBe('b');
  });

  it('considers delivery fee when includeDelivery is true', () => {
    const offers = [
      makeOffer({ offer_id: 'a', final_price: 20000, delivery_fee: 15000 }), // total: 35000
      makeOffer({ offer_id: 'b', final_price: 25000, delivery_fee: 3000 }),  // total: 28000
    ];
    const ranked = rankOffers(offers, true);
    expect(ranked[0].offer_id).toBe('b');
  });

  it('does not mutate original array', () => {
    const offers = [
      makeOffer({ offer_id: 'a', final_price: 30000 }),
      makeOffer({ offer_id: 'b', final_price: 20000 }),
    ];
    const original = [...offers];
    rankOffers(offers);
    expect(offers.map((o) => o.offer_id)).toEqual(original.map((o) => o.offer_id));
  });
});

describe('getBestOfferReason', () => {
  it('includes "الأرخص" for cheapest offer', () => {
    const offer = makeOffer({ final_price: 10000 });
    const reason = getBestOfferReason(offer, [makeOffer({ final_price: 20000 })]);
    expect(reason).toContain('الأرخص');
  });

  it('includes "متوفر" for in-stock offer', () => {
    const offer = makeOffer({ in_stock: true });
    const reason = getBestOfferReason(offer, []);
    expect(reason).toContain('متوفر');
  });

  it('includes "خصم" when discount exists', () => {
    const offer = makeOffer({ base_price: 50000, discount_price: 30000, final_price: 30000 });
    const reason = getBestOfferReason(offer, []);
    expect(reason).toContain('خصم');
  });
});
