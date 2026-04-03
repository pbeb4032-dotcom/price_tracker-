/**
 * Unit tests for price history helpers.
 */

import { describe, it, expect } from 'vitest';
import {
  calcTrend,
  calcPctChange,
  calcVolatility,
  historyMin,
  historyMax,
  totalSources,
  type PriceHistoryPoint,
} from '@/lib/offers/history';

function makePoint(overrides: Partial<PriceHistoryPoint> = {}): PriceHistoryPoint {
  return {
    day: '2026-02-01',
    min_price: 1000,
    max_price: 2000,
    avg_price: 1500,
    offer_count: 5,
    source_count: 3,
    ...overrides,
  };
}

describe('calcTrend', () => {
  it('returns flat for single point', () => {
    expect(calcTrend([makePoint()])).toBe('flat');
  });

  it('returns flat for empty', () => {
    expect(calcTrend([])).toBe('flat');
  });

  it('returns up when price increased >2%', () => {
    const points = [
      makePoint({ avg_price: 1000 }),
      makePoint({ avg_price: 1050 }),
    ];
    expect(calcTrend(points)).toBe('up');
  });

  it('returns down when price decreased >2%', () => {
    const points = [
      makePoint({ avg_price: 1000 }),
      makePoint({ avg_price: 950 }),
    ];
    expect(calcTrend(points)).toBe('down');
  });

  it('returns flat when change within 2%', () => {
    const points = [
      makePoint({ avg_price: 1000 }),
      makePoint({ avg_price: 1010 }),
    ];
    expect(calcTrend(points)).toBe('flat');
  });
});

describe('calcPctChange', () => {
  it('returns null for single point', () => {
    expect(calcPctChange([makePoint()])).toBeNull();
  });

  it('returns null for empty', () => {
    expect(calcPctChange([])).toBeNull();
  });

  it('calculates positive change', () => {
    const points = [
      makePoint({ avg_price: 1000 }),
      makePoint({ avg_price: 1200 }),
    ];
    expect(calcPctChange(points)).toBe(20);
  });

  it('calculates negative change', () => {
    const points = [
      makePoint({ avg_price: 1000 }),
      makePoint({ avg_price: 800 }),
    ];
    expect(calcPctChange(points)).toBe(-20);
  });

  it('returns null when first price is 0', () => {
    const points = [
      makePoint({ avg_price: 0 }),
      makePoint({ avg_price: 1000 }),
    ];
    expect(calcPctChange(points)).toBeNull();
  });
});

describe('calcVolatility', () => {
  it('returns 0 for single point', () => {
    expect(calcVolatility([makePoint()])).toBe(0);
  });

  it('returns 0 for identical prices', () => {
    const points = [
      makePoint({ avg_price: 1000 }),
      makePoint({ avg_price: 1000 }),
    ];
    expect(calcVolatility(points)).toBe(0);
  });

  it('returns positive value for varying prices', () => {
    const points = [
      makePoint({ avg_price: 800 }),
      makePoint({ avg_price: 1200 }),
      makePoint({ avg_price: 1000 }),
    ];
    expect(calcVolatility(points)).toBeGreaterThan(0);
  });
});

describe('historyMin', () => {
  it('returns null for empty', () => {
    expect(historyMin([])).toBeNull();
  });

  it('returns min of all points', () => {
    const points = [
      makePoint({ min_price: 500 }),
      makePoint({ min_price: 300 }),
      makePoint({ min_price: 700 }),
    ];
    expect(historyMin(points)).toBe(300);
  });
});

describe('historyMax', () => {
  it('returns null for empty', () => {
    expect(historyMax([])).toBeNull();
  });

  it('returns max of all points', () => {
    const points = [
      makePoint({ max_price: 500 }),
      makePoint({ max_price: 900 }),
      makePoint({ max_price: 700 }),
    ];
    expect(historyMax(points)).toBe(900);
  });
});

describe('totalSources', () => {
  it('returns 0 for empty', () => {
    expect(totalSources([])).toBe(0);
  });

  it('returns max source_count', () => {
    const points = [
      makePoint({ source_count: 3 }),
      makePoint({ source_count: 5 }),
      makePoint({ source_count: 2 }),
    ];
    expect(totalSources(points)).toBe(5);
  });
});
