import { describe, expect, it } from 'vitest';
import { rankOfferRows } from './offerRanking';

describe('offerRanking', () => {
  it('prefers certified published offers over unpublished observed offers', () => {
    const ranked = rankOfferRows([
      {
        offer_id: 'observed-1',
        final_price: 1000,
        delivery_fee: 0,
        source_publish_enabled: false,
        source_certification_tier: 'observed',
        source_quality_score: 0.66,
        trust_score: 0.6,
        in_stock: true,
        observed_at: new Date().toISOString(),
      },
      {
        offer_id: 'published-1',
        final_price: 1050,
        delivery_fee: 0,
        source_publish_enabled: true,
        source_certification_tier: 'published',
        source_quality_score: 0.84,
        trust_score: 0.8,
        in_stock: true,
        observed_at: new Date().toISOString(),
      },
    ]);

    expect(ranked).toHaveLength(1);
    expect((ranked[0] as any).offer_id).toBe('published-1');
  });

  it('penalizes suspicious offers even if they are slightly cheaper', () => {
    const ranked = rankOfferRows([
      {
        offer_id: 'suspect',
        final_price: 1000,
        delivery_fee: 0,
        source_publish_enabled: true,
        source_certification_tier: 'published',
        source_quality_score: 0.8,
        trust_score: 0.8,
        is_price_suspected: true,
        in_stock: true,
        observed_at: new Date().toISOString(),
      },
      {
        offer_id: 'clean',
        final_price: 1025,
        delivery_fee: 0,
        source_publish_enabled: true,
        source_certification_tier: 'published',
        source_quality_score: 0.82,
        trust_score: 0.82,
        in_stock: true,
        observed_at: new Date().toISOString(),
      },
    ]);

    expect((ranked[0] as any).offer_id).toBe('clean');
    expect(Number((ranked[0] as any).comparison?.breakdown?.total ?? 0)).toBeGreaterThan(
      Number((ranked[1] as any).comparison?.breakdown?.total ?? 0),
    );
  });

  it('can include unpublished rows only when explicitly requested', () => {
    const rows = [
      {
        offer_id: 'observed-1',
        final_price: 1000,
        source_publish_enabled: false,
        source_certification_tier: 'observed',
        source_quality_score: 0.7,
        trust_score: 0.7,
        in_stock: true,
        observed_at: new Date().toISOString(),
      },
    ];

    expect(rankOfferRows(rows)).toHaveLength(0);
    expect(rankOfferRows(rows, { includeUnpublished: true })).toHaveLength(1);
  });
});
