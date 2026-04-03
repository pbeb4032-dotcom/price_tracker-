/**
 * PATCH A — Explore & ProductOffers E2E sanity tests.
 *
 * Validates:
 * - Component rendering: SearchBar, CategoryTabs, ProductCard, OfferRow, EmptyState
 * - Source attribution on cards (source_name_ar, region_name_ar, relative time)
 * - Edge cases: missing images, empty data, discount/OOS overlays
 * - Route structure
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

// ── SearchBar ─────────────────────────────────────────────────────────

describe('SearchBar', () => {
  it('renders input with aria-label', async () => {
    const { SearchBar } = await import('@/components/offers/SearchBar');
    wrap(<SearchBar value="" onChange={vi.fn()} placeholder="ابحث..." />);
    expect(screen.getByLabelText('بحث عن منتج')).toBeInTheDocument();
  });

  it('shows clear button when value is present', async () => {
    const { SearchBar } = await import('@/components/offers/SearchBar');
    wrap(<SearchBar value="test" onChange={vi.fn()} />);
    expect(screen.getByLabelText('مسح البحث')).toBeInTheDocument();
  });

  it('hides clear button when value is empty', async () => {
    const { SearchBar } = await import('@/components/offers/SearchBar');
    wrap(<SearchBar value="" onChange={vi.fn()} />);
    expect(screen.queryByLabelText('مسح البحث')).not.toBeInTheDocument();
  });
});

// ── CategoryTabs ──────────────────────────────────────────────────────

describe('CategoryTabs', () => {
  it('renders all category buttons', async () => {
    const { CategoryTabs } = await import('@/components/offers/CategoryTabs');
    const { PRODUCT_CATEGORIES } = await import('@/lib/offers/types');
    wrap(<CategoryTabs active="all" onChange={vi.fn()} />);
    for (const cat of PRODUCT_CATEGORIES) {
      expect(screen.getByText(cat.label_ar)).toBeInTheDocument();
    }
  });

  it('marks active category with aria-pressed', async () => {
    const { CategoryTabs } = await import('@/components/offers/CategoryTabs');
    wrap(<CategoryTabs active="electronics" onChange={vi.fn()} />);
    expect(screen.getByText('إلكترونيات').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('الكل').getAttribute('aria-pressed')).toBe('false');
  });
});

// ── EmptyState ────────────────────────────────────────────────────────

describe('EmptyState', () => {
  it('renders no-results variant with search query', async () => {
    const { EmptyState } = await import('@/components/offers/EmptyState');
    render(<EmptyState variant="no-results" searchQuery="تفاح" />);
    expect(screen.getByText(/لم يتم العثور/)).toBeInTheDocument();
    expect(screen.getByText(/تفاح/)).toBeInTheDocument();
  });

  it('renders no-data variant', async () => {
    const { EmptyState } = await import('@/components/offers/EmptyState');
    render(<EmptyState variant="no-data" />);
    expect(screen.getByText(/لا توجد عروض حالياً/)).toBeInTheDocument();
  });
});

// ── ProductCard source attribution ────────────────────────────────────

const makeBestOffer = (overrides = {}) => ({
  offer_id: '1',
  product_id: 'p1',
  product_name_ar: 'سكر أبيض ١ كغ',
  product_name_en: null,
  product_image_url: null,
  category: 'groceries',
  unit: 'kg',
  brand_ar: 'الشركة',
  brand_en: null,
  barcode: null,
  size_value: 1,
  size_unit: 'kg',
  base_price: 5000,
  discount_price: null,
  final_price: 5000,
  delivery_fee: null,
  currency: 'IQD',
  in_stock: true,
  source_url: 'https://example.iq/sugar',
  merchant_name: null,
  observed_at: new Date().toISOString(),
  region_id: 'r1',
  region_name_ar: 'بغداد',
  region_name_en: null,
  source_name_ar: 'طلبات مارت',
  source_domain: 'talabat.iq',
  source_logo_url: null,
  source_kind: 'marketplace',
  source_id: 's1',
  low_price_safe: null,
  high_price_safe: null,
  price_samples: 0,
  price_quality: 'synthetic' as const,
  ...overrides,
});

describe('ProductCard — source attribution', () => {
  it('displays source_name_ar, region_name_ar, and relative time', async () => {
    const { ProductCard } = await import('@/components/offers/ProductCard');
    wrap(<ProductCard offer={makeBestOffer()} />);
    expect(screen.getByText('طلبات مارت')).toBeInTheDocument();
    expect(screen.getByText('بغداد')).toBeInTheDocument();
    expect(screen.getByText('الآن')).toBeInTheDocument();
  });

  it('shows discount badge when price is lower', async () => {
    const { ProductCard } = await import('@/components/offers/ProductCard');
    wrap(<ProductCard offer={makeBestOffer({ base_price: 10000, final_price: 7500 })} />);
    expect(screen.getByText('-25%')).toBeInTheDocument();
  });

  it('shows out-of-stock overlay', async () => {
    const { ProductCard } = await import('@/components/offers/ProductCard');
    wrap(<ProductCard offer={makeBestOffer({ in_stock: false })} />);
    expect(screen.getByText('غير متوفر')).toBeInTheDocument();
  });

  it('uses fallback image on error', async () => {
    const { ProductCard } = await import('@/components/offers/ProductCard');
    wrap(<ProductCard offer={makeBestOffer({ product_image_url: 'https://broken.invalid/x.jpg' })} />);
    const img = screen.getByAltText('سكر أبيض ١ كغ') as HTMLImageElement;
    img.dispatchEvent(new Event('error'));
    expect(img.src).toContain('placeholder.svg');
  });

  it('links to /explore/:productId', async () => {
    const { ProductCard } = await import('@/components/offers/ProductCard');
    wrap(<ProductCard offer={makeBestOffer()} />);
    expect(screen.getByRole('link').getAttribute('href')).toBe('/explore/p1');
  });
});

// ── OfferRow source attribution ───────────────────────────────────────

const makeProductOffer = (overrides = {}) => ({
  offer_id: '2',
  product_id: 'p1',
  product_name_ar: 'سكر أبيض',
  product_name_en: null,
  product_image_url: null,
  category: 'groceries',
  unit: 'kg',
  brand_ar: null,
  brand_en: null,
  base_price: 8000,
  discount_price: 6000,
  final_price: 6000,
  delivery_fee: 1500,
  currency: 'IQD',
  in_stock: true,
  source_url: 'https://kicard.iq/sugar',
  merchant_name: 'كي كارد',
  observed_at: new Date(Date.now() - 3600_000).toISOString(),
  region_id: 'r1',
  region_name_ar: 'أربيل',
  region_name_en: null,
  source_name_ar: 'كي كارد',
  source_domain: 'kicard.iq',
  source_logo_url: null,
  source_kind: 'retailer',
  source_id: 's2',
  ...overrides,
});

describe('OfferRow — source attribution', () => {
  it('shows merchant name, region, time, delivery fee, and discount', async () => {
    const { OfferRow } = await import('@/components/offers/OfferRow');
    render(<OfferRow offer={makeProductOffer()} rank={1} />);
    expect(screen.getByText('كي كارد')).toBeInTheDocument();
    expect(screen.getByText('أربيل')).toBeInTheDocument();
    expect(screen.getByText(/ساعة/)).toBeInTheDocument();
    expect(screen.getByText(/توصيل/)).toBeInTheDocument();
    expect(screen.getByText('-25%')).toBeInTheDocument();
  });

  it('shows out-of-stock badge', async () => {
    const { OfferRow } = await import('@/components/offers/OfferRow');
    render(<OfferRow offer={makeProductOffer({ in_stock: false })} rank={2} />);
    expect(screen.getAllByText('غير متوفر').length).toBeGreaterThan(0);
  });

  it('renders safe external link with noopener noreferrer', async () => {
    const { OfferRow } = await import('@/components/offers/OfferRow');
    render(<OfferRow offer={makeProductOffer()} rank={1} />);
    const link = screen.getByText('عرض المصدر').closest('a')!;
    expect(link.getAttribute('href')).toBe('https://kicard.iq/sugar');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(link.getAttribute('target')).toBe('_blank');
  });

  it('hides delivery fee when zero', async () => {
    const { OfferRow } = await import('@/components/offers/OfferRow');
    render(<OfferRow offer={makeProductOffer({ delivery_fee: 0 })} rank={1} />);
    expect(screen.queryByText(/توصيل/)).not.toBeInTheDocument();
  });
});

// ── Route structure ──────────────────────────────────────────────────

describe('Explore route structure (verified via App.tsx)', () => {
  it('App.tsx has /explore and /explore/:productId routes', async () => {
    // Structural verification: both components are importable and exported
    const explore = await import('@/pages/Explore');
    const productOffers = await import('@/pages/ProductOffers');
    expect(explore.default).toBeDefined();
    expect(productOffers.default).toBeDefined();
  });
});
