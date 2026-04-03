/**
 * ProductDetails — Detailed view of a single product's trusted prices across regions.
 * Route: /products/:productId
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Loader2, RefreshCw, AlertTriangle, ArrowRight, Bell, Package } from 'lucide-react';

import { RTLLayout, PageContainer } from '@/components/layout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';

import { supabase } from '@/integrations/supabase/client';
import { USE_API } from '@/integrations/dataMode';
import { apiGet } from '@/integrations/api/client';
import { useTelemetry } from '@/lib/telemetry';
import { mapTrustedPrice, getRegionLabel, getCategoryLabel, formatPrice, formatDate } from '@/lib/prices';
import type { TrustedPrice } from '@/lib/prices';
import { useSeoMeta } from '@/lib/seo/useSeoMeta';

export default function ProductDetails() {
  const { productId } = useParams<{ productId: string }>();
  const telemetry = useTelemetry();

  const [rows, setRows] = useState<TrustedPrice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const loadData = useCallback(async () => {
    if (!productId) return;
    setLoading(true);
    setError(false);
    try {
      let data: any[] = [];

      if (USE_API) {
        data = await apiGet<any[]>(`/views/trusted_price_summary?product_id=${encodeURIComponent(productId)}`);
      } else {
        const { data: sbData, error: fetchError } = await supabase
          .from("v_trusted_price_summary")
          .select("*")
          .eq("product_id", productId);
        if (fetchError) throw fetchError;
        data = sbData ?? [];
      }

      const mapped = (data ?? []).map((r) => mapTrustedPrice(r as unknown as Record<string, unknown>));
      setRows(mapped);
      telemetry.trackEvent('product_details_loaded', { status: mapped.length > 0 ? 'ok' : 'empty' });
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [productId, telemetry]);

  useEffect(() => { loadData(); }, [loadData]);

  const product = rows[0];

  useSeoMeta({
    title: product ? product.product_name_ar : 'تفاصيل المنتج',
    description: product
      ? `أسعار ${product.product_name_ar} الموثّقة في العراق — مقارنة بين المناطق.`
      : 'تفاصيل المنتج وأسعاره الموثّقة.',
  });

  const kpis = useMemo(() => {
    if (rows.length === 0) return null;
    const minPrice = Math.min(...rows.map((r) => r.min_price_iqd));
    const maxPrice = Math.max(...rows.map((r) => r.max_price_iqd));
    const avgPrice = Math.round(rows.reduce((s, r) => s + r.avg_price_iqd, 0) / rows.length);
    const totalSamples = rows.reduce((s, r) => s + r.sample_count, 0);
    const latestDate = rows.reduce((latest, r) =>
      r.last_observed_at > latest ? r.last_observed_at : latest, rows[0].last_observed_at);
    return { minPrice, maxPrice, avgPrice, totalSamples, latestDate };
  }, [rows]);

  // SVG bar chart for avg by region
  const chartBars = useMemo(() => {
    return rows
      .map((r) => ({ label: getRegionLabel(r.region_name_ar, r.region_name_en), value: r.avg_price_iqd }))
      .sort((a, b) => b.value - a.value);
  }, [rows]);

  const maxBarValue = Math.max(...chartBars.map((b) => b.value), 1);
  const barHeight = 28;
  const labelWidth = 100;
  const chartWidth = 300;
  const valueWidth = 80;
  const svgWidth = labelWidth + chartWidth + valueWidth + 16;
  const svgHeight = chartBars.length * (barHeight + 6) + 8;

  if (loading) {
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
      <header className="border-b border-border bg-card">
        <PageContainer className="flex items-center justify-between py-4">
          <div className="flex items-center gap-3">
            <Package className="h-6 w-6 text-primary" />
            <h1 className="text-xl font-bold text-foreground">
              {product ? product.product_name_ar : 'تفاصيل المنتج'}
            </h1>
            {product && product.product_name_en && (
              <span className="text-sm text-muted-foreground">({product.product_name_en})</span>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={loadData} className="gap-1">
              <RefreshCw className="h-3 w-3" />
              تحديث
            </Button>
            <Link to="/prices">
              <Button variant="outline" size="sm" className="gap-1">
                <ArrowRight className="h-3 w-3" />
                العودة للأسعار
              </Button>
            </Link>
          </div>
        </PageContainer>
      </header>

      <PageContainer className="py-8">
        {error && (
          <Card className="mb-6 border-destructive/30 bg-destructive/5" data-testid="product-error">
            <CardContent className="flex items-center gap-3 py-4">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              <p className="text-sm text-destructive flex-1">حدث خطأ أثناء تحميل البيانات.</p>
              <Button variant="outline" size="sm" onClick={loadData} className="gap-1">
                <RefreshCw className="h-3 w-3" />
                إعادة المحاولة
              </Button>
            </CardContent>
          </Card>
        )}

        {!error && rows.length === 0 && (
          <Card data-testid="product-not-found">
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <Package className="h-12 w-12 text-muted-foreground mb-4" />
              <h2 className="text-lg font-bold mb-2">لم يتم العثور على المنتج</h2>
              <p className="text-muted-foreground text-sm mb-4">لا توجد بيانات لهذا المنتج.</p>
              <Link to="/prices">
                <Button variant="outline" className="gap-2">
                  <ArrowRight className="h-4 w-4" />
                  العودة للأسعار
                </Button>
              </Link>
            </CardContent>
          </Card>
        )}

        {product && kpis && (
          <>
            {/* Product Info */}
            <div className="flex flex-wrap items-center gap-2 mb-6">
              <Badge variant="secondary">{getCategoryLabel(product.category)}</Badge>
              <Badge variant="outline">{product.unit === 'kg' ? 'كغم' : product.unit}</Badge>
              <Badge variant="outline">{rows.length} منطقة</Badge>
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6" data-testid="product-kpis">
              {[
                { label: 'أقل سعر', value: formatPrice(kpis.minPrice), color: 'text-primary' },
                { label: 'متوسط السعر', value: formatPrice(kpis.avgPrice), color: '' },
                { label: 'أعلى سعر', value: formatPrice(kpis.maxPrice), color: '' },
                { label: 'مجموع العينات', value: String(kpis.totalSamples), color: '' },
                { label: 'آخر تحديث', value: formatDate(kpis.latestDate), color: 'text-muted-foreground' },
              ].map((kpi) => (
                <Card key={kpi.label}>
                  <CardContent className="py-4 px-3">
                    <p className="text-xs text-muted-foreground mb-1">{kpi.label}</p>
                    <p className={`text-sm font-bold ${kpi.color}`}>{kpi.value}</p>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Region Bar Chart */}
            {chartBars.length > 1 && (
              <Card className="mb-6">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">متوسط السعر حسب المنطقة (د.ع)</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <svg width={svgWidth} height={svgHeight} viewBox={`0 0 ${svgWidth} ${svgHeight}`} className="block" role="img" aria-label="رسم بياني حسب المنطقة">
                      {chartBars.map((bar, i) => {
                        const y = i * (barHeight + 6) + 4;
                        const barW = (bar.value / maxBarValue) * chartWidth;
                        return (
                          <g key={bar.label + i}>
                            <text x={labelWidth - 4} y={y + barHeight / 2 + 5} textAnchor="end" className="fill-foreground" style={{ fontSize: '11px' }}>
                              {bar.label.length > 12 ? bar.label.slice(0, 11) + '…' : bar.label}
                            </text>
                            <rect x={labelWidth} y={y} width={Math.max(barW, 2)} height={barHeight} rx={4} className="fill-primary/70" />
                            <text x={labelWidth + barW + 6} y={y + barHeight / 2 + 5} textAnchor="start" className="fill-muted-foreground" style={{ fontSize: '11px' }}>
                              {bar.value.toLocaleString('ar-IQ')}
                            </text>
                          </g>
                        );
                      })}
                    </svg>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Region Comparison Table */}
            <Card className="mb-6">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">مقارنة المناطق</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table data-testid="product-regions-table">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-right">المنطقة</TableHead>
                        <TableHead className="text-right">أقل سعر</TableHead>
                        <TableHead className="text-right">متوسط السعر</TableHead>
                        <TableHead className="text-right">أعلى سعر</TableHead>
                        <TableHead className="text-center">العينات</TableHead>
                        <TableHead className="text-right">آخر تحديث</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((row) => (
                        <TableRow key={row.region_id}>
                          <TableCell className="font-medium">{getRegionLabel(row.region_name_ar, row.region_name_en)}</TableCell>
                          <TableCell className="text-primary font-bold">{formatPrice(row.min_price_iqd)}</TableCell>
                          <TableCell>{formatPrice(row.avg_price_iqd)}</TableCell>
                          <TableCell>{formatPrice(row.max_price_iqd)}</TableCell>
                          <TableCell className="text-center"><Badge variant="outline">{row.sample_count}</Badge></TableCell>
                          <TableCell className="text-muted-foreground text-sm">{formatDate(row.last_observed_at)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            {/* CTA for alert */}
            <div className="text-center">
              <Link to={`/prices?alert_product=${productId}`}>
                <Button variant="outline" className="gap-2">
                  <Bell className="h-4 w-4" />
                  إنشاء تنبيه لهذا المنتج
                </Button>
              </Link>
            </div>
          </>
        )}
      </PageContainer>
    </RTLLayout>
  );
}
