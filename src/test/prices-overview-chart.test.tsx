import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import PricesOverviewChart, { preparePricesChartData } from '@/components/PricesOverviewChart';
import type { TrustedPrice } from '@/lib/prices/types';

function makeRow(overrides: Partial<TrustedPrice> = {}): TrustedPrice {
  return {
    product_id: 'p1',
    region_id: 'r1',
    product_name_ar: 'رز',
    product_name_en: 'Rice',
    region_name_ar: 'بغداد',
    region_name_en: 'Baghdad',
    unit: 'kg',
    category: 'grains',
    min_price_iqd: 1000,
    avg_price_iqd: 1500,
    max_price_iqd: 2000,
    sample_count: 5,
    last_observed_at: '2026-01-15',
    ...overrides,
  };
}

describe('preparePricesChartData', () => {
  it('returns empty for empty input', () => {
    expect(preparePricesChartData([])).toEqual([]);
  });

  it('limits to top 10', () => {
    const rows = Array.from({ length: 15 }, (_, i) =>
      makeRow({ product_id: `p${i}`, product_name_ar: `منتج ${i}`, avg_price_iqd: (i + 1) * 100 })
    );
    const result = preparePricesChartData(rows);
    expect(result).toHaveLength(10);
    expect(result[0].value).toBe(1500); // highest
  });

  it('aggregates same product across regions', () => {
    const rows = [
      makeRow({ product_id: 'p1', avg_price_iqd: 1000 }),
      makeRow({ product_id: 'p1', region_id: 'r2', avg_price_iqd: 2000 }),
    ];
    const result = preparePricesChartData(rows);
    expect(result).toHaveLength(1);
    expect(result[0].value).toBe(1500); // average
  });

  it('handles mixed ar/en names without crash', () => {
    const rows = [
      makeRow({ product_name_ar: '', product_name_en: 'Tomato', product_id: 'p1' }),
      makeRow({ product_name_ar: 'بطاطا', product_name_en: '', product_id: 'p2' }),
    ];
    const result = preparePricesChartData(rows);
    expect(result).toHaveLength(2);
    expect(result.some((r) => r.label === 'Tomato')).toBe(true);
    expect(result.some((r) => r.label === 'بطاطا')).toBe(true);
  });
});

describe('PricesOverviewChart component', () => {
  it('shows empty hint for empty rows', () => {
    render(<PricesOverviewChart rows={[]} />);
    expect(screen.getByTestId('chart-empty')).toBeInTheDocument();
  });

  it('renders SVG chart for non-empty rows', () => {
    const rows = [makeRow(), makeRow({ product_id: 'p2', product_name_ar: 'طماطم', avg_price_iqd: 800 })];
    render(<PricesOverviewChart rows={rows} />);
    expect(screen.getByTestId('prices-chart')).toBeInTheDocument();
    expect(screen.queryByTestId('chart-empty')).not.toBeInTheDocument();
  });
});
