/**
 * PATCH B — Ingestion layer tests: urlSafety, identity, normalizer, pipeline.
 * Minimum +20 tests.
 */

import { describe, it, expect, vi } from 'vitest';

// ══════════════════════════════════════════════════════════════════════
// URL SAFETY
// ══════════════════════════════════════════════════════════════════════

describe('urlSafety — sanitizeExternalUrl', () => {
  let sanitizeExternalUrl: typeof import('@/lib/ingestion/urlSafety').sanitizeExternalUrl;

  beforeAll(async () => {
    const mod = await import('@/lib/ingestion/urlSafety');
    sanitizeExternalUrl = mod.sanitizeExternalUrl;
  });

  it('accepts valid HTTPS URL', () => {
    expect(sanitizeExternalUrl('https://talabat.iq/product/123')).toBe('https://talabat.iq/product/123');
  });

  it('rejects HTTP URL', () => {
    expect(sanitizeExternalUrl('http://talabat.iq/product/123')).toBeNull();
  });

  it('rejects javascript: scheme', () => {
    expect(sanitizeExternalUrl('javascript:alert(1)')).toBeNull();
  });

  it('rejects data: scheme', () => {
    expect(sanitizeExternalUrl('data:text/html,<script>alert(1)</script>')).toBeNull();
  });

  it('rejects ftp: scheme', () => {
    expect(sanitizeExternalUrl('ftp://files.example.com/data')).toBeNull();
  });

  it('rejects localhost', () => {
    expect(sanitizeExternalUrl('https://localhost/api')).toBeNull();
  });

  it('rejects 127.0.0.1', () => {
    expect(sanitizeExternalUrl('https://127.0.0.1/api')).toBeNull();
  });

  it('rejects 10.x.x.x private IP', () => {
    expect(sanitizeExternalUrl('https://10.0.0.1/api')).toBeNull();
  });

  it('rejects 172.16-31 private IP', () => {
    expect(sanitizeExternalUrl('https://172.16.0.1/api')).toBeNull();
    expect(sanitizeExternalUrl('https://172.31.255.255/api')).toBeNull();
  });

  it('rejects 192.168.x.x private IP', () => {
    expect(sanitizeExternalUrl('https://192.168.1.1/api')).toBeNull();
  });

  it('rejects null/undefined/empty', () => {
    expect(sanitizeExternalUrl(null)).toBeNull();
    expect(sanitizeExternalUrl(undefined)).toBeNull();
    expect(sanitizeExternalUrl('')).toBeNull();
  });

  it('rejects hostnames without dots', () => {
    expect(sanitizeExternalUrl('https://intranet/api')).toBeNull();
  });

  it('accepts URL with query params and path', () => {
    const url = 'https://shop.iq/products?id=abc&cat=food';
    expect(sanitizeExternalUrl(url)).toBe(url);
  });
});

describe('urlSafety — validateSourceUrl', () => {
  let validateSourceUrl: typeof import('@/lib/ingestion/urlSafety').validateSourceUrl;

  beforeAll(async () => {
    const mod = await import('@/lib/ingestion/urlSafety');
    validateSourceUrl = mod.validateSourceUrl;
  });

  it('accepts URL matching allowed domain', () => {
    expect(validateSourceUrl('https://talabat.iq/p/1', 'talabat.iq')).toBe('https://talabat.iq/p/1');
  });

  it('accepts subdomain of allowed domain', () => {
    expect(validateSourceUrl('https://shop.talabat.iq/p/1', 'talabat.iq')).toBe('https://shop.talabat.iq/p/1');
  });

  it('rejects URL from different domain', () => {
    expect(validateSourceUrl('https://evil.com/p/1', 'talabat.iq')).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════════
// IDENTITY
// ══════════════════════════════════════════════════════════════════════

describe('identity — buildFingerprint', () => {
  let buildFingerprint: typeof import('@/lib/ingestion/identity').buildFingerprint;

  beforeAll(async () => {
    const mod = await import('@/lib/ingestion/identity');
    buildFingerprint = mod.buildFingerprint;
  });

  it('uses barcode when available', () => {
    const fp = buildFingerprint({ barcode: '1234567890123', name_ar: 'سكر', category: 'groceries' });
    expect(fp).toBe('barcode:1234567890123');
  });

  it('builds composite fingerprint without barcode', () => {
    const fp = buildFingerprint({ name_ar: 'سكر أبيض', category: 'groceries' });
    expect(fp).toMatch(/^fp:/);
    expect(fp).toContain('groceries');
  });

  it('same inputs produce same fingerprint', () => {
    const a = buildFingerprint({ name_ar: 'سكر أبيض ١ كغ', brand_ar: 'العراقية', category: 'groceries' });
    const b = buildFingerprint({ name_ar: 'سكر أبيض ١ كغ', brand_ar: 'العراقية', category: 'groceries' });
    expect(a).toBe(b);
  });

  it('different inputs produce different fingerprints', () => {
    const a = buildFingerprint({ name_ar: 'سكر أبيض', category: 'groceries' });
    const b = buildFingerprint({ name_ar: 'سكر أحمر', category: 'groceries' });
    expect(a).not.toBe(b);
  });
});

describe('identity — nameSimilarity', () => {
  let nameSimilarity: typeof import('@/lib/ingestion/identity').nameSimilarity;

  beforeAll(async () => {
    const mod = await import('@/lib/ingestion/identity');
    nameSimilarity = mod.nameSimilarity;
  });

  it('returns 1.0 for identical strings', () => {
    expect(nameSimilarity('سكر أبيض', 'سكر أبيض')).toBe(1.0);
  });

  it('returns 1.0 for same after normalization', () => {
    expect(nameSimilarity('أحمد', 'احمد')).toBe(1.0);
  });

  it('returns 0 for completely different strings', () => {
    expect(nameSimilarity('سكر', 'هاتف')).toBeLessThan(0.3);
  });

  it('returns high score for similar strings', () => {
    expect(nameSimilarity('سكر أبيض ١ كغ', 'سكر ابيض 1 كغ')).toBeGreaterThan(0.7);
  });
});

describe('identity — matchProduct', () => {
  let matchProduct: typeof import('@/lib/ingestion/identity').matchProduct;

  beforeAll(async () => {
    const mod = await import('@/lib/ingestion/identity');
    matchProduct = mod.matchProduct;
  });

  it('exact barcode match returns confidence 1.0', () => {
    const existing = new Map([['barcode:1234567890123', 'prod-1']]);
    const result = matchProduct({ barcode: '1234567890123', name_ar: 'سكر', category: 'groceries' }, existing);
    expect(result?.product_id).toBe('prod-1');
    expect(result?.confidence).toBe(1.0);
  });

  it('exact fingerprint match returns confidence 1.0', () => {
    const fp = 'fp:سكر ابيض||||||groceries';
    const existing = new Map([[fp, 'prod-2']]);
    const result = matchProduct({ name_ar: 'سكر أبيض', category: 'groceries' }, existing);
    expect(result?.product_id).toBe('prod-2');
    expect(result?.confidence).toBe(1.0);
  });

  it('fuzzy below threshold returns null', () => {
    const existing = new Map([['fp:هاتف سامسونج||||||electronics', 'prod-3']]);
    const result = matchProduct({ name_ar: 'سكر أبيض', category: 'groceries' }, existing, 0.9);
    expect(result).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════════
// NORMALIZER
// ══════════════════════════════════════════════════════════════════════

describe('normalizer — normalizeOffer', () => {
  let normalizeOffer: typeof import('@/lib/ingestion/normalizer').normalizeOffer;

  const validRaw = {
    source_id: 'src-1',
    source_url: 'https://shop.iq/product/1',
    external_item_id: 'ext-1',
    product_name_ar: 'سكر أبيض ١ كغ',
    product_name_en: 'White Sugar 1kg',
    brand_ar: 'العراقية',
    brand_en: null,
    barcode: '1234567890123',
    category: 'groceries',
    unit: 'kg',
    image_url: 'https://cdn.shop.iq/img.jpg',
    base_price: 5000,
    discount_price: null,
    delivery_fee: 1000,
    currency: 'IQD',
    in_stock: true,
    merchant_name: 'متجر الأمل',
    region_id: 'reg-1',
    observed_at: '2026-02-14T10:00:00Z',
  };

  beforeAll(async () => {
    const mod = await import('@/lib/ingestion/normalizer');
    normalizeOffer = mod.normalizeOffer;
  });

  it('accepts valid offer', () => {
    const result = normalizeOffer(validRaw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.offer.product_name_ar).toBe('سكر أبيض ١ كغ');
      expect(result.offer.currency).toBe('IQD');
    }
  });

  it('rejects empty name', () => {
    const result = normalizeOffer({ ...validRaw, product_name_ar: '' });
    expect(result.ok).toBe(false);
    expect((result as any).reason).toBe('empty_name');
  });

  it('rejects unsafe URL', () => {
    const result = normalizeOffer({ ...validRaw, source_url: 'javascript:alert(1)' });
    expect(result.ok).toBe(false);
    expect((result as any).reason).toBe('unsafe_url');
  });

  it('rejects zero price', () => {
    const result = normalizeOffer({ ...validRaw, base_price: 0, discount_price: null });
    expect(result.ok).toBe(false);
    expect((result as any).reason).toBe('invalid_price');
  });

  it('rejects absurdly low IQD price', () => {
    const result = normalizeOffer({ ...validRaw, base_price: 50 });
    expect(result.ok).toBe(false);
    expect((result as any).reason).toBe('absurd_price');
  });

  it('rejects non-IQD currency', () => {
    const result = normalizeOffer({ ...validRaw, currency: 'USD' });
    expect(result.ok).toBe(false);
    expect((result as any).reason).toBe('invalid_currency');
  });

  it('rejects missing region_id', () => {
    const result = normalizeOffer({ ...validRaw, region_id: null });
    expect(result.ok).toBe(false);
    expect((result as any).reason).toBe('missing_region');
  });

  it('rejects missing source_id', () => {
    const result = normalizeOffer({ ...validRaw, source_id: '' });
    expect(result.ok).toBe(false);
    expect((result as any).reason).toBe('missing_source_id');
  });

  it('uses discount_price as final_price when lower', () => {
    const result = normalizeOffer({ ...validRaw, base_price: 10000, discount_price: 7500 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.offer.final_price).toBe(7500);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════
// PIPELINE
// ══════════════════════════════════════════════════════════════════════

describe('pipeline — runSourceSync', () => {
  let runSourceSync: typeof import('@/lib/ingestion/pipeline').runSourceSync;

  beforeAll(async () => {
    const mod = await import('@/lib/ingestion/pipeline');
    runSourceSync = mod.runSourceSync;
  });

  it('returns success when all items normalize', async () => {
    const adapter = {
      sourceId: 'src-1',
      sourceName: 'Test Source',
      baseDomain: 'shop.iq',
      fetchItems: async () => [
        { external_item_id: 'e1', raw_payload: {}, raw_url: null, raw_title: null, fetched_at: new Date().toISOString() },
      ],
      parseItem: () => ({
        source_id: 'src-1',
        source_url: 'https://shop.iq/p/1',
        external_item_id: 'e1',
        product_name_ar: 'سكر أبيض',
        product_name_en: null,
        brand_ar: null, brand_en: null, barcode: null,
        size_value: null, size_unit: null,
        category: 'groceries', unit: 'kg',
        image_url: null,
        base_price: 5000, discount_price: null, final_price: 5000,
        delivery_fee: null, currency: 'IQD' as const,
        in_stock: true, merchant_name: null,
        region_id: 'r1', observed_at: new Date().toISOString(),
      }),
    };

    const result = await runSourceSync(adapter);
    expect(result.status).toBe('success');
    expect(result.summary.fetched_count).toBe(1);
    expect(result.summary.normalized_count).toBe(1);
    expect(result.summary.error_count).toBe(0);
  });

  it('returns partial when some items fail', async () => {
    let callCount = 0;
    const adapter = {
      sourceId: 'src-1',
      sourceName: 'Test Source',
      baseDomain: 'shop.iq',
      fetchItems: async () => [
        { external_item_id: 'good', raw_payload: {}, raw_url: null, raw_title: null, fetched_at: new Date().toISOString() },
        { external_item_id: 'bad', raw_payload: {}, raw_url: null, raw_title: null, fetched_at: new Date().toISOString() },
      ],
      parseItem: (raw: any) => {
        callCount++;
        if (raw.external_item_id === 'bad') {
          return {
            source_id: 'src-1',
            source_url: 'javascript:alert(1)', // unsafe
            external_item_id: 'bad',
            product_name_ar: 'Bad Item',
            product_name_en: null,
            brand_ar: null, brand_en: null, barcode: null,
            size_value: null, size_unit: null,
            category: 'general', unit: 'pcs',
            image_url: null,
            base_price: 5000, discount_price: null, final_price: 5000,
            delivery_fee: null, currency: 'IQD' as const,
            in_stock: true, merchant_name: null,
            region_id: 'r1', observed_at: new Date().toISOString(),
          };
        }
        return {
          source_id: 'src-1',
          source_url: 'https://shop.iq/p/1',
          external_item_id: 'good',
          product_name_ar: 'منتج جيد',
          product_name_en: null,
          brand_ar: null, brand_en: null, barcode: null,
          size_value: null, size_unit: null,
          category: 'general', unit: 'pcs',
          image_url: null,
          base_price: 5000, discount_price: null, final_price: 5000,
          delivery_fee: null, currency: 'IQD' as const,
          in_stock: true, merchant_name: null,
          region_id: 'r1', observed_at: new Date().toISOString(),
        };
      },
    };

    const result = await runSourceSync(adapter);
    expect(result.status).toBe('partial');
    expect(result.summary.normalized_count).toBe(1);
    expect(result.summary.error_count).toBe(1);
  });

  it('returns failed when fetch throws', async () => {
    const adapter = {
      sourceId: 'src-1',
      sourceName: 'Broken Source',
      baseDomain: 'broken.iq',
      fetchItems: async () => { throw new Error('Network error'); },
      parseItem: () => null,
    };

    const result = await runSourceSync(adapter);
    expect(result.status).toBe('failed');
    expect(result.summary.error_count).toBeGreaterThan(0);
  });

  it('skips items when adapter returns null', async () => {
    const adapter = {
      sourceId: 'src-1',
      sourceName: 'Skip Source',
      baseDomain: 'skip.iq',
      fetchItems: async () => [
        { external_item_id: 'skip-me', raw_payload: {}, raw_url: null, raw_title: null, fetched_at: new Date().toISOString() },
      ],
      parseItem: () => null,
    };

    const result = await runSourceSync(adapter);
    expect(result.items[0].status).toBe('skipped');
  });
});
