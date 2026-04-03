/**
 * Single offer row in product detail view.
 */

import { ExternalLink, MapPin, Clock, Truck, Flag } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { OfferReliabilityBadge } from '@/components/offers/OfferReliabilityBadge';
import type { ProductOffer } from '@/lib/offers/types';
import { formatIQDPrice, discountPercent, relativeTimeAr } from '@/lib/offers/normalization';
import { apiPost } from '@/integrations/api/client';
import { toast } from 'sonner';

interface OfferRowProps {
  offer: ProductOffer;
  rank: number;
}

export function OfferRow({ offer, rank }: OfferRowProps) {
  const [reporting, setReporting] = useState<string | null>(null);
  const discount = discountPercent(offer.base_price, offer.final_price);
  const reliabilityBadge = (offer as any).reliability_badge;
  const confidence = (offer as any).price_confidence;
  const reasons = (offer as any).confidence_reasons;
  const isSuspected = Boolean((offer as any).is_price_suspected ?? (offer as any).is_price_anomaly ?? false);
  const crowdTotal = Number((offer as any).crowd_reports_total ?? 0);

  const sendReport = async (type: 'wrong_price' | 'unavailable' | 'duplicate') => {
    try {
      setReporting(type);
      await apiPost('/offers/report', { offer_id: offer.offer_id, report_type: type });
      toast.success('تم إرسال البلاغ — شكرًا لمساعدتك');
    } catch (e: any) {
      const msg = String(e?.message ?? 'فشل إرسال البلاغ');
      if (msg.includes('UNAUTHORIZED')) toast.error('سجّل دخول أولاً');
      else toast.error(msg);
    } finally {
      setReporting(null);
    }
  };

  return (
    <div className="flex items-center gap-4 p-4 rounded-lg border border-border bg-card hover:border-primary/30 hover:shadow-sm transition-all">
      {/* Rank */}
      <div className="flex-shrink-0 flex items-center justify-center w-8 h-8 rounded-full bg-muted text-muted-foreground font-bold text-sm">
        {rank}
      </div>

      {/* Source info */}
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2">
          {offer.source_logo_url && (
            <img
              src={offer.source_logo_url}
              alt=""
              className="h-5 w-5 rounded object-contain"
              loading="lazy"
            />
          )}
          <span className="font-medium text-card-foreground text-sm truncate">
            {offer.merchant_name || offer.source_name_ar}
          </span>
          <OfferReliabilityBadge
            badge={reliabilityBadge ?? (isSuspected ? 'suspected' : 'medium')}
            confidence={typeof confidence === 'number' ? confidence : null}
            reasons={Array.isArray(reasons) ? reasons : null}
          />
          {crowdTotal > 0 && (
            <Badge variant="outline" className="text-xs">
              بلاغات: {crowdTotal}
            </Badge>
          )}
          {discount && (
            <Badge variant="destructive" className="text-xs">
              -{discount}%
            </Badge>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <MapPin className="h-3 w-3" />
            {offer.region_name_ar}
          </span>
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {relativeTimeAr(offer.observed_at)}
          </span>
          {offer.delivery_fee != null && offer.delivery_fee > 0 && (
            <span className="flex items-center gap-1">
              <Truck className="h-3 w-3" />
              توصيل: {formatIQDPrice(offer.delivery_fee)} د.ع
            </span>
          )}
          {!offer.in_stock && (
            <Badge variant="outline" className="text-xs text-destructive border-destructive/30">
              غير متوفر
            </Badge>
          )}
        </div>
      </div>

      {/* Price + Link */}
      <div className="flex-shrink-0 flex flex-col items-end gap-1">
        <div className="flex items-baseline gap-1">
          <span className="text-lg font-bold text-primary font-display">
            {formatIQDPrice(offer.final_price)}
          </span>
          <span className="text-xs text-muted-foreground">د.ع</span>
        </div>
        {discount && (
          <span className="text-xs text-muted-foreground line-through">
            {formatIQDPrice(offer.base_price)}
          </span>
        )}
        <a
          href={offer.source_url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-xs text-primary hover:underline mt-1"
          onClick={(e) => e.stopPropagation()}
        >
          <ExternalLink className="h-3 w-3" />
          عرض المصدر
        </a>

        <div className="flex gap-1 mt-2">
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs"
            disabled={!!reporting}
            onClick={(e) => {
              e.stopPropagation();
              sendReport('wrong_price');
            }}
            title="سعر خاطئ"
          >
            <Flag className="h-3 w-3 ml-1" />
            سعر خطأ
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs"
            disabled={!!reporting}
            onClick={(e) => {
              e.stopPropagation();
              sendReport('unavailable');
            }}
            title="غير متوفر"
          >
            غير متوفر
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs"
            disabled={!!reporting}
            onClick={(e) => {
              e.stopPropagation();
              sendReport('duplicate');
            }}
            title="مكرر"
          >
            مكرر
          </Button>
        </div>
      </div>
    </div>
  );
}
