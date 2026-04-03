/**
 * PriceAlertsCard — DB-backed price alert management for a product.
 * Requires authentication. Arabic RTL, semantic tokens only.
 */

import { useState } from 'react';
import { Bell, Trash2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { formatIQDPrice } from '@/lib/offers/normalization';
import {
  usePriceAlerts,
  useCreatePriceAlert,
  useDeletePriceAlert,
  useTogglePriceAlert,
} from '@/hooks/offers/usePriceAlerts';
import { useAuth } from '@/lib/auth';

interface PriceAlertsCardProps {
  productId: string;
  regionId?: string | null;
}

export function PriceAlertsCard({ productId, regionId }: PriceAlertsCardProps) {
  const [target, setTarget] = useState('');
  const [includeDelivery, setIncludeDelivery] = useState(false);
  const { user } = useAuth();

  const { data: alerts = [], isLoading } = usePriceAlerts(productId);
  const createAlert = useCreatePriceAlert();
  const toggleAlert = useTogglePriceAlert();
  const deleteAlert = useDeletePriceAlert();

  const onCreate = async () => {
    const value = Number(target);
    if (!value || value <= 0 || !user) return;
    await createAlert.mutateAsync({
      product_id: productId,
      target_price: value,
      region_id: regionId ?? null,
      include_delivery: includeDelivery,
      user_id: user.id,
    });
    setTarget('');
  };

  if (!user) {
    return (
      <Card className="border-border bg-card" data-testid="price-alerts-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Bell className="h-4 w-4" />
            تنبيه الأسعار
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-3">
            سجّل دخولك لإنشاء تنبيهات أسعار
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border bg-card" data-testid="price-alerts-card">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Bell className="h-4 w-4" />
          تنبيه الأسعار
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Create form */}
        <div className="flex flex-col sm:flex-row gap-2">
          <Input
            type="number"
            min={1}
            placeholder="السعر المستهدف (د.ع)"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className="bg-background border-border flex-1"
            aria-label="السعر المستهدف"
          />
          <Button
            size="sm"
            onClick={onCreate}
            disabled={!target || Number(target) <= 0 || createAlert.isPending}
          >
            إضافة تنبيه
          </Button>
        </div>

        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Switch
            checked={includeDelivery}
            onCheckedChange={setIncludeDelivery}
            aria-label="تضمين رسوم التوصيل في التنبيه"
          />
          <span>تضمين رسوم التوصيل</span>
        </div>

        {/* Alerts list */}
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : alerts.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-2">
            ما عندك تنبيهات لهذا المنتج
          </p>
        ) : (
          <div className="space-y-2">
            {alerts.map((a) => (
              <div
                key={a.id}
                className="flex items-center justify-between gap-2 border border-border rounded-lg px-3 py-2"
              >
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <Badge
                    variant={a.is_active ? 'default' : 'secondary'}
                    className="text-xs shrink-0"
                  >
                    {a.is_active ? 'فعال' : 'متوقف'}
                  </Badge>
                  <span className="text-sm text-foreground truncate">
                    عند ≤ {formatIQDPrice(a.target_price ?? 0)} د.ع
                  </span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs h-7 px-2"
                    onClick={() => toggleAlert.mutate({ id: a.id, is_active: !a.is_active, product_id: productId })}
                  >
                    {a.is_active ? 'إيقاف' : 'تفعيل'}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs h-7 px-2 text-destructive"
                    onClick={() => deleteAlert.mutate({ id: a.id, product_id: productId })}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
