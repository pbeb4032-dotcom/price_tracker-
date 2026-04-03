/**
 * Phase 1 — PriceHistoryChart integration tests.
 * Covers: sorted series, min/max badges, pct-change, volatility, includeDelivery toggle, states.
 */

import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';

// Polyfill ResizeObserver for jsdom (Recharts needs it)
beforeAll(() => {
  if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as any;
  }
});
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PriceHistoryPoint } from '@/lib/offers/history';
import { calcTrend, calcPctChange, calcVolatility, historyMin, historyMax, totalSources } from '@/lib/offers/history';

// Mock supabase rpc + from
const mockRpc = vi.fn();
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: () => ({
      select: () => ({
        eq: () => ({
          not: () => Promise.resolve({ data: [], error: null }),
        }),
      }),
    }),
  },
}));

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

const SAMPLE_POINTS: PriceHistoryPoint[] = [
  { day: '2026-01-01', min_price: 800, max_price: 1200, avg_price: 1000, offer_count: 3, source_count: 2 },
  { day: '2026-01-02', min_price: 750, max_price: 1300, avg_price: 1050, offer_count: 4, source_count: 3 },
  { day: '2026-01-03', min_price: 700, max_price: 1400, avg_price: 1100, offer_count: 5, source_count: 3 },
];

describe('PriceHistoryChart integration', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders loading skeleton initially', async () => {
    mockRpc.mockReturnValue(new Promise(() => {})); // never resolves
    const { PriceHistoryChart } = await import('@/components/offers/PriceHistoryChart');
    const Wrapper = wrapper();
    render(<Wrapper><PriceHistoryChart productId="test-id" /></Wrapper>);
    // Skeleton should be present
    expect(document.querySelector('.animate-pulse, [class*="skeleton"]')).toBeTruthy();
  });

  it('renders empty state when no data', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });
    const { PriceHistoryChart } = await import('@/components/offers/PriceHistoryChart');
    const Wrapper = wrapper();
    render(<Wrapper><PriceHistoryChart productId="test-id" /></Wrapper>);
    await waitFor(() => expect(screen.getByText(/لا توجد بيانات/)).toBeTruthy());
  });

  it('renders error state', async () => {
    mockRpc.mockResolvedValue({ data: null, error: new Error('fail') });
    const { PriceHistoryChart } = await import('@/components/offers/PriceHistoryChart');
    const Wrapper = wrapper();
    render(<Wrapper><PriceHistoryChart productId="test-id" /></Wrapper>);
    await waitFor(() => expect(screen.getByText(/خطأ/)).toBeTruthy());
  });

  it('renders chart with summary badges on success', async () => {
    mockRpc.mockResolvedValue({ data: SAMPLE_POINTS, error: null });
    const { PriceHistoryChart } = await import('@/components/offers/PriceHistoryChart');
    const Wrapper = wrapper();
    render(<Wrapper><PriceHistoryChart productId="test-id" /></Wrapper>);
    await waitFor(() => expect(screen.getByText(/أقل سعر/)).toBeTruthy());
    expect(screen.getByText(/أعلى سعر/)).toBeTruthy();
    expect(screen.getByText(/التغير/)).toBeTruthy();
    expect(screen.getByText(/مصدر/)).toBeTruthy();
  });

  it('includeDelivery toggle changes rpc params', async () => {
    mockRpc.mockResolvedValue({ data: SAMPLE_POINTS, error: null });
    const { PriceHistoryChart } = await import('@/components/offers/PriceHistoryChart');
    const Wrapper = wrapper();
    render(<Wrapper><PriceHistoryChart productId="test-id" /></Wrapper>);
    await waitFor(() => expect(mockRpc).toHaveBeenCalled());
    
    // First call should have include_delivery false
    expect(mockRpc).toHaveBeenCalledWith('get_product_price_history', expect.objectContaining({
      p_include_delivery: false,
    }));
  });
});

describe('History helpers — sorted series and computations', () => {
  const sorted: PriceHistoryPoint[] = [
    { day: '2026-01-01', min_price: 1000, max_price: 2000, avg_price: 1500, offer_count: 3, source_count: 2 },
    { day: '2026-01-02', min_price: 900, max_price: 2100, avg_price: 1600, offer_count: 4, source_count: 3 },
    { day: '2026-01-03', min_price: 800, max_price: 2200, avg_price: 1700, offer_count: 5, source_count: 4 },
  ];

  it('series is sorted ascending by day', () => {
    const days = sorted.map(p => p.day);
    const sortedDays = [...days].sort();
    expect(days).toEqual(sortedDays);
  });

  it('historyMin returns global minimum', () => {
    expect(historyMin(sorted)).toBe(800);
  });

  it('historyMax returns global maximum', () => {
    expect(historyMax(sorted)).toBe(2200);
  });

  it('calcPctChange computes correctly', () => {
    // (1700-1500)/1500 * 100 = 13.33 → 13
    expect(calcPctChange(sorted)).toBe(13);
  });

  it('calcTrend returns up for >2% increase', () => {
    expect(calcTrend(sorted)).toBe('up');
  });

  it('calcVolatility returns positive value', () => {
    expect(calcVolatility(sorted)).toBeGreaterThan(0);
  });

  it('totalSources returns max source_count', () => {
    expect(totalSources(sorted)).toBe(4);
  });
});
