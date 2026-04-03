/**
 * Unit tests for usePricesViewState hook.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { type ReactNode } from 'react';
import { TelemetryProvider, type TelemetryClient } from '@/lib/telemetry';
import type { TrustedPrice } from '@/lib/prices/types';

// Mock useIsMobile
vi.mock('@/hooks/use-mobile', () => ({
  useIsMobile: vi.fn(() => false),
}));

// Mock toast
const mockToast = vi.fn();
vi.mock('@/hooks/use-toast', () => ({
  toast: (args: unknown) => mockToast(args),
}));

// Mock downloadCsv to avoid DOM interaction
vi.mock('@/lib/pricesTableUtils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/pricesTableUtils')>();
  return { ...actual, downloadCsv: vi.fn() };
});

import { usePricesViewState } from '@/hooks/prices/usePricesViewState';
import { useIsMobile } from '@/hooks/use-mobile';
import { STORAGE_KEY } from '@/lib/pricesPreferences';
import { VIEW_PREF_KEY } from '@/lib/pricesViewPreference';
import { MAX_COMPARE } from '@/lib/pricesCompareUtils';
import { downloadCsv } from '@/lib/pricesTableUtils';

const mockTelemetry: TelemetryClient = {
  trackEvent: vi.fn(),
  trackError: vi.fn(),
  setUser: vi.fn(),
};

function wrapper({ children }: { children: ReactNode }) {
  return <TelemetryProvider provider={mockTelemetry}>{children}</TelemetryProvider>;
}

function makePrice(overrides: Partial<TrustedPrice> = {}): TrustedPrice {
  return {
    product_id: 'p1',
    product_name_ar: 'رز',
    product_name_en: 'Rice',
    region_id: 'r1',
    region_name_ar: 'بغداد',
    region_name_en: 'Baghdad',
    category: 'grains',
    unit: 'kg',
    min_price_iqd: 1000,
    avg_price_iqd: 1500,
    max_price_iqd: 2000,
    sample_count: 5,
    last_observed_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

const SAMPLE_PRICES: TrustedPrice[] = [
  makePrice(),
  makePrice({ product_id: 'p2', product_name_ar: 'طماطم', product_name_en: 'Tomato', category: 'vegetables', region_id: 'r2', region_name_ar: 'البصرة', region_name_en: 'Basra' }),
  makePrice({ product_id: 'p3', product_name_ar: 'بصل', product_name_en: 'Onion', region_id: 'r1' }),
];

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe('usePricesViewState — defaults', () => {
  it('returns sensible defaults', () => {
    const { result } = renderHook(() => usePricesViewState([]), { wrapper });
    expect(result.current.selectedRegion).toBe('all');
    expect(result.current.selectedCategory).toBe('all');
    expect(result.current.searchQuery).toBe('');
    expect(result.current.pageSize).toBe(10);
    expect(result.current.sortBy).toBe('product_name_ar');
    expect(result.current.sortDir).toBe('asc');
    expect(result.current.compareKeys.size).toBe(0);
  });

  it('effectiveView = table on desktop', () => {
    const { result } = renderHook(() => usePricesViewState([]), { wrapper });
    expect(result.current.effectiveView).toBe('table');
  });

  it('effectiveView = cards on mobile', () => {
    vi.mocked(useIsMobile).mockReturnValueOnce(true);
    const { result } = renderHook(() => usePricesViewState([]), { wrapper });
    expect(result.current.effectiveView).toBe('cards');
  });
});

describe('usePricesViewState — derived data', () => {
  it('computes regionOptions from prices', () => {
    const { result } = renderHook(() => usePricesViewState(SAMPLE_PRICES), { wrapper });
    expect(result.current.regionOptions.length).toBeGreaterThanOrEqual(2);
  });

  it('computes categoryOptions from prices', () => {
    const { result } = renderHook(() => usePricesViewState(SAMPLE_PRICES), { wrapper });
    expect(result.current.categoryOptions).toContain('grains');
    expect(result.current.categoryOptions).toContain('vegetables');
  });

  it('computes alertProducts from prices', () => {
    const { result } = renderHook(() => usePricesViewState(SAMPLE_PRICES), { wrapper });
    expect(result.current.alertProducts.length).toBe(3);
  });
});

describe('usePricesViewState — filter + search', () => {
  it('search narrows filteredPrices', () => {
    const { result } = renderHook(() => usePricesViewState(SAMPLE_PRICES), { wrapper });
    act(() => result.current.setSearchQuery('طماطم'));
    expect(result.current.filteredPrices.length).toBe(1);
    expect(result.current.filteredPrices[0].product_name_ar).toBe('طماطم');
  });

  it('region filter narrows results', () => {
    const { result } = renderHook(() => usePricesViewState(SAMPLE_PRICES), { wrapper });
    const basraLabel = result.current.regionOptions.find(r => r.includes('البصرة') || r.includes('Basra'));
    if (basraLabel) {
      act(() => result.current.setSelectedRegion(basraLabel));
      expect(result.current.filteredPrices.length).toBe(1);
    }
  });
});

describe('usePricesViewState — sort cycle', () => {
  it('handleSort cycles asc -> desc -> reset', () => {
    const { result } = renderHook(() => usePricesViewState(SAMPLE_PRICES), { wrapper });
    // Initial: product_name_ar asc
    act(() => result.current.handleSort('product_name_ar'));
    expect(result.current.sortDir).toBe('desc');
    act(() => result.current.handleSort('product_name_ar'));
    // After none, resets to default
    expect(result.current.sortBy).toBe('product_name_ar');
    expect(result.current.sortDir).toBe('asc');
  });

  it('clicking new column starts asc', () => {
    const { result } = renderHook(() => usePricesViewState(SAMPLE_PRICES), { wrapper });
    act(() => result.current.handleSort('avg_price_iqd'));
    expect(result.current.sortBy).toBe('avg_price_iqd');
    expect(result.current.sortDir).toBe('asc');
  });
});

describe('usePricesViewState — pagination reset on filter change', () => {
  it('page resets to 1 on search change', () => {
    const { result } = renderHook(() => usePricesViewState(SAMPLE_PRICES), { wrapper });
    act(() => result.current.setCurrentPage(2));
    act(() => result.current.setSearchQuery('x'));
    expect(result.current.currentPage).toBe(1);
  });
});

describe('usePricesViewState — compare', () => {
  it('toggleCompare adds and removes', () => {
    const { result } = renderHook(() => usePricesViewState(SAMPLE_PRICES), { wrapper });
    act(() => result.current.toggleCompare('p1__r1__kg'));
    expect(result.current.compareKeys.has('p1__r1__kg')).toBe(true);
    act(() => result.current.toggleCompare('p1__r1__kg'));
    expect(result.current.compareKeys.has('p1__r1__kg')).toBe(false);
  });

  it('respects MAX_COMPARE cap', () => {
    const { result } = renderHook(() => usePricesViewState(SAMPLE_PRICES), { wrapper });
    for (let i = 0; i < MAX_COMPARE + 2; i++) {
      act(() => result.current.toggleCompare(`key_${i}`));
    }
    expect(result.current.compareKeys.size).toBe(MAX_COMPARE);
  });

  it('clearCompare clears all', () => {
    const { result } = renderHook(() => usePricesViewState(SAMPLE_PRICES), { wrapper });
    act(() => result.current.toggleCompare('k1'));
    act(() => result.current.clearCompare());
    expect(result.current.compareKeys.size).toBe(0);
  });
});

describe('usePricesViewState — view preference', () => {
  it('handleSetView persists to localStorage', () => {
    const { result } = renderHook(() => usePricesViewState([]), { wrapper });
    act(() => result.current.handleSetView('cards'));
    expect(result.current.effectiveView).toBe('cards');
    expect(localStorage.getItem(VIEW_PREF_KEY)).toContain('cards');
  });
});

describe('usePricesViewState — preferences save/apply/reset', () => {
  it('save + apply roundtrips preferences', () => {
    const { result } = renderHook(() => usePricesViewState(SAMPLE_PRICES), { wrapper });
    act(() => result.current.setPageSize(25));
    act(() => result.current.handleSavePrefs());
    expect(mockToast).toHaveBeenCalledWith({ title: 'تم حفظ التفضيلات' });

    // Reset then apply
    act(() => result.current.setPageSize(10));
    act(() => result.current.handleApplyPrefs());
    expect(result.current.pageSize).toBe(25);
    expect(mockToast).toHaveBeenCalledWith({ title: 'تم تطبيق التفضيلات' });
  });

  it('apply with no saved prefs shows error toast', () => {
    const { result } = renderHook(() => usePricesViewState([]), { wrapper });
    act(() => result.current.handleApplyPrefs());
    expect(mockToast).toHaveBeenCalledWith({ title: 'لا توجد تفضيلات محفوظة', variant: 'destructive' });
  });

  it('reset clears both pricesPreferences + viewPreference', () => {
    const { result } = renderHook(() => usePricesViewState(SAMPLE_PRICES), { wrapper });
    act(() => result.current.handleSetView('cards'));
    act(() => result.current.setPageSize(50));
    act(() => result.current.handleSavePrefs());

    act(() => result.current.handleResetPrefs());
    expect(result.current.pageSize).toBe(10);
    expect(result.current.selectedRegion).toBe('all');
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(VIEW_PREF_KEY)).toBeNull();
    expect(mockToast).toHaveBeenCalledWith({ title: 'تم إعادة التعيين' });
  });
});

describe('usePricesViewState — CSV export', () => {
  it('does not call downloadCsv when no filtered data', () => {
    const { result } = renderHook(() => usePricesViewState([]), { wrapper });
    act(() => result.current.handleExportCsv());
    expect(downloadCsv).not.toHaveBeenCalled();
  });

  it('exports CSV and tracks telemetry', () => {
    const { result } = renderHook(() => usePricesViewState(SAMPLE_PRICES), { wrapper });
    act(() => result.current.handleExportCsv());
    expect(downloadCsv).toHaveBeenCalled();
    expect(mockTelemetry.trackEvent).toHaveBeenCalledWith('prices_csv_exported', { row_count: '3' });
  });
});
