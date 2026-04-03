/**
 * Unit tests for usePricesData hook.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { type ReactNode } from 'react';
import { TelemetryProvider, type TelemetryClient } from '@/lib/telemetry';

// Mock supabase
const mockSelect = vi.fn();
const mockOrder = vi.fn(() => ({ data: [], error: null }));
mockSelect.mockReturnValue({ order: mockOrder });
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(() => ({ select: mockSelect })),
  },
}));

// Mock toast
const mockToast = vi.fn();
vi.mock('@/hooks/use-toast', () => ({
  toast: (args: unknown) => mockToast(args),
}));

// Mock alerts utils
vi.mock('@/lib/pricesAlertsUtils', () => ({
  loadAlertsRules: vi.fn(() => []),
  evaluateAlerts: vi.fn(() => []),
  dedupeTriggered: vi.fn(() => ({ all: [], newAlerts: [] })),
  loadTriggeredAlerts: vi.fn(() => []),
  saveTriggeredAlerts: vi.fn(),
}));

import { usePricesData } from '@/hooks/prices/usePricesData';
import * as alertsUtils from '@/lib/pricesAlertsUtils';
import { supabase } from '@/integrations/supabase/client';

const mockTelemetry: TelemetryClient = {
  trackEvent: vi.fn(),
  trackError: vi.fn(),
  setUser: vi.fn(),
};

function wrapper({ children }: { children: ReactNode }) {
  return <TelemetryProvider provider={mockTelemetry}>{children}</TelemetryProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mockOrder.mockResolvedValue({ data: [], error: null });
});

describe('usePricesData', () => {
  it('starts in loading state', () => {
    const { result } = renderHook(() => usePricesData(), { wrapper });
    expect(result.current.loading).toBe(true);
    expect(result.current.prices).toEqual([]);
    expect(result.current.error).toBe(false);
  });

  it('loadPrices success path — maps data + tracks telemetry', async () => {
    const mockRow = {
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
    };
    mockOrder.mockResolvedValueOnce({ data: [mockRow], error: null });

    const { result } = renderHook(() => usePricesData(), { wrapper });
    await act(() => result.current.loadPrices());

    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe(false);
    expect(result.current.prices).toHaveLength(1);
    expect(result.current.prices[0].product_name_ar).toBe('رز');
    expect(mockTelemetry.trackEvent).toHaveBeenCalledWith('trusted_prices_view_loaded', { status: 'ok' });
  });

  it('loadPrices empty data tracks status=empty', async () => {
    mockOrder.mockResolvedValueOnce({ data: [], error: null });
    const { result } = renderHook(() => usePricesData(), { wrapper });
    await act(() => result.current.loadPrices());

    expect(result.current.prices).toHaveLength(0);
    expect(mockTelemetry.trackEvent).toHaveBeenCalledWith('trusted_prices_view_loaded', { status: 'empty' });
  });

  it('loadPrices failure path — sets error + tracks fail telemetry', async () => {
    mockOrder.mockResolvedValueOnce({ data: null, error: { message: 'fail' } });
    const { result } = renderHook(() => usePricesData(), { wrapper });
    await act(() => result.current.loadPrices());

    expect(result.current.error).toBe(true);
    expect(result.current.loading).toBe(false);
    expect(mockTelemetry.trackEvent).toHaveBeenCalledWith('trusted_prices_view_failed', { error_code: 'FETCH_FAILED' });
  });

  it('evaluates alerts and shows toast for new alerts', async () => {
    const mockRow = {
      product_id: 'p1', product_name_ar: 'رز', product_name_en: 'Rice',
      region_id: 'r1', region_name_ar: 'بغداد', region_name_en: 'Baghdad',
      category: 'grains', unit: 'kg',
      min_price_iqd: 1000, avg_price_iqd: 1500, max_price_iqd: 2000,
      sample_count: 5, last_observed_at: '2026-01-01T00:00:00Z',
    };
    mockOrder.mockResolvedValueOnce({ data: [mockRow], error: null });

    vi.mocked(alertsUtils.loadAlertsRules).mockReturnValueOnce([
      { id: 'rule1', product_id: 'p1', region_id: 'all', metric: 'avg_price_iqd', condition: 'lte', target_price_iqd: 2000, is_enabled: true, created_at: '' },
    ]);
    vi.mocked(alertsUtils.evaluateAlerts).mockReturnValueOnce([
      { rule_id: 'rule1', product_id: 'p1', region_id: 'r1', triggered_at: '', current_value: 1500, target_value: 2000, fingerprint: 'fp1' },
    ]);
    vi.mocked(alertsUtils.dedupeTriggered).mockReturnValueOnce({
      all: [{ rule_id: 'rule1', product_id: 'p1', region_id: 'r1', triggered_at: '', current_value: 1500, target_value: 2000, fingerprint: 'fp1' }],
      newAlerts: [{ rule_id: 'rule1', product_id: 'p1', region_id: 'r1', triggered_at: '', current_value: 1500, target_value: 2000, fingerprint: 'fp1' }],
    });

    const { result } = renderHook(() => usePricesData(), { wrapper });
    await act(() => result.current.loadPrices());

    expect(result.current.alertRules).toHaveLength(1);
    expect(result.current.triggeredAlerts).toHaveLength(1);
    expect(mockToast).toHaveBeenCalledWith({ title: '1 تنبيه سعر جديد!' });
  });

  it('reloadAlertRules refreshes from localStorage', () => {
    vi.mocked(alertsUtils.loadAlertsRules).mockReturnValueOnce([]);
    const { result } = renderHook(() => usePricesData(), { wrapper });
    act(() => result.current.reloadAlertRules());
    expect(alertsUtils.loadAlertsRules).toHaveBeenCalled();
  });

  it('reloadTriggered refreshes from localStorage', () => {
    vi.mocked(alertsUtils.loadTriggeredAlerts).mockReturnValueOnce([]);
    const { result } = renderHook(() => usePricesData(), { wrapper });
    act(() => result.current.reloadTriggered());
    expect(alertsUtils.loadTriggeredAlerts).toHaveBeenCalled();
  });
});
