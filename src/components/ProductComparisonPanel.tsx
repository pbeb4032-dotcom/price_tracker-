/**
 * ProductComparisonPanel — shows side-by-side comparison of up to 3 selected price rows.
 */

import { AlertTriangle, X } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import type { TrustedPrice } from '@/lib/prices/types';
import { getRegionLabel, getCategoryLabel } from '@/lib/prices/labels';
import type { CompareResult } from '@/lib/pricesCompareUtils';

interface Props {
  comparison: CompareResult;
  onClear: () => void;
}

import { formatPrice, formatDate } from '@/lib/prices/formatters';

export default function ProductComparisonPanel({ comparison, onClear }: Props) {
  if (comparison.rows.length === 0) return null;

  return (
    <Card className="mb-6" data-testid="comparison-panel">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-base">
          <span className="flex items-center gap-2">
            مقارنة المنتجات
            <Badge variant="secondary" className="text-xs">{comparison.rows.length}</Badge>
          </span>
          <Button variant="ghost" size="sm" onClick={onClear} className="gap-1 text-xs">
            <X className="h-3 w-3" />
            مسح التحديد
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {comparison.hasUnitMismatch && (
          <div className="flex items-center gap-2 text-sm text-destructive mb-3" data-testid="unit-mismatch-warning">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            <span>تنبيه: المنتجات المحددة تستخدم وحدات قياس مختلفة ({comparison.units.join('، ')})</span>
          </div>
        )}
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-right">المنتج</TableHead>
                <TableHead className="text-right">المنطقة</TableHead>
                <TableHead className="text-right">الفئة</TableHead>
                <TableHead className="text-right">الوحدة</TableHead>
                <TableHead className="text-right">أقل سعر</TableHead>
                <TableHead className="text-right">متوسط السعر</TableHead>
                <TableHead className="text-right">أعلى سعر</TableHead>
                <TableHead className="text-center">العينات</TableHead>
                <TableHead className="text-right">آخر تحديث</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {comparison.rows.map((row) => (
                <TableRow key={`${row.product_id}-${row.region_id}-${row.unit}`}>
                  <TableCell className="font-medium">{row.product_name_ar}</TableCell>
                  <TableCell>{getRegionLabel(row.region_name_ar, row.region_name_en)}</TableCell>
                  <TableCell>{getCategoryLabel(row.category)}</TableCell>
                  <TableCell>{row.unit === 'kg' ? 'كغم' : row.unit}</TableCell>
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
  );
}
