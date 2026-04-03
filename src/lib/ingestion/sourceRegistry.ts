/**
 * Source registry — resolves active Iraqi sources from price_sources table.
 *
 * No hardcoded external domains. All sources come from the database.
 */

import { USE_API } from '@/integrations/dataMode';
import { apiGet } from '@/integrations/api/client';
import { supabase } from '@/integrations/supabase/client';

export interface RegisteredSource {
  id: string;
  name_ar: string;
  domain: string;
  source_kind: string;
  is_active: boolean;
  trust_weight: number;
  base_url: string | null;
  logo_url: string | null;
}

/**
 * Fetch all active Iraqi price sources from the database.
 * Only returns sources with country_code='IQ' and is_active=true.
 */
export async function getActiveSources(): Promise<RegisteredSource[]> {
  try {
    if (USE_API) {
      return (await apiGet<RegisteredSource[]>('/tables/price_sources?active=true')) ?? [];
    }

    const { data, error } = await supabase
      .from('price_sources')
      .select('id, name_ar, domain, source_kind, is_active, trust_weight, base_url, logo_url')
      .eq('is_active', true)
      .eq('country_code', 'IQ');

    if (error) {
      console.error('[sourceRegistry] Failed to fetch sources:', error.message);
      return [];
    }

    return (data ?? []) as RegisteredSource[];
  } catch (e: any) {
    console.error('[sourceRegistry] Failed to fetch sources:', e?.message ?? e);
    return [];
  }
}

/**
 * Get a single source by ID. Returns null if not found or inactive.
 */
export async function getSourceById(sourceId: string): Promise<RegisteredSource | null> {
  const sources = await getActiveSources();
  return sources.find((s) => s.id === sourceId) ?? null;
}

/**
 * Validate that a source ID exists and is active.
 */
export async function isSourceActive(sourceId: string): Promise<boolean> {
  const source = await getSourceById(sourceId);
  return source !== null;
}
