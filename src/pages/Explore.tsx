/**
 * Explore page — search and browse products with best offers.
 * Uses paginated browse + paginated search.
 * Category fallback is handled inside useBestOffers hook.
 */

import { useState, useCallback, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { USE_API } from '@/integrations/dataMode';
import { apiRpc } from '@/integrations/api/rpc';
import { RTLLayout, PageContainer } from '@/components/layout';
import { SearchBar, CategoryTabs, ProductCard, EmptyState } from '@/components/offers';
import { SearchResultCard } from '@/components/offers/SearchResultCard';
import { useBestOffers } from '@/hooks/offers/useBestOffers';
import { useSearchEngine } from '@/hooks/offers/useSearchEngine';
import { useIngestionHealth } from '@/hooks/offers/useIngestionHealth';
import { useSeoMeta } from '@/lib/seo/useSeoMeta';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { relativeTimeAr } from '@/lib/offers/normalization';
import type { CategoryKey } from '@/lib/offers/types';
import { GROCERY_SUBCATEGORIES, type GrocerySubcategoryKey } from '@/lib/offers/groceryTaxonomy';

const BROWSE_PAGE_SIZE = 24;
const SEARCH_PAGE_SIZE = 24;

// نجلب عنصر زيادة حتى نعرف إذا أكو صفحة تالية بدون count endpoint
const BROWSE_FETCH_LIMIT = BROWSE_PAGE_SIZE + 1; // 25
const SEARCH_FETCH_LIMIT = SEARCH_PAGE_SIZE + 1; // 25

function Pager({
  page,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
}: {
  page: number;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  if (!hasPrev && !hasNext) return null;

  return (
    <div className="flex items-center justify-center gap-2 mt-6">
      <Button variant="outline" size="sm" onClick={onPrev} disabled={!hasPrev}>
        السابق
      </Button>
      <span className="text-sm text-muted-foreground">
        صفحة {page}
      </span>
      <Button variant="outline" size="sm" onClick={onNext} disabled={!hasNext}>
        التالي
      </Button>
    </div>
  );
}

const Explore = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<CategoryKey>('all');
  const [activeSubcategory, setActiveSubcategory] = useState<GrocerySubcategoryKey>('all');
  const [browsePage, setBrowsePage] = useState(1);
  const [searchPage, setSearchPage] = useState(1);

  useSeoMeta({
    title: 'استكشاف المنتجات والأسعار — شكد عادل',
    description:
      'ابحث وقارن أسعار المنتجات من جميع المصادر العراقية. اعثر على أفضل الأسعار للإلكترونيات والغذائيات والملابس وأكثر.',
  });

  const { data: healthStatus } = useIngestionHealth();

  const trimmed = searchQuery.trim();
  const isSearching = trimmed.length >= 2;

  // =========================
  // Browse (best offers) pagination
  // =========================
  const browseOffset = (browsePage - 1) * BROWSE_PAGE_SIZE;

  const {
    data: bestOffersRows,
    isLoading: offersLoading,
    error: offersError,
  } = useBestOffers({
    category: activeCategory,
    subcategory: activeCategory === 'groceries' ? activeSubcategory : undefined,
    limit: BROWSE_FETCH_LIMIT, // fetch one extra row to detect next page
    offset: browseOffset,
  });

  const browseVisibleRows = (bestOffersRows ?? []).slice(0, BROWSE_PAGE_SIZE);
  const browseHasPrev = browsePage > 1;
  const browseHasNext = (bestOffersRows?.length ?? 0) > BROWSE_PAGE_SIZE;

  // =========================
  // Search pagination
  // =========================
  const searchFilters = (() => {
    const f: any = {};
    if (activeCategory !== 'all') f.category = activeCategory;
    if (activeCategory === 'groceries' && activeSubcategory !== 'all') f.subcategory = activeSubcategory;
    return Object.keys(f).length ? f : undefined;
  })();
  const searchOffset = (searchPage - 1) * SEARCH_PAGE_SIZE;
  const searchRegionId: string | null = null; // keep key consistent for useQuery + prefetch

  const {
    data: searchRows,
    isLoading: searchLoading,
  } = useSearchEngine({
    query: searchQuery,
    regionId: searchRegionId,
    filters: searchFilters,
    limit: SEARCH_FETCH_LIMIT, // fetch one extra row to detect next page
    offset: searchOffset,
  });

  const searchVisibleRows = (searchRows ?? []).slice(0, SEARCH_PAGE_SIZE);
  const searchHasPrev = searchPage > 1;
  const searchHasNext = (searchRows?.length ?? 0) > SEARCH_PAGE_SIZE;

  const handleCategoryChange = useCallback((key: CategoryKey) => {
    setActiveCategory(key);
  }, []);

  // Reset pagination when category changes
  useEffect(() => {
    setBrowsePage(1);
    setSearchPage(1);
    // Reset subcategory when leaving groceries
    if (activeCategory !== 'groceries') setActiveSubcategory('all');
  }, [activeCategory]);

  // Reset search page when query changes
  useEffect(() => {
    setSearchPage(1);
  }, [trimmed]);

  // Safety: if a page becomes empty after data changes, step back one page
  useEffect(() => {
    if (isSearching) return;
    if (offersLoading) return;
    if (browsePage > 1 && (bestOffersRows?.length ?? 0) === 0) {
      setBrowsePage((p) => Math.max(1, p - 1));
    }
  }, [isSearching, offersLoading, bestOffersRows, browsePage]);

  useEffect(() => {
    if (!isSearching) return;
    if (searchLoading) return;
    if (searchPage > 1 && (searchRows?.length ?? 0) === 0) {
      setSearchPage((p) => Math.max(1, p - 1));
    }
  }, [isSearching, searchLoading, searchRows, searchPage]);

  // =========================
  // Prefetch next search page (cache)
  // =========================
  const queryClient = useQueryClient();

  const filtersKey = JSON.stringify(
    Object.keys(searchFilters ?? {})
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = (searchFilters as Record<string, unknown>)?.[k];
        return acc;
      }, {})
  );

  const searchSort = 'best';

  useEffect(() => {
    if (!trimmed || trimmed.length < 2) return;
    if (!searchHasNext) return;

    const nextOffset = searchOffset + SEARCH_PAGE_SIZE;

    queryClient.prefetchQuery({
      queryKey: [
        'search-engine',
        trimmed,
        searchRegionId,
        filtersKey,
        searchSort,
        SEARCH_FETCH_LIMIT,
        nextOffset,
      ],
      queryFn: async () => {
        const args = {
          p_query: trimmed,
          p_region_id: searchRegionId,
          p_filters: searchFilters ?? {},
          p_limit: SEARCH_FETCH_LIMIT,
          p_offset: nextOffset,
          p_sort: searchSort,
        };

        if (USE_API) {
          return (await apiRpc<any[]>('search_products_engine', args as any)) ?? [];
        }

        const { data, error } = await supabase.rpc('search_products_engine' as any, args);
        if (error) throw error;
        return (data ?? []) as any[];
      },
      staleTime: 30_000,
    });
  }, [
    trimmed,
    searchHasNext,
    searchOffset,
    searchRegionId,
    filtersKey,
    searchSort,
    searchFilters,
    queryClient,
  ]);

  return (
    <RTLLayout>
      {/* Hero search section */}
      <header className="bg-primary py-8 md:py-12">
        <PageContainer>
          <div className="text-center mb-6">
            <h1 className="text-primary-foreground text-2xl md:text-3xl font-bold mb-2">
              اعثر على أفضل سعر في العراق
            </h1>
            <p className="text-primary-foreground/70 text-sm md:text-base">
              ابحث مرة واحدة — نعرضلك أرخص عرض موثّق من كل المصادر
            </p>
            {healthStatus?.lastSyncAt && (
              <p className="text-primary-foreground/50 text-xs mt-1">
                آخر تحديث: {relativeTimeAr(healthStatus.lastSyncAt)}
              </p>
            )}
          </div>

          <SearchBar
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="ابحث باسم المنتج، الباركود، أو العلامة التجارية..."
          />
        </PageContainer>
      </header>

      {/* Category tabs */}
      <section className="border-b border-border bg-background sticky top-0 z-10">
        <PageContainer className="py-3">
          <CategoryTabs active={activeCategory} onChange={handleCategoryChange} />

          {activeCategory === 'groceries' && (
            <div className="mt-3 flex items-center gap-2 overflow-x-auto pb-2">
              {GROCERY_SUBCATEGORIES.map((s) => (
                <Button
                  key={s.key}
                  size="sm"
                  variant={activeSubcategory === s.key ? 'default' : 'outline'}
                  className="whitespace-nowrap text-xs"
                  onClick={() => setActiveSubcategory(s.key)}
                >
                  {s.label}
                </Button>
              ))}
            </div>
          )}
        </PageContainer>
      </section>

      {/* Results */}
      <main className="py-6 md:py-8">
        <PageContainer as="div">
          {isSearching ? (
            <section>
              <div className="flex items-center justify-between mb-4 gap-3">
                <h2 className="text-lg font-semibold text-foreground">
                  نتائج البحث عن "{searchQuery}"
                </h2>
                <span className="text-xs text-muted-foreground">صفحة {searchPage}</span>
              </div>

              {searchLoading ? (
                <LoadingGrid />
              ) : !searchVisibleRows.length ? (
                <EmptyState variant="no-results" searchQuery={searchQuery} />
              ) : (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 md:gap-4">
                    {searchVisibleRows.map((result) => (
                      <SearchResultCard key={result.out_product_id} result={result} />
                    ))}
                  </div>

                  <Pager
                    page={searchPage}
                    hasPrev={searchHasPrev}
                    hasNext={searchHasNext}
                    onPrev={() => setSearchPage((p) => Math.max(1, p - 1))}
                    onNext={() => setSearchPage((p) => p + 1)}
                  />
                </>
              )}
            </section>
          ) : (
            <section>
              <div className="flex items-center justify-between mb-4 gap-3">
                <h2 className="text-lg font-semibold text-foreground">أفضل العروض</h2>
                <span className="text-xs text-muted-foreground">
                  صفحة {browsePage}
                  {browseVisibleRows.length > 0 ? ` • ${browseVisibleRows.length} عنصر` : ''}
                </span>
              </div>

              {offersLoading ? (
                <LoadingGrid />
              ) : offersError ? (
                <div className="text-center py-12 text-destructive">
                  حدث خطأ في تحميل العروض. حاول مرة أخرى.
                </div>
              ) : !browseVisibleRows.length ? (
                <EmptyState variant="no-data" />
              ) : (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 md:gap-4">
                    {browseVisibleRows.map((offer) => (
                      <ProductCard
                        key={(offer as any).offer_id ?? (offer as any).product_id}
                        offer={offer as any}
                      />
                    ))}
                  </div>

                  <Pager
                    page={browsePage}
                    hasPrev={browseHasPrev}
                    hasNext={browseHasNext}
                    onPrev={() => setBrowsePage((p) => Math.max(1, p - 1))}
                    onNext={() => setBrowsePage((p) => p + 1)}
                  />
                </>
              )}
            </section>
          )}
        </PageContainer>
      </main>
    </RTLLayout>
  );
};

function LoadingGrid() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 md:gap-4">
      {Array.from({ length: 10 }).map((_, i) => (
        <div key={i} className="rounded-lg border border-border bg-card overflow-hidden">
          <Skeleton className="aspect-square w-full" />
          <div className="p-3 space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-5 w-1/2" />
            <Skeleton className="h-3 w-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default Explore;