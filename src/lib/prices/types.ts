/**
 * Shkad Aadel — Trusted Price domain type.
 * Shared across all prices-related modules.
 */

export interface TrustedPrice {
  product_id: string;
  region_id: string;
  product_name_ar: string;
  product_name_en: string;
  region_name_ar: string;
  region_name_en: string;
  unit: string;
  category: string;
  min_price_iqd: number;
  avg_price_iqd: number;
  max_price_iqd: number;
  sample_count: number;
  last_observed_at: string;
}
