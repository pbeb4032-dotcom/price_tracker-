/**
 * LocalStorage helpers for saving/loading user price filter preferences.
 */

import type { SortKey, SortDir } from '@/lib/pricesSortUtils';

export const STORAGE_KEY = 'prices.preferences.v1';

export interface PricesPreferences {
  selectedRegion: string;
  selectedCategory: string;
  searchQuery: string;
  pageSize: number;
  sortBy: SortKey;
  sortDir: SortDir;
}

const DEFAULTS: PricesPreferences = {
  selectedRegion: 'all',
  selectedCategory: 'all',
  searchQuery: '',
  pageSize: 10,
  sortBy: 'product_name_ar',
  sortDir: 'asc',
};

export function getDefaults(): PricesPreferences {
  return { ...DEFAULTS };
}

export function savePricesPreferences(prefs: PricesPreferences): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // storage full or unavailable — silently ignore
  }
}

export function loadPricesPreferences(): PricesPreferences | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    // Validate and merge with defaults
    return {
      selectedRegion: typeof parsed.selectedRegion === 'string' ? parsed.selectedRegion : DEFAULTS.selectedRegion,
      selectedCategory: typeof parsed.selectedCategory === 'string' ? parsed.selectedCategory : DEFAULTS.selectedCategory,
      searchQuery: typeof parsed.searchQuery === 'string' ? parsed.searchQuery : DEFAULTS.searchQuery,
      pageSize: typeof parsed.pageSize === 'number' && parsed.pageSize > 0 ? parsed.pageSize : DEFAULTS.pageSize,
      sortBy: typeof parsed.sortBy === 'string' ? parsed.sortBy as SortKey : DEFAULTS.sortBy,
      sortDir: ['asc', 'desc', 'none'].includes(parsed.sortDir) ? parsed.sortDir : DEFAULTS.sortDir,
    };
  } catch {
    return null;
  }
}

export function clearPricesPreferences(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // silently ignore
  }
}
