/**
 * Product offers detail page — all offers for a specific product.
 */

import { useMemo } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { RTLLayout, PageContainer } from '@/components/layout';
import { OfferRow, EmptyState, PriceHistoryChart } from '@/components/offers';
import { PriceAlertsCard } from '@/components/offers/PriceAlertsCard';
import { useProductOffers } from '@/hooks/offers/useProductOffers';
import { useProductImages } from '@/hooks/offers/useProductImages';
import { ProductImageGallery } from '@/components/offers/ProductImageGallery';
import { useSeoMeta } from '@/lib/seo/useSeoMeta';
import { formatIQDPrice, discountPercent } from '@/lib/offers/normalization';
import { getBestOfferReason, rankOffers } from '@/lib/offers/ranking';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { useCompareOffers, type ApiOfferComparisonRow } from '@/hooks/offers/useApiComparisons';
import type { ProductOffer } from '@/lib/offers/types';

const ProductOffers = () => {
  const { productId } = useParams<{ productId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const regionId = searchParams.get('region') || null;
  const handleRegionChange = (val: string | null) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (val) next.set('region', val);
      else next.delete('region');
      return next;
    }, { replace: true });
  };
  const { data: offers, isLoading, error } = useProductOffers(productId);
  const { data: productImages } = useProductImages(productId);
  const serverOfferCompare = useCompareOffers(productId, regionId, Boolean(productId), 30);

  const rankedLocal = offers ? rankOffers(offers) : [];

  const comparisonByOfferId = useMemo(() => {
    const map = new Map<string, ApiOfferComparisonRow>();
    for (const row of serverOfferCompare.data?.offers ?? []) {
      if (row.offer_id) map.set(String(row.offer_id), row);
    }
    return map;
  }, [serverOfferCompare.data?.offers]);

  const ranked = useMemo(() => {
    if (!rankedLocal.length) return [];
    const serverOrder = (serverOfferCompare.data?.offers ?? [])
      .map((row) => row.offer_id)
      .filter((id): id is string => Boolean(id));

    if (!serverOrder.length) return rankedLocal;

    const localById = new Map(rankedLocal.map((o) => [String(o.offer_id), o] as const));
    const ordered: ProductOffer[] = [];
    const used = new Set<string>();

    for (const offerId of serverOrder) {
      const match = localById.get(String(offerId));
      if (!match) continue;
      ordered.push(match);
      used.add(String(match.offer_id));
    }

    for (const item of rankedLocal) {
      const id = String(item.offer_id);
      if (!used.has(id)) ordered.push(item);
    }

    return ordered;
  }, [rankedLocal, serverOfferCompare.data?.offers]);

  const best = ranked[0];
  const bestServerRow = best ? comparisonByOfferId.get(String(best.offer_id)) : undefined;
  const bestServerReasons = (bestServerRow?.comparison?.reasons ?? []).filter((x): x is string => typeof x === 'string');

  useSeoMeta({
    title: best
      ? `${best.product_name_ar} — مقارنة الأسعار | شكد عادل`
      : 'مقارنة الأسعار — شكد عادل',
    description: best
      ? `قارن ${ranked.length} عرض لـ ${best.product_name_ar} من مصادر عراقية. أفضل سعر: ${formatIQDPrice(best.final_price)} د.ع`
      : 'قارن أسعار المنتجات من جميع المصادر العراقية.',
  });

  return (
    <RTLLayout>
      <PageContainer className="py-6 md:py-8">
        <nav className="flex items-center gap-2 text-sm text-muted-foreground mb-6">
          <Link to="/explore" className="hover:text-primary transition-colors">
            استكشاف
          </Link>
          <ArrowRight className="h-3 w-3 rotate-180" />
          <span className="text-foreground font-medium truncate">
            {best?.product_name_ar ?? 'تفاصيل المنتج'}
          </span>
        </nav>

        {isLoading ? (
          <ProductOffersSkeleton />
        ) : error || !ranked.length ? (
          <EmptyState variant="no-data" />
        ) : (
          <>
            <div className="flex flex-col md:flex-row gap-6 mb-8">
              <ProductImageGallery
                images={productImages ?? []}
                fallbackUrl={best.product_image_url}
                productName={best.product_name_ar}
                className="flex-shrink-0 w-full md:w-64"
              />

              <div className="flex-1 space-y-3">
                <h1 className="text-2xl md:text-3xl font-bold text-foreground">
                  {best.product_name_ar}
                </h1>
                {best.product_name_en && (
                  <p className="text-muted-foreground ltr">{best.product_name_en}</p>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">{best.category}</Badge>
                  {best.brand_ar && <Badge variant="outline">{best.brand_ar}</Badge>}
                  {best.unit && <Badge variant="outline">{best.unit}</Badge>}
                  {serverOfferCompare.data?.offers?.length ? (
                    <Badge variant="outline" className="border-primary/30 text-primary">
                      ترتيب ذكي من السيرفر
                    </Badge>
                  ) : null}
                </div>

                <div className="p-4 rounded-xl bg-primary/5 border border-primary/20">
                  <div className="text-xs text-muted-foreground mb-1">أفضل سعر</div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-bold text-primary font-display">
                      {formatIQDPrice(best.final_price)}
                    </span>
                    <span className="text-sm text-muted-foreground">د.ع</span>
                    {discountPercent(best.base_price, best.final_price) && (
                      <Badge className="bg-destructive text-destructive-foreground">
                        -{discountPercent(best.base_price, best.final_price)}%
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {getBestOfferReason(best, ranked)}
                  </p>
                  {bestServerReasons.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {bestServerReasons.slice(0, 3).map((reason) => (
                        <Badge key={reason} variant="outline" className="text-[11px]">
                          {reason}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>

                <p className="text-sm text-muted-foreground">
                  {ranked.length} عرض من {new Set(ranked.map((o) => o.source_name_ar)).size} مصدر
                </p>
                {serverOfferCompare.isError && (
                  <p className="text-xs text-amber-600">
                    تعذر تحميل ترتيب السيرفر، تم استخدام الترتيب المحلي كبديل.
                  </p>
                )}
              </div>
            </div>

            {productId && (
              <div className="mb-8">
                <PriceHistoryChart productId={productId} regionId={regionId} onRegionChange={handleRegionChange} />
              </div>
            )}

            {productId && (
              <div className="mb-8">
                <PriceAlertsCard productId={productId} regionId={regionId} />
              </div>
            )}

            <section>
              <div className="flex items-center justify-between gap-3 mb-4">
                <h2 className="text-lg font-semibold text-foreground">كل العروض المتاحة</h2>
                {serverOfferCompare.data?.best_offer?.final_price != null ? (
                  <Badge variant="secondary" className="whitespace-nowrap">
                    الأفضل فعليًا: {formatIQDPrice(Number(serverOfferCompare.data.best_offer.final_price))} د.ع
                  </Badge>
                ) : null}
              </div>
              <div className="space-y-3">
                {ranked.map((offer, i) => {
                  const compareRow = comparisonByOfferId.get(String(offer.offer_id));
                  const reasons = (compareRow?.comparison?.reasons ?? []).filter((x): x is string => typeof x === 'string');
                  const score = typeof compareRow?.comparison?.breakdown?.total === 'number'
                    ? Math.round(Number(compareRow.comparison?.breakdown?.total) * 100)
                    : null;
                  return (
                    <div key={offer.offer_id} className="space-y-2">
                      <OfferRow offer={offer} rank={i + 1} />
                      {(score !== null || reasons.length > 0) && (
                        <div className="px-3 pb-2 flex flex-wrap gap-2">
                          {score !== null && (
                            <Badge variant="outline" className="text-[11px]">
                              سكّور المقارنة: {score}/100
                            </Badge>
                          )}
                          {reasons.slice(0, 3).map((reason) => (
                            <Badge key={`${offer.offer_id}-${reason}`} variant="outline" className="text-[11px]">
                              {reason}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          </>
        )}
      </PageContainer>
    </RTLLayout>
  );
};

function ProductOffersSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row gap-6">
        <Skeleton className="w-full md:w-64 aspect-square rounded-xl" />
        <div className="flex-1 space-y-3">
          <Skeleton className="h-8 w-3/4" />
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-24 w-full rounded-xl" />
        </div>
      </div>
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className="h-20 w-full rounded-lg" />
      ))}
    </div>
  );
}

export default ProductOffers;
