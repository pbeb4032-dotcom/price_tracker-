import { useQuery } from '@tanstack/react-query';
import { USE_API } from '@/integrations/dataMode';
import { apiRpc } from '@/integrations/api/rpc';
import { supabase } from '@/integrations/supabase/client';

export function useIsAdmin(userId?: string) {
  return useQuery<boolean>({
    queryKey: ['auth', 'is-admin', userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      if (!userId) return false;

      const args = { _role: 'admin', _user_id: userId };

      if (USE_API) {
        const data = await apiRpc<boolean>('has_role', args as any);
        return Boolean(data);
      }

      const { data, error } = await supabase.rpc('has_role' as any, args);
      if (error) throw error;
      return Boolean(data);
    },
    staleTime: 60_000,
    gcTime: 10 * 60_000,
  });
}
