import { describe, expect, it } from 'vitest';
import {
  decideMarketPublication,
  decideOfficialPublication,
  mapFxPublicationsToLegacyRows,
  weightedMedian,
  type GovernedFxObservation,
} from './governedFx';

const NOW = Date.parse('2026-04-04T09:00:00.000Z');

function buildObservation(overrides: Partial<GovernedFxObservation>): GovernedFxObservation {
  return {
    sourceId: overrides.sourceId ?? 'source-1',
    sourceCode: overrides.sourceCode ?? 'source_code',
    sourceName: overrides.sourceName ?? 'Source',
    sourceKind: overrides.sourceKind ?? 'market_exchange_house',
    rateType: overrides.rateType ?? 'market',
    regionKey: overrides.regionKey ?? 'city:baghdad',
    observedAt: overrides.observedAt ?? '2026-04-04T08:30:00.000Z',
    parseStatus: overrides.parseStatus ?? 'ok',
    midRate: overrides.midRate ?? 1465,
    buyRate: overrides.buyRate ?? 1460,
    sellRate: overrides.sellRate ?? 1470,
    trustScore: overrides.trustScore ?? 0.9,
    freshnessSlaMinutes: overrides.freshnessSlaMinutes ?? 120,
    priority: overrides.priority ?? 10,
    parserVersion: overrides.parserVersion ?? 'v1',
    rawPayload: overrides.rawPayload ?? {},
    anomalyFlags: overrides.anomalyFlags ?? [],
    error: overrides.error ?? null,
    observationId: overrides.observationId ?? null,
  };
}

describe('governedFx', () => {
  it('computes weighted median deterministically', () => {
    expect(weightedMedian([
      { value: 1450, weight: 0.3 },
      { value: 1460, weight: 0.6 },
      { value: 1490, weight: 0.2 },
    ])).toBe(1460);
  });

  it('prefers authoritative official sources over fallback ones', () => {
    const official = decideOfficialPublication({
      nowMs: NOW,
      previous: null,
      observations: [
        buildObservation({
          sourceId: 'official-1',
          sourceCode: 'official-1',
          sourceName: 'CBI',
          sourceKind: 'official',
          rateType: 'official',
          regionKey: 'country:iq',
          midRate: 1320,
          buyRate: 1318,
          sellRate: 1322,
          trustScore: 0.99,
          freshnessSlaMinutes: 1440,
          priority: 10,
        }),
        buildObservation({
          sourceId: 'fallback-1',
          sourceCode: 'fallback-1',
          sourceName: 'Fallback',
          sourceKind: 'api_fallback',
          rateType: 'official',
          regionKey: 'country:iq',
          midRate: 1310,
          buyRate: 1310,
          sellRate: 1310,
          trustScore: 0.3,
          freshnessSlaMinutes: 1440,
          priority: 500,
        }),
      ],
    });

    expect(official.midRate).toBe(1320);
    expect(official.publicationStatus).toBe('current');
    expect(official.qualityFlag).toBe('verified');
    expect(official.decisionMeta.selected_source_code).toBe('official-1');
  });

  it('freezes market publication on large unsupported jumps', () => {
    const market = decideMarketPublication({
      nowMs: NOW,
      previous: {
        midRate: 1460,
        buyRate: 1455,
        sellRate: 1465,
        publicationStatus: 'current',
        qualityFlag: 'verified',
        publishedAt: '2026-04-04T08:00:00.000Z',
      },
      officialDecision: null,
      observations: [
        buildObservation({
          sourceId: 'market-1',
          sourceCode: 'market-1',
          sourceName: 'Exchange house',
          midRate: 1495,
          buyRate: 1490,
          sellRate: 1500,
          trustScore: 0.88,
          priority: 20,
        }),
      ],
    });

    expect(market.publicationStatus).toBe('frozen');
    expect(market.qualityFlag).toBe('anomaly_frozen');
    expect(market.midRate).toBe(1460);
  });

  it('maps governed publications to backward-compatible exchange-rate rows', () => {
    const rows = mapFxPublicationsToLegacyRows([
      {
        id: 'pub-gov',
        rate_date: '2026-04-04',
        rate_type: 'official',
        region_key: 'country:iq',
        publication_status: 'current',
        buy_rate: 1320,
        sell_rate: 1320,
        mid_rate: 1320,
        quality_flag: 'verified',
        based_on_n_sources: 1,
        confidence: 0.97,
        freshness_seconds: 100,
        source_summary: [],
        decision_meta: {},
        published_at: '2026-04-04T08:00:00.000Z',
      },
      {
        id: 'pub-market',
        rate_date: '2026-04-04',
        rate_type: 'market',
        region_key: 'city:baghdad',
        publication_status: 'current',
        buy_rate: 1460,
        sell_rate: 1470,
        mid_rate: 1465,
        quality_flag: 'multi_source',
        based_on_n_sources: 3,
        confidence: 0.91,
        freshness_seconds: 600,
        source_summary: [],
        decision_meta: {},
        published_at: '2026-04-04T08:30:00.000Z',
      },
    ]);

    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.source_type === 'gov')?.mid_iqd_per_usd).toBe(1320);
    expect(rows.find((row) => row.source_type === 'market')?.mid_iqd_per_usd).toBe(1465);
  });
});
