/**
 * Fetch product images from product_images table.
 * Falls back to the single product image_url from products table.
 */

import { useQuery } from '@tanstack/react-query';
import { USE_API } from '@/integrations/dataMode';
import { apiGet } from '@/integrations/api/client';
import { supabase } from '@/integrations/supabase/client';

export interface ProductImage {
  id: string;
  image_url: string;
  source_site: string | null;
  source_page_url: string | null;
  position: number;
  confidence_score: number;
  is_primary: boolean;
  is_verified: boolean;
  width: number | null;
  height: number | null;
}

export function useProductImages(productId: string | undefined) {
  return useQuery<ProductImage[]>({
    queryKey: ['product-images', productId],
    queryFn: async () => {
      if (!productId) return [];

      if (USE_API) {
        const data = await apiGet<ProductImage[]>(`/tables/product_images?product_id=${encodeURIComponent(productId)}`);
        return data ?? [];
      }

      const { data, error } = await supabase
        .from('product_images' as any)
        .select('id, image_url, source_site, source_page_url, position, confidence_score, is_primary, is_verified, width, height')
        .eq('product_id', productId)
        .gte('confidence_score', 0.5)
        .order('is_primary', { ascending: false })
        .order('position', { ascending: true });

      if (error) throw error;
      return (data ?? []) as unknown as ProductImage[];
    },
    enabled: !!productId,
    staleTime: 5 * 60_000, // 5 min cache
  });
}
