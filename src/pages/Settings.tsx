import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Settings, Bell, Mail } from 'lucide-react';
import { RTLLayout } from '@/components/layout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/AuthProvider';
import { useUserSettings, useUpsertUserSettings } from '@/hooks/offers/useUserSettings';
import { useWebPush } from '@/hooks/offers/useWebPush';
import { toast } from 'sonner';

export default function SettingsPage() {
  const { user } = useAuth();
  const { data: settings } = useUserSettings(user?.id);
  const upsert = useUpsertUserSettings(user?.id);
  const { supported, subscribe, unsubscribe } = useWebPush();

  const [quietStart, setQuietStart] = useState('');
  const [quietEnd, setQuietEnd] = useState('');

  useEffect(() => {
    if (settings) {
      setQuietStart(settings.quiet_hours_start ?? '');
      setQuietEnd(settings.quiet_hours_end ?? '');
    }
  }, [settings]);

  if (!user) {
    return (
      <RTLLayout>
        <div className="container mx-auto px-4 py-16 text-center">
          <Settings className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <h1 className="text-2xl font-bold text-foreground mb-2">الإعدادات</h1>
          <p className="text-muted-foreground">سجّل دخولك حتى تعدّل الإعدادات.</p>
          <Link to="/sign-in">
            <Button className="mt-4">تسجيل الدخول</Button>
          </Link>
        </div>
      </RTLLayout>
    );
  }

  const handlePushToggle = async (enabled: boolean) => {
    try {
      if (enabled) {
        await subscribe();
      } else {
        await unsubscribe();
      }
      await upsert.mutateAsync({ push_enabled: enabled });
      toast.success(enabled ? 'تم تفعيل إشعارات Push' : 'تم إيقاف إشعارات Push');
    } catch (err: any) {
      toast.error(err?.message || 'حدث خطأ');
    }
  };

  return (
    <RTLLayout>
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <h1 className="text-2xl font-bold text-foreground mb-6">الإعدادات</h1>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Bell className="h-4 w-4" />
              إعدادات الإشعارات
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Push toggle */}
            <div className="flex items-center justify-between">
              <Label htmlFor="push-toggle" className="text-sm">
                إشعارات Push للمتصفح
              </Label>
              <Switch
                id="push-toggle"
                checked={settings?.push_enabled ?? false}
                onCheckedChange={handlePushToggle}
                disabled={!supported || upsert.isPending}
              />
            </div>

            {!supported && (
              <p className="text-xs text-muted-foreground">
                متصفحك لا يدعم إشعارات Push.
              </p>
            )}

            {/* Email toggle */}
            <div className="flex items-center justify-between">
              <Label htmlFor="email-toggle" className="text-sm">
                إشعارات البريد الإلكتروني
              </Label>
              <Switch
                id="email-toggle"
                checked={settings?.email_enabled ?? true}
                onCheckedChange={(v) => upsert.mutate({ email_enabled: v })}
                disabled={upsert.isPending}
              />
            </div>

            {/* Unread-only default */}
            <div className="flex items-center justify-between">
              <Label htmlFor="unread-toggle" className="text-sm">
                عرض غير المقروء فقط افتراضياً
              </Label>
              <Switch
                id="unread-toggle"
                checked={settings?.notifications_unread_only ?? false}
                onCheckedChange={(v) => upsert.mutate({ notifications_unread_only: v })}
                disabled={upsert.isPending}
              />
            </div>

            {/* Quiet hours */}
            <div className="space-y-3">
              <Label className="text-sm font-medium">وقت الهدوء (لا ترسل Push)</Label>
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <Label htmlFor="quiet-start" className="text-xs text-muted-foreground">
                    من
                  </Label>
                  <Input
                    id="quiet-start"
                    type="time"
                    value={quietStart}
                    onChange={(e) => setQuietStart(e.target.value)}
                  />
                </div>
                <div className="flex-1">
                  <Label htmlFor="quiet-end" className="text-xs text-muted-foreground">
                    إلى
                  </Label>
                  <Input
                    id="quiet-end"
                    type="time"
                    value={quietEnd}
                    onChange={(e) => setQuietEnd(e.target.value)}
                  />
                </div>
              </div>
              <Button
                size="sm"
                onClick={() =>
                  upsert.mutate({
                    quiet_hours_start: quietStart || null,
                    quiet_hours_end: quietEnd || null,
                  })
                }
                disabled={upsert.isPending}
              >
                حفظ وقت الهدوء
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </RTLLayout>
  );
}
