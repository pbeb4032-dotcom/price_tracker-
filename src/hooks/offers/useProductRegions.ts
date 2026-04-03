/**
 * Hook to fetch distinct regions for a product from observations.
 */

import { useQuery } from '@tanstack/react-query';
import { USE_API } from '@/integrations/dataMode';
import { apiGet } from '@/integrations/api/client';
import { supabase } from '@/integrations/supabase/client';

export interface ProductRegion {
  id: string;
  name_ar: string;
}

export function useProductRegions(productId: string | undefined) {
  return useQuery<ProductRegion[]>({
    queryKey: ['product-regions', productId],
    queryFn: async () => {
      if (!productId) return [];

      let rows: any[] = [];

      if (USE_API) {
        rows = await apiGet<any[]>(`/views/product_offers?product_id=${encodeURIComponent(productId)}`);
      } else {
        const { data, error } = await supabase
          .from('v_product_all_offers' as any)
          .select('region_id, region_name_ar')
          .eq('product_id', productId)
          .not('region_id', 'is', null);
        if (error) throw error;
        rows = (data ?? []) as any[];
      }

      const map = new Map<string, string>();
      for (const row of rows ?? []) {
        if (row.region_id && !map.has(row.region_id)) {
          map.set(row.region_id, row.region_name_ar ?? '');
        }
      }
      return Array.from(map.entries()).map(([id, name_ar]) => ({ id, name_ar }));
    },
    enabled: !!productId,
    staleTime: 120_000,
  });
}
