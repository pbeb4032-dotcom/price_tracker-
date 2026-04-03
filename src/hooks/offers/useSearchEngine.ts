/**
 * Hook for the search_products_engine RPC — cache-aware product search.
 */

import { useQuery } from '@tanstack/react-query';
import { USE_API } from '@/integrations/dataMode';
import { apiRpc } from '@/integrations/api/rpc';
import { supabase } from '@/integrations/supabase/client';

export type SearchSort = 'best' | 'price_asc' | 'price_desc';

export interface SearchFilters {
  category?: string;
  subcategory?: string;
  min_price_iqd?: number;
  max_price_iqd?: number;
}

export interface SearchEngineRow {
  out_query_id: string;
  out_product_id: string;
  out_name_ar: string;
  out_name_en: string | null;
  out_image_url: string | null;
  out_category: string | null;
  out_best_price_iqd: number | null;
  out_source_name: string | null;
  out_rank_score: number;
  out_cache_hit: boolean;
}

interface UseSearchEngineParams {
  query: string;
  regionId?: string | null;
  filters?: SearchFilters;
  sort?: SearchSort;
  limit?: number;
  offset?: number;
}

export function useSearchEngine({
  query,
  regionId,
  filters,
  sort = 'best',
  limit = 24,
  offset = 0,
}: UseSearchEngineParams) {
  const trimmed = query.trim();

  // لا نرسل category=all كفلتر
  const normalizedFilters: SearchFilters | undefined = (() => {
    if (!filters) return undefined;
    const next = { ...filters };
    if (next.category === 'all') delete next.category;
    return Object.keys(next).length ? next : undefined;
  })();

  // Stable stringify: sort keys so same filters always produce the same cache key
  const filtersKey = JSON.stringify(
    Object.keys(normalizedFilters ?? {}).sort().reduce<Record<string, unknown>>((acc, k) => {
      acc[k] = (normalizedFilters as Record<string, unknown>)?.[k];
      return acc;
    }, {}),
  );

  return useQuery<SearchEngineRow[]>({
    queryKey: ['search-engine', trimmed, regionId ?? null, filtersKey, sort, limit, offset],
    queryFn: async () => {
      const args = {
        p_query: trimmed,
        p_region_id: regionId ?? null,
        p_filters: normalizedFilters ?? {},
        p_limit: limit,
        p_offset: offset,
        p_sort: sort,
      };

      if (USE_API) {
        const data = await apiRpc<SearchEngineRow[]>('search_products_engine', args as any);
        return (data ?? []) as SearchEngineRow[];
      }

      const { data, error } = await supabase.rpc('search_products_engine' as any, args);
      if (error) throw error;
      return (data ?? []) as SearchEngineRow[];
    },
    enabled: trimmed.length >= 2,
    staleTime: 30_000,
  });
}