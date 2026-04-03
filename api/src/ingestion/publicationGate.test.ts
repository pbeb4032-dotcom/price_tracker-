import { describe, expect, it } from 'vitest';
import { assessPublicationGate } from './publicationGate';

describe('publication gate', () => {
  it('approves high-confidence mapped items', () => {
    const result = assessPublicationGate({
      match: {
        sourceId: 'source-1',
        productId: 'product-1',
        matchKind: 'url_map',
        confidence: 0.99,
      },
      taxonomyConfidence: 0.96,
      priceConfidence: 0.85,
      categoryConflict: false,
      taxonomyConflict: false,
    });

    expect(result.publishable).toBe(true);
    expect(result.status).toBe('approved');
    expect(result.reasons).toHaveLength(0);
  });

  it('quarantines exact-name-only matches', () => {
    const result = assessPublicationGate({
      match: {
        sourceId: 'source-1',
        productId: 'product-1',
        matchKind: 'exact_name',
        confidence: 0.62,
      },
      taxonomyConfidence: 0.97,
      priceConfidence: 0.91,
      categoryConflict: false,
      taxonomyConflict: false,
    });

    expect(result.publishable).toBe(false);
    expect(result.reasons).toContain('exact_name_match_not_publishable');
  });

  it('quarantines taxonomy conflicts even with a mapped product', () => {
    const result = assessPublicationGate({
      match: {
        sourceId: 'source-1',
        productId: 'product-1',
        matchKind: 'url_map',
        confidence: 0.99,
      },
      taxonomyConfidence: 0.95,
      priceConfidence: 0.85,
      categoryConflict: false,
      taxonomyConflict: true,
    });

    expect(result.publishable).toBe(false);
    expect(result.reasons).toContain('taxonomy_conflict');
  });

  it('quarantines weak taxonomy confidence', () => {
    const result = assessPublicationGate({
      match: {
        sourceId: 'source-1',
        productId: 'product-1',
        matchKind: 'identifier',
        confidence: 0.995,
      },
      taxonomyConfidence: 0.7,
      priceConfidence: 0.85,
      categoryConflict: false,
      taxonomyConflict: false,
    });

    expect(result.publishable).toBe(false);
    expect(result.reasons).toContain('taxonomy_confidence_low');
  });

  it('quarantines canonical matches that still lack a legacy projection', () => {
    const result = assessPublicationGate({
      match: {
        sourceId: 'source-1',
        productId: null,
        variantId: 'variant-1',
        familyId: 'family-1',
        matchKind: 'canonical_fingerprint',
        confidence: 0.93,
      },
      taxonomyConfidence: 0.96,
      priceConfidence: 0.88,
      categoryConflict: false,
      taxonomyConflict: false,
    });

    expect(result.publishable).toBe(false);
    expect(result.reasons).toContain('legacy_projection_missing');
  });
});
