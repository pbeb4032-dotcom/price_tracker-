/**
 * Product image gallery with thumbnail navigation.
 * Shows multiple images from product_images table with source attribution.
 */

import { useState, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Badge } from '@/components/ui/badge';
import type { ProductImage } from '@/hooks/offers/useProductImages';

const IMG_FALLBACK = '/placeholder.svg';

interface ProductImageGalleryProps {
  images: ProductImage[];
  fallbackUrl?: string | null;
  productName: string;
  className?: string;
}

export function ProductImageGallery({
  images,
  fallbackUrl,
  productName,
  className,
}: ProductImageGalleryProps) {
  // Build display list: use product_images if available, else fallback
  const displayImages: ProductImage[] = images.length > 0
    ? images
    : fallbackUrl
      ? [{
          id: 'fallback',
          image_url: fallbackUrl,
          source_site: null,
          source_page_url: null,
          position: 0,
          confidence_score: 0.5,
          is_primary: true,
          is_verified: false,
          width: null,
          height: null,
        }]
      : [];

  const [activeIndex, setActiveIndex] = useState(0);
  const [imgError, setImgError] = useState<Set<string>>(new Set());

  const handleError = useCallback((id: string) => {
    setImgError((prev) => new Set(prev).add(id));
  }, []);

  const activeImage = displayImages[activeIndex] ?? displayImages[0];
  const activeSrc = activeImage
    ? (imgError.has(activeImage.id) ? IMG_FALLBACK : activeImage.image_url)
    : IMG_FALLBACK;

  if (displayImages.length === 0) {
    return (
      <div className={cn('relative aspect-square rounded-xl border border-border bg-muted overflow-hidden', className)}>
        <img
          src={IMG_FALLBACK}
          alt={productName}
          className="h-full w-full object-contain p-6"
        />
      </div>
    );
  }

  return (
    <div className={cn('space-y-3', className)}>
      {/* Main image */}
      <div className="relative aspect-square rounded-xl border border-border bg-muted overflow-hidden group">
        <img
          src={activeSrc}
          alt={productName}
          loading="lazy"
          className="h-full w-full object-contain p-4 transition-transform group-hover:scale-105"
          onError={() => activeImage && handleError(activeImage.id)}
        />

        {/* Source attribution badge */}
        {activeImage?.source_site && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge
                  variant="secondary"
                  className="absolute bottom-2 left-2 text-[10px] opacity-70 hover:opacity-100 transition-opacity cursor-help"
                >
                  📷 {activeImage.source_site}
                </Badge>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">
                <p>مصدر الصورة: {activeImage.source_site}</p>
                {activeImage.is_verified && <p className="text-primary">✓ تم التحقق</p>}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}

        {/* Image counter */}
        {displayImages.length > 1 && (
          <span className="absolute top-2 right-2 bg-background/80 text-foreground text-[10px] px-2 py-0.5 rounded-full">
            {activeIndex + 1}/{displayImages.length}
          </span>
        )}
      </div>

      {/* Thumbnails */}
      {displayImages.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {displayImages.map((img, i) => {
            const src = imgError.has(img.id) ? IMG_FALLBACK : img.image_url;
            return (
              <button
                key={img.id}
                onClick={() => setActiveIndex(i)}
                className={cn(
                  'flex-shrink-0 w-14 h-14 rounded-lg border overflow-hidden transition-all',
                  i === activeIndex
                    ? 'border-primary ring-2 ring-primary/30'
                    : 'border-border hover:border-primary/50',
                )}
                aria-label={`صورة ${i + 1}`}
              >
                <img
                  src={src}
                  alt={`${productName} - ${i + 1}`}
                  loading="lazy"
                  className="h-full w-full object-contain p-1"
                  onError={() => handleError(img.id)}
                />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
