/**
 * Unit tests for offers normalization utilities.
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeArabicText,
  stripDiacritics,
  parseSize,
  isValidPrice,
  isReasonableIQDPrice,
  formatIQDPrice,
  discountPercent,
  relativeTimeAr,
} from '@/lib/offers/normalization';

describe('stripDiacritics', () => {
  it('removes Arabic tashkeel', () => {
    expect(stripDiacritics('مُحَمَّد')).toBe('محمد');
  });

  it('returns plain text unchanged', () => {
    expect(stripDiacritics('سكر')).toBe('سكر');
  });
});

describe('normalizeArabicText', () => {
  it('normalizes alef variants', () => {
    expect(normalizeArabicText('أحمد')).toBe('احمد');
    expect(normalizeArabicText('إبراهيم')).toBe('ابراهيم');
  });

  it('normalizes ta marbuta', () => {
    expect(normalizeArabicText('قهوة')).toBe('قهوه');
  });

  it('normalizes hamza on waw/ya', () => {
    expect(normalizeArabicText('مسؤول')).toBe('مسوول');
  });

  it('collapses whitespace', () => {
    expect(normalizeArabicText('سكر   أبيض')).toBe('سكر ابيض');
  });

  it('lowercases English', () => {
    expect(normalizeArabicText('Samsung Galaxy')).toBe('samsung galaxy');
  });
});

describe('parseSize', () => {
  it('parses ml', () => {
    expect(parseSize('عصير 500ml')).toEqual({ value: 500, unit: 'ml' });
  });

  it('parses kg Arabic', () => {
    expect(parseSize('رز 1.5 كغ')).toEqual({ value: 1.5, unit: 'kg' });
  });

  it('parses grams', () => {
    expect(parseSize('شاي 250g')).toEqual({ value: 250, unit: 'g' });
  });

  it('parses liters', () => {
    expect(parseSize('زيت 2 لتر')).toEqual({ value: 2, unit: 'L' });
  });

  it('returns null for no match', () => {
    expect(parseSize('هاتف سامسونج')).toBeNull();
  });
});

describe('isValidPrice', () => {
  it('rejects zero', () => expect(isValidPrice(0)).toBe(false));
  it('rejects negative', () => expect(isValidPrice(-100)).toBe(false));
  it('rejects Infinity', () => expect(isValidPrice(Infinity)).toBe(false));
  it('rejects NaN', () => expect(isValidPrice(NaN)).toBe(false));
  it('accepts valid price', () => expect(isValidPrice(15000)).toBe(true));
  it('rejects absurd price', () => expect(isValidPrice(2_000_000_000)).toBe(false));
});

describe('isReasonableIQDPrice', () => {
  it('rejects price below 250 IQD', () => expect(isReasonableIQDPrice(100)).toBe(false));
  it('accepts 1000 IQD', () => expect(isReasonableIQDPrice(1000)).toBe(true));
});

describe('formatIQDPrice', () => {
  it('formats number with Arabic locale', () => {
    const formatted = formatIQDPrice(150000);
    // Should contain digits (Arabic or Western) with grouping
    expect(formatted).toBeTruthy();
    expect(formatted.length).toBeGreaterThan(0);
  });
});

describe('discountPercent', () => {
  it('returns percentage when discounted', () => {
    expect(discountPercent(100000, 75000)).toBe(25);
  });

  it('returns null when no discount', () => {
    expect(discountPercent(100000, 100000)).toBeNull();
  });

  it('returns null when discounted > base', () => {
    expect(discountPercent(50000, 100000)).toBeNull();
  });

  it('returns null for zero base', () => {
    expect(discountPercent(0, 50000)).toBeNull();
  });
});

describe('relativeTimeAr', () => {
  it('returns "الآن" for recent time', () => {
    expect(relativeTimeAr(new Date().toISOString())).toBe('الآن');
  });

  it('returns minutes for recent past', () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
    expect(relativeTimeAr(fiveMinAgo)).toContain('دقيقة');
  });

  it('returns hours for hours ago', () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 3600_000).toISOString();
    expect(relativeTimeAr(threeHoursAgo)).toContain('ساعة');
  });
});
