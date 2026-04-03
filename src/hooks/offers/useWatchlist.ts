import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { USE_API } from '@/integrations/dataMode';
import { apiDelete, apiGet, apiPatch } from '@/integrations/api/client';
import { supabase } from '@/integrations/supabase/client';

export type WatchlistItem = {
  id: string;
  product_id: string;
  region_id: string | null;
  target_price: number | null;
  include_delivery: boolean;
  is_active: boolean;
  alert_type: string;
  last_triggered_at: string | null;
  created_at: string;

  product_name_ar?: string;
  product_name_en?: string | null;
  product_image_url?: string | null;
  product_category?: string | null;
  product_unit?: string | null;

  current_best_price?: number | null;
  current_best_source_domain?: string | null;
  current_best_observed_at?: string | null;
  would_trigger_now?: boolean;
};

export function useWatchlist(userId?: string, limit = 100) {
  return useQuery({
    queryKey: ['watchlist', userId, limit],
    enabled: !!userId,
    staleTime: 20_000,
    queryFn: async (): Promise<WatchlistItem[]> => {
      if (!userId) return [];

      if (USE_API) {
        const qs = new URLSearchParams();
        qs.set('limit', String(limit));
        const data = await apiGet<WatchlistItem[]>(`/tables/watchlist?${qs.toString()}`);
        return data ?? [];
      }

      // Supabase mode (fallback): alerts + product join, best price computed separately.
      const { data: alerts, error } = await supabase
        .from('alerts')
        .select(
          'id, product_id, region_id, target_price, include_delivery, is_active, alert_type, last_triggered_at, created_at, products(id, name_ar, name_en, image_url, category, unit)'
        )
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) throw error;

      const items = (alerts ?? []).map((a: any) => ({
        id: a.id,
        product_id: a.product_id,
        region_id: a.region_id,
        target_price: a.target_price,
        include_delivery: Boolean(a.include_delivery),
        is_active: Boolean(a.is_active),
        alert_type: a.alert_type,
        last_triggered_at: a.last_triggered_at,
        created_at: a.created_at,
        product_name_ar: a.products?.name_ar,
        product_name_en: a.products?.name_en,
        product_image_url: a.products?.image_url,
        product_category: a.products?.category,
        product_unit: a.products?.unit,
      })) as WatchlistItem[];

      // Compute best price (grouped)
      const productIds = Array.from(new Set(items.map((x) => x.product_id)));
      if (!productIds.length) return items;

      const { data: offers, error: offersErr } = await supabase
        .from('v_product_all_offers')
        .select('product_id, final_price, delivery_fee, observed_at, source_domain, region_id, is_verified, in_stock, is_price_anomaly')
        .in('product_id', productIds)
        .eq('is_verified', true)
        .eq('in_stock', true);
      if (offersErr) return items;

      const bestByKey = new Map<string, any>();
      for (const o of offers ?? []) {
        if ((o as any).is_price_anomaly) continue;
        const pid = String((o as any).product_id);
        const rid = (o as any).region_id ? String((o as any).region_id) : 'any';
        const key = `${pid}:${rid}`;
        const price = Number((o as any).final_price ?? 0) + Number((o as any).delivery_fee ?? 0);
        const cur = bestByKey.get(key);
        if (!cur || price < cur.price) {
          bestByKey.set(key, { price, domain: (o as any).source_domain, at: (o as any).observed_at });
        }
      }

      for (const it of items) {
        const rid = it.region_id ? String(it.region_id) : 'any';
        const key = `${it.product_id}:${rid}`;
        const best = bestByKey.get(key);
        if (best) {
          it.current_best_price = best.price;
          it.current_best_source_domain = best.domain;
          it.current_best_observed_at = best.at;
          it.would_trigger_now = it.target_price != null ? best.price <= Number(it.target_price) : false;
        }
      }

      return items;
    },
  });
}

export function useUpdateWatchlistAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id: string; userId: string; target_price?: number; include_delivery?: boolean; is_active?: boolean }) => {
      if (USE_API) {
        await apiPatch(`/tables/alerts/${encodeURIComponent(args.id)}`, {
          ...(args.target_price != null ? { target_price: args.target_price } : {}),
          ...(args.include_delivery != null ? { include_delivery: args.include_delivery } : {}),
          ...(args.is_active != null ? { is_active: args.is_active } : {}),
        });
        return args.userId;
      }

      const patch: any = {};
      if (args.target_price != null) patch.target_price = args.target_price;
      if (args.include_delivery != null) patch.include_delivery = args.include_delivery;
      if (args.is_active != null) patch.is_active = args.is_active;

      const { error } = await supabase.from('alerts').update(patch).eq('id', args.id).eq('user_id', args.userId);
      if (error) throw error;
      return args.userId;
    },
    onSuccess: (userId) => {
      qc.invalidateQueries({ queryKey: ['watchlist', userId] });
      qc.invalidateQueries({ queryKey: ['notifications', userId] });
      qc.invalidateQueries({ queryKey: ['notifications-unread-count', userId] });
    },
  });
}

export function useDeleteWatchlistAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id: string; userId: string }) => {
      if (USE_API) {
        await apiDelete(`/tables/alerts/${encodeURIComponent(args.id)}`);
        return args.userId;
      }
      const { error } = await supabase.from('alerts').delete().eq('id', args.id).eq('user_id', args.userId);
      if (error) throw error;
      return args.userId;
    },
    onSuccess: (userId) => qc.invalidateQueries({ queryKey: ['watchlist', userId] }),
  });
}
