/**
 * Iraqi price parsing & normalization.
 * Handles Arabic/English numerals, thousand/million text multipliers,
 * separator noise, and category-based anomaly detection.
 */

/** Arabic numeral map */
const AR_DIGITS: Record<string, string> = {
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
  '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
};

/** Convert Arabic-Indic numerals to Western */
export function arabicToWesternDigits(text: string): string {
  return text.replace(/[٠-٩]/g, (d) => AR_DIGITS[d] ?? d);
}

/** Text multiplier patterns */
const MULTIPLIER_PATTERNS: Array<{ pattern: RegExp; factor: number }> = [
  { pattern: /مليون|ملیون/i, factor: 1_000_000 },
  { pattern: /ألف|الف|آلاف|الاف/i, factor: 1_000 },
  { pattern: /million/i, factor: 1_000_000 },
  { pattern: /thousand/i, factor: 1_000 },
];

/** Extract multiplier from text surrounding the number */
export function detectTextMultiplier(text: string): number {
  for (const { pattern, factor } of MULTIPLIER_PATTERNS) {
    if (pattern.test(text)) return factor;
  }
  return 1;
}

/**
 * Parse a raw price string into a numeric IQD value.
 * Handles: \"١٥٠٠٠\", \"15,000\", \"15.000\", \"15 ألف\", \"1.5 مليون\",
 * \"36000 IQD\", currency prefixes/suffixes, etc.
 */
export function parseRawPrice(rawText: string | null | undefined): ParsedPrice {
  if (!rawText || !rawText.trim()) {
    return { ok: false, reason: 'empty_input' };
  }

  let text = rawText.trim();

  // Detect currency
  const currency = detectCurrency(text);

  // Remove currency symbols and labels
  text = text
    .replace(/د\.ع|دينار|IQD|\$/gi, '')
    .replace(/USD/gi, '')
    .trim();

  // Convert Arabic digits
  text = arabicToWesternDigits(text);

  // Detect text multiplier before stripping text
  const textMultiplier = detectTextMultiplier(text);

  // Extract numeric portion
  // Handle comma as thousand separator (Iraqi/Arabic style) or period as thousand sep
  let numericStr = text.replace(/[^\d.,٫]/g, '');

  // Determine if period is decimal or thousand separator
  // In Iraqi usage: 15.000 = 15,000 (thousand sep), 1.5 = 1.5 (decimal)
  if (numericStr.includes('.') && numericStr.includes(',')) {
    // Both present: last one is decimal
    const lastComma = numericStr.lastIndexOf(',');
    const lastDot = numericStr.lastIndexOf('.');
    if (lastComma > lastDot) {
      // Comma is decimal (European style): 15.000,50
      numericStr = numericStr.replace(/\./g, '').replace(',', '.');
    } else {
      // Dot is decimal (US style): 15,000.50
      numericStr = numericStr.replace(/,/g, '');
    }
  } else if (numericStr.includes(',')) {
    // Only commas: if after comma there are exactly 3 digits, it's thousand sep
    const parts = numericStr.split(',');
    const allThousands = parts.slice(1).every((p) => p.length === 3);
    if (allThousands && parts.length > 1) {
      numericStr = numericStr.replace(/,/g, '');
    } else {
      // Comma is decimal
      numericStr = numericStr.replace(',', '.');
    }
  } else if (numericStr.includes('.')) {
    // Only dots: if after dot there are exactly 3 digits, it's thousand sep
    const parts = numericStr.split('.');
    const allThousands = parts.slice(1).every((p) => p.length === 3);
    if (allThousands && parts.length > 1) {
      numericStr = numericStr.replace(/\./g, '');
    }
    // else dot is decimal, keep as-is
  }

  // Replace Arabic decimal mark
  numericStr = numericStr.replace('٫', '.');

  const value = parseFloat(numericStr);
  if (!Number.isFinite(value) || value <= 0) {
    return { ok: false, reason: 'not_a_number' };
  }

  const finalValue = Math.round(value * textMultiplier);

  return {
    ok: true,
    value: finalValue,
    currency: currency,
    multiplier: textMultiplier,
    rawText: rawText,
  };
}

function detectCurrency(text: string): 'IQD' | 'USD' {
  if (/\$|USD|دولار/i.test(text)) return 'USD';
  return 'IQD';
}

export type ParsedPrice =
  | { ok: true; value: number; currency: 'IQD' | 'USD'; multiplier: number; rawText: string }
  | { ok: false; reason: string };

/** Category guardrail bounds */
export interface CategoryGuardrail {
  category_key: string;
  min_iqd: number;
  max_iqd: number;
}

/**
 * Validate a normalized IQD price against category guardrails.
 * Returns anomaly info if price is outside bounds.
 */
export function validatePriceAgainstGuardrail(
  priceIqd: number,
  category: string,
  guardrails: CategoryGuardrail[],
): { valid: boolean; reason?: string } {
  const guard = guardrails.find((g) => g.category_key === category);
  if (!guard) {
    // No guardrail for this category — accept but flag low confidence
    return { valid: true };
  }

  if (priceIqd < guard.min_iqd) {
    return { valid: false, reason: `below_category_min:${guard.min_iqd}` };
  }
  if (priceIqd > guard.max_iqd) {
    return { valid: false, reason: `above_category_max:${guard.max_iqd}` };
  }

  return { valid: true };
}

/**
 * Compute weighted median from an array of prices.
 * Used for robust aggregation instead of fragile MIN.
 */
export function weightedMedian(prices: number[]): number {
  if (prices.length === 0) return 0;
  const sorted = [...prices].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  }
  return sorted[mid];
}

/**
 * Compute IQR-based robust price from valid observations.
 * Returns { median, p25, p75, bestDisplay } where bestDisplay
 * is min within IQR (not fragile global min).
 */
export function robustPriceAggregation(prices: number[]): {
  median: number;
  p25: number;
  p75: number;
  bestDisplay: number;
  validCount: number;
} {
  if (prices.length === 0) {
    return { median: 0, p25: 0, p75: 0, bestDisplay: 0, validCount: 0 };
  }

  const sorted = [...prices].sort((a, b) => a - b);
  const n = sorted.length;

  const p25Idx = Math.floor(n * 0.25);
  const p75Idx = Math.floor(n * 0.75);

  const p25 = sorted[p25Idx];
  const p75 = sorted[Math.min(p75Idx, n - 1)];
  const median = weightedMedian(prices);

  // IQR fence
  const iqr = p75 - p25;
  const lowerFence = p25 - 1.5 * iqr;
  const upperFence = p75 + 1.5 * iqr;

  // Best display = minimum within IQR fence
  const withinIqr = sorted.filter((p) => p >= lowerFence && p <= upperFence);
  const bestDisplay = withinIqr.length > 0 ? withinIqr[0] : sorted[0];

  return { median, p25, p75, bestDisplay, validCount: n };
}

/**
 * Convert USD to IQD using a market rate.
 */
export function convertUsdToIqd(usdAmount: number, marketRate: number): number {
  return Math.round(usdAmount * marketRate);
}

/**
 * Convert IQD to USD using a market rate.
 */
export function convertIqdToUsd(iqdAmount: number, marketRate: number): number {
  if (marketRate <= 0) return 0;
  return Math.round((iqdAmount / marketRate) * 100) / 100;
}
