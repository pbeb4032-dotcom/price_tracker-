/**
 * Search products using the cached search_offers_cached RPC.
 * Returns full BestOffer rows (with price, source, image, quality badge).
 */

import { useQuery } from '@tanstack/react-query';
import { USE_API } from '@/integrations/dataMode';
import { apiRpc } from '@/integrations/api/rpc';
import { supabase } from '@/integrations/supabase/client';
import type { BestOffer, CategoryKey } from '@/lib/offers/types';

interface UseCachedSearchParams {
  query: string;
  category?: CategoryKey;
  regionId?: string;
  limit?: number;
}

export function useCachedSearch({ query, category, regionId, limit = 24 }: UseCachedSearchParams) {
  const trimmed = query.trim();

  return useQuery<BestOffer[]>({
    queryKey: ['cached-search', trimmed, category, regionId, limit],
    queryFn: async () => {
      const args = {
        p_query: trimmed,
        p_category: category && category !== 'all' ? category : null,
        p_region_id: regionId ?? null,
        p_limit: limit,
      };

      let data: any[] = [];

      if (USE_API) {
        data = await apiRpc<any[]>('search_offers_cached', args as any);
      } else {
        const { data: sbData, error } = await supabase.rpc('search_offers_cached' as any, args);
        if (error) throw error;
        data = (sbData ?? []) as any[];
      }

      return (data ?? []).map((row: any) => ({
        ...row,
        final_price: Number(row.display_price_iqd ?? row.final_price),
        product_image_url: row.product_image_url_safe ?? null,
        price_quality: row.price_quality ?? 'synthetic',
        price_samples: row.price_samples ?? 0,
        low_price_safe: row.low_price_safe ?? null,
        high_price_safe: row.high_price_safe ?? null,
      })) as BestOffer[];
    },
    enabled: trimmed.length >= 2,
    staleTime: 30_000,
  });
}
