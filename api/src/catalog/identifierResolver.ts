export type ProductIdentifierType = 'gtin' | 'barcode' | 'ean' | 'upc' | 'sku' | 'qr_url' | 'digital_link' | 'merchant_sku' | 'unknown';

export type ExternalCatalogProduct = {
  source: 'open_food_facts';
  sourceUrl: string;
  code: string;
  identifierType: ProductIdentifierType;
  name: string | null;
  brand: string | null;
  quantity: string | null;
  imageUrl: string | null;
  categories: string[];
  raw: Record<string, unknown>;
};

function normalizeDigits(value: string): string {
  return value
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
}

export function normalizeIdentifierValue(value: unknown): string {
  return normalizeDigits(String(value ?? ''))
    .trim()
    .replace(/[^0-9A-Za-z:_\-./]+/g, '');
}

export function normalizeSearchText(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function inferIdentifierType(value: string, rawInput?: string | null): ProductIdentifierType {
  const v = normalizeIdentifierValue(value);
  const raw = String(rawInput ?? '').trim();
  if (/^https?:\/\//i.test(raw)) {
    if (/\/01\/\d{8,14}/.test(raw) || /gs1/i.test(raw)) return 'digital_link';
    return 'qr_url';
  }
  if (/^\d{14}$/.test(v)) return 'gtin';
  if (/^\d{13}$/.test(v)) return 'ean';
  if (/^\d{12}$/.test(v)) return 'upc';
  if (/^\d{8}$/.test(v)) return 'ean';
  if (/^\d{9,16}$/.test(v)) return 'barcode';
  if (/^[A-Za-z0-9_-]{6,40}$/.test(v)) return 'sku';
  return 'unknown';
}

export function buildNameSearchTokens(input: { name?: string | null; brand?: string | null; quantity?: string | null }): string[] {
  const merged = normalizeSearchText([input.name, input.brand, input.quantity].filter(Boolean).join(' '));
  if (!merged) return [];
  const stop = new Set(['the', 'and', 'with', 'for', 'pack', 'pcs', 'piece', 'pieces', 'ml', 'g', 'kg', 'ل', 'في', 'مع', 'من']);
  const parts = merged.split(' ').filter((x) => x && !stop.has(x) && x.length >= 2);
  return Array.from(new Set(parts)).slice(0, 8);
}

export async function fetchOpenFoodFactsProduct(code: string, timeoutMs = 6500): Promise<ExternalCatalogProduct | null> {
  const normalized = normalizeIdentifierValue(code);
  if (!/^\d{8,14}$/.test(normalized)) return null;

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(normalized)}.json`;
    const res = await fetch(url, {
      signal: ac.signal,
      headers: {
        'User-Agent': 'price-tracker-iraq/1.0 (catalog resolver)',
      },
    });
    if (!res.ok) return null;
    const json = await res.json().catch(() => null);
    const product = json?.product;
    if (!product || Number(json?.status ?? 0) !== 1) return null;

    return {
      source: 'open_food_facts',
      sourceUrl: url,
      code: normalized,
      identifierType: inferIdentifierType(normalized),
      name: product.product_name_ar || product.product_name || product.generic_name || null,
      brand: product.brands || null,
      quantity: product.quantity || null,
      imageUrl: product.image_front_url || product.image_url || null,
      categories: String(product.categories || '')
        .split(',')
        .map((x: string) => x.trim())
        .filter(Boolean)
        .slice(0, 8),
      raw: product as Record<string, unknown>,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}
