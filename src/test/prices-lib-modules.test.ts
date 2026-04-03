/**
 * Tests for lib/prices/* modules — labels, formatters, mappers.
 */
import { describe, it, expect } from 'vitest';
import { getCategoryLabel, getRegionLabel } from '@/lib/prices/labels';
import { formatPrice, formatDate } from '@/lib/prices/formatters';
import { mapTrustedPrice } from '@/lib/prices/mappers';

// ---- Labels ----

describe('getCategoryLabel', () => {
  it('returns Arabic label for known category', () => {
    expect(getCategoryLabel('vegetables')).toBe('خضروات');
    expect(getCategoryLabel('meat')).toBe('لحوم');
  });
  it('returns fallback for unknown category', () => {
    expect(getCategoryLabel('unknown')).toBe('غير مصنفة');
  });
  it('returns fallback for empty string', () => {
    expect(getCategoryLabel('')).toBe('غير مصنفة');
  });
});

describe('getRegionLabel', () => {
  it('returns Arabic name if available and not dash', () => {
    expect(getRegionLabel('بغداد', 'Baghdad')).toBe('بغداد');
  });
  it('falls back to English-to-Arabic mapping', () => {
    expect(getRegionLabel('—', 'Basra')).toBe('البصرة');
  });
  it('returns English name if no Arabic mapping', () => {
    expect(getRegionLabel('', 'UnknownCity')).toBe('UnknownCity');
  });
  it('returns fallback for empty inputs', () => {
    expect(getRegionLabel('', '')).toBe('غير محددة');
  });
});

// ---- Formatters ----

describe('formatPrice', () => {
  it('formats number with Iraqi dinar suffix', () => {
    const result = formatPrice(1500);
    expect(result).toContain('د.ع');
  });
  it('handles zero', () => {
    expect(formatPrice(0)).toContain('د.ع');
  });
});

describe('formatDate', () => {
  it('formats valid date string', () => {
    const result = formatDate('2025-01-15T10:00:00Z');
    expect(result).toBeTruthy();
    expect(result).not.toBe('—');
  });
  it('returns dash for empty string', () => {
    expect(formatDate('')).toBe('—');
  });
});

// ---- Mappers ----

describe('mapTrustedPrice', () => {
  it('maps complete row', () => {
    const row = {
      product_id: 'p1',
      region_id: 'r1',
      product_name_ar: 'رز',
      product_name_en: 'Rice',
      region_name_ar: 'بغداد',
      region_name_en: 'Baghdad',
      unit: 'kg',
      category: 'grains',
      min_price_iqd: 1000,
      avg_price_iqd: 1500,
      max_price_iqd: 2000,
      sample_count: 5,
      last_observed_at: '2025-01-01',
    };
    const result = mapTrustedPrice(row);
    expect(result.product_id).toBe('p1');
    expect(result.avg_price_iqd).toBe(1500);
  });

  it('handles null fields with defaults', () => {
    const result = mapTrustedPrice({});
    expect(result.product_id).toBe('');
    expect(result.product_name_ar).toBe('—');
    expect(result.unit).toBe('kg');
    expect(result.min_price_iqd).toBe(0);
  });
});
