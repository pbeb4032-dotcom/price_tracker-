/**
 * Historical price chart for a product.
 * RTL-friendly, semantic tokens only, responsive.
 */

import { useState } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Area,
  ComposedChart,
} from 'recharts';
import { TrendingUp, TrendingDown, Minus, Truck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useProductPriceHistory } from '@/hooks/offers/useProductPriceHistory';
import { useProductRegions } from '@/hooks/offers/useProductRegions';
import {
  calcTrend,
  calcPctChange,
  historyMin,
  historyMax,
  totalSources,
  type HistoryRange,
} from '@/lib/offers/history';
import { formatIQDPrice } from '@/lib/offers/normalization';

interface PriceHistoryChartProps {
  productId: string;
  regionId?: string | null;
  onRegionChange?: (regionId: string | null) => void;
}

const RANGE_OPTIONS: { value: HistoryRange; label: string }[] = [
  { value: 7, label: '7 أيام' },
  { value: 30, label: '30 يوم' },
  { value: 90, label: '90 يوم' },
  { value: 180, label: '180 يوم' },
];

export function PriceHistoryChart({ productId, regionId: externalRegionId, onRegionChange }: PriceHistoryChartProps) {
  const [days, setDays] = useState<HistoryRange>(30);
  const [includeDelivery, setIncludeDelivery] = useState(false);
  const [internalRegionId, setInternalRegionId] = useState<string | null>(null);

  const regionId = externalRegionId !== undefined ? externalRegionId : internalRegionId;
  const handleRegionChange = (val: string) => {
    const newVal = val === '__all__' ? null : val;
    if (onRegionChange) onRegionChange(newVal);
    else setInternalRegionId(newVal);
  };

  const { data: regions } = useProductRegions(productId);

  const { data: points, isLoading, error } = useProductPriceHistory({
    productId,
    days,
    includeDelivery,
    regionId,
  });

  if (isLoading) return <PriceHistoryChartSkeleton />;
  if (error) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        حدث خطأ في تحميل بيانات الأسعار التاريخية
      </div>
    );
  }
  if (!points || points.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-muted/50 p-6 text-center text-sm text-muted-foreground">
        لا توجد بيانات تاريخية للأسعار لهذه الفترة
      </div>
    );
  }

  const trend = calcTrend(points);
  const pctChange = calcPctChange(points);
  const minPrice = historyMin(points);
  const maxPrice = historyMax(points);
  const sources = totalSources(points);

  const TrendIcon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : Minus;
  const trendColor =
    trend === 'down' ? 'text-success' : trend === 'up' ? 'text-destructive' : 'text-muted-foreground';

  return (
    <section className="space-y-4" aria-label="تاريخ الأسعار">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <h2 className="text-lg font-semibold text-foreground">تاريخ الأسعار</h2>
        <div className="flex flex-wrap items-center gap-2">
          {RANGE_OPTIONS.map((opt) => (
            <Button
              key={opt.value}
              variant={days === opt.value ? 'default' : 'outline'}
              size="sm"
              onClick={() => setDays(opt.value)}
              className="text-xs"
            >
              {opt.label}
            </Button>
          ))}
        </div>
      </div>

      {/* Delivery toggle */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Switch
          checked={includeDelivery}
          onCheckedChange={setIncludeDelivery}
          aria-label="تضمين رسوم التوصيل"
        />
        <Truck className="h-4 w-4" />
        <span>تضمين رسوم التوصيل</span>
      </div>

      {/* Region filter */}
      {regions && regions.length > 0 && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">المنطقة:</span>
          <Select value={regionId ?? '__all__'} onValueChange={handleRegionChange}>
            <SelectTrigger className="w-40 h-8 text-xs bg-card border-border" aria-label="فلتر المنطقة">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-popover border-border z-50">
              <SelectItem value="__all__">كل العراق</SelectItem>
              {regions.map((r) => (
                <SelectItem key={r.id} value={r.id}>{r.name_ar}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Summary badges */}
      <div className="flex flex-wrap gap-2">
        {minPrice != null && (
          <Badge variant="secondary" className="text-xs gap-1">
            أقل سعر: {formatIQDPrice(minPrice)} د.ع
          </Badge>
        )}
        {maxPrice != null && (
          <Badge variant="secondary" className="text-xs gap-1">
            أعلى سعر: {formatIQDPrice(maxPrice)} د.ع
          </Badge>
        )}
        {pctChange != null && (
          <Badge variant="outline" className={`text-xs gap-1 ${trendColor}`}>
            <TrendIcon className="h-3 w-3" />
            التغير: {pctChange > 0 ? '+' : ''}{pctChange}%
          </Badge>
        )}
        <Badge variant="outline" className="text-xs">
          {sources} مصدر
        </Badge>
      </div>

      {/* Chart */}
      <div className="h-64 w-full rounded-xl border border-border bg-card p-2">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={points} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
            <defs>
              <linearGradient id="priceRange" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.15} />
                <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0.02} />
              </linearGradient>
            </defs>
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
                  avg_price: 'المتوسط',
                  min_price: 'الأقل',
                  max_price: 'الأعلى',
                };
                return [`${formatIQDPrice(value)} د.ع`, labels[name] ?? name];
              }}
            />
            <Area
              type="monotone"
              dataKey="max_price"
              stroke="none"
              fill="url(#priceRange)"
              fillOpacity={1}
            />
            <Line
              type="monotone"
              dataKey="min_price"
              stroke="hsl(var(--muted-foreground))"
              strokeWidth={1}
              strokeDasharray="4 4"
              dot={false}
              name="min_price"
            />
            <Line
              type="monotone"
              dataKey="max_price"
              stroke="hsl(var(--muted-foreground))"
              strokeWidth={1}
              strokeDasharray="4 4"
              dot={false}
              name="max_price"
            />
            <Line
              type="monotone"
              dataKey="avg_price"
              stroke="hsl(var(--primary))"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, fill: 'hsl(var(--primary))' }}
              name="avg_price"
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

function PriceHistoryChartSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-6 w-32" />
      <div className="flex gap-2">
        <Skeleton className="h-7 w-16" />
        <Skeleton className="h-7 w-16" />
        <Skeleton className="h-7 w-16" />
        <Skeleton className="h-7 w-16" />
      </div>
      <Skeleton className="h-64 w-full rounded-xl" />
    </div>
  );
}
