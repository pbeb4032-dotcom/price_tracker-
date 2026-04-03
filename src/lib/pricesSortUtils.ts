/**
 * Pure sorting helpers for the prices table.
 * No side-effects. Imported by Prices.tsx.
 */

import type { TrustedPrice } from '@/lib/prices/types';

export type SortKey =
  | 'product_name_ar'
  | 'region_name_ar'
  | 'min_price_iqd'
  | 'avg_price_iqd'
  | 'max_price_iqd'
  | 'sample_count'
  | 'last_observed_at';

export type SortDir = 'asc' | 'desc' | 'none';

/**
 * Cycle through sort directions: none → asc → desc → none
 * If clicking a NEW column, start at asc.
 */
export function nextSortDir(currentKey: SortKey, clickedKey: SortKey, currentDir: SortDir): SortDir {
  if (currentKey !== clickedKey) return 'asc';
  if (currentDir === 'asc') return 'desc';
  if (currentDir === 'desc') return 'none';
  return 'asc';
}

function compareStrings(a: string, b: string): number {
  return (a || '').localeCompare(b || '', 'ar');
}

function compareNumbers(a: number, b: number): number {
  return (a ?? 0) - (b ?? 0);
}

function compareDates(a: string, b: string): number {
  const da = a ? new Date(a).getTime() : 0;
  const db = b ? new Date(b).getTime() : 0;
  return da - db;
}

export function sortPriceRows(
  rows: TrustedPrice[],
  sortBy: SortKey,
  sortDir: SortDir,
): TrustedPrice[] {
  if (sortDir === 'none' || rows.length === 0) return rows;

  const sorted = [...rows].sort((a, b) => {
    let cmp = 0;
    switch (sortBy) {
      case 'product_name_ar':
        cmp = compareStrings(a.product_name_ar, b.product_name_ar);
        break;
      case 'region_name_ar':
        cmp = compareStrings(a.region_name_ar, b.region_name_ar);
        break;
      case 'min_price_iqd':
        cmp = compareNumbers(a.min_price_iqd, b.min_price_iqd);
        break;
      case 'avg_price_iqd':
        cmp = compareNumbers(a.avg_price_iqd, b.avg_price_iqd);
        break;
      case 'max_price_iqd':
        cmp = compareNumbers(a.max_price_iqd, b.max_price_iqd);
        break;
      case 'sample_count':
        cmp = compareNumbers(a.sample_count, b.sample_count);
        break;
      case 'last_observed_at':
        cmp = compareDates(a.last_observed_at, b.last_observed_at);
        break;
    }
    return cmp;
  });

  return sortDir === 'desc' ? sorted.reverse() : sorted;
}
