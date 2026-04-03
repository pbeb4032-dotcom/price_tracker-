/**
 * Tests for region filter on price history chart.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRpc = vi.fn();
const mockFrom = vi.fn();
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: (...args: unknown[]) => mockFrom(...args),
  },
}));

import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

describe('Region filter — useProductPriceHistory', () => {
  beforeEach(() => vi.clearAllMocks());

  it('passes regionId to rpc when provided', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });
    const { useProductPriceHistory } = await import('@/hooks/offers/useProductPriceHistory');
    const { result } = renderHook(
      () => useProductPriceHistory({ productId: 'p1', days: 30, regionId: 'r1' }),
      { wrapper: createWrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockRpc).toHaveBeenCalledWith('get_product_price_history', expect.objectContaining({
      p_region_id: 'r1',
    }));
  });

  it('passes null regionId by default', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });
    const { useProductPriceHistory } = await import('@/hooks/offers/useProductPriceHistory');
    const { result } = renderHook(
      () => useProductPriceHistory({ productId: 'p1' }),
      { wrapper: createWrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockRpc).toHaveBeenCalledWith('get_product_price_history', expect.objectContaining({
      p_region_id: null,
    }));
  });
});

describe('Region filter — useProductRegions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns deduplicated regions', async () => {
    const mockSelect = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        not: vi.fn().mockResolvedValue({
          data: [
            { region_id: 'r1', region_name_ar: 'بغداد' },
            { region_id: 'r1', region_name_ar: 'بغداد' },
            { region_id: 'r2', region_name_ar: 'البصرة' },
          ],
          error: null,
        }),
      }),
    });
    mockFrom.mockReturnValue({ select: mockSelect });
    
    const { useProductRegions } = await import('@/hooks/offers/useProductRegions');
    const { result } = renderHook(
      () => useProductRegions('p1'),
      { wrapper: createWrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(2);
    expect(result.current.data?.[0].name_ar).toBe('بغداد');
  });

  it('returns empty when productId is undefined', async () => {
    const { useProductRegions } = await import('@/hooks/offers/useProductRegions');
    const { result } = renderHook(
      () => useProductRegions(undefined),
      { wrapper: createWrapper() },
    );
    // Query should be disabled
    expect(result.current.fetchStatus).toBe('idle');
  });
});
