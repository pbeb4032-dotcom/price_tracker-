import { describe, it, expect, beforeEach } from 'vitest';
import {
  savePricesPreferences,
  loadPricesPreferences,
  clearPricesPreferences,
  getDefaults,
  STORAGE_KEY,
  type PricesPreferences,
} from '@/lib/pricesPreferences';

beforeEach(() => {
  localStorage.clear();
});

const validPrefs: PricesPreferences = {
  selectedRegion: 'بغداد',
  selectedCategory: 'grains',
  searchQuery: 'رز',
  pageSize: 25,
  sortBy: 'min_price_iqd',
  sortDir: 'desc',
};

describe('savePricesPreferences + loadPricesPreferences', () => {
  it('round-trips correctly', () => {
    savePricesPreferences(validPrefs);
    const loaded = loadPricesPreferences();
    expect(loaded).toEqual(validPrefs);
  });

  it('returns null when nothing saved', () => {
    expect(loadPricesPreferences()).toBeNull();
  });
});

describe('loadPricesPreferences invalid data', () => {
  it('returns null for invalid JSON', () => {
    localStorage.setItem(STORAGE_KEY, '{bad json');
    expect(loadPricesPreferences()).toBeNull();
  });

  it('returns null for non-object', () => {
    localStorage.setItem(STORAGE_KEY, '"just a string"');
    expect(loadPricesPreferences()).toBeNull();
  });

  it('fills missing fields with defaults', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ selectedRegion: 'بغداد' }));
    const loaded = loadPricesPreferences();
    expect(loaded).not.toBeNull();
    expect(loaded!.selectedRegion).toBe('بغداد');
    expect(loaded!.pageSize).toBe(10); // default
    expect(loaded!.sortBy).toBe('product_name_ar'); // default
  });

  it('rejects negative pageSize', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ pageSize: -5 }));
    const loaded = loadPricesPreferences();
    expect(loaded!.pageSize).toBe(10);
  });
});

describe('clearPricesPreferences', () => {
  it('removes stored data', () => {
    savePricesPreferences(validPrefs);
    clearPricesPreferences();
    expect(loadPricesPreferences()).toBeNull();
  });
});

describe('getDefaults', () => {
  it('returns expected default values', () => {
    const d = getDefaults();
    expect(d.selectedRegion).toBe('all');
    expect(d.selectedCategory).toBe('all');
    expect(d.searchQuery).toBe('');
    expect(d.pageSize).toBe(10);
    expect(d.sortBy).toBe('product_name_ar');
    expect(d.sortDir).toBe('asc');
  });
});
