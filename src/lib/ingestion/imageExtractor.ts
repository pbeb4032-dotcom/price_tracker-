/**
 * Image extraction & filtering utilities for the ingestion pipeline.
 *
 * Extracts product images from raw HTML/payloads, filters low-quality
 * candidates, and provides URL normalization + dedup.
 */

/** Minimum image dimensions to qualify as a product image */
const MIN_WIDTH = 200;
const MIN_HEIGHT = 200;

/** Known patterns for logos/icons/placeholders to exclude */
const EXCLUDED_PATTERNS = [
  /logo/i,
  /favicon/i,
  /icon[_-]?\d*/i,
  /placeholder/i,
  /spinner/i,
  /loading/i,
  /avatar/i,
  /banner[_-]?ad/i,
  /pixel\.gif/i,
  /spacer/i,
  /1x1/i,
  /tracking/i,
  /badge/i,
  /social[_-]/i,
  /share[_-]/i,
  /payment[_-]/i,
  /flag[_-]/i,
];

/** Supported image extensions */
const IMAGE_EXTENSIONS = /\.(jpe?g|png|webp|avif|gif)(\?|$)/i;

/** Raw image candidate from extraction */
export interface RawImageCandidate {
  url: string;
  source: 'og_image' | 'json_ld' | 'gallery' | 'srcset' | 'img_tag' | 'meta';
  width?: number;
  height?: number;
  alt?: string;
}

/** Validated image ready for storage */
export interface ValidatedImage {
  image_url: string;
  source_extraction: string;
  width: number | null;
  height: number | null;
  confidence_score: number;
}

/**
 * Normalize an image URL:
 * - Remove tracking query params
 * - Ensure absolute URL
 * - Strip fragments
 */
export function normalizeImageUrl(url: string, baseUrl?: string): string | null {
  try {
    let absolute = url.trim();
    if (!absolute) return null;

    // Protocol-relative
    if (absolute.startsWith('//')) {
      absolute = `https:${absolute}`;
    }

    // Relative URL
    if (absolute.startsWith('/') && baseUrl) {
      const base = new URL(baseUrl);
      absolute = `${base.origin}${absolute}`;
    }

    const parsed = new URL(absolute);

    // Only HTTPS
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return null;
    }

    // Remove tracking params
    const trackingParams = ['utm_source', 'utm_medium', 'utm_campaign', 'ref', 'fbclid', 'gclid'];
    trackingParams.forEach((p) => parsed.searchParams.delete(p));

    // Remove fragment
    parsed.hash = '';

    return parsed.toString();
  } catch {
    return null;
  }
}
/** Blocked placeholder/random image hosts */
const BLOCKED_HOSTS = [
  'picsum.photos',
  'placehold.co',
  'via.placeholder.com',
  'source.unsplash.com',
  'placeholder.com',
  'dummyimage.com',
  'fakeimg.pl',
  'lorempixel.com',
];

/**
 * Check if an image URL is from a known blocked placeholder host.
 */
export function isBlockedImageHost(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return BLOCKED_HOSTS.some((blocked) => hostname === blocked || hostname.endsWith('.' + blocked));
  } catch {
    return false;
  }
}

/**
 * Check if an image URL matches exclusion patterns (logos, icons, etc.)
 */
export function isExcludedImage(url: string): boolean {
  const path = url.toLowerCase();
  return EXCLUDED_PATTERNS.some((pattern) => pattern.test(path));
}

/**
 * Check if URL looks like a valid product image
 */
export function isProductImageUrl(url: string): boolean {
  if (!url) return false;
  if (isBlockedImageHost(url)) return false;
  if (isExcludedImage(url)) return false;

  // Data URIs are never product images
  if (url.startsWith('data:')) return false;

  // Must be a known image format or a dynamic image URL (CDN)
  const hasExtension = IMAGE_EXTENSIONS.test(url);
  const isCdn = /\/(images?|media|cdn|static|uploads?|products?|assets?)\//i.test(url);

  return hasExtension || isCdn;
}

/**
 * Check if image dimensions meet minimum requirements
 */
export function meetsMinDimensions(
  width: number | undefined | null,
  height: number | undefined | null,
): boolean {
  // If dimensions unknown, assume OK (will be checked later)
  if (width == null || height == null) return true;
  return width >= MIN_WIDTH && height >= MIN_HEIGHT;
}

/**
 * Calculate confidence score for an extracted image candidate
 */
export function calculateImageConfidence(candidate: RawImageCandidate): number {
  let score = 0.5; // base

  // Source bonus
  const sourceScores: Record<string, number> = {
    json_ld: 0.30,
    og_image: 0.25,
    gallery: 0.20,
    srcset: 0.10,
    img_tag: 0.05,
    meta: 0.15,
  };
  score += sourceScores[candidate.source] ?? 0;

  // Dimension bonus
  if (candidate.width && candidate.height) {
    if (candidate.width >= 500 && candidate.height >= 500) score += 0.10;
    else if (candidate.width >= MIN_WIDTH && candidate.height >= MIN_HEIGHT) score += 0.05;
  }

  // Alt text with product-related content
  if (candidate.alt && candidate.alt.length > 5) {
    score += 0.05;
  }

  return Math.min(score, 1.0);
}

/**
 * Filter and validate a list of raw image candidates.
 * Returns deduplicated, quality-filtered images sorted by confidence.
 */
export function filterAndRankImages(
  candidates: RawImageCandidate[],
  baseUrl?: string,
  minConfidence = 0.50,
): ValidatedImage[] {
  const seen = new Set<string>();
  const results: ValidatedImage[] = [];

  for (const c of candidates) {
    const normalized = normalizeImageUrl(c.url, baseUrl);
    if (!normalized) continue;
    if (seen.has(normalized)) continue;
    if (!isProductImageUrl(normalized)) continue;
    if (!meetsMinDimensions(c.width, c.height)) continue;

    const confidence = calculateImageConfidence(c);
    if (confidence < minConfidence) continue;

    seen.add(normalized);
    results.push({
      image_url: normalized,
      source_extraction: c.source,
      width: c.width ?? null,
      height: c.height ?? null,
      confidence_score: Math.round(confidence * 100) / 100,
    });
  }

  // Sort by confidence descending, cap at 8
  return results
    .sort((a, b) => b.confidence_score - a.confidence_score)
    .slice(0, 8);
}

/**
 * Extract image candidates from a JSON-LD structured data object.
 */
export function extractFromJsonLd(jsonLd: Record<string, unknown>): RawImageCandidate[] {
  const results: RawImageCandidate[] = [];

  const images = jsonLd.image;
  if (typeof images === 'string') {
    results.push({ url: images, source: 'json_ld' });
  } else if (Array.isArray(images)) {
    for (const img of images) {
      if (typeof img === 'string') {
        results.push({ url: img, source: 'json_ld' });
      } else if (img && typeof img === 'object' && 'url' in img) {
        results.push({
          url: String((img as Record<string, unknown>).url),
          source: 'json_ld',
          width: Number((img as Record<string, unknown>).width) || undefined,
          height: Number((img as Record<string, unknown>).height) || undefined,
        });
      }
    }
  }

  return results;
}

/**
 * Extract image candidates from raw payload metadata
 * (works with common e-commerce payload shapes).
 */
export function extractImagesFromPayload(
  payload: Record<string, unknown>,
  sourceUrl?: string,
): RawImageCandidate[] {
  const candidates: RawImageCandidate[] = [];

  // og:image
  const ogImage = payload.og_image ?? payload.ogImage ?? payload.open_graph_image;
  if (typeof ogImage === 'string' && ogImage) {
    candidates.push({ url: ogImage, source: 'og_image' });
  }

  // JSON-LD
  const jsonLd = payload.jsonLd ?? payload.json_ld ?? payload.structured_data;
  if (jsonLd && typeof jsonLd === 'object') {
    candidates.push(...extractFromJsonLd(jsonLd as Record<string, unknown>));
  }

  // Gallery / images array
  const gallery = payload.images ?? payload.gallery ?? payload.image_urls ?? payload.photos;
  if (Array.isArray(gallery)) {
    for (const item of gallery) {
      if (typeof item === 'string') {
        candidates.push({ url: item, source: 'gallery' });
      } else if (item && typeof item === 'object') {
        const obj = item as Record<string, unknown>;
        const url = obj.url ?? obj.src ?? obj.image_url;
        if (typeof url === 'string') {
          candidates.push({
            url,
            source: 'gallery',
            width: Number(obj.width) || undefined,
            height: Number(obj.height) || undefined,
            alt: typeof obj.alt === 'string' ? obj.alt : undefined,
          });
        }
      }
    }
  }

  // Single image fields
  const singleFields = ['image', 'image_url', 'main_image', 'primary_image', 'thumbnail_url', 'photo_url'];
  for (const field of singleFields) {
    const val = payload[field];
    if (typeof val === 'string' && val && !candidates.some((c) => c.url === val)) {
      candidates.push({ url: val, source: 'img_tag' });
    }
  }

  return candidates;
}
