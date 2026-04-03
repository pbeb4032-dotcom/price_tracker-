/**
 * Hooks for DB-backed price alerts (uses existing `alerts` table).
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { USE_API } from '@/integrations/dataMode';
import { apiGet, apiPost, apiPatch, apiDelete } from '@/integrations/api/client';
import { supabase } from '@/integrations/supabase/client';

export type PriceAlert = {
  id: string;
  product_id: string;
  region_id: string | null;
  target_price: number | null;
  include_delivery: boolean;
  is_active: boolean;
  alert_type: string;
  last_triggered_at: string | null;
  created_at: string;
};

export function usePriceAlerts(productId?: string) {
  return useQuery({
    queryKey: ['price-alerts', productId],
    enabled: !!productId,
    queryFn: async () => {
      if (!productId) return [];

      if (USE_API) {
        const data = await apiGet<PriceAlert[]>(`/tables/alerts?product_id=${encodeURIComponent(productId)}`);
        return data ?? [];
      }

      const { data, error } = await supabase
        .from('alerts')
        .select('id, product_id, region_id, target_price, include_delivery, is_active, alert_type, last_triggered_at, created_at')
        .eq('product_id', productId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as PriceAlert[];
    },
  });
}

export function useCreatePriceAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      product_id: string;
      target_price: number;
      region_id?: string | null;
      include_delivery?: boolean;
      user_id: string;
    }) => {
      if (USE_API) {
        return apiPost<PriceAlert>('/tables/alerts', {
          product_id: payload.product_id,
          target_price: payload.target_price,
          region_id: payload.region_id ?? null,
          include_delivery: payload.include_delivery ?? false,
        });
      }

      const { data, error } = await supabase
        .from('alerts')
        .insert({
          product_id: payload.product_id,
          target_price: payload.target_price,
          region_id: payload.region_id ?? null,
          include_delivery: payload.include_delivery ?? false,
          alert_type: 'price_drop',
          user_id: payload.user_id,
        })
        .select('*')
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_, vars) => qc.invalidateQueries({ queryKey: ['price-alerts', vars.product_id] }),
  });
}

export function useTogglePriceAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, is_active, product_id }: { id: string; is_active: boolean; product_id: string }) => {
      if (USE_API) {
        await apiPatch('/tables/alerts/' + encodeURIComponent(id), { is_active });
        return { product_id };
      }

      const { error } = await supabase.from('alerts').update({ is_active }).eq('id', id);
      if (error) throw error;
      return { product_id };
    },
    onSuccess: ({ product_id }) => qc.invalidateQueries({ queryKey: ['price-alerts', product_id] }),
  });
}

export function useDeletePriceAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, product_id }: { id: string; product_id: string }) => {
      if (USE_API) {
        await apiDelete('/tables/alerts/' + encodeURIComponent(id));
        return { product_id };
      }

      const { error } = await supabase.from('alerts').delete().eq('id', id);
      if (error) throw error;
      return { product_id };
    },
    onSuccess: ({ product_id }) => qc.invalidateQueries({ queryKey: ['price-alerts', product_id] }),
  });
}
