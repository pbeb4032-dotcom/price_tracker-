/**
 * Unit tests for Iraqi price parsing, normalization, and robust aggregation.
 */

import { describe, it, expect } from 'vitest';
import {
  arabicToWesternDigits,
  detectTextMultiplier,
  parseRawPrice,
  validatePriceAgainstGuardrail,
  weightedMedian,
  robustPriceAggregation,
  convertUsdToIqd,
  convertIqdToUsd,
} from '@/lib/prices/priceParser';
import type { CategoryGuardrail } from '@/lib/prices/priceParser';

describe('arabicToWesternDigits', () => {
  it('converts Arabic-Indic numerals', () => {
    expect(arabicToWesternDigits('١٥٠٠٠')).toBe('15000');
  });
  it('passes through Western digits', () => {
    expect(arabicToWesternDigits('42000')).toBe('42000');
  });
  it('handles mixed', () => {
    expect(arabicToWesternDigits('١5٠00')).toBe('15000');
  });
});

describe('detectTextMultiplier', () => {
  it('detects ألف (thousand)', () => {
    expect(detectTextMultiplier('15 ألف')).toBe(1000);
  });
  it('detects الف (thousand variant)', () => {
    expect(detectTextMultiplier('٣٦ الف')).toBe(1000);
  });
  it('detects مليون (million)', () => {
    expect(detectTextMultiplier('1.5 مليون')).toBe(1_000_000);
  });
  it('returns 1 for no multiplier', () => {
    expect(detectTextMultiplier('15000')).toBe(1);
  });
});

describe('parseRawPrice', () => {
  it('parses simple number', () => {
    const r = parseRawPrice('15000');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(15000);
  });

  it('parses Arabic digits', () => {
    const r = parseRawPrice('١٥٠٠٠');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(15000);
  });

  it('parses comma-separated thousands', () => {
    const r = parseRawPrice('1,500,000');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(1_500_000);
  });

  it('parses dot-separated thousands (Iraqi style)', () => {
    const r = parseRawPrice('1.500.000');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(1_500_000);
  });

  it('parses "36 ألف" = 36000', () => {
    const r = parseRawPrice('36 ألف');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toBe(36_000);
      expect(r.multiplier).toBe(1000);
    }
  });

  it('parses "1.5 مليون" = 1,500,000', () => {
    const r = parseRawPrice('1.5 مليون');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(1_500_000);
  });

  it('parses with IQD suffix', () => {
    const r = parseRawPrice('25000 د.ع');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toBe(25000);
      expect(r.currency).toBe('IQD');
    }
  });

  it('parses USD amount', () => {
    const r = parseRawPrice('$1,200');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toBe(1200);
      expect(r.currency).toBe('USD');
    }
  });

  it('rejects empty', () => {
    expect(parseRawPrice('')).toEqual({ ok: false, reason: 'empty_input' });
    expect(parseRawPrice(null)).toEqual({ ok: false, reason: 'empty_input' });
  });

  it('rejects non-numeric', () => {
    expect(parseRawPrice('مجاني').ok).toBe(false);
  });

  // CRITICAL: Million/thousand bug regression tests
  it('iPhone 15 Pro Max at "٣٦ ألف" should be 36000 not 36', () => {
    const r = parseRawPrice('٣٦ ألف');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(36_000);
  });

  it('handles "1,800,000 IQD" (real iPhone price)', () => {
    const r = parseRawPrice('1,800,000 IQD');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(1_800_000);
  });
});

describe('validatePriceAgainstGuardrail', () => {
  const guardrails: CategoryGuardrail[] = [
    { category_key: 'electronics', min_iqd: 5000, max_iqd: 500_000_000 },
    { category_key: 'vegetables', min_iqd: 250, max_iqd: 100_000 },
  ];

  it('accepts valid electronics price', () => {
    expect(validatePriceAgainstGuardrail(1_800_000, 'electronics', guardrails).valid).toBe(true);
  });

  it('rejects electronics at 36 IQD (absurdly low)', () => {
    const r = validatePriceAgainstGuardrail(36, 'electronics', guardrails);
    expect(r.valid).toBe(false);
    expect(r.reason).toContain('below_category_min');
  });

  it('accepts vegatable at 1500', () => {
    expect(validatePriceAgainstGuardrail(1500, 'vegetables', guardrails).valid).toBe(true);
  });

  it('rejects vegetable at 500,000 IQD', () => {
    const r = validatePriceAgainstGuardrail(500_000, 'vegetables', guardrails);
    expect(r.valid).toBe(false);
  });

  it('accepts unknown category', () => {
    expect(validatePriceAgainstGuardrail(100, 'unknown', guardrails).valid).toBe(true);
  });
});

describe('weightedMedian', () => {
  it('returns median of odd-length array', () => {
    expect(weightedMedian([10, 20, 30])).toBe(20);
  });
  it('returns average of two middle for even-length', () => {
    expect(weightedMedian([10, 20, 30, 40])).toBe(25);
  });
  it('returns 0 for empty', () => {
    expect(weightedMedian([])).toBe(0);
  });
  it('handles single element', () => {
    expect(weightedMedian([42000])).toBe(42000);
  });
});

describe('robustPriceAggregation', () => {
  it('ignores outliers via IQR for best display price', () => {
    // Most prices around 1.5M, one outlier at 36K (scaling bug)
    const prices = [36_000, 1_400_000, 1_500_000, 1_550_000, 1_600_000, 1_450_000];
    const result = robustPriceAggregation(prices);
    // bestDisplay should NOT be 36,000 (outlier)
    expect(result.bestDisplay).toBeGreaterThan(100_000);
    expect(result.median).toBeGreaterThan(1_000_000);
  });

  it('works with uniform prices', () => {
    const prices = [25000, 25500, 26000, 25000, 25500];
    const result = robustPriceAggregation(prices);
    expect(result.bestDisplay).toBe(25000);
    expect(result.median).toBe(25500);
  });

  it('returns zero for empty', () => {
    const result = robustPriceAggregation([]);
    expect(result.bestDisplay).toBe(0);
  });
});

describe('currency conversion', () => {
  it('USD to IQD', () => {
    expect(convertUsdToIqd(100, 1470)).toBe(147_000);
  });
  it('IQD to USD', () => {
    expect(convertIqdToUsd(147_000, 1470)).toBe(100);
  });
  it('handles zero rate', () => {
    expect(convertIqdToUsd(1000, 0)).toBe(0);
  });
});
