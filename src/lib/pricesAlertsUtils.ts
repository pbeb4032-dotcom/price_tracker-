/**
 * Price Alerts v1 — localStorage-based alert rules and triggered alerts.
 * No DB dependency. Fail-safe: never blocks /prices flow.
 */

export interface PriceAlertRule {
  id: string;
  product_id: string;
  product_name_ar?: string;
  region_id: string; // 'all' or specific
  region_name_ar?: string;
  metric: 'avg_price_iqd';
  condition: 'lte';
  target_price_iqd: number;
  is_enabled: boolean;
  created_at: string;
}

export interface TriggeredAlert {
  rule_id: string;
  product_id: string;
  region_id: string;
  triggered_at: string;
  current_value: number;
  target_value: number;
  fingerprint: string;
}

const RULES_KEY = 'prices_alert_rules_v1';
const TRIGGERED_KEY = 'prices_alert_triggered_v1';

function safeParseArray<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function loadAlertsRules(): PriceAlertRule[] {
  return safeParseArray<PriceAlertRule>(RULES_KEY);
}

export function saveAlertsRules(rules: PriceAlertRule[]): void {
  try {
    localStorage.setItem(RULES_KEY, JSON.stringify(rules));
  } catch { /* storage full */ }
}

export function addAlertRule(input: Omit<PriceAlertRule, 'id' | 'created_at'>): PriceAlertRule {
  const rules = loadAlertsRules();
  const rule: PriceAlertRule = {
    ...input,
    id: crypto.randomUUID?.() ?? `rule_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    created_at: new Date().toISOString(),
  };
  rules.push(rule);
  saveAlertsRules(rules);
  return rule;
}

export function removeAlertRule(ruleId: string): void {
  const rules = loadAlertsRules().filter((r) => r.id !== ruleId);
  saveAlertsRules(rules);
}

export function toggleAlertRule(ruleId: string, enabled: boolean): void {
  const rules = loadAlertsRules().map((r) =>
    r.id === ruleId ? { ...r, is_enabled: enabled } : r,
  );
  saveAlertsRules(rules);
}

interface PriceRow {
  product_id: string;
  region_id: string;
  avg_price_iqd: number;
  last_observed_at: string;
}

export function evaluateAlerts(rules: PriceAlertRule[], rows: PriceRow[]): TriggeredAlert[] {
  const triggered: TriggeredAlert[] = [];
  for (const rule of rules) {
    if (!rule.is_enabled) continue;
    if (rule.target_price_iqd <= 0) continue;

    const matchingRows = rows.filter((r) => {
      if (r.product_id !== rule.product_id) return false;
      if (rule.region_id !== 'all' && r.region_id !== rule.region_id) return false;
      return true;
    });

    for (const row of matchingRows) {
      const current = row.avg_price_iqd;
      if (rule.condition === 'lte' && current <= rule.target_price_iqd) {
        const fingerprint = `${rule.id}:${row.product_id}:${row.region_id}:${row.last_observed_at}`;
        triggered.push({
          rule_id: rule.id,
          product_id: row.product_id,
          region_id: row.region_id,
          triggered_at: new Date().toISOString(),
          current_value: current,
          target_value: rule.target_price_iqd,
          fingerprint,
        });
      }
    }
  }
  return triggered;
}

export function loadTriggeredAlerts(): TriggeredAlert[] {
  return safeParseArray<TriggeredAlert>(TRIGGERED_KEY);
}

export function saveTriggeredAlerts(alerts: TriggeredAlert[]): void {
  try {
    localStorage.setItem(TRIGGERED_KEY, JSON.stringify(alerts));
  } catch { /* storage full */ }
}

export function dedupeTriggered(previous: TriggeredAlert[], next: TriggeredAlert[]): {
  all: TriggeredAlert[];
  newAlerts: TriggeredAlert[];
} {
  const existingFingerprints = new Set(previous.map((a) => a.fingerprint));
  const newAlerts = next.filter((a) => !existingFingerprints.has(a.fingerprint));
  return {
    all: [...previous, ...newAlerts],
    newAlerts,
  };
}

export function clearTriggered(): void {
  try {
    localStorage.removeItem(TRIGGERED_KEY);
  } catch { /* ignore */ }
}
