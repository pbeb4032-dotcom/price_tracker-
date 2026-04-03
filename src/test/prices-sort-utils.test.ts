import { describe, it, expect } from 'vitest';
import { sortPriceRows, nextSortDir, type SortKey } from '@/lib/pricesSortUtils';
import type { TrustedPrice } from '@/lib/prices/types';

const makeRow = (overrides: Partial<TrustedPrice> = {}): TrustedPrice => ({
  product_id: 'p1',
  region_id: 'r1',
  product_name_ar: 'بصل',
  product_name_en: 'Onion',
  region_name_ar: 'أربيل',
  region_name_en: 'Erbil',
  unit: 'kg',
  category: 'vegetables',
  min_price_iqd: 1200,
  avg_price_iqd: 1300,
  max_price_iqd: 1400,
  sample_count: 5,
  last_observed_at: '2026-02-01T00:00:00Z',
  ...overrides,
});

const rows: TrustedPrice[] = [
  makeRow({ product_name_ar: 'طماطم', min_price_iqd: 500, last_observed_at: '2026-01-01T00:00:00Z' }),
  makeRow({ product_name_ar: 'بصل', min_price_iqd: 1200, last_observed_at: '2026-02-15T00:00:00Z' }),
  makeRow({ product_name_ar: 'رز', min_price_iqd: 800, last_observed_at: '2026-01-20T00:00:00Z' }),
];

describe('sortPriceRows', () => {
  it('returns original order when dir=none', () => {
    const result = sortPriceRows(rows, 'min_price_iqd', 'none');
    expect(result).toEqual(rows);
  });

  it('sorts numbers ascending', () => {
    const result = sortPriceRows(rows, 'min_price_iqd', 'asc');
    expect(result.map((r) => r.min_price_iqd)).toEqual([500, 800, 1200]);
  });

  it('sorts numbers descending', () => {
    const result = sortPriceRows(rows, 'min_price_iqd', 'desc');
    expect(result.map((r) => r.min_price_iqd)).toEqual([1200, 800, 500]);
  });

  it('sorts Arabic text ascending', () => {
    const result = sortPriceRows(rows, 'product_name_ar', 'asc');
    // Arabic collation order
    expect(result.map((r) => r.product_name_ar)).toEqual(
      [...rows].map((r) => r.product_name_ar).sort((a, b) => a.localeCompare(b, 'ar')),
    );
  });

  it('sorts dates ascending', () => {
    const result = sortPriceRows(rows, 'last_observed_at', 'asc');
    expect(result.map((r) => r.last_observed_at)).toEqual([
      '2026-01-01T00:00:00Z',
      '2026-01-20T00:00:00Z',
      '2026-02-15T00:00:00Z',
    ]);
  });

  it('handles empty rows', () => {
    expect(sortPriceRows([], 'min_price_iqd', 'asc')).toEqual([]);
  });

  it('handles null/empty date gracefully', () => {
    const withEmpty = [makeRow({ last_observed_at: '' }), makeRow({ last_observed_at: '2026-01-01T00:00:00Z' })];
    const result = sortPriceRows(withEmpty, 'last_observed_at', 'asc');
    expect(result[0].last_observed_at).toBe('');
    expect(result[1].last_observed_at).toBe('2026-01-01T00:00:00Z');
  });
});

describe('nextSortDir', () => {
  it('starts asc on new column', () => {
    expect(nextSortDir('min_price_iqd', 'max_price_iqd', 'asc')).toBe('asc');
  });

  it('cycles asc → desc on same column', () => {
    expect(nextSortDir('min_price_iqd', 'min_price_iqd', 'asc')).toBe('desc');
  });

  it('cycles desc → none on same column', () => {
    expect(nextSortDir('min_price_iqd', 'min_price_iqd', 'desc')).toBe('none');
  });

  it('cycles none → asc on same column', () => {
    expect(nextSortDir('min_price_iqd', 'min_price_iqd', 'none')).toBe('asc');
  });
});
