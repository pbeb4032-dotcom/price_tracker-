/**
 * Shkad Aadel — Map raw Supabase row to TrustedPrice.
 */

import type { TrustedPrice } from './types';

export function mapTrustedPrice(row: Record<string, unknown>): TrustedPrice {
  return {
    product_id: (row.product_id as string) ?? '',
    region_id: (row.region_id as string) ?? '',
    product_name_ar: (row.product_name_ar as string) ?? '—',
    product_name_en: (row.product_name_en as string) ?? '',
    region_name_ar: (row.region_name_ar as string) ?? '—',
    region_name_en: (row.region_name_en as string) ?? '',
    unit: (row.unit as string) ?? 'kg',
    category: (row.category as string) ?? '',
    min_price_iqd: Number(row.min_price_iqd ?? 0),
    avg_price_iqd: Number(row.avg_price_iqd ?? 0),
    max_price_iqd: Number(row.max_price_iqd ?? 0),
    sample_count: Number(row.sample_count ?? 0),
    last_observed_at: (row.last_observed_at as string) ?? '',
  };
}
