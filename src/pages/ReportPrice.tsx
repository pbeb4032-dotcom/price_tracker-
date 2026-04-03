/**
 * Shkad Aadel — Report Price Page (Protected)
 *
 * RTL-first form for submitting a price report.
 * Loads products, regions, stores from public tables.
 * Shows last 5 user submissions with status badges.
 */

import { useState, useEffect, useCallback } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, Send, CheckCircle2, Clock, XCircle, AlertTriangle, RefreshCw } from 'lucide-react';

import { RTLLayout, PageContainer } from '@/components/layout';
import { FormField } from '@/components/forms';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

import { supabase } from '@/integrations/supabase/client';
import { USE_API } from '@/integrations/dataMode';
import { apiGet, apiPost } from '@/integrations/api/client';
import { useAuth } from '@/lib/auth/AuthProvider';
import { useTelemetry } from '@/lib/telemetry';
import { toAppError, AppError } from '@/lib/errors';
import { priceReportCreateSchema, type PriceReportCreateInput } from '@/lib/validation/schemas';
import type { ReportStatus } from '@/lib/types/domain';
import { useSeoMeta } from '@/lib/seo/useSeoMeta';

// ---- Types for select options ----

interface SelectOption {
  id: string;
  label: string;
}

// ---- Status badge helpers ----

const STATUS_CONFIG: Record<ReportStatus, { label: string; icon: typeof Clock; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  pending: { label: 'قيد المراجعة', icon: Clock, variant: 'secondary' },
  approved: { label: 'معتمد', icon: CheckCircle2, variant: 'default' },
  rejected: { label: 'مرفوض', icon: XCircle, variant: 'destructive' },
  flagged: { label: 'مُبلّغ عنه', icon: AlertTriangle, variant: 'outline' },
};

function StatusBadge({ status }: { status: ReportStatus }) {
  const config = STATUS_CONFIG[status];
  const Icon = config.icon;
  return (
    <Badge variant={config.variant} className="gap-1 text-xs">
      <Icon className="h-3 w-3" />
      {config.label}
    </Badge>
  );
}

// ---- Main Page ----

export default function ReportPrice() {
  const { user } = useAuth();
  const telemetry = useTelemetry();

  useSeoMeta({
    title: 'الإبلاغ عن سعر جديد',
    description: 'أرسل سعر منتج موثّق للمساهمة في تحديث الأسعار في السوق العراقي.',
    noindex: true,
  });

  // Data for selects
  const [products, setProducts] = useState<SelectOption[]>([]);
  const [regions, setRegions] = useState<SelectOption[]>([]);
  const [stores, setStores] = useState<SelectOption[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [dataLoadError, setDataLoadError] = useState(false);

  // Submissions list
  const [recentReports, setRecentReports] = useState<Array<{
    id: string;
    price: number;
    currency: string;
    unit: string;
    status: ReportStatus;
    created_at: string;
    product_name: string;
    region_name: string;
  }>>([]);

  // Submit state
  const [submitting, setSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Form
  const {
    register,
    handleSubmit,
    control,
    reset,
    watch,
    formState: { errors },
  } = useForm<PriceReportCreateInput>({
    resolver: zodResolver(priceReportCreateSchema),
    defaultValues: {
      currency: 'IQD',
      unit: 'kg',
      quantity: 1,
      notes: '',
      store_id: null,
    },
  });

  const selectedRegionId = watch('region_id');

  // ---- Load reference data ----

  useEffect(() => {
    let mounted = true;

    async function loadData() {
      try {
        const [productsRes, regionsRes, storesRes] = USE_API
          ? await Promise.all([
              apiGet<any[]>('/tables/products?active=true'),
              apiGet<any[]>('/tables/regions?active=true'),
              apiGet<any[]>('/tables/stores'),
            ]).then(([p, r, s]) => [
              { data: p },
              { data: r },
              { data: s },
            ])
          : await Promise.all([
              supabase.from('products').select('id, name_ar').eq('is_active', true).order('name_ar'),
              supabase.from('regions').select('id, name_ar').eq('is_active', true).order('name_ar'),
              supabase.from('stores').select('id, name_ar, region_id').order('name_ar'),
            ]);

        if (!mounted) return;

        setProducts(
          (productsRes.data ?? []).map((p) => ({ id: p.id, label: p.name_ar }))
        );
        setRegions(
          (regionsRes.data ?? []).map((r) => ({ id: r.id, label: r.name_ar }))
        );
        setStores(
          (storesRes.data ?? []).map((s) => ({
            id: s.id,
            label: s.name_ar,
            regionId: s.region_id,
          })) as (SelectOption & { regionId: string })[]
        );
      } catch {
        if (mounted) setDataLoadError(true);
      } finally {
        if (mounted) setDataLoading(false);
      }
    }

    loadData();
    return () => { mounted = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const retryLoadData = useCallback(() => {
    setDataLoading(true);
    setDataLoadError(false);
    setProducts([]);
    setRegions([]);
    setStores([]);

    (USE_API
      ? Promise.all([
          apiGet<any[]>("/tables/products?active=true"),
          apiGet<any[]>("/tables/regions?active=true"),
          apiGet<any[]>("/tables/stores"),
        ]).then(([p, r, s]) => ({ products: p, regions: r, stores: s }))
      : Promise.all([
          supabase.from("products").select("id, name_ar").eq("is_active", true).order("name_ar"),
          supabase.from("regions").select("id, name_ar").eq("is_active", true).order("name_ar"),
          supabase.from("stores").select("id, name_ar, region_id").order("name_ar"),
        ]).then(([productsRes, regionsRes, storesRes]) => ({
          products: productsRes.data ?? [],
          regions: regionsRes.data ?? [],
          stores: storesRes.data ?? [],
        })))
      .then(({ products: p, regions: r, stores: s }) => {
        setProducts((p ?? []).map((x: any) => ({ id: x.id, label: x.name_ar })));
        setRegions((r ?? []).map((x: any) => ({ id: x.id, label: x.name_ar })));
        setStores((s ?? []).map((x: any) => ({ id: x.id, label: x.name_ar, regionId: x.region_id })) as (SelectOption & { regionId: string })[]);
      })
      .catch(() => setDataLoadError(true))
      .finally(() => setDataLoading(false));
  }, []);

  // Filter stores by selected region
  const filteredStores = selectedRegionId
    ? (stores as (SelectOption & { regionId?: string })[]).filter(
        (s) => (s as { regionId?: string }).regionId === selectedRegionId
      )
    : stores;

  // ---- Load recent user reports ----

  const loadRecentReports = useCallback(async () => {
    if (!user) return;

    const data = USE_API
      ? await apiGet<any[]>("/tables/price_reports/recent?limit=5")
      : (await supabase
          .from("price_reports")
          .select("id, price, currency, unit, status, created_at, product_id, region_id")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(5)).data;

    if (!data || data.length === 0) {
      setRecentReports([]);
      return;
    }

    const productIds = [...new Set((data as any[]).map((r) => r.product_id))];
    const regionIds = [...new Set((data as any[]).map((r) => r.region_id))];

    const [productsRows, regionsRows] = USE_API
      ? await Promise.all([
          apiGet<any[]>(`/tables/products?ids=${productIds.join(",")}`),
          apiGet<any[]>(`/tables/regions?ids=${regionIds.join(",")}`),
        ])
      : await Promise.all([
          supabase.from("products").select("id, name_ar").in("id", productIds),
          supabase.from("regions").select("id, name_ar").in("id", regionIds),
        ]).then(([p, r]) => [p.data ?? [], r.data ?? []]);

    const productMap = new Map((productsRows ?? []).map((p: any) => [p.id, p.name_ar]));
    const regionMap = new Map((regionsRows ?? []).map((r: any) => [r.id, r.name_ar]));

    setRecentReports(
      (data as any[]).map((r: any) => ({
        id: String(r.id ?? ''),
        price: Number(r.price),
        currency: String(r.currency ?? 'IQD'),
        unit: String(r.unit ?? 'unit'),
        status: r.status as ReportStatus,
        created_at: String(r.created_at ?? ''),
        product_name: String(productMap.get(r.product_id) ?? '—'),
        region_name: String(regionMap.get(r.region_id) ?? '—'),
      }))
    );
  }, [user]);

  useEffect(() => {
    loadRecentReports();
  }, [loadRecentReports]);

  // ---- Submit handler ----

  const onSubmit = async (values: PriceReportCreateInput) => {
    if (!user) return;

    setSubmitting(true);
    setSubmitError(null);
    setSubmitSuccess(false);

    try {
      if (USE_API) {
        await apiPost("/tables/price_reports", {
          product_id: values.product_id,
          region_id: values.region_id,
          store_id: values.store_id || null,
          price: values.price,
          currency: values.currency ?? "IQD",
          unit: values.unit,
          quantity: values.quantity ?? 1,
          notes: values.notes || null,
        });
      } else {
        const { error } = await supabase.from("price_reports").insert({
          user_id: user.id,
          product_id: values.product_id,
          region_id: values.region_id,
          store_id: values.store_id || null,
          price: values.price,
          currency: values.currency ?? "IQD",
          unit: values.unit,
          quantity: values.quantity ?? 1,
          notes: values.notes || null,
        });
        if (error) throw error;
      }

      telemetry.trackEvent('price_report_submit_success', {
        status: 'ok',
        has_store: Boolean(values.store_id),
      });

      setSubmitSuccess(true);
      reset({
        currency: 'IQD',
        unit: 'kg',
        quantity: 1,
        notes: '',
        store_id: null,
        product_id: undefined as unknown as string,
        region_id: undefined as unknown as string,
        price: undefined as unknown as number,
      });

      // Refresh recent reports
      await loadRecentReports();

      // Clear success after 4s
      setTimeout(() => setSubmitSuccess(false), 4000);
    } catch (err) {
      const mapped = toAppError(err);
      telemetry.trackEvent('price_report_submit_fail', {
        status: 'error',
        error_code: mapped.code,
      });
      setSubmitError(mapped.messageAr);
    } finally {
      setSubmitting(false);
    }
  };

  // ---- Unit options ----

  const UNIT_OPTIONS = [
    { value: 'kg', label: 'كغم' },
    { value: 'g', label: 'غرام' },
    { value: 'lb', label: 'رطل' },
    { value: 'piece', label: 'حبّة' },
    { value: 'liter', label: 'لتر' },
    { value: 'dozen', label: 'درزن' },
    { value: 'box', label: 'صندوق' },
  ];

  if (dataLoading) {
    return (
      <RTLLayout>
        <div className="min-h-screen flex items-center justify-center" role="status">
          <Loader2 className="h-8 w-8 animate-spin text-primary" aria-label="جاري التحميل" />
        </div>
      </RTLLayout>
    );
  }

  return (
    <RTLLayout>
      <PageContainer className="max-w-2xl py-8">
        <h1 className="text-2xl font-bold text-foreground mb-6">تسجيل سعر جديد</h1>

        {/* Success feedback */}
        {submitSuccess && (
          <div
            className="mb-6 flex items-center gap-3 rounded-lg border border-border bg-card p-4 animate-fade-in"
            role="status"
          >
            <CheckCircle2 className="h-5 w-5 text-primary flex-shrink-0" />
            <p className="text-sm text-foreground">تم تسجيل السعر بنجاح! شكراً لمساهمتك.</p>
          </div>
        )}

        {/* Error feedback */}
        {submitError && (
          <div
            className="mb-6 flex items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 animate-fade-in"
            role="alert"
          >
            <XCircle className="h-5 w-5 text-destructive flex-shrink-0" />
            <p className="text-sm text-destructive">{submitError}</p>
          </div>
        )}

        {/* Empty products warning */}
        {!dataLoading && products.length === 0 && (
          <div
            className="mb-6 flex items-center gap-3 rounded-lg border border-border bg-muted/50 p-4"
            role="alert"
            data-testid="empty-products-warning"
          >
            <AlertTriangle className="h-5 w-5 text-muted-foreground flex-shrink-0" />
            <div className="flex-1">
              <p className="text-sm text-foreground">
                لا توجد منتجات مفعّلة حالياً. يرجى المحاولة لاحقاً أو التواصل مع الإدارة.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={retryLoadData}
              className="gap-1 flex-shrink-0"
            >
              <RefreshCw className="h-3 w-3" />
              إعادة المحاولة
            </Button>
          </div>
        )}

        {/* Data load error */}
        {dataLoadError && products.length === 0 && (
          <div
            className="mb-6 flex items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4"
            role="alert"
          >
            <XCircle className="h-5 w-5 text-destructive flex-shrink-0" />
            <div className="flex-1">
              <p className="text-sm text-destructive">حدث خطأ أثناء تحميل البيانات.</p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={retryLoadData}
              className="gap-1 flex-shrink-0"
            >
              <RefreshCw className="h-3 w-3" />
              إعادة المحاولة
            </Button>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
          {/* Product */}
          <FormField label="المنتج" htmlFor="product_id" error={errors.product_id?.message} required>
            <Controller
              name="product_id"
              control={control}
              render={({ field }) => (
                <Select onValueChange={field.onChange} value={field.value || ''}>
                  <SelectTrigger id="product_id" className={errors.product_id ? 'border-destructive' : ''}>
                    <SelectValue placeholder="اختر المنتج" />
                  </SelectTrigger>
                  <SelectContent>
                    {products.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </FormField>

          {/* Region */}
          <FormField label="المنطقة" htmlFor="region_id" error={errors.region_id?.message} required>
            <Controller
              name="region_id"
              control={control}
              render={({ field }) => (
                <Select onValueChange={field.onChange} value={field.value || ''}>
                  <SelectTrigger id="region_id" className={errors.region_id ? 'border-destructive' : ''}>
                    <SelectValue placeholder="اختر المنطقة" />
                  </SelectTrigger>
                  <SelectContent>
                    {regions.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </FormField>

          {/* Price + Unit row */}
          <div className="grid grid-cols-2 gap-4">
            <FormField label="السعر" htmlFor="price" error={errors.price?.message} required>
              <Input
                id="price"
                type="number"
                step="any"
                min="0"
                placeholder="0.00"
                className={errors.price ? 'border-destructive' : ''}
                {...register('price', { valueAsNumber: true })}
              />
            </FormField>

            <FormField label="الوحدة" htmlFor="unit" error={errors.unit?.message} required>
              <Controller
                name="unit"
                control={control}
                render={({ field }) => (
                  <Select onValueChange={field.onChange} value={field.value || 'kg'}>
                    <SelectTrigger id="unit" className={errors.unit ? 'border-destructive' : ''}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {UNIT_OPTIONS.map((u) => (
                        <SelectItem key={u.value} value={u.value}>
                          {u.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </FormField>
          </div>

          {/* Store (optional) */}
          <FormField label="المتجر" htmlFor="store_id" hint="اختياري">
            <Controller
              name="store_id"
              control={control}
              render={({ field }) => (
                <Select
                  onValueChange={(v) => field.onChange(v === '__none__' ? null : v)}
                  value={field.value || '__none__'}
                >
                  <SelectTrigger id="store_id">
                    <SelectValue placeholder="بدون متجر محدد" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">بدون متجر محدد</SelectItem>
                    {filteredStores.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </FormField>

          {/* Quantity */}
          <FormField label="الكمية" htmlFor="quantity" error={errors.quantity?.message} hint="اختياري — افتراضي 1">
            <Input
              id="quantity"
              type="number"
              step="any"
              min="0"
              placeholder="1"
              {...register('quantity', { valueAsNumber: true })}
            />
          </FormField>

          {/* Notes */}
          <FormField label="ملاحظات" htmlFor="notes" error={errors.notes?.message} hint="اختياري">
            <Textarea
              id="notes"
              rows={3}
              maxLength={1000}
              placeholder="مثال: عرض خاص، سعر الجملة..."
              {...register('notes')}
            />
          </FormField>

          {/* Submit */}
          <Button type="submit" disabled={submitting || products.length === 0} className="w-full gap-2">
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                جاري الإرسال...
              </>
            ) : (
              <>
                <Send className="h-4 w-4" />
                تسجيل السعر
              </>
            )}
          </Button>
        </form>

        {/* Recent submissions */}
        {recentReports.length > 0 && (
          <Card className="mt-8">
            <CardHeader>
              <CardTitle className="text-lg">آخر تقاريرك</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y divide-border">
                {recentReports.map((report) => (
                  <div
                    key={report.id}
                    className="flex items-center justify-between px-6 py-3"
                  >
                    <div className="space-y-0.5">
                      <p className="text-sm font-medium text-foreground">
                        {report.product_name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {report.region_name} · {new Date(report.created_at).toLocaleDateString('ar-IQ')}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-semibold text-foreground tabular-nums">
                        {report.price.toLocaleString('ar-IQ')} {report.currency === 'IQD' ? 'د.ع' : report.currency}/{report.unit === 'kg' ? 'كغم' : report.unit}
                      </span>
                      <StatusBadge status={report.status} />
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </PageContainer>
    </RTLLayout>
  );
}
