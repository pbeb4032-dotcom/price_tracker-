/**
 * Product identity resolution — fingerprinting and matching.
 *
 * Strategy:
 * 1. Exact barcode match (highest confidence)
 * 2. Deterministic fingerprint (name + brand + size + category)
 * 3. Fuzzy name match (above threshold only)
 */

import { normalizeArabicText } from '@/lib/offers/normalization';

/** Default confidence threshold for fuzzy matches */
export const FUZZY_CONFIDENCE_THRESHOLD = 0.65;

/**
 * Build a deterministic fingerprint from product attributes.
 * Used for deduplication when barcode is unavailable.
 *
 * Format: sha256-like hash based on normalized concatenation.
 * For simplicity (no crypto dependency), uses a stable string key.
 */
export function buildFingerprint(attrs: {
  barcode?: string | null;
  name_ar: string;
  name_en?: string | null;
  brand_ar?: string | null;
  brand_en?: string | null;
  size_value?: number | null;
  size_unit?: string | null;
  category: string;
}): string {
  // If barcode exists, it's the strongest identity signal
  if (attrs.barcode?.trim()) {
    return `barcode:${attrs.barcode.trim()}`;
  }

  // Build composite fingerprint from normalized fields
  const parts = [
    normalizeArabicText(attrs.name_ar),
    attrs.name_en?.toLowerCase().trim() ?? '',
    attrs.brand_ar ? normalizeArabicText(attrs.brand_ar) : '',
    attrs.brand_en?.toLowerCase().trim() ?? '',
    attrs.size_value != null ? String(attrs.size_value) : '',
    attrs.size_unit?.toLowerCase().trim() ?? '',
    attrs.category.toLowerCase().trim(),
  ];

  return `fp:${parts.join('|')}`;
}

/**
 * Check if a barcode is present and could serve as primary identity.
 */
export function hasBarcodeIdentity(barcode: string | null | undefined): boolean {
  return !!barcode?.trim() && barcode.trim().length >= 8;
}

/**
 * Compute simple name similarity score between 0 and 1.
 * Uses character overlap (Sørensen–Dice coefficient on bigrams).
 */
export function nameSimilarity(a: string, b: string): number {
  const na = normalizeArabicText(a);
  const nb = normalizeArabicText(b);

  if (na === nb) return 1.0;
  if (!na || !nb) return 0;

  const bigramsA = toBigrams(na);
  const bigramsB = toBigrams(nb);

  if (bigramsA.size === 0 && bigramsB.size === 0) return 1.0;
  if (bigramsA.size === 0 || bigramsB.size === 0) return 0;

  let intersection = 0;
  for (const bg of bigramsA) {
    if (bigramsB.has(bg)) intersection++;
  }

  return (2 * intersection) / (bigramsA.size + bigramsB.size);
}

function toBigrams(text: string): Set<string> {
  const set = new Set<string>();
  for (let i = 0; i < text.length - 1; i++) {
    set.add(text.substring(i, i + 2));
  }
  return set;
}

/**
 * Match a normalized offer against existing product fingerprints.
 * Returns the matched fingerprint and confidence, or null.
 */
export function matchProduct(
  attrs: Parameters<typeof buildFingerprint>[0],
  existingFingerprints: Map<string, string>, // fingerprint -> product_id
  threshold = FUZZY_CONFIDENCE_THRESHOLD,
): { product_id: string; fingerprint: string; confidence: number } | null {
  const fp = buildFingerprint(attrs);

  // 1. Exact fingerprint match (barcode or composite)
  const exactMatch = existingFingerprints.get(fp);
  if (exactMatch) {
    return { product_id: exactMatch, fingerprint: fp, confidence: 1.0 };
  }

  // 2. If we have a barcode but no match, no fallback
  if (fp.startsWith('barcode:')) {
    return null;
  }

  // 3. Fuzzy match against existing fingerprints
  let bestMatch: { product_id: string; fingerprint: string; confidence: number } | null = null;

  for (const [existingFp, productId] of existingFingerprints) {
    if (existingFp.startsWith('barcode:')) continue;

    // Extract name part from composite fingerprint
    const existingParts = existingFp.replace('fp:', '').split('|');
    const currentParts = fp.replace('fp:', '').split('|');

    // Compare name_ar (index 0)
    const sim = nameSimilarity(currentParts[0] ?? '', existingParts[0] ?? '');

    if (sim >= threshold && (!bestMatch || sim > bestMatch.confidence)) {
      bestMatch = { product_id: productId, fingerprint: existingFp, confidence: sim };
    }
  }

  return bestMatch;
}
