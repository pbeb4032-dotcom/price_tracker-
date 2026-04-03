import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell, CheckCheck } from 'lucide-react';
import { RTLLayout } from '@/components/layout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/lib/auth/AuthProvider';
import {
  useNotifications,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
} from '@/hooks/offers/useNotifications';
import { formatIQDPrice } from '@/lib/offers/normalization';

export default function NotificationsPage() {
  const { user } = useAuth();
  const [unreadOnly, setUnreadOnly] = useState(false);

  const { data: notifications = [], isLoading } = useNotifications({
    userId: user?.id,
    limit: 100,
    unreadOnly,
  });

  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead(user?.id);

  if (!user) {
    return (
      <RTLLayout>
        <div className="container mx-auto px-4 py-16 text-center">
          <Bell className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <h1 className="text-2xl font-bold text-foreground mb-2">الإشعارات</h1>
          <p className="text-muted-foreground">سجّل دخولك حتى تشوف إشعاراتك.</p>
          <Link to="/sign-in">
            <Button className="mt-4">تسجيل الدخول</Button>
          </Link>
        </div>
      </RTLLayout>
    );
  }

  return (
    <RTLLayout>
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-foreground">الإشعارات</h1>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setUnreadOnly((v) => !v)}
            >
              {unreadOnly ? 'عرض الكل' : 'غير المقروء فقط'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => markAll.mutate()}
              disabled={markAll.isPending}
              className="gap-1"
            >
              <CheckCheck className="h-4 w-4" />
              تحديد الكل كمقروء
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">آخر التنبيهات</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {isLoading ? (
              <>
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-20 w-full" />
              </>
            ) : notifications.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Bell className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>لا توجد إشعارات</p>
              </div>
            ) : (
              notifications.map((n) => {
                const productId = (n.payload?.product_id as string) ?? null;
                const matched = n.payload?.matched_price as number | undefined;
                const target = n.payload?.target_price as number | undefined;

                return (
                  <div
                    key={n.id}
                    className={`p-4 rounded-lg border transition-colors ${
                      !n.is_read
                        ? 'bg-primary/5 border-primary/20'
                        : 'bg-card border-border'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium text-sm text-foreground">
                        {n.title_ar}
                      </p>
                      {!n.is_read && (
                        <Badge variant="default" className="text-[10px] px-1.5 py-0.5 shrink-0">
                          جديد
                        </Badge>
                      )}
                    </div>

                    <p className="text-sm text-muted-foreground mt-1">
                      {n.body_ar}
                    </p>

                    {(matched != null || target != null) && (
                      <p className="text-xs text-muted-foreground mt-2">
                        {matched != null && (
                          <span>السعر الحالي: {formatIQDPrice(matched)} د.ع</span>
                        )}
                        {matched != null && target != null && ' • '}
                        {target != null && (
                          <span>الهدف: {formatIQDPrice(target)} د.ع</span>
                        )}
                      </p>
                    )}

                    <div className="flex items-center gap-2 mt-3">
                      {!n.is_read && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-xs h-7"
                          onClick={() => markRead.mutate({ id: n.id, userId: user.id })}
                        >
                          تحديد كمقروء
                        </Button>
                      )}
                      {productId && (
                        <Link to={`/explore/${productId}`}>
                          <Button variant="outline" size="sm" className="text-xs h-7">
                            فتح المنتج
                          </Button>
                        </Link>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      </div>
    </RTLLayout>
  );
}
