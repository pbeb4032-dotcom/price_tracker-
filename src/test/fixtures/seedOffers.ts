/**
 * Deterministic test fixtures for BestOffer and ProductOffer types.
 */

import type { BestOffer, ProductOffer } from '@/lib/offers/types';

const DEFAULTS_BEST: BestOffer = {
  offer_id: 'offer-001',
  product_id: 'prod-001',
  product_name_ar: 'سكر أبيض ناعم 1 كغ',
  product_name_en: 'Fine White Sugar 1kg',
  product_image_url: null,
  category: 'groceries',
  unit: 'kg',
  brand_ar: 'الأهلية',
  brand_en: 'Al-Ahliya',
  barcode: '6281000000001',
  size_value: 1,
  size_unit: 'kg',
  base_price: 5000,
  discount_price: null,
  final_price: 5000,
  delivery_fee: null,
  currency: 'IQD',
  in_stock: true,
  source_url: 'https://talabatmart.iq/p/prod-001',
  merchant_name: null,
  observed_at: new Date().toISOString(),
  region_id: 'r-baghdad',
  region_name_ar: 'بغداد',
  region_name_en: 'Baghdad',
  source_name_ar: 'طلبات مارت',
  source_domain: 'talabatmart.iq',
  source_logo_url: null,
  source_kind: 'marketplace',
  source_id: 's-talabat',
  low_price_safe: null,
  high_price_safe: null,
  price_samples: 0,
  price_quality: 'synthetic',
};

const DEFAULTS_PRODUCT_OFFER: ProductOffer = {
  offer_id: 'po-001',
  product_id: 'prod-001',
  product_name_ar: 'سكر أبيض ناعم 1 كغ',
  product_name_en: 'Fine White Sugar 1kg',
  product_image_url: null,
  category: 'groceries',
  unit: 'kg',
  brand_ar: 'الأهلية',
  brand_en: 'Al-Ahliya',
  base_price: 5000,
  discount_price: null,
  final_price: 5000,
  delivery_fee: null,
  currency: 'IQD',
  in_stock: true,
  source_url: 'https://talabatmart.iq/p/prod-001',
  merchant_name: null,
  observed_at: new Date().toISOString(),
  region_id: 'r-baghdad',
  region_name_ar: 'بغداد',
  region_name_en: 'Baghdad',
  source_name_ar: 'طلبات مارت',
  source_domain: 'talabatmart.iq',
  source_logo_url: null,
  source_kind: 'marketplace',
  source_id: 's-talabat',
};

/** Build a BestOffer with optional overrides */
export function makeBestOffer(overrides: Partial<BestOffer> = {}): BestOffer {
  return { ...DEFAULTS_BEST, ...overrides };
}

/** Build a ProductOffer with optional overrides */
export function makeProductOffer(overrides: Partial<ProductOffer> = {}): ProductOffer {
  return { ...DEFAULTS_PRODUCT_OFFER, ...overrides };
}

/** Pre-built edge-case offers */
export const EDGE_CASES = {
  /** Very long Arabic name */
  longName: makeBestOffer({
    offer_id: 'edge-long',
    product_name_ar: 'شاشة تلفاز ذكية إل جي أو ليد 55 بوصة بدقة 4K ألترا إتش دي مع نظام ويب أو إس وتقنية الذكاء الاصطناعي ثينك كيو ومعالج ألفا 9 الجيل السادس',
    product_name_en: 'LG 55" OLED 4K Smart TV with AI ThinQ',
  }),

  /** Missing image */
  noImage: makeBestOffer({
    offer_id: 'edge-noimg',
    product_image_url: null,
  }),

  /** Discounted product */
  discounted: makeBestOffer({
    offer_id: 'edge-disc',
    base_price: 10000,
    discount_price: 7500,
    final_price: 7500,
  }),

  /** Out of stock */
  outOfStock: makeBestOffer({
    offer_id: 'edge-oos',
    in_stock: false,
  }),

  /** With delivery fee */
  withDelivery: makeBestOffer({
    offer_id: 'edge-delivery',
    delivery_fee: 3500,
  }),

  /** Zero delivery fee */
  zeroDelivery: makeBestOffer({
    offer_id: 'edge-zero-del',
    delivery_fee: 0,
  }),

  /** Null delivery fee */
  nullDelivery: makeBestOffer({
    offer_id: 'edge-null-del',
    delivery_fee: null,
  }),
} as const;

/** Generate N deterministic offers with varied properties */
export function makeBestOfferList(count: number): BestOffer[] {
  const sources = ['طلبات مارت', 'مسواگ', 'كارفور العراق', 'لولو هايبر', 'بيم ستور'];
  const regions = ['بغداد', 'أربيل', 'البصرة', 'النجف', 'كربلاء'];

  return Array.from({ length: count }, (_, i) => makeBestOffer({
    offer_id: `list-offer-${i}`,
    product_id: `list-prod-${i}`,
    product_name_ar: `منتج اختبار ${i + 1}`,
    base_price: 3000 + i * 1000,
    final_price: 3000 + i * 800,
    discount_price: i % 3 === 0 ? 3000 + i * 800 : null,
    in_stock: i % 7 !== 0,
    delivery_fee: i % 4 === 0 ? 2500 : null,
    source_name_ar: sources[i % sources.length],
    region_name_ar: regions[i % regions.length],
    observed_at: new Date(Date.now() - i * 3600_000).toISOString(),
  }));
}
