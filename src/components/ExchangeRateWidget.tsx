/**
 * Iraqi exchange rate widget — shows CBI + market rates with converter.
 */

import { useState, useMemo } from 'react';
import { TrendingUp, TrendingDown, RefreshCw, ArrowLeftRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useExchangeRates, getLatestRate } from '@/hooks/prices/useExchangeRates';
import { convertUsdToIqd, convertIqdToUsd } from '@/lib/prices/priceParser';
import { Skeleton } from '@/components/ui/skeleton';

export function ExchangeRateWidget() {
  const { data: rates, isLoading } = useExchangeRates();
  const [converterInput, setConverterInput] = useState('');
  const [converterDirection, setConverterDirection] = useState<'iqd_to_usd' | 'usd_to_iqd'>('iqd_to_usd');
  const [rateType, setRateType] = useState<'market' | 'gov'>('market');

  const govRate = useMemo(() => rates ? getLatestRate(rates, 'gov') : null, [rates]);
  const marketRate = useMemo(() => rates ? getLatestRate(rates, 'market') : null, [rates]);
  const activeRate = rateType === 'market' ? marketRate : govRate;

  const fmtUpdated = (ts?: string | null) => {
    if (!ts) return null;
    const ms = Date.parse(ts);
    if (!Number.isFinite(ms)) return null;
    try {
      return new Date(ms).toLocaleString('ar-IQ');
    } catch {
      return ts;
    }
  };

  const sampleCount = (rate: any) => {
    const src = rate?.meta?.sources;
    if (!Array.isArray(src)) return null;
    const ok = src.filter((s: any) => s && (s.ok === true || s.ok === 'true') && typeof s.mid === 'number').length;
    return ok > 0 ? ok : src.length;
  };

  const converted = useMemo(() => {
    const val = parseFloat(converterInput);
    if (!Number.isFinite(val) || val <= 0 || !activeRate) return null;
    if (converterDirection === 'iqd_to_usd') {
      return convertIqdToUsd(val, activeRate.mid_iqd_per_usd);
    }
    return convertUsdToIqd(val, activeRate.mid_iqd_per_usd);
  }, [converterInput, converterDirection, activeRate]);

  if (isLoading) {
    return (
      <Card>
        <CardHeader><Skeleton className="h-6 w-48" /></CardHeader>
        <CardContent><Skeleton className="h-24 w-full" /></CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <TrendingUp className="h-5 w-5 text-primary" />
          سعر صرف الدولار في العراق
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Rate cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* Government rate */}
          <div
            className={`rounded-lg border p-3 cursor-pointer transition-colors ${
              rateType === 'gov' ? 'border-primary bg-primary/5' : 'border-border'
            }`}
            onClick={() => setRateType('gov')}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-muted-foreground">السعر الرسمي</span>
              <Badge variant="outline" className="text-[10px]">البنك المركزي</Badge>
            </div>
            {govRate ? (
              <>
                <div className="text-xl font-bold text-foreground">
                  {Math.round(Number(govRate.mid_iqd_per_usd)).toLocaleString('ar-IQ')} <span className="text-sm font-normal text-muted-foreground">د.ع / $</span>
                </div>
                <div className="text-[10px] text-muted-foreground mt-1">
                  {govRate.rate_date}
                  {fmtUpdated(govRate.created_at) ? ` · آخر تحديث: ${fmtUpdated(govRate.created_at)}` : ''}
                  {sampleCount(govRate) ? ` · مصادر: ${sampleCount(govRate)}` : ''}
                </div>
              </>
            ) : (
              <span className="text-sm text-muted-foreground">غير متوفر</span>
            )}
          </div>

          {/* Market rate */}
          <div
            className={`rounded-lg border p-3 cursor-pointer transition-colors ${
              rateType === 'market' ? 'border-primary bg-primary/5' : 'border-border'
            }`}
            onClick={() => setRateType('market')}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-muted-foreground">سعر السوق</span>
              <Badge variant="outline" className="text-[10px]">الصرافين</Badge>
            </div>
            {marketRate ? (
              <>
                <div className="text-xl font-bold text-foreground">
                  {Math.round(Number(marketRate.mid_iqd_per_usd)).toLocaleString('ar-IQ')} <span className="text-sm font-normal text-muted-foreground">د.ع / $</span>
                </div>
                {marketRate.buy_iqd_per_usd && marketRate.sell_iqd_per_usd && (
                  <div className="flex gap-2 text-[10px] text-muted-foreground mt-1">
                    <span>شراء: {Math.round(Number(marketRate.buy_iqd_per_usd)).toLocaleString('ar-IQ')}</span>
                    <span>بيع: {Math.round(Number(marketRate.sell_iqd_per_usd)).toLocaleString('ar-IQ')}</span>
                  </div>
                )}
                <div className="text-[10px] text-muted-foreground mt-1">
                  {marketRate.rate_date}
                  {fmtUpdated(marketRate.created_at) ? ` · آخر تحديث: ${fmtUpdated(marketRate.created_at)}` : ''}
                  {sampleCount(marketRate) ? ` · مصادر: ${sampleCount(marketRate)}` : ''}
                </div>
              </>
            ) : (
              <span className="text-sm text-muted-foreground">غير متوفر</span>
            )}
          </div>
        </div>

        {/* Converter */}
        <div className="rounded-lg border border-border p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-foreground">محوّل العملة</span>
            <Badge variant="secondary" className="text-[10px]">
              {rateType === 'market' ? 'حسب سعر السوق' : 'حسب السعر الرسمي'}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <Input
                type="number"
                placeholder={converterDirection === 'iqd_to_usd' ? 'المبلغ بالدينار' : 'المبلغ بالدولار'}
                value={converterInput}
                onChange={(e) => setConverterInput(e.target.value)}
                className="text-left"
                dir="ltr"
              />
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setConverterDirection(
                converterDirection === 'iqd_to_usd' ? 'usd_to_iqd' : 'iqd_to_usd'
              )}
              aria-label="عكس التحويل"
            >
              <ArrowLeftRight className="h-4 w-4" />
            </Button>
            <div className="flex-1 text-left" dir="ltr">
              {converted !== null ? (
                <div className="font-bold text-foreground text-lg">
                  {converterDirection === 'iqd_to_usd'
                    ? `$${converted.toLocaleString('en-US')}`
                    : `${converted.toLocaleString('ar-IQ')} د.ع`
                  }
                </div>
              ) : (
                <span className="text-sm text-muted-foreground">—</span>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
