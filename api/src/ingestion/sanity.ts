/**
 * sanity.ts
 * Shared hygiene + sanity checks for production ingestion.
 */

export function normalizeDomain(input: string): string {
  return input.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
}

export function isPlaceholderImage(url: string): boolean {
  const u = url.toLowerCase();
  return (
    /picsum\.photos|placehold|placeholder|dummyimage|fakeimg|source\.unsplash\.com|lorempixel/i.test(u) ||
    /\/logo\b|\bicon\b|favicon|sprite|\/badge\b|\/banner\b|\/social\b|\/payment\b|\/app-store\b|\/play-store\b/i.test(u) ||
    /no[-_ ]?image|no[-_ ]?photo|default[-_ ]?image|image[-_ ]?not[-_ ]?available|blank\.(png|jpg|jpeg)/i.test(u) ||
    /1x1|pixel\.(png|gif)/i.test(u)
  );
}

export function validateImageUrl(url: string | null): string | null {
  if (!url) return null;
  const trimmed = String(url).trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("data:")) return null;
  if (!/^https?:\/\//i.test(trimmed)) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (isPlaceholderImage(parsed.href)) return null;
    return parsed.href;
  } catch {
    return null;
  }
}

export function extractNumberLike(input: unknown): number | null {
  // Robust parsing for Iraq e-commerce formats.
  // Handles:
  // - 100,000
  // - 100.000 (dot as thousands)
  // - 1.250.000 / 1,250,000
  // - Arabic/Persian digits
  // - Arabic separators: ١٢٣٬٤٥٦٫٧٨
  if (typeof input === 'number' && Number.isFinite(input)) return input;
  if (typeof input !== 'string') return null;

  let raw = input.trim();
  if (!raw) return null;

  // Normalize Arabic/Persian digits
  raw = raw
    .replace(/[\u0660-\u0669]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[\u06F0-\u06F9]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));

  // Arabic thousands (٬/،) => ',' and Arabic decimal (٫) => '.'
  raw = raw.replace(/[٬،]/g, ',').replace(/[٫]/g, '.');

  // First number-like token
  const m = raw.replace(/\s+/g, '').match(/-?\d[\d\.,]*/);
  if (!m) return null;
  let token = m[0];
  if (!token) return null;

  const lastDot = token.lastIndexOf('.');
  const lastComma = token.lastIndexOf(',');

  // Decide if we have a decimal separator or only thousands separators.
  // Typical product prices in IQD are integers, so treat '.' or ',' as thousands
  // unless it clearly looks like a decimal (<= 2 fractional digits).
  let decimalSep: '.' | ',' | null = null;

  if (lastDot !== -1 && lastComma !== -1) {
    // Both present: right-most is decimal
    decimalSep = lastDot > lastComma ? '.' : ',';
  } else if (lastDot !== -1) {
    const parts = token.split('.');
    if (parts.length === 2) {
      const fracLen = parts[1]?.length ?? 0;
      decimalSep = fracLen > 0 && fracLen <= 2 ? '.' : null;
    } else {
      decimalSep = null;
    }
  } else if (lastComma !== -1) {
    const parts = token.split(',');
    if (parts.length === 2) {
      const fracLen = parts[1]?.length ?? 0;
      decimalSep = fracLen > 0 && fracLen <= 2 ? ',' : null;
    } else {
      decimalSep = null;
    }
  }

  if (decimalSep) {
    const thousandSep = decimalSep === '.' ? ',' : '.';
    token = token.split(thousandSep).join('');
    if (decimalSep === ',') token = token.replace(/,/g, '.');
    else token = token.replace(/,/g, '');
  } else {
    // No decimals: strip both separators
    token = token.replace(/[\.,]/g, '');
  }

  const n = Number(token);
  return Number.isFinite(n) ? n : null;
}

export function isSaneIqdPrice(priceIqd: number): { ok: boolean; reason?: string } {
  if (!Number.isFinite(priceIqd)) return { ok: false, reason: "not_finite" };
  if (priceIqd <= 0) return { ok: false, reason: "non_positive" };
  // Practical range for Iraq e-commerce (keeps room for expensive electronics)
  // Lowest practical denomination in Iraq is 250 IQD.
  if (priceIqd < 250) return { ok: false, reason: "too_low" };
  if (priceIqd > 200_000_000) return { ok: false, reason: "too_high" };

  // Common parsing mistakes: repeated digits or absurd precision
  const s = String(Math.round(priceIqd));
  if (/^(\d)\1{6,}$/.test(s)) return { ok: false, reason: "repeated_digits" };
  if (s.length >= 11) return { ok: false, reason: "too_many_digits" };

  return { ok: true };
}

export function normalizeToIqd(price: number, currency: string, fxRate: number): {
  priceIqd: number;
  normalizationFactor: number;
  parsedCurrency: string;
} {
  const parsedCurrency = (currency || "IQD").toUpperCase();
  const originalPrice = Number(price);
  let priceIqd = 0;
  let normalizationFactor = 1;
  if (parsedCurrency === "USD" || (parsedCurrency !== "IQD" && originalPrice < 500)) {
    priceIqd = Math.round(originalPrice * fxRate);
    normalizationFactor = Math.round(fxRate);
  } else {
    priceIqd = Math.round(originalPrice);
  }
  return { priceIqd, normalizationFactor, parsedCurrency };
}

/**
 * Smarter normalization with cross-currency sanity.
 * Protects against pages that mention USD but show prices in IQD.
 */
export function normalizeToIqdSmart(
  price: number,
  currency: string,
  fxRate: number,
  opts?: { categoryHint?: string | null; domain?: string | null; rawText?: string | null; name?: string | null }
): {
  priceIqd: number;
  normalizationFactor: number;
  parsedCurrency: string;
} {
  let parsedCurrency = (currency || 'IQD').toUpperCase();
  const originalPrice = Number(price);
  const cat = String(opts?.categoryHint ?? '').toLowerCase();
  const raw = String(opts?.rawText ?? '').toLowerCase();
  const name = String(opts?.name ?? '');

  const currencyFromText = (() => {
    if (!raw) return null as string | null;
    if (raw.includes('$') || raw.includes('usd') || raw.includes('us$') || raw.includes('دولار')) return 'USD';
    if (raw.includes('د.ع') || raw.includes('دينار') || raw.includes('iqd') || raw.includes('د ع')) return 'IQD';
    return null;
  })();

  if (currencyFromText) parsedCurrency = currencyFromText;

  const hasUsdMarker = raw.includes('$') || raw.includes('usd') || raw.includes('us$') || raw.includes('دولار');
  const hasIqdMarker = raw.includes('د.ع') || raw.includes('دينار') || raw.includes('iqd') || raw.includes('د ع');

  // If currency says USD but the number is very large and there's no explicit USD marker,
  // it's almost certainly IQD (common for Iraqi stores + some APIs defaulting to USD).
  if (parsedCurrency === 'USD' && !hasUsdMarker && Number.isFinite(originalPrice) && originalPrice >= 5000) {
    parsedCurrency = 'IQD';
  }

  // IQD prices are practically integers; if we see a small decimal like 2.99, treat as USD.
  if (parsedCurrency === 'IQD' && !hasIqdMarker && Number.isFinite(originalPrice) && originalPrice > 0 && originalPrice < 100 && !Number.isInteger(originalPrice)) {
    parsedCurrency = 'USD';
  }

  // Protect against pages that mention USD but show prices in IQD.
  if (parsedCurrency === 'USD') {
    const rawSuggestsIqd = raw.includes('د.ع') || raw.includes('دينار') || raw.includes('iqd');
    const likelyIqd =
      Number.isFinite(originalPrice) &&
      originalPrice >= 1000 &&
      originalPrice <= 500000 &&
      !['electronics', 'automotive'].includes(cat);
    if (rawSuggestsIqd || likelyIqd) parsedCurrency = 'IQD';
  }

  // Fix the opposite case: currency missing/incorrect (default IQD) but the price is clearly USD-like.
  // Typical symptom: expensive products (electronics/beauty) with prices like 99 / 110 / 199.
  const looksUsdButMissing = (() => {
    if (!Number.isFinite(originalPrice)) return false;
    if (originalPrice <= 0) return false;
    // USD prices are usually < 1000; IQD prices rarely are (except errors)
    if (originalPrice >= 1000) return false;
    if (parsedCurrency !== 'IQD') return false;
    // Strong signal: explicit $/USD in raw text (even if currency field is missing)
    if (raw.includes('$') || raw.includes('usd') || raw.includes('us$') || raw.includes('دولار')) return true;

    const usdHeavy = ['electronics', 'beauty', 'automotive'].includes(cat);
    const hasLatin = /[A-Za-z]/.test(name) || /[A-Za-z]/.test(raw);
    return usdHeavy && hasLatin;
  })();

  if (looksUsdButMissing) parsedCurrency = 'USD';

  let priceIqd = 0;
  let normalizationFactor = 1;

  if (parsedCurrency === 'USD' || (parsedCurrency !== 'IQD' && originalPrice < 500)) {
    priceIqd = Math.round(originalPrice * fxRate);
    normalizationFactor = Math.round(fxRate);
  } else {
    priceIqd = Math.round(originalPrice);
  }

  return { priceIqd, normalizationFactor, parsedCurrency };
}
