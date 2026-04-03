import { describe, expect, it } from 'vitest';
import {
  deriveCanonicalIdentity,
  extractPackCount,
  extractSize,
  normalizeCatalogIdentifier,
  stripVariantSizeTokens,
} from './canonicalIdentity';

describe('canonicalIdentity', () => {
  it('normalizes identifiers safely', () => {
    expect(normalizeCatalogIdentifier(' 5449-0000-00996 ')).toBe('5449000000996');
    expect(normalizeCatalogIdentifier('abc')).toBeNull();
  });

  it('extracts size and pack count from mixed names', () => {
    expect(extractSize('Pepsi 330ml')).toEqual({ value: 330, unit: 'ml' });
    expect(extractPackCount('بيبسي 6 x 330ml')).toBe(6);
  });

  it('strips variant measurements from family names', () => {
    expect(stripVariantSizeTokens('بيبسي 6 x 330ml')).toBe('بيبسي');
  });

  it('builds stable family and variant fingerprints', () => {
    const derived = deriveCanonicalIdentity({
      nameAr: 'بيبسي 6 x 330ml',
      brandAr: 'بيبسي',
      category: 'beverages',
      barcode: '5449000000996',
    });

    expect(derived.normalizedFamilyName).toBe('بيبسي');
    expect(derived.packCount).toBe(6);
    expect(derived.barcodeNormalized).toBe('5449000000996');
    expect(derived.variantFingerprint).toBe('barcode:5449000000996');
  });
});
