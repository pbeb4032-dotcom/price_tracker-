import { useMemo } from 'react';
import { USE_API } from '@/integrations/dataMode';
import { apiPost } from '@/integrations/api/client';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth/AuthProvider';

function b64ToUint8Array(base64: string) {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4);
  const base64Safe = (base64 + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64Safe);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export function useWebPush() {
  const { user } = useAuth();
  const supported = useMemo(
    () =>
      typeof window !== 'undefined' &&
      'serviceWorker' in navigator &&
      'PushManager' in window,
    [],
  );

  const subscribe = async () => {
    if (!supported || !user) throw new Error('Push not supported or user missing');

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') throw new Error('Notification permission denied');

    const reg = await navigator.serviceWorker.register('/sw.js');
    const vapidKey = import.meta.env.VITE_VAPID_PUBLIC_KEY as string;
    if (!vapidKey) throw new Error('Missing VITE_VAPID_PUBLIC_KEY');

    const sub = await (reg as any).pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: b64ToUint8Array(vapidKey),
    });

    const json = sub.toJSON();

    if (USE_API) {
      await apiPost('/tables/web_push_subscriptions', {
        endpoint: json.endpoint!,
        p256dh: json.keys?.p256dh!,
        auth: json.keys?.auth!,
        user_agent: navigator.userAgent,
      });
      return sub;
    }

    const { error } = await supabase.from('web_push_subscriptions').upsert(
      {
        user_id: user.id,
        endpoint: json.endpoint!,
        p256dh: json.keys?.p256dh!,
        auth: json.keys?.auth!,
        user_agent: navigator.userAgent,
        is_active: true,
        updated_at: new Date().toISOString(),
      } as any,
      { onConflict: 'endpoint' },
    );
    if (error) throw error;
    return sub;
  };

  const unsubscribe = async () => {
    if (!supported || !user) return;
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await (reg as any)?.pushManager?.getSubscription();
    if (!sub) return;

    const endpoint = sub.endpoint;
    await sub.unsubscribe();

    if (USE_API) {
      await apiPost('/tables/web_push_subscriptions/unsubscribe', { endpoint });
      return;
    }

    await supabase
      .from('web_push_subscriptions')
      .update({ is_active: false, updated_at: new Date().toISOString() } as any)
      .eq('user_id', user.id)
      .eq('endpoint', endpoint);
  };

  return { supported, subscribe, unsubscribe };
}
