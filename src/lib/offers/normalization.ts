/**
 * Text and price normalization for product matching.
 */

/** Remove Arabic diacritics (tashkeel) */
export function stripDiacritics(text: string): string {
  return text.replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E8\u06EA-\u06ED]/g, '');
}

/** Normalize Arabic text for matching */
export function normalizeArabicText(text: string): string {
  let normalized = text.trim().toLowerCase();
  normalized = stripDiacritics(normalized);
  // Normalize common Arabic character variants
  normalized = normalized
    .replace(/[أإآا]/g, 'ا')
    .replace(/[ىئ]/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و');
  // Collapse whitespace
  normalized = normalized.replace(/\s+/g, ' ');
  return normalized;
}

/** Parse size/unit from product name (e.g., "500ml", "1.5 كغ", "250g") */
export function parseSize(text: string): { value: number; unit: string } | null {
  const patterns = [
    /(\d+(?:\.\d+)?)\s*(ml|مل|liter|litre|لتر|l|L)/i,
    /(\d+(?:\.\d+)?)\s*(kg|كغ|كيلو|كيلوغرام|g|غ|غرام|جرام)/i,
    /(\d+(?:\.\d+)?)\s*(pcs|حبة|قطعة|عدد)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const value = parseFloat(match[1]);
      const rawUnit = match[2].toLowerCase();
      const unit = normalizeUnit(rawUnit);
      return { value, unit };
    }
  }
  return null;
}

/** Normalize unit strings to standard form */
function normalizeUnit(raw: string): string {
  const map: Record<string, string> = {
    ml: 'ml', مل: 'ml',
    l: 'L', liter: 'L', litre: 'L', لتر: 'L',
    g: 'g', غ: 'g', غرام: 'g', جرام: 'g',
    kg: 'kg', كغ: 'kg', كيلو: 'kg', كيلوغرام: 'kg',
    pcs: 'pcs', حبة: 'pcs', قطعة: 'pcs', عدد: 'pcs',
  };
  return map[raw] ?? raw;
}

/** Validate that a price is reasonable (positive, not absurd) */
export function isValidPrice(price: number): boolean {
  return Number.isFinite(price) && price > 0 && price < 1_000_000_000;
}

/** Validate IQD price range (reject suspicious outliers) */
export function isReasonableIQDPrice(price: number): boolean {
  return isValidPrice(price) && price >= 250; // minimum ~$0.15 USD
}

/** Format IQD price for display */
export function formatIQDPrice(price: number): string {
  return new Intl.NumberFormat('ar-IQ', {
    style: 'decimal',
    maximumFractionDigits: 0,
  }).format(price);
}

/** Compute discount percentage */
export function discountPercent(base: number, discounted: number): number | null {
  if (!base || !discounted || discounted >= base) return null;
  return Math.round(((base - discounted) / base) * 100);
}

/** Relative time in Arabic */
export function relativeTimeAr(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60_000);

  if (diffMin < 1) return 'الآن';
  if (diffMin < 60) return `قبل ${diffMin} دقيقة`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `قبل ${diffHr} ساعة`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `قبل ${diffDay} يوم`;
  const diffMonth = Math.floor(diffDay / 30);
  return `قبل ${diffMonth} شهر`;
}
