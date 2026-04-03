/**
 * Shkad Aadel — Price filter and search helpers.
 * Pure functions extracted from Prices.tsx.
 */

import type { TrustedPrice } from './types';

/**
 * Normalizes text for search: lowercase, strip Arabic diacritics, trim.
 */
export function normalizeSearchText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, '') // remove Arabic diacritics
    .trim();
}

/**
 * Filters price rows by region, category, and free-text search query.
 */
export function applyPriceFilters(
  rows: TrustedPrice[],
  region: string,
  category: string,
  query: string = '',
): TrustedPrice[] {
  const normalizedQuery = normalizeSearchText(query);
  return rows.filter((r) => {
    const regionOk = region === 'all' || r.region_name_ar === region;
    const categoryOk = category === 'all' || r.category === category;
    if (!regionOk || !categoryOk) return false;
    if (!normalizedQuery) return true;
    const nameAr = normalizeSearchText(r.product_name_ar);
    const nameEn = normalizeSearchText(r.product_name_en || '');
    return nameAr.includes(normalizedQuery) || nameEn.includes(normalizedQuery);
  });
}
