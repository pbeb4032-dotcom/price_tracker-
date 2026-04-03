/**
 * Watchlist — list all price alerts (alerts table) with current best price.
 * Arabic RTL.
 */

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell, Trash2, ExternalLink, RefreshCcw } from 'lucide-react';
import { RTLLayout, PageContainer } from '@/components/layout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { useAuth } from '@/lib/auth';
import { formatIQDPrice } from '@/lib/offers/normalization';
import { toast } from 'sonner';
import {
  useWatchlist,
  useUpdateWatchlistAlert,
  useDeleteWatchlistAlert,
  type WatchlistItem,
} from '@/hooks/offers/useWatchlist';

export default function WatchlistPage() {
  const { user } = useAuth();
  const { data: items = [], isLoading, isError, refetch, isFetching } = useWatchlist(user?.id);
  const update = useUpdateWatchlistAlert();
  const del = useDeleteWatchlistAlert();

  const activeCount = useMemo(() => items.filter((x) => x.is_active).length, [items]);

  if (!user) {
    return (
      <RTLLayout>
        <PageContainer className="py-8">
          <Card className="border-border bg-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <Bell className="h-4 w-4" />
                قائمة المراقبة
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                سجّل دخولك حتى تقدر تسوي تنبيهات أسعار وتتابعها.
              </p>
              <div className="mt-4">
                <Button asChild>
                  <Link to="/sign-in">تسجيل الدخول</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        </PageContainer>
      </RTLLayout>
    );
  }

  return (
    <RTLLayout>
      <PageContainer className="py-6 md:py-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-foreground">قائمة المراقبة</h1>
            <p className="text-sm text-muted-foreground">
              تنبيهاتك الفعّالة: {activeCount} / المجموع: {items.length}
            </p>
          </div>
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCcw className="h-4 w-4" />
            تحديث
          </Button>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full rounded-xl" />
            ))}
          </div>
        ) : isError ? (
          <Card className="border-border bg-card">
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              صار خطأ بتحميل قائمة المراقبة.
            </CardContent>
          </Card>
        ) : items.length === 0 ? (
          <Card className="border-border bg-card">
            <CardContent className="py-10 text-center">
              <p className="text-sm text-muted-foreground">ما عندك تنبيهات بعد.</p>
              <p className="text-xs text-muted-foreground mt-2">
                افتح أي منتج واضغط "إضافة تنبيه" حتى يوصلك إشعار إذا نزل السعر.
              </p>
              <div className="mt-4">
                <Button asChild>
                  <Link to="/explore">اذهب للاستكشاف</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {items.map((it) => (
              <WatchlistRow
                key={it.id}
                item={it}
                onToggle={async (isActive) => {
                  await update.mutateAsync({ id: it.id, userId: user.id, is_active: isActive });
                }}
                onUpdateTarget={async (target, includeDelivery) => {
                  await update.mutateAsync({ id: it.id, userId: user.id, target_price: target, include_delivery: includeDelivery });
                }}
                onDelete={async () => {
                  await del.mutateAsync({ id: it.id, userId: user.id });
                }}
              />
            ))}
          </div>
        )}

        <div className="mt-8 text-xs text-muted-foreground">
          ملاحظة: التنبيهات تُولد تلقائيًا (Notifications) عند تحقق الشرط. افتح "الإشعارات" لمشاهدة آخر التنبيهات.
        </div>
      </PageContainer>
    </RTLLayout>
  );
}

function WatchlistRow({
  item,
  onToggle,
  onUpdateTarget,
  onDelete,
}: {
  item: WatchlistItem;
  onToggle: (active: boolean) => Promise<void>;
  onUpdateTarget: (target: number, includeDelivery: boolean) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [target, setTarget] = useState(String(item.target_price ?? ''));
  const [includeDelivery, setIncludeDelivery] = useState(Boolean(item.include_delivery));
  const [saving, setSaving] = useState(false);

  const best = item.current_best_price != null ? Number(item.current_best_price) : null;
  const wouldTrigger = Boolean(item.would_trigger_now);

  const productName = item.product_name_ar ?? 'منتج';
  const img = item.product_image_url ?? undefined;

  const onSave = async () => {
    const v = Number(target);
    if (!v || v <= 0) {
      toast.error('اكتب سعر مستهدف صحيح');
      return;
    }
    setSaving(true);
    try {
      await onUpdateTarget(v, includeDelivery);
      toast.success('تم تحديث التنبيه');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="border-border bg-card" data-testid="watchlist-row">
      <CardContent className="p-4">
        <div className="flex gap-3">
          <div className="w-16 h-16 rounded-lg overflow-hidden bg-muted flex-shrink-0">
            {img ? (
              <img src={img} alt={productName} className="w-full h-full object-cover" loading="lazy" />
            ) : null}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-sm font-semibold text-foreground truncate">{productName}</h3>
                  {item.product_category ? <Badge variant="secondary">{item.product_category}</Badge> : null}
                  {item.product_unit ? <Badge variant="outline">{item.product_unit}</Badge> : null}
                  {wouldTrigger ? (
                    <Badge className="bg-primary text-primary-foreground">وصل للهدف</Badge>
                  ) : item.is_active ? (
                    <Badge variant="default">فعال</Badge>
                  ) : (
                    <Badge variant="secondary">متوقف</Badge>
                  )}
                </div>

                <div className="mt-2 text-xs text-muted-foreground flex flex-wrap gap-2">
                  <span>
                    السعر الحالي: <span className="text-foreground font-medium">{best != null ? `${formatIQDPrice(best)} د.ع` : 'غير متوفر'}</span>
                  </span>
                  {item.current_best_source_domain ? (
                    <span>
                      المصدر: <span className="text-foreground">{item.current_best_source_domain}</span>
                    </span>
                  ) : null}
                </div>
              </div>

              <Button asChild variant="ghost" size="sm" className="gap-1">
                <Link to={`/explore/${item.product_id}`}>
                  <ExternalLink className="h-4 w-4" />
                  فتح
                </Link>
              </Button>
            </div>

            <div className="mt-4 flex flex-col md:flex-row gap-3 md:items-center">
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={1}
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  className="w-44 bg-background border-border"
                  placeholder="السعر المستهدف"
                />
                <Button size="sm" onClick={onSave} disabled={saving}>
                  تحديث
                </Button>
              </div>

              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Switch checked={includeDelivery} onCheckedChange={setIncludeDelivery} />
                <span>تضمين التوصيل</span>
              </div>

              <div className="flex-1" />

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    await onToggle(!item.is_active);
                    toast.success(item.is_active ? 'تم إيقاف التنبيه' : 'تم تفعيل التنبيه');
                  }}
                >
                  {item.is_active ? 'إيقاف' : 'تفعيل'}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive"
                  onClick={async () => {
                    await onDelete();
                    toast.success('تم حذف التنبيه');
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
