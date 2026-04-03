/**
 * Product vs Product comparison page.
 * URL-driven: /explore/compare?left=<id>&right=<id>&days=30&region=&delivery=0
 */

import { useState, useCallback } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { ArrowRight, Search, BarChart3 } from 'lucide-react';
import { RTLLayout, PageContainer } from '@/components/layout';
import { useSeoMeta } from '@/lib/seo/useSeoMeta';
import { useProductSearch } from '@/hooks/offers/useProductSearch';
import { useProductPriceHistory } from '@/hooks/offers/useProductPriceHistory';
import { useCompareOffers, useCompareProducts, isSuspectedOffer } from '@/hooks/offers/useApiComparisons';
import { formatIQDPrice } from '@/lib/offers/normalization';
import { calcPctChange, historyMin, historyMax, calcTrend, type HistoryRange } from '@/lib/offers/history';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
} from 'recharts';

const ProductCompare = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const leftId = searchParams.get('left') || '';
  const rightId = searchParams.get('right') || '';
  const daysParam = parseInt(searchParams.get('days') || '30', 10) as HistoryRange;
  const days: HistoryRange = ([7, 30, 90, 180] as const).includes(daysParam as any) ? daysParam : 30;
  const delivery = searchParams.get('delivery') === '1';

  const setParam = useCallback((key: string, value: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) next.set(key, value);
      else next.delete(key);
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  useSeoMeta({
    title: 'مقارنة المنتجات — شكد عادل',
    description: 'قارن أسعار منتجين جنب بجنب مع تاريخ الأسعار والعروض المتاحة.',
  });

  return (
    <RTLLayout>
      <PageContainer className="py-6 md:py-8">
        <nav className="flex items-center gap-2 text-sm text-muted-foreground mb-6">
          <Link to="/explore" className="hover:text-primary transition-colors">استكشاف</Link>
          <ArrowRight className="h-3 w-3 rotate-180" />
          <span className="text-foreground font-medium">مقارنة المنتجات</span>
        </nav>

        <h1 className="text-2xl md:text-3xl font-bold text-foreground mb-6">مقارنة المنتجات</h1>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          <ProductPicker
            label="المنتج الأول"
            selectedId={leftId}
            onSelect={(id) => setParam('left', id)}
          />
          <ProductPicker
            label="المنتج الثاني"
            selectedId={rightId}
            onSelect={(id) => setParam('right', id)}
          />
        </div>

        {leftId && rightId && (
          <CompareResults
            leftId={leftId}
            rightId={rightId}
            days={days}
            delivery={delivery}
            onDaysChange={(d) => setParam('days', String(d))}
            onDeliveryChange={(d) => setParam('delivery', d ? '1' : '0')}
          />
        )}

        {(!leftId || !rightId) && (
          <div className="rounded-xl border border-border bg-muted/50 p-8 text-center">
            <BarChart3 className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
            <p className="text-muted-foreground">اختر منتجين للمقارنة</p>
          </div>
        )}
      </PageContainer>
    </RTLLayout>
  );
};

/* --- Product Picker --- */
function ProductPicker({
  label,
  selectedId,
  onSelect,
}: {
  label: string;
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const { data: results, isLoading } = useProductSearch({ query });
  const [open, setOpen] = useState(false);

  const selected = results?.find((r) => r.product_id === selectedId);

  return (
    <Card className="border-border bg-card">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        {selectedId && selected ? (
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <p className="text-sm font-medium text-foreground">{selected.name_ar}</p>
              <p className="text-xs text-muted-foreground">{selected.category}</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => { onSelect(''); setOpen(true); }}>
              تغيير
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="relative">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type="search"
                value={query}
                onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
                onFocus={() => setOpen(true)}
                placeholder="ابحث عن منتج..."
                className="pr-9 text-sm bg-card border-border"
                aria-label={`بحث ${label}`}
              />
            </div>
            {open && query.length >= 2 && (
              <div className="border border-border rounded-lg bg-popover shadow-md max-h-48 overflow-y-auto z-50">
                {isLoading ? (
                  <div className="p-3"><Skeleton className="h-5 w-full" /></div>
                ) : !results?.length ? (
                  <p className="p-3 text-sm text-muted-foreground">لا توجد نتائج</p>
                ) : (
                  results.slice(0, 8).map((r) => (
                    <button
                      key={r.product_id}
                      onClick={() => { onSelect(r.product_id); setOpen(false); setQuery(''); }}
                      className="w-full text-start px-3 py-2 text-sm hover:bg-muted transition-colors text-foreground"
                    >
                      {r.name_ar}
                      {r.name_en && <span className="text-xs text-muted-foreground ms-2 ltr">{r.name_en}</span>}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* --- Compare Results --- */
function CompareResults({
  leftId,
  rightId,
  days,
  delivery,
  onDaysChange,
  onDeliveryChange,
}: {
  leftId: string;
  rightId: string;
  days: HistoryRange;
  delivery: boolean;
  onDaysChange: (d: HistoryRange) => void;
  onDeliveryChange: (d: boolean) => void;
}) {
  const leftHistory = useProductPriceHistory({ productId: leftId, days, includeDelivery: delivery });
  const rightHistory = useProductPriceHistory({ productId: rightId, days, includeDelivery: delivery });
  const serverProductCompare = useCompareProducts(leftId, rightId);
  const serverOffersLeft = useCompareOffers(leftId, null, true, 5);
  const serverOffersRight = useCompareOffers(rightId, null, true, 5);

  const leftPoints = leftHistory.data ?? [];
  const rightPoints = rightHistory.data ?? [];
  const isLoading = leftHistory.isLoading || rightHistory.isLoading;

  const mergedData = mergeChartData(leftPoints, rightPoints);

  const RANGE_OPTIONS: { value: HistoryRange; label: string }[] = [
    { value: 7, label: '7 أيام' },
    { value: 30, label: '30 يوم' },
    { value: 90, label: '90 يوم' },
    { value: 180, label: '180 يوم' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        {RANGE_OPTIONS.map((opt) => (
          <Button
            key={opt.value}
            variant={days === opt.value ? 'default' : 'outline'}
            size="sm"
            onClick={() => onDaysChange(opt.value)}
            className="text-xs"
          >
            {opt.label}
          </Button>
        ))}
        <Button
          variant={delivery ? 'default' : 'outline'}
          size="sm"
          className="text-xs"
          onClick={() => onDeliveryChange(!delivery)}
        >
          {delivery ? 'يشمل التوصيل' : 'بدون توصيل'}
        </Button>
      </div>

      <ServerComparisonCard
        data={serverProductCompare.data}
        loading={serverProductCompare.isLoading || serverProductCompare.isFetching}
        error={serverProductCompare.error ? (serverProductCompare.error as Error).message : null}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ServerOffersRankCard
          title="أفضل العروض (المنتج الأول)"
          data={serverOffersLeft.data}
          loading={serverOffersLeft.isLoading || serverOffersLeft.isFetching}
          error={serverOffersLeft.error ? (serverOffersLeft.error as Error).message : null}
        />
        <ServerOffersRankCard
          title="أفضل العروض (المنتج الثاني)"
          data={serverOffersRight.data}
          loading={serverOffersRight.isLoading || serverOffersRight.isFetching}
          error={serverOffersRight.error ? (serverOffersRight.error as Error).message : null}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <StatsCard label="المنتج الأول" points={leftPoints} loading={leftHistory.isLoading} productId={leftId} />
        <StatsCard label="المنتج الثاني" points={rightPoints} loading={rightHistory.isLoading} productId={rightId} />
      </div>

      {isLoading ? (
        <Skeleton className="h-64 w-full rounded-xl" />
      ) : mergedData.length > 0 ? (
        <div className="h-64 w-full rounded-xl border border-border bg-card p-2">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={mergedData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
              <XAxis
                dataKey="day"
                tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                tickFormatter={(v: string) => {
                  const d = new Date(v);
                  return `${d.getDate()}/${d.getMonth() + 1}`;
                }}
                axisLine={{ stroke: 'hsl(var(--border))' }}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                tickFormatter={(v: number) => formatIQDPrice(v)}
                axisLine={false}
                tickLine={false}
                width={65}
                orientation="right"
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'hsl(var(--card))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '0.5rem',
                  fontSize: '0.75rem',
                  direction: 'rtl',
                }}
                labelFormatter={(v: string) => new Date(v).toLocaleDateString('ar-IQ')}
                formatter={(value: number, name: string) => {
                  const labels: Record<string, string> = {
                    left_avg: 'المنتج الأول',
                    right_avg: 'المنتج الثاني',
                  };
                  return [`${formatIQDPrice(value)} د.ع`, labels[name] ?? name];
                }}
              />
              <Legend formatter={(value: string) => (value === 'left_avg' ? 'المنتج الأول' : 'المنتج الثاني')} />
              <Line type="monotone" dataKey="left_avg" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} name="left_avg" connectNulls />
              <Line type="monotone" dataKey="right_avg" stroke="hsl(var(--destructive))" strokeWidth={2} dot={false} name="right_avg" connectNulls />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-muted/50 p-6 text-center text-sm text-muted-foreground">
          لا توجد بيانات تاريخية للمقارنة
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <Link to={`/explore/${leftId}`}>
          <Button variant="outline" size="sm">عرض تفاصيل المنتج الأول</Button>
        </Link>
        <Link to={`/explore/${rightId}`}>
          <Button variant="outline" size="sm">عرض تفاصيل المنتج الثاني</Button>
        </Link>
      </div>
    </div>
  );
}

function ServerComparisonCard({ data, loading, error }: { data: any; loading?: boolean; error?: string | null }) {
  if (loading) {
    return (
      <Card className="border-border bg-card">
        <CardContent className="p-4 text-sm text-muted-foreground">جاري تحميل تحليل المقارنة من السيرفر...</CardContent>
      </Card>
    );
  }
  if (error) {
    return (
      <Card className="border-destructive/40 bg-card">
        <CardContent className="p-4 text-sm text-destructive">تعذر تحميل تحليل المقارنة: {error}</CardContent>
      </Card>
    );
  }
  if (!data) return null;

  const winnerRaw = String(data?.winner ?? '').toLowerCase();
  const winnerLabel = winnerRaw === 'a' ? 'المنتج الأول' : winnerRaw === 'b' ? 'المنتج الثاني' : 'تعادل';
  const totalA = Number(data?.scorecards?.product_a?.total ?? 0);
  const totalB = Number(data?.scorecards?.product_b?.total ?? 0);
  const priceDiff = Number(data?.price_difference_iqd ?? 0);
  const pct = Number(data?.percent_difference ?? 0);

  return (
    <Card className="border-border bg-card">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base">مقارنة ذكية من السيرفر</CardTitle>
          <Badge variant={winnerRaw && winnerRaw !== 'tie' ? 'default' : 'secondary'}>{winnerLabel}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {data?.recommendation ? (
          <div className="rounded-lg border border-border bg-muted/50 p-3 text-sm leading-6">
            {String(data.recommendation)}
          </div>
        ) : null}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="rounded-lg border border-border p-3">
            <div className="text-xs text-muted-foreground mb-1">المنتج الأول</div>
            <div className="text-lg font-semibold">{Number.isFinite(totalA) ? totalA.toFixed(1) : '0.0'}</div>
            <div className="text-xs text-muted-foreground">السكور الكلي</div>
          </div>
          <div className="rounded-lg border border-border p-3">
            <div className="text-xs text-muted-foreground mb-1">المنتج الثاني</div>
            <div className="text-lg font-semibold">{Number.isFinite(totalB) ? totalB.toFixed(1) : '0.0'}</div>
            <div className="text-xs text-muted-foreground">السكور الكلي</div>
          </div>
        </div>

        {(priceDiff || pct) ? (
          <div className="text-xs text-muted-foreground">
            فرق السعر التقريبي: {Math.abs(priceDiff).toLocaleString('en-US')} د.ع {pct ? `(≈ ${Math.abs(pct).toFixed(1)}%)` : ''}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ServerOffersRankCard({ title, data, loading, error }: { title: string; data: any; loading?: boolean; error?: string | null }) {
  return (
    <Card className="border-border bg-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="text-xs text-muted-foreground">جاري تحليل أفضل العروض...</div>
        ) : error ? (
          <div className="text-xs text-destructive">{error}</div>
        ) : !data?.offers?.length ? (
          <div className="text-xs text-muted-foreground">لا توجد عروض كافية للتحليل</div>
        ) : (
          <div className="space-y-2">
            {data.offers.slice(0, 3).map((offer: any, idx: number) => {
              const price = Number(offer?.final_price ?? 0);
              const delivery = Number(offer?.delivery_fee ?? 0);
              const totalScore = Number(offer?.comparison?.breakdown?.total ?? 0);
              const reasons = Array.isArray(offer?.comparison?.reasons) ? offer.comparison.reasons : [];
              const sourceName = offer?.merchant_name || offer?.source_name_ar || 'مصدر';
              return (
                <div key={String(offer?.offer_id ?? idx)} className="rounded-lg border border-border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Badge variant={idx === 0 ? 'default' : 'outline'}>#{idx + 1}</Badge>
                      <span className="text-sm font-medium">{String(sourceName)}</span>
                      {isSuspectedOffer(offer) ? <Badge variant="destructive">سعر مشتبه</Badge> : null}
                    </div>
                    <div className="text-sm font-semibold">{Number.isFinite(price) ? formatIQDPrice(price) : '—'} د.ع</div>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span>سكور: {Number.isFinite(totalScore) ? totalScore.toFixed(1) : '0.0'}</span>
                    {delivery > 0 ? <span>توصيل: {formatIQDPrice(delivery)} د.ع</span> : null}
                    {offer?.in_stock === false ? <span>غير متوفر</span> : null}
                  </div>
                  {reasons[0] ? <div className="mt-2 text-xs text-muted-foreground leading-5">{String(reasons[0])}</div> : null}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* --- Stats Card --- */
function StatsCard({
  label,
  points,
  loading,
  productId,
}: {
  label: string;
  points: { day: string; min_price: number; max_price: number; avg_price: number; offer_count: number; source_count: number }[];
  loading: boolean;
  productId: string;
}) {
  void productId;
  if (loading) return <Skeleton className="h-32 rounded-xl" />;
  if (!points.length) {
    return (
      <Card className="border-border bg-card">
        <CardContent className="p-4 text-sm text-muted-foreground text-center">لا بيانات</CardContent>
      </Card>
    );
  }

  const min = historyMin(points);
  const max = historyMax(points);
  const pct = calcPctChange(points);
  const trend = calcTrend(points);

  return (
    <Card className="border-border bg-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex flex-wrap gap-2">
          {min != null && (
            <Badge variant="secondary" className="text-xs">أقل: {formatIQDPrice(min)} د.ع</Badge>
          )}
          {max != null && (
            <Badge variant="secondary" className="text-xs">أعلى: {formatIQDPrice(max)} د.ع</Badge>
          )}
          {pct != null && (
            <Badge variant="outline" className={`text-xs ${trend === 'down' ? 'text-success' : trend === 'up' ? 'text-destructive' : 'text-muted-foreground'}`}>
              التغير: {pct > 0 ? '+' : ''}{pct}%
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/* --- Merge helper --- */
function mergeChartData(
  left: { day: string; avg_price: number }[],
  right: { day: string; avg_price: number }[],
) {
  const map = new Map<string, { day: string; left_avg?: number; right_avg?: number }>();
  for (const p of left) {
    map.set(p.day, { ...(map.get(p.day) || { day: p.day }), left_avg: p.avg_price });
  }
  for (const p of right) {
    map.set(p.day, { ...(map.get(p.day) || { day: p.day }), right_avg: p.avg_price });
  }
  return Array.from(map.values()).sort((a, b) => a.day.localeCompare(b.day));
}

export default ProductCompare;
