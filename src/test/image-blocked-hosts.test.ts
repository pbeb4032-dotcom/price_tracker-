/**
 * Tests for blocked image host validation.
 */

import { describe, it, expect } from 'vitest';
import {
  isBlockedImageHost,
  isProductImageUrl,
  filterAndRankImages,
} from '@/lib/ingestion/imageExtractor';
import type { RawImageCandidate } from '@/lib/ingestion/imageExtractor';

describe('isBlockedImageHost', () => {
  it('blocks picsum.photos', () => {
    expect(isBlockedImageHost('https://picsum.photos/seed/abc/400/400')).toBe(true);
  });
  it('blocks placehold.co', () => {
    expect(isBlockedImageHost('https://placehold.co/400x400')).toBe(true);
  });
  it('blocks via.placeholder.com', () => {
    expect(isBlockedImageHost('https://via.placeholder.com/400')).toBe(true);
  });
  it('blocks source.unsplash.com/random', () => {
    expect(isBlockedImageHost('https://source.unsplash.com/random/400x400')).toBe(true);
  });
  it('allows real product image', () => {
    expect(isBlockedImageHost('https://miswag.com/media/products/phone.jpg')).toBe(false);
  });
  it('allows carrefouriraq CDN', () => {
    expect(isBlockedImageHost('https://cdn.carrefouriraq.com/images/product123.jpg')).toBe(false);
  });
});

describe('filterAndRankImages rejects blocked hosts', () => {
  it('filters out picsum images', () => {
    const candidates: RawImageCandidate[] = [
      { url: 'https://picsum.photos/seed/test/400/400', source: 'img_tag' },
      { url: 'https://miswag.com/media/real-product.jpg', source: 'gallery' },
    ];
    const result = filterAndRankImages(candidates);
    expect(result).toHaveLength(1);
    expect(result[0].image_url).toContain('miswag.com');
  });

  it('returns empty if all images are blocked', () => {
    const candidates: RawImageCandidate[] = [
      { url: 'https://picsum.photos/400/400', source: 'img_tag' },
      { url: 'https://placehold.co/200x200', source: 'og_image' },
    ];
    const result = filterAndRankImages(candidates);
    expect(result).toHaveLength(0);
  });
});
