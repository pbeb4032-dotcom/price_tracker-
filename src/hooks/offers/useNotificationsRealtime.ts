import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { USE_API } from '@/integrations/dataMode';
import { supabase } from '@/integrations/supabase/client';

/**
 * Realtime notifications:
 * - Supabase mode: Postgres realtime.
 * - API mode: lightweight polling (keeps behavior without adding extra infra).
 */
export function useNotificationsRealtime(userId?: string) {
  const qc = useQueryClient();

  useEffect(() => {
    if (!userId) return;

    if (USE_API) {
      const t = window.setInterval(() => {
        qc.invalidateQueries({ queryKey: ['notifications', userId] });
        qc.invalidateQueries({ queryKey: ['notifications-unread-count', userId] });
      }, 10_000);
      return () => window.clearInterval(t);
    }

    const channel = supabase
      .channel(`notifications:user:${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${userId}`,
        },
        () => {
          qc.invalidateQueries({ queryKey: ['notifications', userId] });
          qc.invalidateQueries({ queryKey: ['notifications-unread-count', userId] });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, qc]);
}
