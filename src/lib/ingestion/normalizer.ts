/**
 * Offer normalizer — validates and normalizes raw source data.
 *
 * Reuses existing Arabic normalization and price validation utilities.
 */

import { normalizeArabicText, parseSize, isValidPrice, isReasonableIQDPrice } from '@/lib/offers/normalization';
import { sanitizeExternalUrl } from './urlSafety';
import type { NormalizedOfferInput, RejectReason } from './types';

/** Input from a raw source adapter parse */
export interface RawOfferFields {
  source_id: string;
  source_url: string | null;
  external_item_id: string | null;
  product_name_ar: string | null;
  product_name_en: string | null;
  brand_ar: string | null;
  brand_en: string | null;
  barcode: string | null;
  category: string | null;
  unit: string | null;
  image_url: string | null;
  base_price: number | null;
  discount_price: number | null;
  delivery_fee: number | null;
  currency: string | null;
  in_stock: boolean | null;
  merchant_name: string | null;
  region_id: string | null;
  observed_at: string | null;
}

export type NormalizationResult =
  | { ok: true; offer: NormalizedOfferInput }
  | { ok: false; reason: RejectReason; detail: string };

/**
 * Normalize and validate a raw offer from any source.
 * Returns a strict NormalizedOfferInput or a rejection reason.
 */
export function normalizeOffer(raw: RawOfferFields): NormalizationResult {
  // Source ID required
  if (!raw.source_id?.trim()) {
    return { ok: false, reason: 'missing_source_id', detail: 'source_id is empty' };
  }

  // Product name required
  const nameAr = raw.product_name_ar?.trim();
  if (!nameAr) {
    return { ok: false, reason: 'empty_name', detail: 'product_name_ar is empty' };
  }

  // Normalize Arabic name
  const normalizedNameAr = normalizeArabicText(nameAr);

  // URL safety
  const safeSourceUrl = sanitizeExternalUrl(raw.source_url);
  if (!safeSourceUrl) {
    return { ok: false, reason: 'unsafe_url', detail: `Rejected URL: ${raw.source_url ?? 'null'}` };
  }

  // Price validation
  const basePrice = raw.base_price ?? 0;
  const finalPrice = raw.discount_price != null && raw.discount_price > 0
    ? Math.min(basePrice, raw.discount_price)
    : basePrice;

  if (!isValidPrice(finalPrice)) {
    return { ok: false, reason: 'invalid_price', detail: `Price ${finalPrice} is not valid` };
  }

  if (!isReasonableIQDPrice(finalPrice)) {
    return { ok: false, reason: 'absurd_price', detail: `Price ${finalPrice} IQD is outside reasonable range` };
  }

  // Currency must be IQD
  const currency = (raw.currency ?? 'IQD').toUpperCase();
  if (currency !== 'IQD') {
    return { ok: false, reason: 'invalid_currency', detail: `Currency ${currency} is not IQD` };
  }

  // Region required
  if (!raw.region_id?.trim()) {
    return { ok: false, reason: 'missing_region', detail: 'region_id is empty' };
  }

  // Auto-extract size from name if not provided
  let sizeValue: number | null = null;
  let sizeUnit: string | null = null;
  const parsedSize = parseSize(nameAr);
  if (parsedSize) {
    sizeValue = parsedSize.value;
    sizeUnit = parsedSize.unit;
  }

  // Safe image URL (permissive — fallback handled in UI)
  const safeImageUrl = sanitizeExternalUrl(raw.image_url);

  const offer: NormalizedOfferInput = {
    source_id: raw.source_id.trim(),
    source_url: safeSourceUrl,
    external_item_id: raw.external_item_id?.trim() ?? null,
    product_name_ar: nameAr,
    product_name_en: raw.product_name_en?.trim() ?? null,
    brand_ar: raw.brand_ar?.trim() ?? null,
    brand_en: raw.brand_en?.trim() ?? null,
    barcode: raw.barcode?.trim() ?? null,
    size_value: sizeValue,
    size_unit: sizeUnit,
    category: raw.category?.trim() ?? 'general',
    unit: raw.unit?.trim() ?? 'pcs',
    image_url: safeImageUrl,
    base_price: basePrice > 0 ? basePrice : finalPrice,
    discount_price: raw.discount_price != null && raw.discount_price < basePrice ? raw.discount_price : null,
    final_price: finalPrice,
    delivery_fee: raw.delivery_fee != null && raw.delivery_fee >= 0 ? raw.delivery_fee : null,
    currency: 'IQD',
    in_stock: raw.in_stock ?? true,
    merchant_name: raw.merchant_name?.trim() ?? null,
    region_id: raw.region_id.trim(),
    observed_at: raw.observed_at ?? new Date().toISOString(),
  };

  return { ok: true, offer };
}
