/**
 * Pure helpers for product comparison in /prices.
 */

import type { TrustedPrice } from '@/lib/prices/types';

export const MAX_COMPARE = 3;

export interface CompareResult {
  rows: TrustedPrice[];
  hasUnitMismatch: boolean;
  units: string[];
}

/**
 * Select rows matching selectedProductIds from the filtered dataset.
 * Uses product_id + region_id as compound key to allow comparing
 * the same product across regions.
 */
export function selectComparableRows(
  rows: TrustedPrice[],
  selectedKeys: Set<string>,
): TrustedPrice[] {
  return rows.filter((r) => selectedKeys.has(rowKey(r)));
}

export function rowKey(r: TrustedPrice): string {
  return `${r.product_id}__${r.region_id}__${r.unit}`;
}

/**
 * Build comparison metrics from selected rows.
 */
export function compareMetrics(rows: TrustedPrice[]): CompareResult {
  const units = Array.from(new Set(rows.map((r) => r.unit)));
  return {
    rows,
    hasUnitMismatch: units.length > 1,
    units,
  };
}
