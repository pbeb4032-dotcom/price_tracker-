import { describe, expect, it } from 'vitest';
import {
  computeGtinCheckDigit,
  isValidGtinIdentifier,
  parseBarcodeInput,
  resolveBarcodeLookup,
  scoreBarcodeCatalogCandidate,
} from './barcodeResolution';

describe('barcodeResolution', () => {
  it('parses GS1 digital link QR payloads into GTIN candidates', () => {
    const parsed = parseBarcodeInput('https://example.com/01/6281000000001/21/ABC123');

    expect(parsed.code).toBe('6281000000001');
    expect(parsed.source).toBe('digital_link');
    expect(parsed.identifierType).toBe('digital_link');
    expect(parsed.gs1?.gtin).toBe('6281000000001');
    expect(parsed.gs1?.serial).toBe('ABC123');
  });

  it('validates GTIN check digits correctly', () => {
    expect(computeGtinCheckDigit('544900000099')).toBe(6);
    expect(isValidGtinIdentifier('5449000000996')).toBe(true);
    expect(isValidGtinIdentifier('5449000000995')).toBe(false);
  });

  it('accepts strong external-to-catalog matches with exact brand and size', () => {
    const scored = scoreBarcodeCatalogCandidate({
      external: {
        code: '5449000000996',
        name: 'Pepsi',
        brand: 'Pepsi',
        quantity: '330ml',
        taxonomyKey: 'groceries/beverages',
      },
      candidate: {
        displayNameAr: 'بيبسي 330ml',
        familyNameAr: 'بيبسي',
        normalizedBrand: 'pepsi',
        sizeValue: 330,
        sizeUnit: 'ml',
        packCount: 1,
        taxonomyKey: 'groceries/beverages',
        barcodePrimary: '5449000000996',
      },
    });

    expect(scored.accepted).toBe(true);
    expect(scored.confidence).toBeGreaterThanOrEqual(0.85);
    expect(scored.reasons).toContain('exact_barcode_match');
    expect(scored.reasons).toContain('size_exact');
  });

  it('rejects strong size conflicts to avoid false matches', () => {
    const scored = scoreBarcodeCatalogCandidate({
      external: {
        name: 'Pepsi',
        brand: 'Pepsi',
        quantity: '330ml',
        taxonomyKey: 'groceries/beverages',
      },
      candidate: {
        displayNameAr: 'بيبسي 2 لتر',
        familyNameAr: 'بيبسي',
        normalizedBrand: 'pepsi',
        sizeValue: 2,
        sizeUnit: 'L',
        packCount: 1,
        taxonomyKey: 'groceries/beverages',
      },
    });

    expect(scored.accepted).toBe(false);
    expect(scored.blockingReasons).toContain('size_mismatch');
  });

  it('returns external catalog results even when the product is not yet in the local app', async () => {
    const db = {
      execute: async () => ({ rows: [] as any[] }),
    };

    const result = await resolveBarcodeLookup(db, '5449000000996', {
      allowExternal: true,
      externalResolvers: [
        async (code) => ({
          source: 'open_food_facts',
          sourceUrl: `https://example.test/${code}`,
          code,
          identifierType: 'ean',
          name: 'Pepsi',
          brand: 'Pepsi',
          quantity: '330ml',
          imageUrl: null,
          categories: ['Beverages'],
          raw: {},
        }),
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.external_catalog?.name).toBe('Pepsi');
    expect(result.product).toBeNull();
    expect(result.resolution.match_type).toBe('external_catalog_only');
  });
});
