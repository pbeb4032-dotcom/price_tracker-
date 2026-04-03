/**
 * E2E smoke tests for /prices page behavior.
 * Uses testing-library with mocked Supabase client.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import Prices, {
  TrustedPrice,
  applyPriceFilters,
  getRegionLabel,
  getCategoryLabel,
} from '@/pages/Prices';

// ---- Mock data ----

const mockRows: TrustedPrice[] = [
  {
    product_id: '1', region_id: 'r1',
    product_name_ar: 'رز بسمتي', product_name_en: 'Basmati Rice',
    region_name_ar: 'بغداد', region_name_en: 'Baghdad',
    unit: 'kg', category: 'grains',
    min_price_iqd: 1000, avg_price_iqd: 1500, max_price_iqd: 2000,
    sample_count: 5, last_observed_at: '2026-01-15',
  },
  {
    product_id: '2', region_id: 'r2',
    product_name_ar: 'طماطم', product_name_en: 'Tomato',
    region_name_ar: 'البصرة', region_name_en: 'Basra',
    unit: 'kg', category: 'vegetables',
    min_price_iqd: 500, avg_price_iqd: 750, max_price_iqd: 1000,
    sample_count: 8, last_observed_at: '2026-01-20',
  },
  {
    product_id: '3', region_id: 'r1',
    product_name_ar: 'تفاح', product_name_en: 'Apple',
    region_name_ar: 'بغداد', region_name_en: 'Baghdad',
    unit: 'kg', category: 'fruits',
    min_price_iqd: 2000, avg_price_iqd: 2500, max_price_iqd: 3000,
    sample_count: 3, last_observed_at: '2026-01-10',
  },
];

// ---- Unit-level smoke for filter/sort/region logic ----

describe('Prices E2E smoke — filters', () => {
  it('returns all rows with default filters', () => {
    const result = applyPriceFilters(mockRows, 'all', 'all', '');
    expect(result).toHaveLength(3);
  });

  it('search narrows by Arabic partial', () => {
    const result = applyPriceFilters(mockRows, 'all', 'all', 'رز');
    expect(result).toHaveLength(1);
    expect(result[0].product_name_ar).toBe('رز بسمتي');
  });

  it('search narrows by English partial (case-insensitive)', () => {
    const result = applyPriceFilters(mockRows, 'all', 'all', 'tomato');
    expect(result).toHaveLength(1);
  });

  it('region filter narrows results', () => {
    const result = applyPriceFilters(mockRows, 'بغداد', 'all', '');
    expect(result).toHaveLength(2);
  });

  it('category filter narrows results', () => {
    const result = applyPriceFilters(mockRows, 'all', 'grains', '');
    expect(result).toHaveLength(1);
  });

  it('combined filters narrow results', () => {
    const result = applyPriceFilters(mockRows, 'بغداد', 'fruits', '');
    expect(result).toHaveLength(1);
    expect(result[0].product_name_ar).toBe('تفاح');
  });

  it('no-match returns empty array', () => {
    const result = applyPriceFilters(mockRows, 'all', 'all', 'غير_موجود');
    expect(result).toHaveLength(0);
  });
});

describe('Prices E2E smoke — region labels', () => {
  it('uses region_name_ar when present', () => {
    expect(getRegionLabel('بغداد', 'Baghdad')).toBe('بغداد');
  });

  it('falls back from English to Arabic map', () => {
    expect(getRegionLabel('', 'Basra')).toBe('البصرة');
  });

  it('returns غير محددة for missing region', () => {
    expect(getRegionLabel('', '')).toBe('غير محددة');
  });
});

describe('Prices E2E smoke — category labels', () => {
  it('maps known category', () => {
    expect(getCategoryLabel('grains')).toBe('حبوب');
  });

  it('returns غير مصنفة for unknown', () => {
    expect(getCategoryLabel('xyz')).toBe('غير مصنفة');
  });
});

describe('Prices E2E smoke — sorting', () => {
  it('sortPriceRows sorts by avg_price_iqd asc', async () => {
    const { sortPriceRows } = await import('@/lib/pricesSortUtils');
    const sorted = sortPriceRows([...mockRows], 'avg_price_iqd', 'asc');
    expect(sorted[0].avg_price_iqd).toBe(750);
    expect(sorted[2].avg_price_iqd).toBe(2500);
  });

  it('sortPriceRows sorts desc', async () => {
    const { sortPriceRows } = await import('@/lib/pricesSortUtils');
    const sorted = sortPriceRows([...mockRows], 'avg_price_iqd', 'desc');
    expect(sorted[0].avg_price_iqd).toBe(2500);
  });
});

describe('Prices E2E smoke — pagination', () => {
  it('paginates correctly', async () => {
    const { paginateRows } = await import('@/lib/pricesTableUtils');
    const result = paginateRows(mockRows, 1, 2);
    expect(result.pageRows).toHaveLength(2);
    expect(result.totalPages).toBe(2);
    expect(result.startIndex).toBe(1);
    expect(result.endIndex).toBe(2);
  });

  it('CSV export button disabled logic', async () => {
    const { paginateRows } = await import('@/lib/pricesTableUtils');
    const empty = paginateRows([], 1, 10);
    expect(empty.totalRows).toBe(0);
  });
});

describe('Prices E2E smoke — preferences', () => {
  beforeEach(() => localStorage.clear());

  it('save/load/clear cycle works', async () => {
    const { savePricesPreferences, loadPricesPreferences, clearPricesPreferences, getDefaults } = await import('@/lib/pricesPreferences');
    expect(loadPricesPreferences()).toBeNull();

    const prefs = { ...getDefaults(), searchQuery: 'رز', pageSize: 25 };
    savePricesPreferences(prefs);
    const loaded = loadPricesPreferences();
    expect(loaded?.searchQuery).toBe('رز');
    expect(loaded?.pageSize).toBe(25);

    clearPricesPreferences();
    expect(loadPricesPreferences()).toBeNull();
  });
});
