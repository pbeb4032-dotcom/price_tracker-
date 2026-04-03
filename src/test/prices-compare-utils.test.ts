import { describe, it, expect } from 'vitest';
import { selectComparableRows, compareMetrics, rowKey, MAX_COMPARE } from '@/lib/pricesCompareUtils';
import type { TrustedPrice } from '@/lib/prices/types';

function makeRow(overrides: Partial<TrustedPrice> = {}): TrustedPrice {
  return {
    product_id: 'p1', region_id: 'r1',
    product_name_ar: 'رز', product_name_en: 'Rice',
    region_name_ar: 'بغداد', region_name_en: 'Baghdad',
    unit: 'kg', category: 'grains',
    min_price_iqd: 1000, avg_price_iqd: 1500, max_price_iqd: 2000,
    sample_count: 5, last_observed_at: '2026-01-15',
    ...overrides,
  };
}

describe('pricesCompareUtils', () => {
  it('MAX_COMPARE is 3', () => {
    expect(MAX_COMPARE).toBe(3);
  });

  it('rowKey produces unique compound key', () => {
    const r1 = makeRow({ product_id: 'p1', region_id: 'r1', unit: 'kg' });
    const r2 = makeRow({ product_id: 'p1', region_id: 'r2', unit: 'kg' });
    expect(rowKey(r1)).not.toBe(rowKey(r2));
  });

  it('selectComparableRows filters by key set', () => {
    const rows = [
      makeRow({ product_id: 'p1', region_id: 'r1' }),
      makeRow({ product_id: 'p2', region_id: 'r1' }),
      makeRow({ product_id: 'p3', region_id: 'r1' }),
    ];
    const keys = new Set([rowKey(rows[0]), rowKey(rows[2])]);
    const selected = selectComparableRows(rows, keys);
    expect(selected).toHaveLength(2);
  });

  it('compareMetrics detects unit mismatch', () => {
    const rows = [
      makeRow({ unit: 'kg' }),
      makeRow({ product_id: 'p2', unit: 'liter' }),
    ];
    const result = compareMetrics(rows);
    expect(result.hasUnitMismatch).toBe(true);
    expect(result.units).toContain('kg');
    expect(result.units).toContain('liter');
  });

  it('compareMetrics no mismatch for same unit', () => {
    const rows = [makeRow(), makeRow({ product_id: 'p2' })];
    const result = compareMetrics(rows);
    expect(result.hasUnitMismatch).toBe(false);
  });

  it('compareMetrics returns empty for no rows', () => {
    const result = compareMetrics([]);
    expect(result.rows).toHaveLength(0);
    expect(result.hasUnitMismatch).toBe(false);
  });
});
