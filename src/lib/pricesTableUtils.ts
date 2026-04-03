/**
 * Pure helpers for prices table pagination and CSV export.
 * No side-effects except downloadCsv (DOM interaction).
 */

import { getCategoryLabel, getRegionLabel } from '@/lib/prices/labels';

// ---- Pagination ----

export interface PaginationResult<T> {
  pageRows: T[];
  totalRows: number;
  totalPages: number;
  currentPage: number;
  startIndex: number; // 1-based, 0 when empty
  endIndex: number;   // 0 when empty
}

export function paginateRows<T>(
  rows: T[],
  page: number,
  pageSize: number,
): PaginationResult<T> {
  const safePageSize = Math.max(1, pageSize);
  const totalRows = rows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / safePageSize));
  const currentPage = Math.max(1, Math.min(page, totalPages));

  if (totalRows === 0) {
    return { pageRows: [], totalRows: 0, totalPages: 1, currentPage: 1, startIndex: 0, endIndex: 0 };
  }

  const start = (currentPage - 1) * safePageSize;
  const end = Math.min(start + safePageSize, totalRows);

  return {
    pageRows: rows.slice(start, end),
    totalRows,
    totalPages,
    currentPage,
    startIndex: start + 1,
    endIndex: end,
  };
}

// ---- CSV ----

export function csvEscape(value: unknown): string {
  if (value == null) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export interface TrustedPriceLike {
  product_name_ar: string;
  product_name_en?: string;
  region_name_ar: string;
  region_name_en: string;
  category: string;
  unit: string;
  min_price_iqd: number;
  avg_price_iqd: number;
  max_price_iqd: number;
  sample_count: number;
  last_observed_at: string;
}

const CSV_HEADER = 'المنتج,المنطقة,الفئة,الوحدة,أقل سعر (د.ع),متوسط السعر (د.ع),أعلى سعر (د.ع),عدد العينات,آخر تحديث';

export function buildPricesCsv(rows: TrustedPriceLike[]): string {
  const lines = [CSV_HEADER];
  for (const r of rows) {
    lines.push(
      [
        csvEscape(r.product_name_ar),
        csvEscape(getRegionLabel(r.region_name_ar, r.region_name_en)),
        csvEscape(getCategoryLabel(r.category)),
        csvEscape(r.unit === 'kg' ? 'كغم' : r.unit),
        csvEscape(r.min_price_iqd),
        csvEscape(r.avg_price_iqd),
        csvEscape(r.max_price_iqd),
        csvEscape(r.sample_count),
        csvEscape(r.last_observed_at),
      ].join(','),
    );
  }
  return lines.join('\n');
}

export function downloadCsv(filename: string, csvContent: string): void {
  const bom = '\uFEFF';
  const blob = new Blob([bom + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
