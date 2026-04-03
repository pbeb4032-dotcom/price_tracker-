/**
 * PriceCardView — Mobile-friendly card layout for price rows.
 * Shown on small screens instead of the data table.
 * Preserves comparison checkbox and alert button behavior.
 */

import { Link } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import type { TrustedPrice } from '@/lib/prices/types';
import { getRegionLabel, getCategoryLabel } from '@/lib/prices/labels';
import { rowKey, MAX_COMPARE } from '@/lib/pricesCompareUtils';

interface Props {
  rows: TrustedPrice[];
  compareKeys: Set<string>;
  onToggleCompare: (key: string) => void;
  onAlertPrefill: (prefill: { product_id: string; product_name_ar: string; region_id: string; region_name_ar: string }) => void;
}

import { formatPrice, formatDate } from '@/lib/prices/formatters';

export default function PriceCardView({ rows, compareKeys, onToggleCompare, onAlertPrefill }: Props) {
  if (rows.length === 0) return null;

  return (
    <div className="grid grid-cols-1 xs:grid-cols-2 gap-3" data-testid="prices-card-view">
      {rows.map((row) => {
        const key = rowKey(row);
        const region = getRegionLabel(row.region_name_ar, row.region_name_en);
        return (
          <Card key={`${row.product_id}-${row.region_id}-${row.unit}`} className="relative">
            <CardContent className="p-3 space-y-2">
              {/* Header: name + actions */}
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <Link
                    to={`/products/${row.product_id}`}
                    className="font-semibold text-sm text-foreground hover:text-primary hover:underline transition-colors block truncate"
                  >
                    {row.product_name_ar || row.product_name_en || '—'}
                  </Link>
                  <div className="flex flex-wrap items-center gap-1 mt-0.5">
                    <span className="text-xs text-muted-foreground">{region}</span>
                    <span className="text-xs text-muted-foreground">·</span>
                    <span className="text-xs text-muted-foreground">
                      {row.unit === 'kg' ? 'كغم' : row.unit}
                    </span>
                    {row.category && (
                      <>
                        <span className="text-xs text-muted-foreground">·</span>
                        <span className="text-xs text-muted-foreground">{getCategoryLabel(row.category)}</span>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <Checkbox
                    checked={compareKeys.has(key)}
                    disabled={!compareKeys.has(key) && compareKeys.size >= MAX_COMPARE}
                    onCheckedChange={() => onToggleCompare(key)}
                    aria-label={`قارن ${row.product_name_ar}`}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0"
                    onClick={() => onAlertPrefill({
                      product_id: row.product_id,
                      product_name_ar: row.product_name_ar,
                      region_id: row.region_id,
                      region_name_ar: region,
                    })}
                    aria-label={`تنبيه ${row.product_name_ar}`}
                  >
                    <Bell className="h-3 w-3" />
                  </Button>
                </div>
              </div>

              {/* Price grid */}
              <div className="grid grid-cols-3 gap-1 text-center">
                <div>
                  <div className="text-[10px] text-muted-foreground">أقل</div>
                  <div className="text-xs font-bold text-primary">{formatPrice(row.min_price_iqd)}</div>
                </div>
                <div>
                  <div className="text-[10px] text-muted-foreground">متوسط</div>
                  <div className="text-xs font-semibold">{formatPrice(row.avg_price_iqd)}</div>
                </div>
                <div>
                  <div className="text-[10px] text-muted-foreground">أعلى</div>
                  <div className="text-xs font-semibold">{formatPrice(row.max_price_iqd)}</div>
                </div>
              </div>

              {/* Footer: samples + date */}
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Badge variant="outline" className="text-[10px] px-1 py-0">{row.sample_count}</Badge>
                  عينة
                </span>
                <span>{row.last_observed_at ? formatDate(row.last_observed_at) : '—'}</span>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
