/**
 * Hook for fetching Iraqi exchange rates (gov + market).
 */

import { useQuery } from '@tanstack/react-query';
import { USE_API } from '@/integrations/dataMode';
import { apiGet } from '@/integrations/api/client';
import { supabase } from '@/integrations/supabase/client';

export interface ExchangeRate {
  id: string;
  rate_date: string;
  source_type: 'gov' | 'market';
  source_name: string;
  buy_iqd_per_usd: number | null;
  sell_iqd_per_usd: number | null;
  mid_iqd_per_usd: number;
  is_active: boolean;
  created_at: string;
  meta?: any;
}

export function useExchangeRates() {
  return useQuery<ExchangeRate[]>({
    queryKey: ['exchange-rates'],
    queryFn: async () => {
      if (USE_API) {
        const data = await apiGet<ExchangeRate[]>('/tables/exchange_rates');
        return data ?? [];
      }

      const { data, error } = await supabase
        .from('exchange_rates')
        .select('*')
        .eq('is_active', true)
        .order('rate_date', { ascending: false })
        .limit(10);

      if (error) throw error;
      return (data ?? []) as unknown as ExchangeRate[];
    },
    staleTime: 5 * 60_000,
  });
}

/** Get the latest rate for a given source_type */
export function getLatestRate(rates: ExchangeRate[], type: 'gov' | 'market'): ExchangeRate | null {
  return rates.find((r) => r.source_type === type) ?? null;
}
