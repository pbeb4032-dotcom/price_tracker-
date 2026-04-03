import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import React from 'react';

beforeAll(() => { (globalThis as any).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }; });

vi.mock('@/hooks/offers/useProductSearch', () => ({ useProductSearch: () => ({ data: [], isLoading: false }) }));
vi.mock('@/hooks/offers/useProductPriceHistory', () => ({ useProductPriceHistory: () => ({ data: [], isLoading: false, error: null }) }));
vi.mock('@/hooks/offers/useBestOffers', () => ({ useBestOffers: () => ({ data: [], isLoading: false }) }));
vi.mock('@/hooks/offers/useApiComparisons', () => ({
  useCompareOffers: () => ({ data: { offers: [] }, isLoading: false, isFetching: false, error: null }),
  useCompareProducts: () => ({ data: null, isLoading: false, isFetching: false, error: null }),
  isSuspectedOffer: () => false,
}));
vi.mock('@/lib/seo/useSeoMeta', () => ({ useSeoMeta: () => {} }));
vi.mock('@/components/AppNavbar', () => ({ default: () => React.createElement('nav'), __esModule: true }));
vi.mock('@/components/layout/AppFooter', () => ({ default: () => React.createElement('footer'), __esModule: true }));

describe('Mobile dark mode smoke — compare page', () => {
  beforeEach(() => { document.documentElement.classList.add('dark'); Object.defineProperty(window, 'innerWidth', { configurable: true, value: 375 }); });
  afterEach(() => { document.documentElement.classList.remove('dark'); });

  it('renders key elements in dark mode at 375px', async () => {
    const { default: ProductCompare } = await import('@/pages/ProductCompare');
    render(<MemoryRouter initialEntries={['/explore/compare']}><Routes><Route path="/explore/compare" element={<ProductCompare />} /></Routes></MemoryRouter>);
    expect(screen.getAllByText('مقارنة المنتجات').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('اختر منتجين للمقارنة')).toBeInTheDocument();
  });

  it('renders with products selected in dark mode', async () => {
    const { default: ProductCompare } = await import('@/pages/ProductCompare');
    render(<MemoryRouter initialEntries={['/explore/compare?left=p1&right=p2']}><Routes><Route path="/explore/compare" element={<ProductCompare />} /></Routes></MemoryRouter>);
    expect(screen.getAllByText('مقارنة المنتجات').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('عرض تفاصيل المنتج الأول')).toBeInTheDocument();
  });
});
