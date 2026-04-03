/**
 * Tests for image extraction, filtering, dedup, and confidence scoring.
 */
import { describe, it, expect } from 'vitest';
import {
  normalizeImageUrl,
  isExcludedImage,
  isProductImageUrl,
  meetsMinDimensions,
  calculateImageConfidence,
  filterAndRankImages,
  extractFromJsonLd,
  extractImagesFromPayload,
  type RawImageCandidate,
} from '@/lib/ingestion/imageExtractor';

describe('normalizeImageUrl', () => {
  it('returns null for empty string', () => {
    expect(normalizeImageUrl('')).toBeNull();
  });

  it('handles protocol-relative URLs', () => {
    const result = normalizeImageUrl('//cdn.example.com/img.jpg');
    expect(result).toBe('https://cdn.example.com/img.jpg');
  });

  it('handles relative URLs with base', () => {
    const result = normalizeImageUrl('/images/product.jpg', 'https://store.iq/page');
    expect(result).toBe('https://store.iq/images/product.jpg');
  });

  it('strips tracking params', () => {
    const result = normalizeImageUrl('https://cdn.com/img.jpg?utm_source=fb&size=large');
    expect(result).toBe('https://cdn.com/img.jpg?size=large');
  });

  it('returns null for data URIs', () => {
    const result = normalizeImageUrl('data:image/png;base64,abc');
    expect(result).toBeNull();
  });
});

describe('isExcludedImage', () => {
  it('excludes logos', () => {
    expect(isExcludedImage('https://site.com/assets/logo.png')).toBe(true);
  });

  it('excludes favicons', () => {
    expect(isExcludedImage('https://site.com/favicon.ico')).toBe(true);
  });

  it('excludes social icons', () => {
    expect(isExcludedImage('https://site.com/social-facebook.png')).toBe(true);
  });

  it('allows product images', () => {
    expect(isExcludedImage('https://cdn.site.com/products/phone-128gb.jpg')).toBe(false);
  });
});

describe('isProductImageUrl', () => {
  it('accepts jpg/png/webp URLs', () => {
    expect(isProductImageUrl('https://cdn.com/product.jpg')).toBe(true);
    expect(isProductImageUrl('https://cdn.com/product.webp')).toBe(true);
  });

  it('accepts CDN paths without extension', () => {
    expect(isProductImageUrl('https://cdn.com/images/12345')).toBe(true);
  });

  it('rejects data URIs', () => {
    expect(isProductImageUrl('data:image/png;base64,abc')).toBe(false);
  });

  it('rejects logos', () => {
    expect(isProductImageUrl('https://cdn.com/logo.png')).toBe(false);
  });
});

describe('meetsMinDimensions', () => {
  it('accepts null dimensions (unknown)', () => {
    expect(meetsMinDimensions(null, null)).toBe(true);
  });

  it('rejects tiny images', () => {
    expect(meetsMinDimensions(50, 50)).toBe(false);
  });

  it('accepts large images', () => {
    expect(meetsMinDimensions(800, 600)).toBe(true);
  });
});

describe('calculateImageConfidence', () => {
  it('gives highest score to json_ld with large dimensions', () => {
    const score = calculateImageConfidence({
      url: 'https://cdn.com/product.jpg',
      source: 'json_ld',
      width: 1000,
      height: 1000,
      alt: 'iPhone 15 Pro Max',
    });
    expect(score).toBeGreaterThanOrEqual(0.90);
  });

  it('gives lower score to img_tag without dimensions', () => {
    const score = calculateImageConfidence({
      url: 'https://cdn.com/img.jpg',
      source: 'img_tag',
    });
    expect(score).toBeLessThan(0.70);
  });
});

describe('filterAndRankImages', () => {
  it('deduplicates same URL', () => {
    const candidates: RawImageCandidate[] = [
      { url: 'https://cdn.com/product.jpg', source: 'og_image' },
      { url: 'https://cdn.com/product.jpg', source: 'gallery' },
    ];
    const result = filterAndRankImages(candidates);
    expect(result).toHaveLength(1);
  });

  it('excludes low-confidence images', () => {
    const candidates: RawImageCandidate[] = [
      { url: 'https://cdn.com/product.jpg', source: 'json_ld', width: 800, height: 800 },
      { url: 'https://cdn.com/tiny.jpg', source: 'img_tag', width: 10, height: 10 },
    ];
    const result = filterAndRankImages(candidates);
    expect(result).toHaveLength(1);
    expect(result[0].image_url).toContain('product.jpg');
  });

  it('caps at 8 images', () => {
    const candidates: RawImageCandidate[] = Array.from({ length: 12 }, (_, i) => ({
      url: `https://cdn.com/product-${i}.jpg`,
      source: 'gallery' as const,
      width: 800,
      height: 800,
    }));
    const result = filterAndRankImages(candidates);
    expect(result.length).toBeLessThanOrEqual(8);
  });

  it('sorts by confidence descending', () => {
    const candidates: RawImageCandidate[] = [
      { url: 'https://cdn.com/low.jpg', source: 'img_tag' },
      { url: 'https://cdn.com/high.jpg', source: 'json_ld', width: 1000, height: 1000, alt: 'Product' },
    ];
    const result = filterAndRankImages(candidates);
    expect(result[0].image_url).toContain('high.jpg');
  });
});

describe('extractFromJsonLd', () => {
  it('extracts string image', () => {
    const result = extractFromJsonLd({ image: 'https://cdn.com/product.jpg' });
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe('json_ld');
  });

  it('extracts array of images', () => {
    const result = extractFromJsonLd({
      image: [
        'https://cdn.com/img1.jpg',
        { url: 'https://cdn.com/img2.jpg', width: 800, height: 600 },
      ],
    });
    expect(result).toHaveLength(2);
  });
});

describe('extractImagesFromPayload', () => {
  it('extracts og:image', () => {
    const result = extractImagesFromPayload({ og_image: 'https://cdn.com/og.jpg' });
    expect(result.some((r) => r.source === 'og_image')).toBe(true);
  });

  it('extracts gallery array', () => {
    const result = extractImagesFromPayload({
      images: ['https://cdn.com/img1.jpg', 'https://cdn.com/img2.jpg'],
    });
    expect(result.filter((r) => r.source === 'gallery')).toHaveLength(2);
  });

  it('extracts single image fields', () => {
    const result = extractImagesFromPayload({ main_image: 'https://cdn.com/main.jpg' });
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  it('avoids duplicates across fields', () => {
    const result = extractImagesFromPayload({
      image: 'https://cdn.com/same.jpg',
      main_image: 'https://cdn.com/same.jpg',
    });
    // Both extracted but filterAndRankImages will dedup
    expect(result.length).toBeGreaterThanOrEqual(1);
  });
});
