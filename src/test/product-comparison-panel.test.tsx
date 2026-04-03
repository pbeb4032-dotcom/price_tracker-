import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ProductComparisonPanel from '@/components/ProductComparisonPanel';
import type { CompareResult } from '@/lib/pricesCompareUtils';
import type { TrustedPrice } from '@/lib/prices/types';

function makeRow(overrides: Partial<TrustedPrice> = {}): TrustedPrice {
  return {
    product_id: 'p1', region_id: 'r1',
    product_name_ar: 'رز', product_name_en: 'Rice',
    region_name_ar: 'بغداد', region_name_en: 'Baghdad',
    unit: 'kg', category: 'grains',
    min_price_iqd: 1000, avg_price_iqd: 1500, max_price_iqd: 2000,
    sample_count: 5, last_observed_at: '2026-01-15',
    ...overrides,
  };
}

describe('ProductComparisonPanel', () => {
  it('renders nothing when no rows selected', () => {
    const comparison: CompareResult = { rows: [], hasUnitMismatch: false, units: [] };
    const { container } = render(<ProductComparisonPanel comparison={comparison} onClear={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders comparison table with selected rows', () => {
    const comparison: CompareResult = {
      rows: [makeRow(), makeRow({ product_id: 'p2', product_name_ar: 'طماطم' })],
      hasUnitMismatch: false,
      units: ['kg'],
    };
    render(<ProductComparisonPanel comparison={comparison} onClear={() => {}} />);
    expect(screen.getByTestId('comparison-panel')).toBeInTheDocument();
    expect(screen.getByText('طماطم')).toBeInTheDocument();
  });

  it('shows unit mismatch warning', () => {
    const comparison: CompareResult = {
      rows: [makeRow({ unit: 'kg' }), makeRow({ product_id: 'p2', unit: 'liter' })],
      hasUnitMismatch: true,
      units: ['kg', 'liter'],
    };
    render(<ProductComparisonPanel comparison={comparison} onClear={() => {}} />);
    expect(screen.getByTestId('unit-mismatch-warning')).toBeInTheDocument();
  });

  it('calls onClear when clear button clicked', () => {
    const onClear = vi.fn();
    const comparison: CompareResult = {
      rows: [makeRow()],
      hasUnitMismatch: false,
      units: ['kg'],
    };
    render(<ProductComparisonPanel comparison={comparison} onClear={onClear} />);
    fireEvent.click(screen.getByText('مسح التحديد'));
    expect(onClear).toHaveBeenCalledOnce();
  });
});
