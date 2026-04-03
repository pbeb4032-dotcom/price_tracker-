/**
 * Product card showing best offer with price quality badge.
 */

import { Link } from 'react-router-dom';
import { MapPin, Clock, Tag, ShieldCheck, AlertTriangle, FlaskConical } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { OfferReliabilityBadge } from '@/components/offers/OfferReliabilityBadge';
import { CategoryConfidenceBadge } from '@/components/offers/CategoryConfidenceBadge';
import type { BestOffer, PriceQuality } from '@/lib/offers/types';
import { formatIQDPrice, discountPercent, relativeTimeAr } from '@/lib/offers/normalization';
import { isBlockedImageHost } from '@/lib/ingestion/imageExtractor';
import { getGrocerySubcategoryLabel } from '@/lib/offers/groceryTaxonomy';

interface ProductCardProps {
  offer: BestOffer;
}

const IMG_FALLBACK = '/placeholder.svg';

function getSafeImageUrl(url: string | null): string {
  if (!url) return IMG_FALLBACK;
  if (isBlockedImageHost(url)) return IMG_FALLBACK;
  return url;
}

const QUALITY_CONFIG: Record<PriceQuality, { label: string; icon: React.ElementType; className: string }> = {
  trusted: {
    label: 'موثّق',
    icon: ShieldCheck,
    className: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/20',
  },
  provisional: {
    label: 'قيد التحقق',
    icon: AlertTriangle,
    className: 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/20',
  },
  synthetic: {
    label: 'غير موثّق بعد',
    icon: FlaskConical,
    className: 'bg-muted text-muted-foreground border-border',
  },
};

export function ProductCard({ offer }: ProductCardProps) {
  const finalPriceNum =
    typeof offer.final_price === 'number'
      ? offer.final_price
      : offer.final_price != null
        ? Number(offer.final_price)
        : null;

  const basePriceNum =
    typeof offer.base_price === 'number'
      ? offer.base_price
      : offer.base_price != null
        ? Number(offer.base_price)
        : null;

  const hasPrice = Number.isFinite(finalPriceNum as number) && (finalPriceNum as number) > 0;
  const discount = hasPrice ? discountPercent(basePriceNum ?? null, finalPriceNum ?? null) : null;

  const imageUrl = getSafeImageUrl(offer.product_image_url);
  const hasRealImage = imageUrl !== IMG_FALLBACK;

  const qualityKey = (offer.price_quality ?? 'synthetic') as PriceQuality;
  const quality = QUALITY_CONFIG[qualityKey] ?? QUALITY_CONFIG.synthetic;
  const QualityIcon = quality.icon;

  const reliabilityBadge = (offer as any).reliability_badge;
  const categoryBadge = (offer as any).category_badge;
  const categoryConfidence = (offer as any).category_confidence;
  const categoryReasons = (offer as any).category_reasons;
  const categoryConflict = Boolean((offer as any).category_conflict ?? false);
  const confidence = (offer as any).price_confidence;
  const reasons = (offer as any).confidence_reasons;
  const isSuspected = Boolean((offer as any).is_price_suspected ?? (offer as any).is_price_anomaly ?? false);

  const productName = offer.product_name_ar || offer.product_name_en || 'منتج بدون اسم';
  const grocerySubLabel = offer.category === 'groceries' ? getGrocerySubcategoryLabel((offer as any).subcategory) : null;

  return (
    <Card className="group overflow-hidden border-border hover:border-primary/30 hover:shadow-md transition-all duration-200">
      <Link to={`/explore/${offer.product_id}`} className="block">
        {/* Image */}
        <div className="relative aspect-square bg-muted overflow-hidden">
          {hasRealImage ? (
            <img
              src={imageUrl}
              alt={productName}
              loading="lazy"
              className="h-full w-full object-contain p-4 transition-transform group-hover:scale-105"
              onError={(e) => { e.currentTarget.src = IMG_FALLBACK; }}
            />
          ) : (
            <div className="h-full w-full flex items-center justify-center p-4">
              <span className="text-xs text-muted-foreground text-center">لا توجد صورة موثقة</span>
            </div>
          )}

          {!!discount && (
            <Badge className="absolute top-2 left-2 bg-destructive text-destructive-foreground text-xs font-bold">
              -{discount}%
            </Badge>
          )}

          {offer.in_stock === false && (
            <div className="absolute inset-0 bg-background/60 flex items-center justify-center">
              <span className="text-muted-foreground font-medium">غير متوفر</span>
            </div>
          )}
        </div>

        <CardContent className="p-3 space-y-2">
          {/* Product name */}
          <h3 className="font-medium text-card-foreground text-sm leading-tight line-clamp-2 min-h-[2.5rem]">
            {productName}
          </h3>

          {/* Brand + Size */}
          {(offer.brand_ar || offer.brand_en || offer.size_value) && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              {(offer.brand_ar || offer.brand_en) && <span>{offer.brand_ar || offer.brand_en}</span>}
              {(offer.brand_ar || offer.brand_en) && offer.size_value && <span>·</span>}
              {offer.size_value && <span>{offer.size_value} {offer.size_unit}</span>}
            </div>
          )}

          {/* Grocery subcategory */}
          {grocerySubLabel && (
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="text-[10px]">
                {grocerySubLabel}
              </Badge>
            </div>
          )}

          {/* Price + Quality badge */}
          <div className="space-y-1.5">
            {hasPrice ? (
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="text-lg font-bold text-primary font-display">
                  {formatIQDPrice(finalPriceNum as number)}
                </span>
                <span className="text-xs text-muted-foreground">د.ع</span>
                {!!discount && !!basePriceNum && (
                  <span className="text-xs text-muted-foreground line-through">
                    {formatIQDPrice(basePriceNum)}
                  </span>
                )}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">
                السعر غير متاح حالياً
              </div>
            )}

            {/* Quality badge */}
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className={`text-[10px] gap-1 font-normal ${quality.className}`}>
                <QualityIcon className="h-3 w-3" />
                {quality.label}
              </Badge>
              <OfferReliabilityBadge
                badge={reliabilityBadge ?? (isSuspected ? 'suspected' : 'medium')}
                confidence={typeof confidence === 'number' ? confidence : null}
                reasons={Array.isArray(reasons) ? reasons : null}
              />
              <CategoryConfidenceBadge
                badge={categoryBadge}
                confidence={typeof categoryConfidence === 'number' ? categoryConfidence : null}
                reasons={Array.isArray(categoryReasons) ? categoryReasons : null}
                conflict={categoryConflict}
              />
            </div>

            {/* توضيح للسعر غير الموثق حتى ما المستخدم يفكر ماكو عروض */}
            {hasPrice && offer.is_price_trusted === false && (
              <p className="text-[10px] text-muted-foreground">
                السعر ظاهر مبدئيًا وقد يتغير بعد التحقق
              </p>
            )}
          </div>

          {/* Price samples */}
          {(offer.price_samples ?? 0) > 0 && (
            <p className="text-xs text-muted-foreground">
              {offer.price_samples} مصادر
            </p>
          )}

          {/* Source + Location + Time */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground pt-1 border-t border-border">
            {!!offer.source_name_ar && (
              <span className="flex items-center gap-1">
                <Tag className="h-3 w-3" aria-hidden="true" />
                {offer.source_name_ar}
              </span>
            )}

            {!!offer.region_name_ar && (
              <span className="flex items-center gap-1">
                <MapPin className="h-3 w-3" aria-hidden="true" />
                {offer.region_name_ar}
              </span>
            )}

            {!!offer.observed_at && (
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" aria-hidden="true" />
                {relativeTimeAr(offer.observed_at)}
              </span>
            )}
          </div>
        </CardContent>
      </Link>
    </Card>
  );
}