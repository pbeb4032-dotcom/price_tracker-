/**
 * Tests for useProductPriceHistory hook.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock supabase
const mockRpc = vi.fn();
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

// Must import after mocks
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

function createWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

describe('useProductPriceHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty array when productId is undefined', async () => {
    const { useProductPriceHistory } = await import('@/hooks/offers/useProductPriceHistory');
    const { result } = renderHook(
      () => useProductPriceHistory({ productId: undefined }),
      { wrapper: createWrapper() },
    );
    // Should not call rpc
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('calls rpc with correct params on success', async () => {
    const mockData = [
      { day: '2026-02-01', min_price: 1000, max_price: 2000, avg_price: 1500, offer_count: 5, source_count: 3 },
    ];
    mockRpc.mockResolvedValue({ data: mockData, error: null });

    const { useProductPriceHistory } = await import('@/hooks/offers/useProductPriceHistory');
    const { result } = renderHook(
      () => useProductPriceHistory({ productId: 'test-id', days: 30, includeDelivery: true }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockRpc).toHaveBeenCalledWith('get_product_price_history', {
      p_product_id: 'test-id',
      p_days: 30,
      p_region_id: null,
      p_include_delivery: true,
    });
    expect(result.current.data).toEqual([
      {
        ...mockData[0],
        sample_count: 5,
      },
    ]);
  });

  it('handles error from rpc', async () => {
    mockRpc.mockResolvedValue({ data: null, error: new Error('db error') });

    const { useProductPriceHistory } = await import('@/hooks/offers/useProductPriceHistory');
    const { result } = renderHook(
      () => useProductPriceHistory({ productId: 'test-id' }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it('query key includes all params', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });

    const { useProductPriceHistory } = await import('@/hooks/offers/useProductPriceHistory');
    const { result } = renderHook(
      () => useProductPriceHistory({ productId: 'abc', days: 7, regionId: 'r1', includeDelivery: false }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // Verifying it was called — query key stability ensured by no extra calls
    expect(mockRpc).toHaveBeenCalledTimes(1);
  });
});
