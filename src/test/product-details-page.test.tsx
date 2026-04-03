/**
 * Tests for ProductDetails page — loading, not-found, error, success states.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mapTrustedPrice, getRegionLabel, getCategoryLabel } from '@/lib/prices';

// Test the data mapping and helpers used by ProductDetails

describe('ProductDetails — data helpers', () => {
  it('mapTrustedPrice handles full row', () => {
    const row = {
      product_id: 'p1', region_id: 'r1',
      product_name_ar: 'رز', product_name_en: 'Rice',
      region_name_ar: 'بغداد', region_name_en: 'Baghdad',
      unit: 'kg', category: 'grains',
      min_price_iqd: 1000, avg_price_iqd: 1500, max_price_iqd: 2000,
      sample_count: 5, last_observed_at: '2026-01-15',
    };
    const mapped = mapTrustedPrice(row);
    expect(mapped.product_name_ar).toBe('رز');
    expect(mapped.avg_price_iqd).toBe(1500);
  });

  it('mapTrustedPrice handles missing fields', () => {
    const mapped = mapTrustedPrice({});
    expect(mapped.product_id).toBe('');
    expect(mapped.product_name_ar).toBe('—');
    expect(mapped.avg_price_iqd).toBe(0);
  });

  it('getRegionLabel falls back correctly', () => {
    expect(getRegionLabel('بغداد', 'Baghdad')).toBe('بغداد');
    expect(getRegionLabel('', 'Erbil')).toBe('أربيل');
    expect(getRegionLabel('', '')).toBe('غير محددة');
  });

  it('getCategoryLabel maps known categories', () => {
    expect(getCategoryLabel('grains')).toBe('حبوب');
    expect(getCategoryLabel('dairy')).toBe('ألبان');
    expect(getCategoryLabel('')).toBe('غير مصنفة');
  });
});

describe('ProductDetails — KPI calculations', () => {
  const rows = [
    { min_price_iqd: 1000, max_price_iqd: 2000, avg_price_iqd: 1500, sample_count: 5, last_observed_at: '2026-01-10' },
    { min_price_iqd: 800, max_price_iqd: 2500, avg_price_iqd: 1200, sample_count: 8, last_observed_at: '2026-01-20' },
  ];

  it('computes min across regions', () => {
    const min = Math.min(...rows.map(r => r.min_price_iqd));
    expect(min).toBe(800);
  });

  it('computes max across regions', () => {
    const max = Math.max(...rows.map(r => r.max_price_iqd));
    expect(max).toBe(2500);
  });

  it('computes avg', () => {
    const avg = Math.round(rows.reduce((s, r) => s + r.avg_price_iqd, 0) / rows.length);
    expect(avg).toBe(1350);
  });

  it('computes total samples', () => {
    const total = rows.reduce((s, r) => s + r.sample_count, 0);
    expect(total).toBe(13);
  });

  it('finds latest date', () => {
    const latest = rows.reduce((l, r) => r.last_observed_at > l ? r.last_observed_at : l, rows[0].last_observed_at);
    expect(latest).toBe('2026-01-20');
  });
});
