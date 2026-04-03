import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { RTLLayout, PageContainer } from '@/components/layout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useCompareOffers, isSuspectedOffer } from '@/hooks/offers/useApiComparisons';
import { formatIQDPrice } from '@/lib/offers/normalization';
import { OfferReliabilityBadge } from '@/components/offers/OfferReliabilityBadge';

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? '';

type LookupResult = {
  ok?: boolean;
  input?: string | null;
  resolved_code?: string | null;
  product?: Record<string, any> | null;
  offers?: Record<string, any>[];
  external_catalog?: Record<string, any> | null;
  external_prices?: Record<string, any>[];
  cheapest_external?: Record<string, any> | null;
  resolution?: { match_type?: string; confidence?: number } | null;
  identifier_type?: string | null;
  error?: string;
  candidates?: string[];
};

type ResolveResult = {
  ok: boolean;
  code: string | null;
  source: string;
  candidates: string[];
};

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = (data && (data.error || data.message)) || `HTTP ${res.status}`;
    throw new Error(message);
  }
  return data as T;
}

export default function ScanPage() {
  const [input, setInput] = useState('');
  const [regionId, setRegionId] = useState('');
  const [resolveResult, setResolveResult] = useState<ResolveResult | null>(null);
  const [lookupResult, setLookupResult] = useState<LookupResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingResolve, setLoadingResolve] = useState(false);
  const [loadingLookup, setLoadingLookup] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraSupported, setCameraSupported] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraMode, setCameraMode] = useState<'barcode' | 'zxing' | null>(null);
  const [autoLookup, setAutoLookup] = useState(true);
  const [showServerOfferCompare, setShowServerOfferCompare] = useState(false);
  const [offersFilter, setOffersFilter] = useState<'all' | 'trusted' | 'hide_suspected'>('all');

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanTimerRef = useRef<number | null>(null);
  const lastDetectedRef = useRef<string>('');

  const zxingReaderRef = useRef<any>(null);
  const zxingControlsRef = useRef<any>(null);

  const resolvedCode = lookupResult?.resolved_code || resolveResult?.code || '';
  const offers = lookupResult?.offers ?? [];
  const externalCatalog = lookupResult?.external_catalog ?? null;
  const externalPrices = lookupResult?.external_prices ?? [];
  const cheapestExternal = lookupResult?.cheapest_external ?? null;
  const product = lookupResult?.product ?? null;
  const productId = product?.id ? String(product.id) : '';

  const serverOfferCompare = useCompareOffers(productId || null, regionId.trim() || null, showServerOfferCompare && !!productId, 10);

  const serverRankedOfferIds = useMemo(() => new Set((serverOfferCompare.data?.offers ?? []).map((x: any) => String(x?.offer_id ?? ''))), [serverOfferCompare.data?.offers]);

  const rankedLookupOffers = useMemo(() => {
    if (!offers.length) return offers;
    const serverRows = serverOfferCompare.data?.offers ?? [];
    if (!serverRows.length) return offers;

    const localById = new Map(offers.map((o: any) => [String(o.id ?? ''), o] as const));
    const used = new Set<string>();
    const ordered: any[] = [];

    for (const row of serverRows) {
      const id = String(row?.offer_id ?? '');
      const match = localById.get(id);
      if (!match) continue;
      ordered.push(match);
      used.add(id);
    }
    for (const offer of offers) {
      const id = String((offer as any)?.id ?? '');
      if (!used.has(id)) ordered.push(offer);
    }
    return ordered;
  }, [offers, serverOfferCompare.data?.offers]);

  const visibleLookupOffers = useMemo(() => {
    const list = rankedLookupOffers;
    if (offersFilter === 'all') return list;
    if (offersFilter === 'trusted') {
      return list.filter((o: any) => !isSuspectedOffer(o) && ((o as any).in_stock !== false));
    }
    return list.filter((o: any) => !isSuspectedOffer(o));
  }, [rankedLookupOffers, offersFilter]);

  const bestOpenOfferUrl = useMemo(() => {
    const bestServer = serverOfferCompare.data?.best_offer;
    if (bestServer?.product_url) return String(bestServer.product_url);
    const firstLocal = visibleLookupOffers.find((o: any) => (o as any).product_url);
    return firstLocal?.product_url ? String(firstLocal.product_url) : null;
  }, [serverOfferCompare.data?.best_offer, visibleLookupOffers]);

  useEffect(() => {
    setShowServerOfferCompare(false);
  }, [productId]);

  const barcodeApi = useMemo(() => {
    const ctor = (window as any)?.BarcodeDetector;
    return typeof ctor === 'function' ? ctor : null;
  }, []);

  useEffect(() => {
    setCameraSupported(!!navigator.mediaDevices?.getUserMedia);
  }, [barcodeApi]);

  const stopCamera = async () => {
    setCameraOn(false);
    setCameraMode(null);
    if (scanTimerRef.current) {
      window.clearInterval(scanTimerRef.current);
      scanTimerRef.current = null;
    }

    // stop ZXing reader if running
    try {
      zxingControlsRef.current?.stop?.();
    } catch {
      // ignore
    }
    zxingControlsRef.current = null;
    zxingReaderRef.current = null;

    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) track.stop();
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
  };

  useEffect(() => () => {
    void stopCamera();
  }, []);

  const runResolve = async (text?: string) => {
    const q = (text ?? input).trim();
    if (!q) return null;
    setLoadingResolve(true);
    setError(null);
    try {
      const url = `${API_BASE}/views/qr_resolve?text=${encodeURIComponent(q)}`;
      const data = await fetchJson<ResolveResult>(url);
      setResolveResult(data);
      return data;
    } catch (e: any) {
      setResolveResult(null);
      setError(e?.message || 'فشل تحليل الكود');
      return null;
    } finally {
      setLoadingResolve(false);
    }
  };

  const runLookup = async (text?: string) => {
    const q = (text ?? input).trim();
    if (!q) return null;
    setLoadingLookup(true);
    setError(null);
    try {
      const params = new URLSearchParams({ text: q });
      if (regionId.trim()) params.set('region_id', regionId.trim());
      const url = `${API_BASE}/views/lookup_by_qr?${params.toString()}`;
      const data = await fetchJson<LookupResult>(url);
      setLookupResult(data);
      setResolveResult((prev) => prev ?? ({ ok: !!data.resolved_code, code: data.resolved_code ?? null, source: 'lookup', candidates: data.candidates ?? [] } as ResolveResult));
      return data;
    } catch (e: any) {
      setLookupResult(null);
      setError(e?.message || 'فشل البحث بالـ QR/Barcode');
      return null;
    } finally {
      setLoadingLookup(false);
    }
  };

  const handleResolve = async () => {
    await runResolve();
  };

  const handleLookup = async () => {
    await runLookup();
  };

  const startCamera = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('الجهاز/المتصفح لا يدعم تشغيل الكاميرا');
      return;
    }
    setCameraError(null);
    setError(null);

    try {
      // Prefer native BarcodeDetector when available
      if (barcodeApi) {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      const detector = new (barcodeApi as any)({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'qr_code'] });
      setCameraOn(true);
      setCameraMode('barcode');

      scanTimerRef.current = window.setInterval(async () => {
        try {
          if (!videoRef.current) return;
          const codes = await detector.detect(videoRef.current);
          if (!Array.isArray(codes) || !codes.length) return;
          const rawValue = String(codes[0]?.rawValue ?? '').trim();
          if (!rawValue || rawValue === lastDetectedRef.current) return;
          lastDetectedRef.current = rawValue;
          setInput(rawValue);
          const resolved = await runResolve(rawValue);
          if (autoLookup && (resolved?.code || rawValue)) {
            await runLookup(resolved?.code ?? rawValue);
          }
        } catch {
          // ignore intermittent detector errors while streaming
        }
      }, 700);
      return;
      }

      // Fallback: ZXing (works on Brave / browsers without BarcodeDetector)
      setCameraOn(true);
      setCameraMode('zxing');
      const mod = await import('@zxing/browser');
      const Reader = (mod as any).BrowserMultiFormatReader;
      if (!Reader) {
        throw new Error('تعذر تحميل ZXing');
      }
      const reader = new Reader();
      zxingReaderRef.current = reader;

      if (!videoRef.current) throw new Error('video element غير جاهز');
      const controls = await reader.decodeFromVideoDevice(
        null,
        videoRef.current,
        async (result: any) => {
          if (!result) return;
          const rawValue = String(result.getText ? result.getText() : result.text ?? '').trim();
          if (!rawValue || rawValue === lastDetectedRef.current) return;
          lastDetectedRef.current = rawValue;
          setInput(rawValue);
          const resolved = await runResolve(rawValue);
          if (autoLookup && (resolved?.code || rawValue)) {
            await runLookup(resolved?.code ?? rawValue);
          }
        },
      );
      zxingControlsRef.current = controls;
    } catch (e: any) {
      setCameraError(e?.message || 'تعذر تشغيل الكاميرا');
      await stopCamera();
    }
  };

  return (
    <RTLLayout>
      <PageContainer className="py-6 md:py-8">
        <div className="mb-6">
          <h1 className="text-2xl md:text-3xl font-bold text-foreground">مسح QR / Barcode</h1>
          <p className="text-sm text-muted-foreground mt-2">بحث حقيقي عن المنتج والعروض باستخدام QR أو الباركود</p>
        </div>
      <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardHeader>
            <CardTitle>إدخال أو مسح الكود</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="ألصق نص QR أو الباركود (EAN/UPC/SKU)"
                dir="ltr"
              />
              <Button onClick={handleResolve} disabled={loadingResolve || !input.trim()} variant="secondary">
                {loadingResolve ? '...تحليل' : 'تحليل'}
              </Button>
              <Button onClick={handleLookup} disabled={loadingLookup || !input.trim()}>
                {loadingLookup ? '...بحث' : 'بحث'}
              </Button>
            </div>

            <div className="grid gap-3 sm:grid-cols-[1fr_auto] items-center">
              <Input
                value={regionId}
                onChange={(e) => setRegionId(e.target.value)}
                placeholder="region_id اختياري"
                dir="ltr"
              />
              <label className="text-sm flex items-center gap-2 select-none">
                <input type="checkbox" checked={autoLookup} onChange={(e) => setAutoLookup(e.target.checked)} />
                بحث تلقائي بعد المسح
              </label>
            </div>

            <div className="rounded-md border p-3 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={cameraSupported ? 'default' : 'secondary'}>
                  {cameraSupported ? 'الكاميرا مدعومة' : 'الكاميرا غير مدعومة'}
                </Badge>
                <Badge variant="outline">
                  {cameraMode === 'zxing'
                    ? 'ZXing'
                    : barcodeApi
                      ? 'BarcodeDetector'
                      : 'ZXing (fallback)'}
                </Badge>
                {!cameraOn ? (
                  <Button type="button" variant="outline" onClick={startCamera} disabled={!cameraSupported}>
                    تشغيل الكاميرا
                  </Button>
                ) : (
                  <Button type="button" variant="outline" onClick={stopCamera}>
                    إيقاف الكاميرا
                  </Button>
                )}
              </div>

              {cameraError ? <p className="text-sm text-destructive">{cameraError}</p> : null}

              <video ref={videoRef} className="w-full rounded-md bg-black/80 min-h-56 object-cover" playsInline muted autoPlay />
              <p className="text-xs text-muted-foreground">
                ملاحظة: إذا BarcodeDetector غير مدعوم أو المتصفح يمنع الكاميرا (Brave)، يتم استخدام ZXing تلقائيًا.
              </p>
            </div>

            {error ? (
              <Alert variant="destructive">
                <AlertTitle>خطأ</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>نتيجة التحليل</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-muted-foreground">الكود المستخرج:</span>
                <Badge variant={resolvedCode ? 'default' : 'secondary'}>{resolvedCode || '—'}</Badge>
              </div>
              <div>
                <span className="text-muted-foreground">المصدر: </span>
                <span>{resolveResult?.source ?? '—'}</span>
              </div>
              {!!resolveResult?.candidates?.length && (
                <div>
                  <div className="text-muted-foreground mb-1">مرشحات الكود:</div>
                  <div className="flex gap-2 flex-wrap">
                    {resolveResult.candidates.map((c) => (
                      <button
                        key={c}
                        type="button"
                        className="text-xs px-2 py-1 rounded border hover:bg-muted"
                        onClick={() => {
                          setInput(c);
                          void runLookup(c);
                        }}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>نتيجة البحث</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {!lookupResult ? (
                <p className="text-sm text-muted-foreground">لسه ماكو نتيجة. حلل أو ابحث بكود.</p>
              ) : !product && !externalCatalog ? (
                <p className="text-sm text-muted-foreground">ما لقينا منتج مرتبط بهذا الكود حالياً، لا داخلياً ولا من المصدر الخارجي.</p>
              ) : (
                <>
                  {lookupResult?.resolution ? (
                    <div className="rounded-md border p-2 text-xs text-muted-foreground">
                      نوع المطابقة: <span className="font-medium text-foreground">{String(lookupResult.resolution.match_type ?? '—')}</span>
                      {typeof lookupResult.resolution.confidence === 'number' ? (
                        <span> · ثقة: {Math.round(Number(lookupResult.resolution.confidence) * 100)}%</span>
                      ) : null}
                      {lookupResult.identifier_type ? <span> · المعرّف: {String(lookupResult.identifier_type)}</span> : null}
                    </div>
                  ) : null}

                  {externalCatalog && !product ? (
                    <div className="rounded-lg border p-3 space-y-3">
                      <div className="text-sm font-medium">نتيجة خارجية مسترجعة</div>
                      <div className="flex gap-3 items-start">
                        {externalCatalog.image_url ? (
                          <img
                            src={String(externalCatalog.image_url)}
                            alt={String(externalCatalog.name ?? 'external-product')}
                            className="w-20 h-20 rounded-md object-cover border bg-muted"
                            loading="lazy"
                          />
                        ) : null}
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold line-clamp-2">{String(externalCatalog.name ?? 'منتج خارجي')}</div>
                          {externalCatalog.brand ? <div className="text-sm text-muted-foreground">{String(externalCatalog.brand)}</div> : null}
                          {externalCatalog.quantity ? <div className="text-xs text-muted-foreground">الحجم: {String(externalCatalog.quantity)}</div> : null}
                          <div className="text-xs text-muted-foreground mt-1">المصدر: {String(externalCatalog.source ?? 'external')}</div>
                          {externalCatalog.source_url ? (
                            <a href={String(externalCatalog.source_url)} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline mt-1 inline-block">
                              فتح مصدر التعرف الخارجي
                            </a>
                          ) : null}
                        </div>
                      </div>

                      {cheapestExternal ? (
                        <div className="rounded-md border p-2 text-sm">
                          <div className="font-medium mb-1">أرخص نتيجة مطابقة داخل السوق الحالي</div>
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <div>
                              <div className="font-semibold">{String(cheapestExternal.merchant_name ?? cheapestExternal.source_domain ?? 'مصدر')}</div>
                              {cheapestExternal.observed_at ? <div className="text-xs text-muted-foreground">آخر تحديث: {String(cheapestExternal.observed_at)}</div> : null}
                            </div>
                            <div className="font-bold">{formatIQDPrice(Number(cheapestExternal.final_price ?? 0))} د.ع</div>
                          </div>
                          {cheapestExternal.source_url ? (
                            <a href={String(cheapestExternal.source_url)} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline mt-1 inline-block">
                              فتح أرخص نتيجة
                            </a>
                          ) : null}
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">تم التعرف على المنتج خارجياً، لكن بعد ما عدنا مطابقات سعرية داخل السوق المحلي الحالي.</p>
                      )}

                      {externalPrices.length > 0 ? (
                        <div className="space-y-2">
                          <div className="text-sm font-medium">مطابقات سعرية محتملة ({externalPrices.length})</div>
                          {externalPrices.slice(0, 5).map((offer, idx) => (
                            <div key={String((offer as any).offer_id ?? idx)} className="rounded-md border p-2 text-sm">
                              <div className="flex items-center justify-between gap-2 flex-wrap">
                                <div className="font-medium truncate">{String((offer as any).merchant_name ?? (offer as any).source_name_ar ?? 'متجر')}</div>
                                <div className="font-semibold">{formatIQDPrice(Number((offer as any).final_price ?? 0))} د.ع</div>
                              </div>
                              <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-3">
                                {typeof (offer as any).match_confidence === 'number' ? <span>ثقة المطابقة: {Math.round(Number((offer as any).match_confidence) * 100)}%</span> : null}
                                {(offer as any).observed_at ? <span>آخر تحديث: {String((offer as any).observed_at)}</span> : null}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {product ? (
                    <>
                      <div className="flex gap-3 items-start">
                        {product.image_url ? (
                          <img
                            src={String(product.image_url)}
                            alt={String(product.name_ar ?? product.name_en ?? 'product')}
                            className="w-20 h-20 rounded-md object-cover border bg-muted"
                            loading="lazy"
                          />
                        ) : null}
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold line-clamp-2">{String(product.name_ar ?? product.name_en ?? 'منتج')}</div>
                          {product.brand_ar || product.brand_en ? (
                            <div className="text-sm text-muted-foreground">{String(product.brand_ar ?? product.brand_en)}</div>
                          ) : null}
                          <div className="text-xs text-muted-foreground mt-1">ID: {String(product.id ?? '—')}</div>
                          {product.barcode ? <div className="text-xs text-muted-foreground">Barcode: {String(product.barcode)}</div> : null}
                          <div className="mt-2 flex flex-wrap gap-2">
                            {product.id ? (
                              <Link to={`/explore/${String(product.id)}`}>
                                <Button size="sm" variant="outline">فتح صفحة المنتج</Button>
                              </Link>
                            ) : null}
                            {product.id ? (
                              <Button size="sm" onClick={() => setShowServerOfferCompare((v) => !v)}>
                                {showServerOfferCompare ? 'إخفاء مقارنة أفضل العروض' : 'قارن أفضل العروض'}
                              </Button>
                            ) : null}
                          </div>
                        </div>
                      </div>

                      {showServerOfferCompare && productId ? (
                        <div className="rounded-lg border p-3 space-y-3">
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-sm font-medium">تحليل أفضل العروض من السيرفر</div>
                            {serverOfferCompare.data?.best_offer ? <Badge variant="secondary">أفضل عرض مُوصى به</Badge> : null}
                          </div>

                          {serverOfferCompare.isLoading || serverOfferCompare.isFetching ? (
                            <p className="text-sm text-muted-foreground">جاري تحليل العروض...</p>
                          ) : serverOfferCompare.error ? (
                            <p className="text-sm text-destructive">{(serverOfferCompare.error as Error).message}</p>
                          ) : !serverOfferCompare.data?.offers?.length ? (
                            <p className="text-sm text-muted-foreground">لا توجد بيانات مقارنة كافية لهذا المنتج حالياً.</p>
                          ) : (
                            <div className="space-y-2">
                              {serverOfferCompare.data.offers.slice(0, 5).map((offer: any, idx: number) => {
                                const finalPrice = Number(offer?.final_price ?? 0);
                                const deliveryFee = Number(offer?.delivery_fee ?? 0);
                                const score = Number(offer?.comparison?.breakdown?.total ?? 0);
                                const reasons = Array.isArray(offer?.comparison?.reasons) ? offer.comparison.reasons : [];
                                return (
                                  <div key={String(offer?.offer_id ?? idx)} className="rounded-md border p-2 text-sm">
                                    <div className="flex items-center justify-between gap-2 flex-wrap">
                                      <div className="flex items-center gap-2 flex-wrap">
                                        <Badge variant={idx === 0 ? 'default' : 'outline'}>#{idx + 1}</Badge>
                                        <div className="font-medium truncate">{String(offer?.merchant_name ?? offer?.source_name_ar ?? 'متجر')}</div>
                                        {isSuspectedOffer(offer) ? <Badge variant="destructive">سعر مشتبه</Badge> : null}
                                      </div>
                                      <div className="font-semibold">{formatIQDPrice(finalPrice)} د.ع</div>
                                    </div>
                                    <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-3">
                                      <span>سكور: {Number.isFinite(score) ? score.toFixed(1) : '0.0'}</span>
                                      {deliveryFee > 0 ? <span>توصيل: {formatIQDPrice(deliveryFee)} د.ع</span> : null}
                                      {offer?.in_stock === false ? <span>غير متوفر</span> : null}
                                      {offer?.observed_at ? <span>آخر تحديث: {String(offer.observed_at)}</span> : null}
                                    </div>
                                    {reasons[0] ? <div className="text-xs text-muted-foreground mt-1">{String(reasons[0])}</div> : null}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      ) : null}

                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div className="text-sm font-medium">العروض الحالية ({offers.length})</div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <Button size="sm" variant={offersFilter === 'all' ? 'default' : 'outline'} onClick={() => setOffersFilter('all')}>الكل</Button>
                            <Button size="sm" variant={offersFilter === 'hide_suspected' ? 'default' : 'outline'} onClick={() => setOffersFilter('hide_suspected')}>إخفاء المشتبه</Button>
                            <Button size="sm" variant={offersFilter === 'trusted' ? 'default' : 'outline'} onClick={() => setOffersFilter('trusted')}>موثوق/متوفر</Button>
                            {bestOpenOfferUrl ? (
                              <a href={bestOpenOfferUrl} target="_blank" rel="noreferrer">
                                <Button size="sm">فتح أفضل عرض</Button>
                              </a>
                            ) : null}
                          </div>
                        </div>
                        {offers.length === 0 ? (
                          <p className="text-sm text-muted-foreground">ماكو عروض حالياً لهذا المنتج.</p>
                        ) : (
                          <div className="space-y-2">
                            {visibleLookupOffers.length !== offers.length ? (
                              <p className="text-xs text-muted-foreground">معروض {visibleLookupOffers.length} من أصل {offers.length} بعد الفلترة.</p>
                            ) : null}
                            {visibleLookupOffers.slice(0, 10).map((offer, idx) => {
                              const currentPrice = Number(offer.final_price ?? offer.display_price_iqd ?? 0);
                              const suspected = Boolean((offer as any).is_suspected ?? (offer as any).is_price_suspected ?? false);
                              const relBadge = (offer as any).reliability_badge;
                              const conf = (offer as any).price_confidence;
                              const reasons = (offer as any).confidence_reasons;
                              return (
                                <div key={String(offer.id ?? idx)} className="rounded-md border p-2 text-sm">
                                  <div className="flex items-center justify-between gap-2 flex-wrap">
                                    <div className="flex items-center gap-2 min-w-0">
                                      <div className="font-medium truncate">{String(offer.store_name ?? offer.source_name ?? 'متجر')}</div>
                                      <OfferReliabilityBadge
                                        badge={relBadge ?? (suspected ? 'suspected' : 'medium')}
                                        confidence={typeof conf === 'number' ? conf : null}
                                        reasons={Array.isArray(reasons) ? reasons : null}
                                      />
                                      {serverRankedOfferIds.has(String((offer as any).id ?? '')) ? <Badge variant="outline">ترتيب السيرفر</Badge> : null}
                                      {suspected ? <Badge variant="destructive">سعر مشتبه</Badge> : null}
                                    </div>
                                    <div className="font-semibold">{formatIQDPrice(currentPrice)} د.ع</div>
                                  </div>
                                  <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-3">
                                    {(offer as any).delivery_fee_iqd ? <span>توصيل: {formatIQDPrice(Number((offer as any).delivery_fee_iqd))} د.ع</span> : null}
                                    {offer.observed_at ? <span>آخر تحديث: {String(offer.observed_at)}</span> : null}
                                    {offer.availability_status ? <span>التوفر: {String(offer.availability_status)}</span> : null}
                                  </div>
                                  {offer.product_url ? (
                                    <a href={String(offer.product_url)} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline mt-1 inline-block">
                                      فتح رابط المصدر
                                    </a>
                                  ) : null}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </>
                  ) : null}
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
      </PageContainer>
    </RTLLayout>
  );
}
