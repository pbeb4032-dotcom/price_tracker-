/**
 * Tests for pricesAlertsUtils.ts — localStorage-based alerts v1.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadAlertsRules,
  saveAlertsRules,
  addAlertRule,
  removeAlertRule,
  toggleAlertRule,
  evaluateAlerts,
  dedupeTriggered,
  clearTriggered,
  loadTriggeredAlerts,
  saveTriggeredAlerts,
  type PriceAlertRule,
  type TriggeredAlert,
} from '@/lib/pricesAlertsUtils';

beforeEach(() => localStorage.clear());

describe('alerts rules CRUD', () => {
  it('load returns empty array initially', () => {
    expect(loadAlertsRules()).toEqual([]);
  });

  it('add + load round-trip', () => {
    const rule = addAlertRule({
      product_id: 'p1',
      product_name_ar: 'رز',
      region_id: 'all',
      metric: 'avg_price_iqd',
      condition: 'lte',
      target_price_iqd: 2000,
      is_enabled: true,
    });
    expect(rule.id).toBeTruthy();
    const loaded = loadAlertsRules();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].product_id).toBe('p1');
  });

  it('remove deletes by id', () => {
    const rule = addAlertRule({ product_id: 'p1', region_id: 'all', metric: 'avg_price_iqd', condition: 'lte', target_price_iqd: 1000, is_enabled: true });
    removeAlertRule(rule.id);
    expect(loadAlertsRules()).toHaveLength(0);
  });

  it('toggle changes enabled state', () => {
    const rule = addAlertRule({ product_id: 'p1', region_id: 'all', metric: 'avg_price_iqd', condition: 'lte', target_price_iqd: 1000, is_enabled: true });
    toggleAlertRule(rule.id, false);
    expect(loadAlertsRules()[0].is_enabled).toBe(false);
  });

  it('handles corrupt JSON gracefully', () => {
    localStorage.setItem('prices_alert_rules_v1', '{bad');
    expect(loadAlertsRules()).toEqual([]);
  });
});

describe('evaluateAlerts', () => {
  const baseRule: PriceAlertRule = {
    id: 'r1', product_id: 'p1', region_id: 'all',
    metric: 'avg_price_iqd', condition: 'lte',
    target_price_iqd: 1500, is_enabled: true, created_at: '2026-01-01',
  };

  const priceRows = [
    { product_id: 'p1', region_id: 'reg1', avg_price_iqd: 1200, last_observed_at: '2026-01-20' },
    { product_id: 'p1', region_id: 'reg2', avg_price_iqd: 1800, last_observed_at: '2026-01-20' },
    { product_id: 'p2', region_id: 'reg1', avg_price_iqd: 500, last_observed_at: '2026-01-20' },
  ];

  it('triggers for lte condition', () => {
    const alerts = evaluateAlerts([baseRule], priceRows);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].current_value).toBe(1200);
  });

  it('skips disabled rules', () => {
    const disabled = { ...baseRule, is_enabled: false };
    expect(evaluateAlerts([disabled], priceRows)).toHaveLength(0);
  });

  it('skips rules with invalid target', () => {
    const bad = { ...baseRule, target_price_iqd: 0 };
    expect(evaluateAlerts([bad], priceRows)).toHaveLength(0);
  });

  it('filters by specific region', () => {
    const regionRule = { ...baseRule, region_id: 'reg2', target_price_iqd: 2000 };
    const alerts = evaluateAlerts([regionRule], priceRows);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].region_id).toBe('reg2');
  });
});

describe('dedupeTriggered', () => {
  it('removes duplicates by fingerprint', () => {
    const prev: TriggeredAlert[] = [
      { rule_id: 'r1', product_id: 'p1', region_id: 'reg1', triggered_at: '', current_value: 1000, target_value: 1500, fingerprint: 'fp1' },
    ];
    const next: TriggeredAlert[] = [
      { rule_id: 'r1', product_id: 'p1', region_id: 'reg1', triggered_at: '', current_value: 1000, target_value: 1500, fingerprint: 'fp1' },
      { rule_id: 'r1', product_id: 'p1', region_id: 'reg1', triggered_at: '', current_value: 900, target_value: 1500, fingerprint: 'fp2' },
    ];
    const result = dedupeTriggered(prev, next);
    expect(result.newAlerts).toHaveLength(1);
    expect(result.all).toHaveLength(2);
  });
});

describe('triggered persistence', () => {
  it('save/load/clear', () => {
    const alerts: TriggeredAlert[] = [
      { rule_id: 'r1', product_id: 'p1', region_id: 'reg1', triggered_at: '', current_value: 100, target_value: 200, fingerprint: 'f1' },
    ];
    saveTriggeredAlerts(alerts);
    expect(loadTriggeredAlerts()).toHaveLength(1);
    clearTriggered();
    expect(loadTriggeredAlerts()).toHaveLength(0);
  });
});
