/**
 * usePricesData — Fetches trusted prices from v_trusted_price_summary.
 * Handles loading, error, retry, and alert evaluation.
 */

import { useState, useCallback } from 'react';
import { USE_API } from '@/integrations/dataMode';
import { apiGet } from '@/integrations/api/client';
import { supabase } from '@/integrations/supabase/client';
import { useTelemetry } from '@/lib/telemetry';
import { mapTrustedPrice } from '@/lib/prices/mappers';
import type { TrustedPrice } from '@/lib/prices/types';
import { toast } from '@/hooks/use-toast';
import {
  loadAlertsRules,
  evaluateAlerts,
  dedupeTriggered,
  loadTriggeredAlerts,
  saveTriggeredAlerts,
  type PriceAlertRule,
  type TriggeredAlert,
} from '@/lib/pricesAlertsUtils';

export interface PricesDataState {
  prices: TrustedPrice[];
  loading: boolean;
  error: boolean;
  alertRules: PriceAlertRule[];
  triggeredAlerts: TriggeredAlert[];
  loadPrices: () => Promise<void>;
  reloadAlertRules: () => void;
  reloadTriggered: () => void;
}

export function usePricesData(): PricesDataState {
  const telemetry = useTelemetry();

  const [prices, setPrices] = useState<TrustedPrice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [alertRules, setAlertRules] = useState<PriceAlertRule[]>([]);
  const [triggeredAlerts, setTriggeredAlerts] = useState<TriggeredAlert[]>([]);

  const reloadAlertRules = useCallback(() => setAlertRules(loadAlertsRules()), []);
  const reloadTriggered = useCallback(() => setTriggeredAlerts(loadTriggeredAlerts()), []);

  const loadPrices = useCallback(async () => {
    setLoading(true);
    setError(false);

    try {
      let rows: any[] = [];

      if (USE_API) {
        rows = await apiGet<any[]>(`/views/trusted_price_summary?limit=5000`);
      } else {
        const { data, error: fetchError } = await supabase
          .from('v_trusted_price_summary')
          .select('*')
          .order('product_name_ar');

        if (fetchError) throw fetchError;
        rows = data ?? [];
      }

      const mapped = (rows ?? []).map((r) => mapTrustedPrice(r as unknown as Record<string, unknown>));
      setPrices(mapped);

      // Evaluate alerts
      const rules = loadAlertsRules();
      setAlertRules(rules);
      const newTriggered = evaluateAlerts(rules, mapped);
      const prev = loadTriggeredAlerts();
      const { all, newAlerts } = dedupeTriggered(prev, newTriggered);
      saveTriggeredAlerts(all);
      setTriggeredAlerts(all);
      if (newAlerts.length > 0) {
        toast({ title: `${newAlerts.length} تنبيه سعر جديد!` });
      }

      telemetry.trackEvent('trusted_prices_view_loaded', {
        status: mapped.length > 0 ? 'ok' : 'empty',
      });
    } catch {
      setError(true);
      telemetry.trackEvent('trusted_prices_view_failed', {
        error_code: 'FETCH_FAILED',
      });
    } finally {
      setLoading(false);
    }
  }, [telemetry]);

  return {
    prices,
    loading,
    error,
    alertRules,
    triggeredAlerts,
    loadPrices,
    reloadAlertRules,
    reloadTriggered,
  };
}
