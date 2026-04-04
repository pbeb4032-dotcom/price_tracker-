/**
 * Iraq Product & Price Collector — Offer domain types.
 */

export type PriceQuality = 'trusted' | 'provisional' | 'synthetic';

export interface BestOffer {
  offer_id: string;
  product_id: string;
  product_name_ar: string;
  product_name_en: string | null;
  product_image_url: string | null;
  category: string;
  subcategory?: string | null;
  unit: string;
  brand_ar: string | null;
  brand_en: string | null;
  barcode: string | null;
  size_value: number | null;
  size_unit: string | null;
  base_price: number;
  discount_price: number | null;
  final_price: number;
  delivery_fee: number | null;
  currency: string;
  in_stock: boolean;
  source_url: string;
  merchant_name: string | null;
  observed_at: string;
  region_id: string;
  region_name_ar: string;
  region_name_en: string | null;
  source_name_ar: string;
  source_domain: string;
  source_logo_url: string | null;
  source_kind: string;
  source_id: string;
  low_price_safe: number | null;
  high_price_safe: number | null;
  price_samples: number;
  price_quality: PriceQuality;

  // Optional reliability fields (added by newer APIs)
  price_confidence?: number | null;
  reliability_badge?: 'trusted' | 'medium' | 'suspected' | string | null;
  confidence_reasons?: string[] | null;
  is_price_suspected?: boolean | null;
  is_price_anomaly?: boolean | null;
  is_price_trusted?: boolean | null;
  source_certification_tier?: string | null;
  source_quality_score?: number | null;
  source_publish_enabled?: boolean | null;
  comparison?: {
    breakdown?: Record<string, unknown> | null;
    reasons?: string[] | null;
    [key: string]: unknown;
  } | null;

  // Optional category confidence fields (added by newer APIs)
  category_confidence?: number | null;
  category_badge?: 'trusted' | 'medium' | 'weak' | string | null;
  category_reasons?: string[] | null;
  category_conflict?: boolean | null;
}

export interface ProductOffer {
  offer_id: string;
  product_id: string;
  product_name_ar: string;
  product_name_en: string | null;
  product_image_url: string | null;
  category: string;
  subcategory?: string | null;
  unit: string;
  brand_ar: string | null;
  brand_en: string | null;
  base_price: number;
  discount_price: number | null;
  final_price: number;
  delivery_fee: number | null;
  currency: string;
  in_stock: boolean;
  source_url: string;
  merchant_name: string | null;
  observed_at: string;
  region_id: string;
  region_name_ar: string;
  region_name_en: string | null;
  source_name_ar: string;
  source_domain: string;
  source_logo_url: string | null;
  source_kind: string;
  source_id: string;

  // Optional reliability fields (added by newer APIs)
  price_confidence?: number | null;
  reliability_badge?: 'trusted' | 'medium' | 'suspected' | string | null;
  confidence_reasons?: string[] | null;
  is_price_suspected?: boolean | null;
  is_price_anomaly?: boolean | null;
  source_certification_tier?: string | null;
  source_quality_score?: number | null;
  source_publish_enabled?: boolean | null;
  comparison?: {
    breakdown?: Record<string, unknown> | null;
    reasons?: string[] | null;
    [key: string]: unknown;
  } | null;

  // Optional crowd signals
  crowd_reports_total?: number | null;
  crowd_wrong_price?: number | null;
  crowd_unavailable?: number | null;
  crowd_duplicate?: number | null;
  crowd_penalty?: number | null;
}

export interface ProductSearchResult {
  product_id: string;
  name_ar: string;
  name_en: string | null;
  category: string;
  unit: string;
  image_url: string | null;
  brand_ar: string | null;
  brand_en: string | null;
  barcode: string | null;
  condition: string;
  similarity_score: number;
}

export type OfferSortKey = 'price' | 'recency' | 'source';

export const PRODUCT_CATEGORIES = [
  { key: 'all', label_ar: 'الكل', label_en: 'All' },
  { key: 'electronics', label_ar: 'إلكترونيات', label_en: 'Electronics' },
  { key: 'groceries', label_ar: 'غذائيات', label_en: 'Groceries' },
  { key: 'beverages', label_ar: 'مشروبات', label_en: 'Beverages' },
  { key: 'clothing', label_ar: 'ملابس', label_en: 'Clothing' },
  { key: 'home', label_ar: 'أدوات منزلية', label_en: 'Home' },
  { key: 'beauty', label_ar: 'تجميل وعناية', label_en: 'Beauty' },
  { key: 'sports', label_ar: 'رياضة', label_en: 'Sports' },
  { key: 'toys', label_ar: 'ألعاب', label_en: 'Toys' },
  { key: 'automotive', label_ar: 'سيارات', label_en: 'Automotive' },
  { key: 'essentials', label_ar: 'أساسيات', label_en: 'Essentials' },
  { key: 'general', label_ar: 'عام', label_en: 'General' },
] as const;

export type CategoryKey = (typeof PRODUCT_CATEGORIES)[number]['key'];
