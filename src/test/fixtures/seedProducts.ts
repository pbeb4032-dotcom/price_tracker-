/**
 * Deterministic test fixtures for ProductSearchResult.
 */

import type { ProductSearchResult } from '@/lib/offers/types';

const DEFAULTS: ProductSearchResult = {
  product_id: 'search-001',
  name_ar: 'سكر أبيض ناعم 1 كغ',
  name_en: 'Fine White Sugar 1kg',
  category: 'groceries',
  unit: 'kg',
  image_url: null,
  brand_ar: 'الأهلية',
  brand_en: 'Al-Ahliya',
  barcode: '6281000000001',
  condition: 'new',
  similarity_score: 0.95,
};

/** Build a ProductSearchResult with optional overrides */
export function makeSearchResult(overrides: Partial<ProductSearchResult> = {}): ProductSearchResult {
  return { ...DEFAULTS, ...overrides };
}

/** Pre-built edge cases */
export const SEARCH_EDGE_CASES = {
  /** Long Arabic name */
  longName: makeSearchResult({
    product_id: 'search-long',
    name_ar: 'شاشة تلفاز ذكية إل جي أو ليد 55 بوصة بدقة 4K ألترا إتش دي مع نظام ويب أو إس وتقنية الذكاء الاصطناعي',
    name_en: null,
  }),

  /** No image */
  noImage: makeSearchResult({
    product_id: 'search-noimg',
    image_url: null,
  }),

  /** No brand */
  noBrand: makeSearchResult({
    product_id: 'search-nobrand',
    brand_ar: null,
    brand_en: null,
  }),

  /** Low similarity */
  lowSimilarity: makeSearchResult({
    product_id: 'search-low',
    similarity_score: 0.3,
  }),
} as const;

/** Generate a list of search results */
export function makeSearchResultList(count: number): ProductSearchResult[] {
  const categories = ['groceries', 'electronics', 'home', 'beauty', 'clothing'];
  return Array.from({ length: count }, (_, i) => makeSearchResult({
    product_id: `search-list-${i}`,
    name_ar: `نتيجة بحث ${i + 1}`,
    name_en: `Search Result ${i + 1}`,
    category: categories[i % categories.length],
    similarity_score: 0.9 - i * 0.05,
  }));
}
