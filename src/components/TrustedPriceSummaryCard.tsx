/**
 * Shkad Aadel — TrustedPriceSummaryCard
 *
 * Read-only card for Dashboard showing market averages
 * from v_trusted_price_summary. Shows empty state when no data.
 */

import { useState, useEffect, useCallback } from 'react';
import { Loader2, RefreshCw, BarChart3, AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useTelemetry } from '@/lib/telemetry';
import { USE_API } from '@/integrations/dataMode';
import { apiGet } from '@/integrations/api/client';
import { supabase } from '@/integrations/supabase/client';

interface SummaryRow {
  product_name_ar: string;
  region_name_ar: string;
  avg_price_iqd: number;
  min_price_iqd: number;
  max_price_iqd: number;
  sample_count: number;
  last_observed_at: string;
  unit: string;
}

export default function TrustedPriceSummaryCard() {
  const telemetry = useTelemetry();
  const [rows, setRows] = useState<SummaryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(false);

    try {
      let data: any[] = [];

      if (USE_API) {
        data = await apiGet<any[]>(`/views/trusted_price_summary?limit=10`);
      } else {
        const { data: sbData, error: fetchError } = await supabase
          .from('v_trusted_price_summary')
          .select('product_name_ar, region_name_ar, avg_price_iqd, min_price_iqd, max_price_iqd, sample_count, last_observed_at, unit')
          .order('product_name_ar')
          .limit(10);

        if (fetchError) throw fetchError;
        data = sbData ?? [];
      }

      const mapped: SummaryRow[] = (data ?? []).map((r) => ({
        product_name_ar: (r as Record<string, unknown>).product_name_ar as string ?? '—',
        region_name_ar: (r as Record<string, unknown>).region_name_ar as string ?? '—',
        avg_price_iqd: Number((r as Record<string, unknown>).avg_price_iqd ?? 0),
        min_price_iqd: Number((r as Record<string, unknown>).min_price_iqd ?? 0),
        max_price_iqd: Number((r as Record<string, unknown>).max_price_iqd ?? 0),
        sample_count: Number((r as Record<string, unknown>).sample_count ?? 0),
        last_observed_at: (r as Record<string, unknown>).last_observed_at as string ?? '',
        unit: (r as Record<string, unknown>).unit as string ?? 'kg',
      }));

      setRows(mapped);

      telemetry.trackEvent('trusted_prices_view_loaded', {
        status: mapped.length > 0 ? 'ok' : 'empty',
      });
    } catch {
      setError(true);
      telemetry.trackEvent('trusted_prices_view_failed', {
        error_code: 'DASHBOARD_FETCH_FAILED',
      });
    } finally {
      setLoading(false);
    }
  }, [telemetry]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  return (
    <Card data-testid="trusted-price-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <BarChart3 className="h-5 w-5 text-primary" />
          متوسط السوق من مصادر موثقة
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading && (
          <div className="flex items-center justify-center py-8" role="status">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        )}

        {!loading && error && (
          <div className="flex items-center gap-3 py-4" role="alert" data-testid="trusted-price-error">
            <AlertTriangle className="h-5 w-5 text-destructive flex-shrink-0" />
            <p className="text-sm text-destructive flex-1">
              حدث خطأ أثناء تحميل بيانات الأسعار.
            </p>
            <Button variant="outline" size="sm" onClick={loadData} className="gap-1 flex-shrink-0">
              <RefreshCw className="h-3 w-3" />
              إعادة
            </Button>
          </div>
        )}

        {!loading && !error && rows.length === 0 && (
          <div className="text-center py-8" data-testid="trusted-price-empty">
            <p className="text-muted-foreground text-sm">
              لا توجد بيانات موثقة كافية حالياً.
            </p>
          </div>
        )}

        {!loading && !error && rows.length > 0 && (
          <div className="space-y-3" data-testid="trusted-price-list">
            {rows.map((row, i) => (
              <div
                key={i}
                className="flex items-center justify-between border-b border-border pb-2 last:border-0 last:pb-0"
              >
                <div>
                  <span className="font-medium text-foreground text-sm">{row.product_name_ar}</span>
                  <span className="text-muted-foreground text-xs mx-2">
                    ({row.unit === 'kg' ? 'كغم' : row.unit})
                  </span>
                  <span className="text-muted-foreground text-xs">{row.region_name_ar}</span>
                </div>
                <div className="text-primary font-bold text-sm">
                  {Number(row.avg_price_iqd).toLocaleString('ar-IQ')} د.ع
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
