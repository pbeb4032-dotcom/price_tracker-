/**
 * Lightweight product card for search engine results.
 */

import { Link } from 'react-router-dom';
import { Tag } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { isBlockedImageHost } from '@/lib/ingestion/imageExtractor';
import type { SearchEngineRow } from '@/hooks/offers/useSearchEngine';

const IMG_FALLBACK = '/placeholder.svg';

function getSafeImageUrl(url: string | null): string {
  if (!url) return IMG_FALLBACK;
  if (isBlockedImageHost(url)) return IMG_FALLBACK;
  return url;
}

function formatPrice(price: number | null): string {
  if (!price || price <= 0) return '—';
  return Math.round(price).toLocaleString('ar-IQ');
}

interface SearchResultCardProps {
  result: SearchEngineRow;
}

export function SearchResultCard({ result }: SearchResultCardProps) {
  const imageUrl = getSafeImageUrl(result.out_image_url);
  const hasRealImage = imageUrl !== IMG_FALLBACK;

  return (
    <Card className="group overflow-hidden border-border hover:border-primary/30 hover:shadow-md transition-all duration-200">
      <Link to={`/explore/${result.out_product_id}`} className="block">
        <div className="relative aspect-square bg-muted overflow-hidden">
          {hasRealImage ? (
            <img
              src={imageUrl}
              alt={result.out_name_ar}
              loading="lazy"
              className="h-full w-full object-contain p-4 transition-transform group-hover:scale-105"
              onError={(e) => { e.currentTarget.src = IMG_FALLBACK; }}
            />
          ) : (
            <div className="h-full w-full flex items-center justify-center p-4">
              <span className="text-xs text-muted-foreground text-center">لا توجد صورة</span>
            </div>
          )}
        </div>

        <CardContent className="p-3 space-y-2">
          <h3 className="font-medium text-card-foreground text-sm leading-tight line-clamp-2 min-h-[2.5rem]">
            {result.out_name_ar}
          </h3>

          {result.out_best_price_iqd && result.out_best_price_iqd > 0 ? (
            <div className="flex items-baseline gap-2">
              <span className="text-lg font-bold text-primary font-display">
                {formatPrice(result.out_best_price_iqd)}
              </span>
              <span className="text-xs text-muted-foreground">د.ع</span>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">السعر غير متوفر</p>
          )}

          {result.out_source_name && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground pt-1 border-t border-border">
              <Tag className="h-3 w-3" aria-hidden="true" />
              {result.out_source_name}
            </div>
          )}
        </CardContent>
      </Link>
    </Card>
  );
}
