import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/integrations/api/client';

export interface ApiOfferComparisonBreakdown {
  total?: number;
  price?: number;
  trust?: number;
  freshness?: number;
  availability?: number;
  delivery?: number;
  [key: string]: unknown;
}

export interface ApiOfferComparisonRow {
  offer_id?: string;
  product_id?: string;
  final_price?: number | null;
  delivery_fee?: number | null;
  source_name_ar?: string | null;
  merchant_name?: string | null;
  in_stock?: boolean | null;
  observed_at?: string | null;
  is_suspected?: boolean | null;
  is_price_suspected?: boolean | null;
  comparison?: {
    breakdown?: ApiOfferComparisonBreakdown;
    reasons?: string[];
    [key: string]: unknown;
  } | null;
  [key: string]: unknown;
}

export interface CompareOffersResponse {
  product_id: string;
  region_id?: string | null;
  cheapest_effective_price_iqd?: number | null;
  best_offer?: ApiOfferComparisonRow | null;
  offers: ApiOfferComparisonRow[];
}

export interface CompareProductsResponse {
  winner?: 'A' | 'B' | 'tie' | string | null;
  recommendation?: string | null;
  left_product_id?: string | null;
  right_product_id?: string | null;
  product_a_id?: string | null;
  product_b_id?: string | null;
  cheaper_product_id?: string | null;
  price_difference_iqd?: number | null;
  percent_difference?: number | null;
  summary_ar?: string | null;
  scorecards?: {
    product_a?: { total?: number; [key: string]: unknown } | null;
    product_b?: { total?: number; [key: string]: unknown } | null;
    [key: string]: unknown;
  } | null;
  left_product?: Record<string, unknown> | null;
  right_product?: Record<string, unknown> | null;
  [key: string]: unknown;
}

export function isSuspectedOffer(row: Partial<ApiOfferComparisonRow> | null | undefined): boolean {
  if (!row) return false;
  return Boolean(row.is_suspected ?? row.is_price_suspected ?? false);
}

export function useCompareOffers(productId?: string | null, regionId?: string | null, enabled = true, limit = 10) {
  return useQuery({
    queryKey: ['compare-offers', productId ?? null, regionId ?? null, limit],
    enabled: Boolean(productId && enabled),
    queryFn: async () => {
      const qs = new URLSearchParams();
      qs.set('product_id', String(productId));
      if (regionId) qs.set('region_id', regionId);
      qs.set('limit', String(limit));
      return apiGet<CompareOffersResponse>(`/views/compare_offers?${qs.toString()}`);
    },
    staleTime: 60_000,
  });
}

export function useCompareProducts(productAId?: string | null, productBId?: string | null, regionId?: string | null, enabled = true) {
  return useQuery({
    queryKey: ['compare-products', productAId ?? null, productBId ?? null, regionId ?? null],
    enabled: Boolean(productAId && productBId && enabled),
    queryFn: async () => {
      const qs = new URLSearchParams();
      qs.set('product_a_id', String(productAId));
      qs.set('product_b_id', String(productBId));
      if (regionId) qs.set('region_id', regionId);
      return apiGet<CompareProductsResponse>(`/views/compare_products?${qs.toString()}`);
    },
    staleTime: 60_000,
  });
}
