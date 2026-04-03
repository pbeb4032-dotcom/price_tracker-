import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { USE_API } from '@/integrations/dataMode';
import { apiGet, apiPost } from '@/integrations/api/client';
import { supabase } from '@/integrations/supabase/client';

export type UserSettings = {
  user_id: string;
  push_enabled: boolean;
  email_enabled: boolean;
  notifications_unread_only: boolean;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  timezone: string;
};

export function useUserSettings(userId?: string) {
  return useQuery({
    queryKey: ['user-settings', userId],
    enabled: !!userId,
    queryFn: async (): Promise<UserSettings | null> => {
      if (!userId) return null;

      if (USE_API) {
        return apiGet<UserSettings | null>('/tables/user_settings');
      }

      const { data, error } = await supabase
        .from('user_settings')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();
      if (error) throw error;
      return data as UserSettings | null;
    },
  });
}

export function useUpsertUserSettings(userId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<UserSettings>) => {
      if (!userId) throw new Error('userId is required');

      if (USE_API) {
        await apiPost('/tables/user_settings', patch);
        return;
      }

      const { error } = await supabase.from('user_settings').upsert(
        { user_id: userId, ...patch, updated_at: new Date().toISOString() } as any,
        { onConflict: 'user_id' },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['user-settings', userId] });
    },
  });
}
