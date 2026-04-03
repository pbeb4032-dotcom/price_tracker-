/**
 * Search products using fuzzy matching (Arabic + English + barcode).
 */

import { useQuery } from '@tanstack/react-query';
import type { ProductSearchResult, CategoryKey } from '@/lib/offers/types';
import { USE_API } from '@/integrations/dataMode';
import { apiRpc } from '@/integrations/api/rpc';
import { supabase } from '@/integrations/supabase/client';

interface UseProductSearchParams {
  query: string;
  category?: CategoryKey;
  limit?: number;
}

export function useProductSearch({ query, category, limit = 50 }: UseProductSearchParams) {
  const trimmed = query.trim();
  return useQuery<ProductSearchResult[]>({
    queryKey: ['product-search', trimmed, category, limit],
    queryFn: async () => {
      if (!trimmed) return [];

      if (USE_API) {
        const data = await apiRpc<ProductSearchResult[]>('search_products', {
          search_query: trimmed,
          category_filter: category && category !== 'all' ? category : null,
          limit_count: limit,
        });
        return data ?? [];
      }

      const { data, error } = await supabase.rpc('search_products' as any, {
        search_query: trimmed,
        category_filter: category && category !== 'all' ? category : null,
        limit_count: limit,
      });

      if (error) throw error;
      return (data ?? []) as unknown as ProductSearchResult[];
    },
    enabled: trimmed.length >= 2,
    staleTime: 30_000,
  });
}
