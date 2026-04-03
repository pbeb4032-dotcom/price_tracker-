/**
 * usePricesViewState — Manages filters, sort, pagination, view mode, and preferences.
 * Pure state management, no data fetching.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useIsMobile } from '@/hooks/use-mobile';
import type { TrustedPrice } from '@/lib/prices/types';
import { getRegionLabel } from '@/lib/prices/labels';
import { applyPriceFilters } from '@/lib/prices/filters';
import { sortPriceRows, nextSortDir, type SortKey, type SortDir } from '@/lib/pricesSortUtils';
import { paginateRows, type PaginationResult, buildPricesCsv, downloadCsv } from '@/lib/pricesTableUtils';
import { savePricesPreferences, loadPricesPreferences, clearPricesPreferences, getDefaults } from '@/lib/pricesPreferences';
import { saveViewPreference, loadViewPreference, clearViewPreference, resolveEffectiveView, type ViewMode } from '@/lib/pricesViewPreference';
import { selectComparableRows, compareMetrics, rowKey, MAX_COMPARE } from '@/lib/pricesCompareUtils';
import { toast } from '@/hooks/use-toast';
import { useTelemetry } from '@/lib/telemetry';

export interface PricesViewState {
  // Filter state
  selectedRegion: string;
  setSelectedRegion: (v: string) => void;
  selectedCategory: string;
  setSelectedCategory: (v: string) => void;
  searchQuery: string;
  setSearchQuery: (v: string) => void;

  // Pagination
  currentPage: number;
  setCurrentPage: (v: number | ((p: number) => number)) => void;
  pageSize: number;
  setPageSize: (v: number) => void;

  // Sort
  sortBy: SortKey;
  sortDir: SortDir;
  handleSort: (key: SortKey) => void;

  // View mode
  effectiveView: ViewMode;
  handleSetView: (mode: ViewMode) => void;

  // Compare
  compareKeys: Set<string>;
  toggleCompare: (key: string) => void;
  clearCompare: () => void;

  // Alert prefill
  alertPrefill: { product_id: string; product_name_ar: string; region_id: string; region_name_ar: string } | null;
  setAlertPrefill: (v: { product_id: string; product_name_ar: string; region_id: string; region_name_ar: string } | null) => void;

  // Derived data
  regionOptions: string[];
  categoryOptions: string[];
  filteredPrices: TrustedPrice[];
  sortedPrices: TrustedPrice[];
  pagination: PaginationResult<TrustedPrice>;
  comparison: ReturnType<typeof compareMetrics>;
  alertProducts: { product_id: string; product_name_ar: string }[];
  alertRegions: { region_id: string; region_name_ar: string }[];

  // Preference actions
  handleSavePrefs: () => void;
  handleApplyPrefs: () => void;
  handleResetPrefs: () => void;
  handleExportCsv: () => void;
}

export function usePricesViewState(prices: TrustedPrice[]): PricesViewState {
  const telemetry = useTelemetry();
  const isMobile = useIsMobile();

  const [selectedRegion, setSelectedRegion] = useState('all');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [sortBy, setSortBy] = useState<SortKey>('product_name_ar');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [compareKeys, setCompareKeys] = useState<Set<string>>(new Set());
  const [viewChoice, setViewChoice] = useState<ViewMode | null>(() => loadViewPreference());
  const [alertPrefill, setAlertPrefill] = useState<PricesViewState['alertPrefill']>(null);

  const effectiveView = resolveEffectiveView(viewChoice, isMobile);

  const handleSetView = useCallback((mode: ViewMode) => {
    setViewChoice(mode);
    saveViewPreference(mode);
  }, []);

  // Derived data
  const alertProducts = useMemo(() => {
    const map = new Map<string, string>();
    prices.forEach((p) => map.set(p.product_id, p.product_name_ar));
    return Array.from(map.entries()).map(([product_id, product_name_ar]) => ({ product_id, product_name_ar }));
  }, [prices]);

  const alertRegions = useMemo(() => {
    const map = new Map<string, string>();
    prices.forEach((p) => map.set(p.region_id, getRegionLabel(p.region_name_ar, p.region_name_en)));
    return Array.from(map.entries()).map(([region_id, region_name_ar]) => ({ region_id, region_name_ar }));
  }, [prices]);

  const regionOptions = useMemo(() => {
    return Array.from(new Set(prices.map((p) => getRegionLabel(p.region_name_ar, p.region_name_en)).filter(Boolean))).sort((a, b) =>
      a.localeCompare(b, 'ar'),
    );
  }, [prices]);

  const categoryOptions = useMemo(() => {
    return Array.from(new Set(prices.map((p) => p.category).filter(Boolean))).sort((a, b) =>
      a.localeCompare(b, 'ar'),
    );
  }, [prices]);

  const filteredPrices = useMemo(() => {
    return applyPriceFilters(prices, selectedRegion, selectedCategory, searchQuery);
  }, [prices, selectedRegion, selectedCategory, searchQuery]);

  const sortedPrices = useMemo(
    () => sortPriceRows(filteredPrices, sortBy, sortDir),
    [filteredPrices, sortBy, sortDir],
  );

  const pagination = useMemo(
    () => paginateRows(sortedPrices, currentPage, pageSize),
    [sortedPrices, currentPage, pageSize],
  );

  const comparison = useMemo(
    () => compareMetrics(selectComparableRows(sortedPrices, compareKeys)),
    [sortedPrices, compareKeys],
  );

  // Reset page on filter changes
  useEffect(() => { setCurrentPage(1); }, [selectedRegion, selectedCategory, searchQuery, pageSize, sortBy, sortDir]);

  const toggleCompare = useCallback((key: string) => {
    setCompareKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else if (next.size < MAX_COMPARE) {
        next.add(key);
      }
      return next;
    });
  }, []);

  const clearCompare = useCallback(() => setCompareKeys(new Set()), []);

  const handleSort = useCallback((key: SortKey) => {
    const newDir = nextSortDir(sortBy, key, sortDir);
    if (newDir === 'none') {
      setSortBy('product_name_ar');
      setSortDir('asc');
    } else {
      setSortBy(key);
      setSortDir(newDir);
    }
  }, [sortBy, sortDir]);

  const handleExportCsv = useCallback(() => {
    if (filteredPrices.length === 0) return;
    const csv = buildPricesCsv(filteredPrices);
    const date = new Date().toISOString().slice(0, 10);
    downloadCsv(`اسعار-موثقة-${date}.csv`, csv);
    telemetry.trackEvent('prices_csv_exported', { row_count: String(filteredPrices.length) });
  }, [filteredPrices, telemetry]);

  const handleSavePrefs = useCallback(() => {
    savePricesPreferences({ selectedRegion, selectedCategory, searchQuery, pageSize, sortBy, sortDir });
    toast({ title: 'تم حفظ التفضيلات' });
  }, [selectedRegion, selectedCategory, searchQuery, pageSize, sortBy, sortDir]);

  const handleApplyPrefs = useCallback(() => {
    const prefs = loadPricesPreferences();
    if (!prefs) {
      toast({ title: 'لا توجد تفضيلات محفوظة', variant: 'destructive' });
      return;
    }
    setSelectedRegion(prefs.selectedRegion);
    setSelectedCategory(prefs.selectedCategory);
    setSearchQuery(prefs.searchQuery);
    setPageSize(prefs.pageSize);
    setSortBy(prefs.sortBy);
    setSortDir(prefs.sortDir);
    toast({ title: 'تم تطبيق التفضيلات' });
  }, []);

  const handleResetPrefs = useCallback(() => {
    const d = getDefaults();
    setSelectedRegion(d.selectedRegion);
    setSelectedCategory(d.selectedCategory);
    setSearchQuery(d.searchQuery);
    setPageSize(d.pageSize);
    setSortBy(d.sortBy);
    setSortDir(d.sortDir);
    setCurrentPage(1);
    clearPricesPreferences();
    clearViewPreference();
    setViewChoice(null);
    toast({ title: 'تم إعادة التعيين' });
  }, []);

  return {
    selectedRegion, setSelectedRegion,
    selectedCategory, setSelectedCategory,
    searchQuery, setSearchQuery,
    currentPage, setCurrentPage,
    pageSize, setPageSize,
    sortBy, sortDir, handleSort,
    effectiveView, handleSetView,
    compareKeys, toggleCompare, clearCompare,
    alertPrefill, setAlertPrefill,
    regionOptions, categoryOptions,
    filteredPrices, sortedPrices,
    pagination, comparison,
    alertProducts, alertRegions,
    handleSavePrefs, handleApplyPrefs, handleResetPrefs,
    handleExportCsv,
  };
}
