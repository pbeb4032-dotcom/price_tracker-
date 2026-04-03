import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { USE_API } from '@/integrations/dataMode';
import { apiGet, apiPatch, apiPost } from '@/integrations/api/client';
import { supabase } from '@/integrations/supabase/client';

export type AppNotification = {
  id: string;
  user_id: string;
  type: string;
  title_ar: string;
  body_ar: string;
  payload: Record<string, unknown>;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
};

export function useNotifications(params: {
  userId?: string;
  limit?: number;
  unreadOnly?: boolean;
}) {
  const { userId, limit = 20, unreadOnly = false } = params;

  return useQuery({
    queryKey: ['notifications', userId, limit, unreadOnly],
    enabled: !!userId,
    staleTime: 20_000,
    queryFn: async (): Promise<AppNotification[]> => {
      if (!userId) return [];

      if (USE_API) {
        const qs = new URLSearchParams();
        qs.set('limit', String(limit));
        qs.set('unreadOnly', String(unreadOnly));
        const data = await apiGet<AppNotification[]>(`/tables/notifications?${qs.toString()}`);
        return data ?? [];
      }

      let q = supabase
        .from('notifications')
        .select('id, user_id, type, title_ar, body_ar, payload, is_read, read_at, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (unreadOnly) q = q.eq('is_read', false);

      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as AppNotification[];
    },
  });
}

export function useUnreadNotificationsCount(userId?: string) {
  return useQuery({
    queryKey: ['notifications-unread-count', userId],
    enabled: !!userId,
    staleTime: 15_000,
    queryFn: async () => {
      if (!userId) return 0;

      if (USE_API) {
        const r = await apiGet<{ count: number }>(`/tables/notifications/unread_count`);
        return r?.count ?? 0;
      }

      const { count, error } = await supabase
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('is_read', false);

      if (error) throw error;
      return count ?? 0;
    },
  });
}

export function useMarkNotificationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id: string; userId: string }) => {
      if (USE_API) {
        await apiPatch(`/tables/notifications/${encodeURIComponent(args.id)}/read`, {});
        return args.userId;
      }

      const { error } = await supabase
        .from('notifications')
        .update({ is_read: true, read_at: new Date().toISOString() })
        .eq('id', args.id)
        .eq('user_id', args.userId);

      if (error) throw error;
      return args.userId;
    },
    onSuccess: (userId) => {
      qc.invalidateQueries({ queryKey: ['notifications', userId] });
      qc.invalidateQueries({ queryKey: ['notifications-unread-count', userId] });
    },
  });
}

export function useMarkAllNotificationsRead(userId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      if (!userId) return;

      if (USE_API) {
        await apiPost(`/tables/notifications/read_all`, {});
        return;
      }

      const { error } = await supabase
        .from('notifications')
        .update({ is_read: true, read_at: new Date().toISOString() })
        .eq('user_id', userId)
        .eq('is_read', false);

      if (error) throw error;
    },
    onSuccess: () => {
      if (!userId) return;
      qc.invalidateQueries({ queryKey: ['notifications', userId] });
      qc.invalidateQueries({ queryKey: ['notifications-unread-count', userId] });
    },
  });
}
