/**
 * Fetch all offers for a specific product from v_product_all_offers.
 */

import { useQuery } from '@tanstack/react-query';
import type { ProductOffer } from '@/lib/offers/types';
import { USE_API } from '@/integrations/dataMode';
import { apiGet } from '@/integrations/api/client';
import { supabase } from '@/integrations/supabase/client';

export function useProductOffers(productId: string | undefined) {
  return useQuery<ProductOffer[]>({
    queryKey: ['product-offers', productId],
    queryFn: async () => {
      if (!productId) return [];

      if (USE_API) {
        const data = await apiGet<any[]>(`/views/product_offers?product_id=${encodeURIComponent(productId)}`);
        return (data ?? []) as unknown as ProductOffer[];
      }

      const { data, error } = await supabase
        .from('v_product_all_offers' as any)
        .select('*')
        .eq('product_id', productId)
        .order('final_price', { ascending: true });

      if (error) throw error;
      return (data ?? []) as unknown as ProductOffer[];
    },
    enabled: !!productId,
    staleTime: 60_000,
  });
}
