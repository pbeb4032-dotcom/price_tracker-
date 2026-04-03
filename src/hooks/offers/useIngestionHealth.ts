/**
 * Hook to check ingestion health — latest sync run status.
 * Non-blocking to UI; returns null if no data available.
 */

import { useQuery } from '@tanstack/react-query';
import { USE_API } from '@/integrations/dataMode';
import { apiGet } from '@/integrations/api/client';
import { supabase } from '@/integrations/supabase/client';

export interface IngestionHealthStatus {
  lastSyncAt: string | null;
  lastStatus: string | null;
  sourceCount: number;
}

export function useIngestionHealth() {
  return useQuery<IngestionHealthStatus>({
    queryKey: ['ingestion-health'],
    queryFn: async () => {
      if (USE_API) {
        return apiGet<IngestionHealthStatus>('/views/ingestion_health');
      }

      const { data, error } = await supabase
        .from('source_sync_runs' as any)
        .select('started_at, status')
        .order('started_at', { ascending: false })
        .limit(1);

      if (error || !data?.length) {
        return { lastSyncAt: null, lastStatus: null, sourceCount: 0 };
      }

      const latest = data[0] as any;
      return {
        lastSyncAt: latest.started_at ?? null,
        lastStatus: latest.status ?? null,
        sourceCount: 1,
      };
    },
    staleTime: 5 * 60_000, // 5 min
    retry: false,
  });
}
