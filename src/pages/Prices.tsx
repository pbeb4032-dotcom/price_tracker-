/**
 * Shkad Aadel — Verified Market Prices (Public)
 *
 * Displays aggregated source-backed prices from v_trusted_price_summary.
 * No authentication required. Arabic RTL UI.
 */

import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, RefreshCw, AlertTriangle, TrendingDown, BarChart3, Eye, Search, Download, ChevronRight, ChevronLeft, ArrowUpDown, ArrowUp, ArrowDown, Save, RotateCcw, Star, Bell, LayoutGrid, TableIcon } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';

import { RTLLayout, PageContainer } from '@/components/layout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

import PricesOverviewChart from '@/components/PricesOverviewChart';
import ProductComparisonPanel from '@/components/ProductComparisonPanel';
import PriceAlertsPanel from '@/components/PriceAlertsPanel';
import PriceCardView from '@/components/PriceCardView';

import { usePricesData } from '@/hooks/prices/usePricesData';
import { usePricesViewState } from '@/hooks/prices/usePricesViewState';
import { useSeoMeta } from '@/lib/seo/useSeoMeta';

import { formatPrice, formatDate } from '@/lib/prices/formatters';
import { getCategoryLabel, getRegionLabel } from '@/lib/prices/labels';
import { rowKey, MAX_COMPARE } from '@/lib/pricesCompareUtils';
import type { SortKey } from '@/lib/pricesSortUtils';

// ---- Re-export shared types/helpers for backward compat ----
export type { TrustedPrice } from '@/lib/prices/types';
export { getCategoryLabel, getRegionLabel } from '@/lib/prices/labels';
export { mapTrustedPrice } from '@/lib/prices/mappers';
export { normalizeSearchText, applyPriceFilters } from '@/lib/prices/filters';

// ---- Main Page ----

export default function Prices() {
  useSeoMeta({
    title: 'الأسعار الموثّقة',
    description: 'تصفّح أسعار السوق الموثّقة في العراق — فلترة حسب المنطقة والفئة مع مقارنة وتنبيهات.',
  });

  const data = usePricesData();
  const view = usePricesViewState(data.prices);

  // Load prices on mount
  useEffect(() => {
    data.loadPrices();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (data.loading) {
    return (
      <RTLLayout>
        <div className="min-h-screen flex items-center justify-center" role="status">
          <Loader2 className="h-8 w-8 animate-spin text-primary" aria-label="جاري التحميل" />
        </div>
      </RTLLayout>
    );
  }

  return (
    <RTLLayout>
      <PageContainer className="py-8">
        {/* Page title + refresh */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <BarChart3 className="h-6 w-6 text-primary" />
            <h1 className="text-xl font-bold text-foreground">الأسعار الموثّقة</h1>
          </div>
          <Button variant="outline" size="sm" onClick={data.loadPrices} className="gap-1">
            <RefreshCw className="h-3 w-3" />
            تحديث
          </Button>
        </div>
        {data.error && (
          <Card className="mb-6 border-destructive/30 bg-destructive/5" data-testid="prices-error">
            <CardContent className="flex items-center gap-3 py-4">
              <AlertTriangle className="h-5 w-5 text-destructive flex-shrink-0" />
              <p className="text-sm text-destructive flex-1">
                حدث خطأ أثناء تحميل الأسعار. يرجى المحاولة لاحقاً.
              </p>
              <Button variant="outline" size="sm" onClick={data.loadPrices} className="gap-1 flex-shrink-0">
                <RefreshCw className="h-3 w-3" />
                إعادة المحاولة
              </Button>
            </CardContent>
          </Card>
        )}

        {!data.error && data.prices.length === 0 && (
          <Card className="border-border" data-testid="prices-empty">
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <Eye className="h-12 w-12 text-muted-foreground mb-4" />
              <h2 className="text-lg font-bold text-foreground mb-2">
                لا توجد أسعار موثّقة حالياً
              </h2>
              <p className="text-muted-foreground text-sm max-w-md mb-6">
                لا توجد بيانات موثقة كافية حالياً.
              </p>
              <Button variant="outline" onClick={data.loadPrices} className="gap-2">
                <RefreshCw className="h-4 w-4" />
                إعادة المحاولة
              </Button>
            </CardContent>
          </Card>
        )}

        {data.prices.length > 0 && view.filteredPrices.length === 0 && (
          <Card className="border-border" data-testid="prices-filter-empty">
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <p className="text-muted-foreground text-sm">
                لا توجد نتائج مطابقة للفلاتر الحالية.
              </p>
            </CardContent>
          </Card>
        )}

        {data.prices.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <TrendingDown className="h-5 w-5 text-primary" />
                أسعار السوق المُوثّقة
                <Badge variant="secondary" className="text-xs">
                  {view.filteredPrices.length} نتيجة
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {/* Search */}
              <div className="mb-4" data-testid="prices-search">
                <div className="relative">
                  <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                  <Input
                    type="text"
                    placeholder="ابحث عن منتج (مثال: رز، طماطم)"
                    value={view.searchQuery}
                    onChange={(e) => view.setSearchQuery(e.target.value)}
                    className="pr-10 w-full"
                    data-testid="prices-search-input"
                  />
                </div>
              </div>

              {/* Filters */}
              <div className="flex flex-col sm:flex-row flex-wrap gap-4 mb-4" data-testid="prices-filters">
                <div className="flex flex-col gap-1 w-full sm:w-auto">
                  <label htmlFor="region-filter" className="text-xs text-muted-foreground">المنطقة</label>
                  <select
                    id="region-filter"
                    value={view.selectedRegion}
                    onChange={(e) => view.setSelectedRegion(e.target.value)}
                    className="rounded-md border border-input bg-background px-3 py-2 text-sm w-full sm:w-auto"
                  >
                    <option value="all">كل المناطق</option>
                    {view.regionOptions.map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1 w-full sm:w-auto">
                  <label htmlFor="category-filter" className="text-xs text-muted-foreground">الفئة</label>
                  <select
                    id="category-filter"
                    value={view.selectedCategory}
                    onChange={(e) => view.setSelectedCategory(e.target.value)}
                    className="rounded-md border border-input bg-background px-3 py-2 text-sm w-full sm:w-auto"
                  >
                    <option value="all">كل الفئات</option>
                    {view.categoryOptions.map((c) => (
                      <option key={c} value={c}>{getCategoryLabel(c)}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Filters row 2: page size + export */}
              <div className="flex flex-col sm:flex-row flex-wrap items-start sm:items-end gap-4 mb-6">
                <div className="flex flex-col gap-1 w-full sm:w-auto">
                  <label htmlFor="page-size" className="text-xs text-muted-foreground">عدد الصفوف</label>
                  <select
                    id="page-size"
                    value={view.pageSize}
                    onChange={(e) => view.setPageSize(Number(e.target.value))}
                    className="rounded-md border border-input bg-background px-3 py-2 text-sm w-full sm:w-auto"
                  >
                    <option value={10}>10</option>
                    <option value={25}>25</option>
                    <option value={50}>50</option>
                  </select>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={view.handleExportCsv}
                  disabled={view.filteredPrices.length === 0}
                  className="gap-1 w-full sm:w-auto"
                  data-testid="prices-csv-export"
                >
                  <Download className="h-3 w-3" />
                  تصدير CSV
                </Button>
                <Button variant="outline" size="sm" onClick={view.handleSavePrefs} className="gap-1 w-full sm:w-auto">
                  <Save className="h-3 w-3" />
                  حفظ التفضيلات
                </Button>
                <Button variant="outline" size="sm" onClick={view.handleApplyPrefs} className="gap-1 w-full sm:w-auto">
                  <Star className="h-3 w-3" />
                  تطبيق المحفوظة
                </Button>
                <Button variant="outline" size="sm" onClick={view.handleResetPrefs} className="gap-1 w-full sm:w-auto">
                  <RotateCcw className="h-3 w-3" />
                  إعادة تعيين
                </Button>
              </div>

              {/* View toggle: بطاقات | جدول */}
              <div className="flex items-center gap-1 mb-4" data-testid="view-toggle">
                <Button
                  variant={view.effectiveView === 'cards' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => view.handleSetView('cards')}
                  className="gap-1 text-xs"
                  data-testid="view-toggle-cards"
                >
                  <LayoutGrid className="h-3 w-3" />
                  بطاقات
                </Button>
                <Button
                  variant={view.effectiveView === 'table' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => view.handleSetView('table')}
                  className="gap-1 text-xs"
                  data-testid="view-toggle-table"
                >
                  <TableIcon className="h-3 w-3" />
                  جدول
                </Button>
              </div>

              {/* Alerts Panel */}
              <PriceAlertsPanel
                rules={data.alertRules}
                triggeredAlerts={data.triggeredAlerts}
                onRulesChange={data.reloadAlertRules}
                onClearTriggered={data.reloadTriggered}
                prefill={view.alertPrefill}
                onClearPrefill={() => view.setAlertPrefill(null)}
                products={view.alertProducts}
                regions={view.alertRegions}
              />

              {/* Chart */}
              <PricesOverviewChart rows={view.filteredPrices} />

              {/* Comparison Panel */}
              <ProductComparisonPanel comparison={view.comparison} onClear={view.clearCompare} />

              {/* Card View or Table View based on effectiveView */}
              {view.effectiveView === 'cards' ? (
                <PriceCardView
                  rows={view.pagination.pageRows}
                  compareKeys={view.compareKeys}
                  onToggleCompare={view.toggleCompare}
                  onAlertPrefill={view.setAlertPrefill}
                />
              ) : (
              <div className="overflow-x-auto" data-testid="prices-table-view" style={{ minWidth: 0 }}>
                <Table data-testid="prices-table">
                  <TableHeader>
                    <TableRow>
                      {([
                        ['product_name_ar', 'المنتج', 'text-right'],
                        ['region_name_ar', 'المنطقة', 'text-right'],
                        ['min_price_iqd', 'أقل سعر', 'text-right'],
                        ['avg_price_iqd', 'متوسط السعر', 'text-right'],
                        ['max_price_iqd', 'أعلى سعر', 'text-right'],
                        ['sample_count', 'العينات', 'text-center'],
                        ['last_observed_at', 'آخر تحديث', 'text-right'],
                      ] as [SortKey, string, string][]).map(([key, label, align]) => (
                        <TableHead key={key} className={align}>
                          <button
                            type="button"
                            onClick={() => view.handleSort(key)}
                            className="inline-flex items-center gap-1 hover:text-primary transition-colors"
                          >
                            {label}
                            {view.sortBy === key && view.sortDir === 'asc' && <ArrowUp className="h-3 w-3" />}
                            {view.sortBy === key && view.sortDir === 'desc' && <ArrowDown className="h-3 w-3" />}
                            {view.sortBy !== key && <ArrowUpDown className="h-3 w-3 opacity-30" />}
                          </button>
                        </TableHead>
                      ))}
                      <TableHead className="w-10 text-center">قارن</TableHead>
                      <TableHead className="w-10 text-center">تنبيه</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {view.pagination.pageRows.map((row) => (
                      <TableRow key={`${row.product_id}-${row.region_id}-${row.unit}`}>
                        <TableCell className="text-center">
                          <Checkbox
                            checked={view.compareKeys.has(rowKey(row))}
                            disabled={!view.compareKeys.has(rowKey(row)) && view.compareKeys.size >= MAX_COMPARE}
                            onCheckedChange={() => view.toggleCompare(rowKey(row))}
                            aria-label={`قارن ${row.product_name_ar}`}
                          />
                        </TableCell>
                        <TableCell className="font-medium">
                          <Link to={`/products/${row.product_id}`} className="hover:text-primary hover:underline transition-colors">
                            {row.product_name_ar}
                          </Link>
                          <span className="text-muted-foreground text-xs block">
                            {row.unit === 'kg' ? 'كغم' : row.unit}
                            {row.category ? ` · ${getCategoryLabel(row.category)}` : ''}
                          </span>
                        </TableCell>
                        <TableCell>{getRegionLabel(row.region_name_ar, row.region_name_en)}</TableCell>
                        <TableCell className="text-primary font-bold">
                          {formatPrice(row.min_price_iqd)}
                        </TableCell>
                        <TableCell>{formatPrice(row.avg_price_iqd)}</TableCell>
                        <TableCell>{formatPrice(row.max_price_iqd)}</TableCell>
                        <TableCell className="text-center">
                          <Badge variant="outline">{row.sample_count}</Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {row.last_observed_at ? formatDate(row.last_observed_at) : '—'}
                        </TableCell>
                        <TableCell className="text-center">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => view.setAlertPrefill({ product_id: row.product_id, product_name_ar: row.product_name_ar, region_id: row.region_id, region_name_ar: getRegionLabel(row.region_name_ar, row.region_name_en) })}
                            aria-label={`تنبيه ${row.product_name_ar}`}
                          >
                            <Bell className="h-3 w-3" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              )}

              {/* Pagination controls */}
              {view.filteredPrices.length > 0 && (
                <div className="flex flex-col sm:flex-row items-center justify-between gap-3 mt-4 text-sm" data-testid="prices-pagination">
                  <span className="text-muted-foreground">
                    عرض {view.pagination.startIndex}–{view.pagination.endIndex} من {view.pagination.totalRows}
                  </span>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={view.pagination.currentPage <= 1}
                      onClick={() => view.setCurrentPage((p) => p - 1)}
                      className="gap-1"
                    >
                      <ChevronRight className="h-3 w-3" />
                      السابق
                    </Button>
                    <span className="px-2">
                      صفحة {view.pagination.currentPage} من {view.pagination.totalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={view.pagination.currentPage >= view.pagination.totalPages}
                      onClick={() => view.setCurrentPage((p) => p + 1)}
                      className="gap-1"
                    >
                      التالي
                      <ChevronLeft className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </PageContainer>
    </RTLLayout>
  );
}
