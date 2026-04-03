import { describe, it, expect } from 'vitest';
import { normalizeSearchText, applyPriceFilters } from '@/lib/prices/filters';
import { getCategoryLabel, getRegionLabel } from '@/lib/prices/labels';
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
  last_observed_at: '2026-02-12T10:00:00Z',
  ...overrides,
});

const rows: TrustedPrice[] = [
  makeRow(),
  makeRow({
    product_id: 'p2',
    region_id: 'r2',
    product_name_ar: 'رز',
    product_name_en: 'Rice',
    region_name_ar: 'بغداد',
    region_name_en: 'Baghdad',
    category: 'grains',
    min_price_iqd: 2000,
    avg_price_iqd: 2200,
    max_price_iqd: 2400,
    sample_count: 7,
  }),
  makeRow({
    product_id: 'p3',
    region_id: 'r1',
    product_name_ar: 'طماطم',
    product_name_en: 'Tomato',
    region_name_ar: 'أربيل',
    region_name_en: 'Erbil',
    category: 'vegetables',
  }),
];

// ---- applyPriceFilters ----

describe('applyPriceFilters', () => {
  it('returns all when all/all and empty query', () => {
    expect(applyPriceFilters(rows, 'all', 'all', '')).toHaveLength(3);
  });

  it('filters by region', () => {
    const result = applyPriceFilters(rows, 'أربيل', 'all');
    expect(result).toHaveLength(2);
    expect(result.every((r) => r.region_name_ar === 'أربيل')).toBe(true);
  });

  it('filters by category', () => {
    const result = applyPriceFilters(rows, 'all', 'grains');
    expect(result).toHaveLength(1);
    expect(result[0].category).toBe('grains');
  });

  it('filters by region + category', () => {
    const result = applyPriceFilters(rows, 'بغداد', 'grains');
    expect(result).toHaveLength(1);
    expect(result[0].product_name_ar).toBe('رز');
  });

  it('returns empty when no match', () => {
    expect(applyPriceFilters(rows, 'أربيل', 'grains')).toHaveLength(0);
  });

  it('searches by Arabic partial', () => {
    const result = applyPriceFilters(rows, 'all', 'all', 'رز');
    expect(result).toHaveLength(1);
    expect(result[0].product_name_ar).toBe('رز');
  });

  it('searches case-insensitive English', () => {
    const result = applyPriceFilters(rows, 'all', 'all', 'rice');
    expect(result).toHaveLength(1);
    expect(result[0].product_name_en).toBe('Rice');
  });

  it('combines search + region + category', () => {
    const result = applyPriceFilters(rows, 'أربيل', 'vegetables', 'طماطم');
    expect(result).toHaveLength(1);
    expect(result[0].product_name_ar).toBe('طماطم');
  });

  it('search with no match returns empty', () => {
    expect(applyPriceFilters(rows, 'all', 'all', 'سمك')).toHaveLength(0);
  });
});

// ---- getCategoryLabel ----

describe('getCategoryLabel', () => {
  it('maps known categories to Arabic', () => {
    expect(getCategoryLabel('vegetables')).toBe('خضروات');
    expect(getCategoryLabel('grains')).toBe('حبوب');
    expect(getCategoryLabel('fruits')).toBe('فواكه');
    expect(getCategoryLabel('dairy')).toBe('ألبان');
    expect(getCategoryLabel('meat')).toBe('لحوم');
    expect(getCategoryLabel('poultry')).toBe('دواجن');
    expect(getCategoryLabel('fish')).toBe('أسماك');
    expect(getCategoryLabel('oils')).toBe('زيوت');
    expect(getCategoryLabel('spices')).toBe('بهارات');
    expect(getCategoryLabel('beverages')).toBe('مشروبات');
    expect(getCategoryLabel('others')).toBe('أخرى');
  });

  it('returns fallback for unknown', () => {
    expect(getCategoryLabel('xyz')).toBe('غير مصنفة');
  });

  it('returns fallback for empty', () => {
    expect(getCategoryLabel('')).toBe('غير مصنفة');
  });
});

// ---- getRegionLabel ----

describe('getRegionLabel', () => {
  it('uses region_name_ar when available', () => {
    expect(getRegionLabel('بغداد', 'Baghdad')).toBe('بغداد');
  });

  it('falls back from English to Arabic via map', () => {
    expect(getRegionLabel('', 'Erbil')).toBe('أربيل');
    expect(getRegionLabel('—', 'Basra')).toBe('البصرة');
  });

  it('returns English as-is for unknown region', () => {
    expect(getRegionLabel('', 'UnknownCity')).toBe('UnknownCity');
  });

  it('returns غير محددة when both empty', () => {
    expect(getRegionLabel('', '')).toBe('غير محددة');
  });
});

// ---- normalizeSearchText ----

describe('normalizeSearchText', () => {
  it('lowercases text', () => {
    expect(normalizeSearchText('RICE')).toBe('rice');
  });

  it('removes Arabic diacritics', () => {
    expect(normalizeSearchText('رُزّ')).toBe('رز');
  });

  it('trims whitespace', () => {
    expect(normalizeSearchText('  رز  ')).toBe('رز');
  });
});
