/**
 * Fetches best (cheapest) offers per product from v_best_offers_ui.
 *
 * Canonical rule:
 * - The backend taxonomy is the only source of truth for category membership.
 * - The client must never re-infer or override categories locally.
 *
 * This intentionally removes the previous "fetch all + guess category" fallback,
 * because that behavior polluted explore pages with unrelated products.
 */

import { useQuery } from '@tanstack/react-query';
import type { BestOffer, CategoryKey } from '@/lib/offers/types';
import { USE_API } from '@/integrations/dataMode';
import { apiGet } from '@/integrations/api/client';
import { supabase } from '@/integrations/supabase/client';

interface UseBestOffersParams {
  category?: CategoryKey;
  subcategory?: string;
  regionId?: string;
  limit?: number;
  offset?: number;
}

type RawOfferRow = Record<string, any>;

function normalizeOfferRow(row: RawOfferRow): BestOffer {
  return {
    ...row,
    final_price: Number(row.display_price_iqd ?? row.final_price),
    product_image_url: row.product_image_url_safe ?? row.product_image_url ?? null,
    price_quality: row.price_quality ?? 'synthetic',
    price_samples: row.price_samples ?? 0,
    low_price_safe: row.low_price_safe ?? null,
    high_price_safe: row.high_price_safe ?? null,
  } as BestOffer;
}

function dedupeOffers(rows: BestOffer[]): BestOffer[] {
  const seen = new Set<string>();
  const out: BestOffer[] = [];

  for (const row of rows) {
    const key =
      String((row as any).offer_id ?? '') ||
      `p:${String((row as any).product_id ?? '')}|s:${String((row as any).source_id ?? '')}`;
    if (!key) {
      out.push(row);
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }

  return out;
}

async function fetchApiBestOffers(params: {
  category?: string;
  subcategory?: string;
  regionId?: string;
  limit: number;
  offset?: number;
}): Promise<RawOfferRow[]> {
  const qs = new URLSearchParams();

  if (params.category && params.category !== 'all') qs.set('category', params.category);
  if (params.subcategory && params.subcategory !== 'all') qs.set('subcategory', params.subcategory);
  if (params.regionId) qs.set('region_id', params.regionId);
  qs.set('limit', String(params.limit));
  if ((params.offset ?? 0) > 0) qs.set('offset', String(params.offset));

  const data = await apiGet<any[]>(`/views/best_offers?${qs.toString()}`);
  return (data ?? []) as RawOfferRow[];
}

async function fetchSupabaseBestOffers(params: {
  category?: string;
  subcategory?: string;
  regionId?: string;
  limit: number;
  offset?: number;
}): Promise<RawOfferRow[]> {
  let query = supabase.from('v_best_offers_ui' as any).select('*');

  if (params.category && params.category !== 'all') {
    query = query.eq('category', params.category);
  }
  if (params.subcategory && params.subcategory !== 'all') {
    query = query.eq('subcategory', params.subcategory);
  }
  if (params.regionId) {
    query = query.eq('region_id', params.regionId);
  }

  const safeOffset = Math.max(0, params.offset ?? 0);
  const safeLimit = Math.max(1, params.limit);
  const from = safeOffset;
  const to = safeOffset + safeLimit - 1;

  const { data, error } = await query
    .order('is_price_trusted', { ascending: false })
    .order('display_price_iqd', { ascending: true })
    .range(from, to);

  if (error) throw error;
  return (data ?? []) as RawOfferRow[];
}

export function useBestOffers({
  category,
  subcategory,
  regionId,
  limit = 50,
  offset = 0,
}: UseBestOffersParams = {}) {
  return useQuery<BestOffer[]>({
    queryKey: ['best-offers', category ?? 'all', subcategory ?? 'all', regionId ?? null, limit, offset],
    queryFn: async () => {
      const cat = category ?? 'all';
      const sub = subcategory ?? 'all';
      const safeLimit = Math.max(1, limit);
      const safeOffset = Math.max(0, offset);

      const rows = USE_API
        ? await fetchApiBestOffers({ category: cat, subcategory: sub, regionId, limit: safeLimit, offset: safeOffset })
        : await fetchSupabaseBestOffers({ category: cat, subcategory: sub, regionId, limit: safeLimit, offset: safeOffset });

      return dedupeOffers(rows.map(normalizeOfferRow));
    },
    staleTime: 60_000,
  });
}
