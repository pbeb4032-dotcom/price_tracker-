import { describe, it, expect } from 'vitest';
import { paginateRows, csvEscape, buildPricesCsv, type TrustedPriceLike } from '@/lib/pricesTableUtils';

// ---- paginateRows ----

describe('paginateRows', () => {
  const items = [1, 2, 3, 4, 5, 6, 7];

  it('returns empty result for empty rows', () => {
    const r = paginateRows([], 1, 10);
    expect(r.pageRows).toEqual([]);
    expect(r.totalRows).toBe(0);
    expect(r.totalPages).toBe(1);
    expect(r.currentPage).toBe(1);
    expect(r.startIndex).toBe(0);
    expect(r.endIndex).toBe(0);
  });

  it('paginates exact multiple pages', () => {
    const data = [1, 2, 3, 4];
    const r = paginateRows(data, 2, 2);
    expect(r.pageRows).toEqual([3, 4]);
    expect(r.totalPages).toBe(2);
    expect(r.startIndex).toBe(3);
    expect(r.endIndex).toBe(4);
  });

  it('handles non-exact final page', () => {
    const r = paginateRows(items, 3, 3);
    expect(r.pageRows).toEqual([7]);
    expect(r.totalPages).toBe(3);
    expect(r.startIndex).toBe(7);
    expect(r.endIndex).toBe(7);
  });

  it('clamps page too high', () => {
    const r = paginateRows(items, 100, 5);
    expect(r.currentPage).toBe(2);
    expect(r.pageRows).toEqual([6, 7]);
  });

  it('clamps page too low', () => {
    const r = paginateRows(items, -1, 5);
    expect(r.currentPage).toBe(1);
    expect(r.pageRows).toEqual([1, 2, 3, 4, 5]);
  });

  it('handles pageSize <= 0 by falling back to 1', () => {
    const r = paginateRows([1, 2, 3], 1, 0);
    expect(r.pageRows).toEqual([1]);
    expect(r.totalPages).toBe(3);
  });
});

// ---- csvEscape ----

describe('csvEscape', () => {
  it('returns empty for null/undefined', () => {
    expect(csvEscape(null)).toBe('');
    expect(csvEscape(undefined)).toBe('');
  });

  it('returns plain text as-is', () => {
    expect(csvEscape('hello')).toBe('hello');
  });

  it('wraps value with comma', () => {
    expect(csvEscape('a,b')).toBe('"a,b"');
  });

  it('escapes double quotes', () => {
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
  });

  it('wraps value with newline', () => {
    expect(csvEscape('line1\nline2')).toBe('"line1\nline2"');
  });

  it('handles numbers', () => {
    expect(csvEscape(1500)).toBe('1500');
  });
});

// ---- buildPricesCsv ----

describe('buildPricesCsv', () => {
  const makeRow = (overrides: Partial<TrustedPriceLike> = {}): TrustedPriceLike => ({
    product_name_ar: 'طماطم',
    region_name_ar: 'بغداد',
    region_name_en: 'Baghdad',
    category: 'vegetables',
    unit: 'kg',
    min_price_iqd: 1000,
    avg_price_iqd: 1200,
    max_price_iqd: 1400,
    sample_count: 5,
    last_observed_at: '2026-02-01T00:00:00Z',
    ...overrides,
  });

  it('includes Arabic header', () => {
    const csv = buildPricesCsv([]);
    expect(csv).toContain('المنتج,المنطقة,الفئة');
  });

  it('has correct row count', () => {
    const csv = buildPricesCsv([makeRow(), makeRow()]);
    const lines = csv.split('\n');
    expect(lines).toHaveLength(3); // header + 2 rows
  });

  it('preserves Arabic text', () => {
    const csv = buildPricesCsv([makeRow()]);
    expect(csv).toContain('طماطم');
    expect(csv).toContain('بغداد');
  });

  it('shows category in Arabic label', () => {
    const csv = buildPricesCsv([makeRow({ category: 'grains' })]);
    expect(csv).toContain('حبوب');
  });

  it('escapes values correctly', () => {
    const csv = buildPricesCsv([makeRow({ product_name_ar: 'حليب, طازج' })]);
    expect(csv).toContain('"حليب, طازج"');
  });
});
