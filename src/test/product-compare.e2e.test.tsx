import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import React from 'react';

beforeAll(() => { (globalThis as any).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }; });

vi.mock('@/hooks/offers/useProductPriceHistory', () => ({
  useProductPriceHistory: ({ productId }: { productId: string }) => ({
    data: [
      { day: '2026-02-01', min_price: 8000, max_price: 10000, avg_price: productId === 'p1' ? 9000 : 9500, offer_count: 3, source_count: 2 },
      { day: '2026-02-02', min_price: 7800, max_price: 9800, avg_price: productId === 'p1' ? 8800 : 9400, offer_count: 4, source_count: 3 },
    ],
    isLoading: false, error: null,
  }),
}));
vi.mock('@/hooks/offers/useProductSearch', () => ({ useProductSearch: () => ({ data: [], isLoading: false }) }));
vi.mock('@/hooks/offers/useBestOffers', () => ({ useBestOffers: () => ({ data: [], isLoading: false }) }));
vi.mock('@/hooks/offers/useApiComparisons', () => ({
  useCompareOffers: () => ({ data: { offers: [] }, isLoading: false, isFetching: false, error: null }),
  useCompareProducts: () => ({ data: null, isLoading: false, isFetching: false, error: null }),
  isSuspectedOffer: () => false,
}));
vi.mock('@/lib/seo/useSeoMeta', () => ({ useSeoMeta: () => {} }));
vi.mock('@/components/AppNavbar', () => ({ default: () => React.createElement('nav'), __esModule: true }));
vi.mock('@/components/layout/AppFooter', () => ({ default: () => React.createElement('footer'), __esModule: true }));

describe('ProductCompare E2E', () => {
  it('opens with URL params and renders compare layout', async () => {
    const { default: ProductCompare } = await import('@/pages/ProductCompare');
    render(<MemoryRouter initialEntries={['/explore/compare?left=p1&right=p2&days=30&delivery=0']}><Routes><Route path="/explore/compare" element={<ProductCompare />} /></Routes></MemoryRouter>);
    expect(screen.getAllByText('مقارنة المنتجات').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('7 أيام')).toBeInTheDocument();
    expect(screen.getByText('30 يوم')).toBeInTheDocument();
  });

  it('shows CTA links to product pages', async () => {
    const { default: ProductCompare } = await import('@/pages/ProductCompare');
    render(<MemoryRouter initialEntries={['/explore/compare?left=p1&right=p2']}><Routes><Route path="/explore/compare" element={<ProductCompare />} /></Routes></MemoryRouter>);
    const links = screen.getAllByRole('link');
    expect(links.some((l) => l.getAttribute('href')?.includes('/explore/p1'))).toBe(true);
    expect(links.some((l) => l.getAttribute('href')?.includes('/explore/p2'))).toBe(true);
  });

  it('shows empty state when no products selected', async () => {
    const { default: ProductCompare } = await import('@/pages/ProductCompare');
    render(<MemoryRouter initialEntries={['/explore/compare']}><Routes><Route path="/explore/compare" element={<ProductCompare />} /></Routes></MemoryRouter>);
    expect(screen.getByText('اختر منتجين للمقارنة')).toBeInTheDocument();
  });

  it('renders product picker labels', async () => {
    const { default: ProductCompare } = await import('@/pages/ProductCompare');
    render(<MemoryRouter initialEntries={['/explore/compare']}><Routes><Route path="/explore/compare" element={<ProductCompare />} /></Routes></MemoryRouter>);
    expect(screen.getByText('المنتج الأول')).toBeInTheDocument();
    expect(screen.getByText('المنتج الثاني')).toBeInTheDocument();
  });
});
