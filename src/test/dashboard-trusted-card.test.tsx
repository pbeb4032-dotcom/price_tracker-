import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

/**
 * Unit tests for TrustedPriceSummaryCard states and telemetry PII safety.
 */

let mockResponse: { data: unknown[] | null; error: unknown };

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        order: () => ({
          limit: () => Promise.resolve(mockResponse),
        }),
      }),
    }),
  },
}));

const trackEvent = vi.fn();
// Return a STABLE reference to prevent infinite useCallback/useEffect loops
const stableTelemetry = { trackEvent };
vi.mock('@/lib/telemetry', () => ({
  useTelemetry: () => stableTelemetry,
}));

import TrustedPriceSummaryCard from '@/components/TrustedPriceSummaryCard';

beforeEach(() => {
  vi.clearAllMocks();
  mockResponse = { data: [], error: null };
});

describe('TrustedPriceSummaryCard', () => {
  it('shows empty state when no data', async () => {
    mockResponse = { data: [], error: null };
    render(<TrustedPriceSummaryCard />);
    await waitFor(() => {
      expect(screen.getByTestId('trusted-price-empty')).toBeTruthy();
    });
  });

  it('shows error state with retry button on fetch failure', async () => {
    mockResponse = { data: null, error: { message: 'fail' } };
    render(<TrustedPriceSummaryCard />);
    await waitFor(() => {
      expect(screen.getByTestId('trusted-price-error')).toBeTruthy();
      expect(screen.getByText('إعادة')).toBeTruthy();
    });
  });

  it('renders rows when data exists', async () => {
    mockResponse = {
      data: [{
        product_name_ar: 'طماطم',
        region_name_ar: 'بغداد',
        avg_price_iqd: 1500,
        min_price_iqd: 1200,
        max_price_iqd: 1800,
        sample_count: 5,
        last_observed_at: '2026-02-12',
        unit: 'kg',
      }],
      error: null,
    };
    render(<TrustedPriceSummaryCard />);
    await waitFor(() => {
      expect(screen.getByTestId('trusted-price-list')).toBeTruthy();
      expect(screen.getByText('طماطم')).toBeTruthy();
    });
  });

  it('telemetry payloads are PII-safe', async () => {
    mockResponse = {
      data: [{ product_name_ar: 'x', region_name_ar: 'y', avg_price_iqd: 100, min_price_iqd: 90, max_price_iqd: 110, sample_count: 1, last_observed_at: '', unit: 'kg' }],
      error: null,
    };
    render(<TrustedPriceSummaryCard />);
    await waitFor(() => {
      expect(trackEvent).toHaveBeenCalled();
    });
    for (const call of trackEvent.mock.calls) {
      const payload = call[1] as Record<string, unknown> | undefined;
      if (payload) {
        const keys = Object.keys(payload);
        expect(keys).not.toContain('email');
        expect(keys).not.toContain('user_id');
        expect(keys).not.toContain('notes');
      }
    }
  });
});
