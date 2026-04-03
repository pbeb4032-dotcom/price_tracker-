/**
 * Fetch time-series history for a product.
 */

import { useQuery } from '@tanstack/react-query';
import { USE_API } from '@/integrations/dataMode';
import { apiRpc } from '@/integrations/api/rpc';
import { supabase } from '@/integrations/supabase/client';

export type ProductPriceHistoryRow = {
  day: string;
  avg_price: number;
  min_price: number;
  max_price: number;
  offer_count: number;
  source_count: number;
  sample_count: number;
};

const normalizeHistoryRows = (rows: any[]): ProductPriceHistoryRow[] => {
  return (rows ?? []).map((r) => {
    const offerCount = Number(r.offer_count ?? r.sample_count ?? 0);
    const sourceCount = Number(r.source_count ?? 0);
    return {
      day: String(r.day ?? ''),
      avg_price: Number(r.avg_price ?? 0),
      min_price: Number(r.min_price ?? 0),
      max_price: Number(r.max_price ?? 0),
      offer_count: offerCount,
      source_count: sourceCount,
      // Backward compat for older components/tests still reading sample_count.
      sample_count: Number(r.sample_count ?? offerCount),
    };
  });
};

export function useProductPriceHistory(params: {
  productId?: string;
  regionId?: string | null;
  days?: number;
  includeDelivery?: boolean;
}) {
  const { productId, regionId, days = 30, includeDelivery = false } = params;

  return useQuery<ProductPriceHistoryRow[]>({
    queryKey: ['product-price-history', productId, regionId, days, includeDelivery],
    enabled: !!productId,
    staleTime: 60_000,
    queryFn: async () => {
      if (!productId) return [];

      const payload = {
        p_product_id: productId,
        p_region_id: regionId ?? null,
        p_days: days,
        p_include_delivery: includeDelivery,
      };

      if (USE_API) {
        const data = await apiRpc<ProductPriceHistoryRow[]>('get_product_price_history', payload);
        return normalizeHistoryRows(data as any);
      }

      const { data, error } = await supabase.rpc('get_product_price_history', payload);
      if (error) throw error;
      return normalizeHistoryRows(data as any);
    },
  });
}
