/**
 * PriceAlertsPanel — Manage and view price alert rules and triggered alerts.
 * localStorage-based v1. Arabic RTL UI.
 */

import { useState, useCallback } from 'react';
import { Bell, BellRing, Plus, Trash2, X } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  type PriceAlertRule,
  type TriggeredAlert,
  addAlertRule,
  removeAlertRule,
  toggleAlertRule,
  loadAlertsRules,
  clearTriggered,
} from '@/lib/pricesAlertsUtils';

interface Props {
  rules: PriceAlertRule[];
  triggeredAlerts: TriggeredAlert[];
  onRulesChange: () => void;
  onClearTriggered: () => void;
  /** Pre-fill for creating alert from a specific row */
  prefill?: { product_id: string; product_name_ar: string; region_id: string; region_name_ar: string } | null;
  onClearPrefill?: () => void;
  /** Available products for the create form */
  products: Array<{ product_id: string; product_name_ar: string }>;
  regions: Array<{ region_id: string; region_name_ar: string }>;
}

export default function PriceAlertsPanel({
  rules, triggeredAlerts, onRulesChange, onClearTriggered,
  prefill, onClearPrefill, products, regions,
}: Props) {
  const [showCreate, setShowCreate] = useState(!!prefill);
  const [showPanel, setShowPanel] = useState(false);
  const [formProductId, setFormProductId] = useState(prefill?.product_id ?? '');
  const [formRegionId, setFormRegionId] = useState(prefill?.region_id ?? 'all');
  const [formTarget, setFormTarget] = useState('');

  // Sync prefill
  const openCreate = useCallback((pf?: typeof prefill) => {
    if (pf) {
      setFormProductId(pf.product_id);
      setFormRegionId(pf.region_id);
    }
    setFormTarget('');
    setShowCreate(true);
    setShowPanel(true);
  }, []);

  // If prefill changes externally
  if (prefill && !showCreate) {
    openCreate(prefill);
  }

  const handleCreate = useCallback(() => {
    const target = Number(formTarget);
    if (!formProductId || target <= 0) return;
    const prod = products.find((p) => p.product_id === formProductId);
    const reg = regions.find((r) => r.region_id === formRegionId);
    addAlertRule({
      product_id: formProductId,
      product_name_ar: prod?.product_name_ar,
      region_id: formRegionId,
      region_name_ar: formRegionId === 'all' ? 'الكل' : reg?.region_name_ar,
      metric: 'avg_price_iqd',
      condition: 'lte',
      target_price_iqd: target,
      is_enabled: true,
    });
    setShowCreate(false);
    setFormTarget('');
    onClearPrefill?.();
    onRulesChange();
  }, [formProductId, formRegionId, formTarget, products, regions, onRulesChange, onClearPrefill]);

  const handleToggle = useCallback((id: string, enabled: boolean) => {
    toggleAlertRule(id, enabled);
    onRulesChange();
  }, [onRulesChange]);

  const handleRemove = useCallback((id: string) => {
    removeAlertRule(id);
    onRulesChange();
  }, [onRulesChange]);

  const handleClearTriggered = useCallback(() => {
    clearTriggered();
    onClearTriggered();
  }, [onClearTriggered]);

  function formatPrice(v: number) {
    return `${v.toLocaleString('ar-IQ')} د.ع`;
  }

  return (
    <div className="mb-4">
      {/* Toggle button */}
      <Button
        variant="outline"
        size="sm"
        onClick={() => setShowPanel(!showPanel)}
        className="gap-1 w-full sm:w-auto"
        data-testid="alerts-toggle"
      >
        {triggeredAlerts.length > 0 ? <BellRing className="h-3 w-3 text-destructive" /> : <Bell className="h-3 w-3" />}
        تنبيهات الأسعار
        {rules.length > 0 && <Badge variant="secondary" className="text-xs mr-1">{rules.length}</Badge>}
        {triggeredAlerts.length > 0 && <Badge variant="destructive" className="text-xs mr-1">{triggeredAlerts.length}</Badge>}
      </Button>

      {showPanel && (
        <Card className="mt-3" data-testid="alerts-panel">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center justify-between text-base">
              <span>تنبيهات الأسعار</span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => { setShowCreate(true); setFormProductId(''); setFormRegionId('all'); setFormTarget(''); }} className="gap-1 text-xs">
                  <Plus className="h-3 w-3" />
                  إنشاء تنبيه
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setShowPanel(false)}>
                  <X className="h-3 w-3" />
                </Button>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {/* Create form */}
            {showCreate && (
              <div className="border border-border rounded-md p-3 mb-4 space-y-3" data-testid="alert-create-form">
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-muted-foreground">المنتج</label>
                  <select
                    value={formProductId}
                    onChange={(e) => setFormProductId(e.target.value)}
                    className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="">اختر المنتج</option>
                    {products.map((p) => (
                      <option key={p.product_id} value={p.product_id}>{p.product_name_ar}</option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-muted-foreground">المنطقة</label>
                  <select
                    value={formRegionId}
                    onChange={(e) => setFormRegionId(e.target.value)}
                    className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="all">الكل</option>
                    {regions.map((r) => (
                      <option key={r.region_id} value={r.region_id}>{r.region_name_ar}</option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-muted-foreground">السعر المستهدف (د.ع) — تنبيه عندما ≤</label>
                  <Input
                    type="number"
                    min={1}
                    value={formTarget}
                    onChange={(e) => setFormTarget(e.target.value)}
                    placeholder="مثلاً 1500"
                    data-testid="alert-target-input"
                  />
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={handleCreate} disabled={!formProductId || Number(formTarget) <= 0}>
                    حفظ التنبيه
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => { setShowCreate(false); onClearPrefill?.(); }}>
                    إلغاء
                  </Button>
                </div>
              </div>
            )}

            {/* Rules list */}
            {rules.length > 0 && (
              <div className="mb-4">
                <h4 className="text-sm font-semibold mb-2">القواعد ({rules.length})</h4>
                <div className="space-y-2">
                  {rules.map((rule) => (
                    <div key={rule.id} className="flex items-center justify-between gap-2 border border-border rounded-md px-3 py-2 text-sm">
                      <div className="flex-1">
                        <span className="font-medium">{rule.product_name_ar || rule.product_id}</span>
                        <span className="text-muted-foreground mx-1">·</span>
                        <span className="text-muted-foreground">{rule.region_name_ar || rule.region_id}</span>
                        <span className="text-muted-foreground mx-1">·</span>
                        <span>≤ {formatPrice(rule.target_price_iqd)}</span>
                      </div>
                      <Switch
                        checked={rule.is_enabled}
                        onCheckedChange={(v) => handleToggle(rule.id, v)}
                        aria-label={`تفعيل/تعطيل تنبيه ${rule.product_name_ar}`}
                      />
                      <Button variant="ghost" size="sm" onClick={() => handleRemove(rule.id)}>
                        <Trash2 className="h-3 w-3 text-destructive" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Triggered alerts */}
            {triggeredAlerts.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-sm font-semibold">تنبيهات مُفعّلة ({triggeredAlerts.length})</h4>
                  <Button variant="ghost" size="sm" onClick={handleClearTriggered} className="text-xs">
                    مسح التنبيهات المُفعلة
                  </Button>
                </div>
                <div className="space-y-1">
                  {triggeredAlerts.slice(0, 20).map((a, i) => (
                    <div key={a.fingerprint + i} className="flex items-center gap-2 text-xs border border-border rounded px-2 py-1">
                      <BellRing className="h-3 w-3 text-destructive flex-shrink-0" />
                      <span>الحالي: {formatPrice(a.current_value)}</span>
                      <span className="text-muted-foreground">≤</span>
                      <span>المستهدف: {formatPrice(a.target_value)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {rules.length === 0 && triggeredAlerts.length === 0 && !showCreate && (
              <p className="text-sm text-muted-foreground text-center py-4">لا توجد تنبيهات حالياً</p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
