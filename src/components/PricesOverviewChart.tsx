/**
 * PricesOverviewChart — Lightweight SVG bar chart showing top 10 products by avg price.
 * No external chart library. Arabic RTL labels. Responsive.
 */

import { useMemo } from 'react';
import type { TrustedPrice } from '@/lib/prices/types';

interface Props {
  rows: TrustedPrice[];
}

interface BarData {
  label: string;
  value: number;
}

export function preparePricesChartData(rows: TrustedPrice[]): BarData[] {
  if (rows.length === 0) return [];

  // Aggregate avg price per product (by product_id)
  const map = new Map<string, { label: string; total: number; count: number }>();
  for (const r of rows) {
    const existing = map.get(r.product_id);
    if (existing) {
      existing.total += r.avg_price_iqd;
      existing.count += 1;
    } else {
      map.set(r.product_id, { label: r.product_name_ar || r.product_name_en || '—', total: r.avg_price_iqd, count: 1 });
    }
  }

  const items: BarData[] = [];
  for (const v of map.values()) {
    items.push({ label: v.label, value: Math.round(v.total / v.count) });
  }

  items.sort((a, b) => b.value - a.value);
  return items.slice(0, 10);
}

export default function PricesOverviewChart({ rows }: Props) {
  const bars = useMemo(() => preparePricesChartData(rows), [rows]);

  if (bars.length === 0) {
    return (
      <div className="text-center py-6 text-sm text-muted-foreground" data-testid="chart-empty">
        لا توجد بيانات كافية لعرض الرسم البياني.
      </div>
    );
  }

  const maxValue = Math.max(...bars.map((b) => b.value));
  const barHeight = 32;
  const labelWidth = 120;
  const valueWidth = 80;
  const chartWidth = 400;
  const svgWidth = labelWidth + chartWidth + valueWidth + 16;
  const svgHeight = bars.length * (barHeight + 8) + 8;

  return (
    <div className="mb-6" data-testid="prices-chart">
      <h3 className="text-sm font-semibold text-foreground mb-3">
        أعلى 10 منتجات حسب متوسط السعر (د.ع)
      </h3>
      <div className="overflow-x-auto">
        <svg
          width={svgWidth}
          height={svgHeight}
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          className="block"
          role="img"
          aria-label="رسم بياني لأسعار المنتجات"
        >
          {bars.map((bar, i) => {
            const y = i * (barHeight + 8) + 4;
            const barW = maxValue > 0 ? (bar.value / maxValue) * chartWidth : 0;

            return (
              <g key={bar.label + i}>
                {/* Label — right-aligned for RTL */}
                <text
                  x={labelWidth - 4}
                  y={y + barHeight / 2 + 5}
                  textAnchor="end"
                  className="fill-foreground text-xs"
                  style={{ fontSize: '11px' }}
                >
                  {bar.label.length > 14 ? bar.label.slice(0, 13) + '…' : bar.label}
                </text>
                {/* Bar */}
                <rect
                  x={labelWidth}
                  y={y}
                  width={Math.max(barW, 2)}
                  height={barHeight}
                  rx={4}
                  className="fill-primary/70"
                />
                {/* Value */}
                <text
                  x={labelWidth + barW + 6}
                  y={y + barHeight / 2 + 5}
                  textAnchor="start"
                  className="fill-muted-foreground text-xs"
                  style={{ fontSize: '11px' }}
                >
                  {bar.value.toLocaleString('ar-IQ')}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
