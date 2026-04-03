/**
 * Price history types and helpers.
 */

export interface PriceHistoryPoint {
  day: string;
  min_price: number;
  max_price: number;
  avg_price: number;
  offer_count: number;
  source_count: number;
}

export type HistoryRange = 7 | 30 | 90 | 180;

/** Calculate trend direction from history points */
export function calcTrend(points: PriceHistoryPoint[]): 'up' | 'down' | 'flat' {
  if (points.length < 2) return 'flat';
  const first = points[0].avg_price;
  const last = points[points.length - 1].avg_price;
  const pct = ((last - first) / first) * 100;
  if (pct > 2) return 'up';
  if (pct < -2) return 'down';
  return 'flat';
}

/** Calculate percentage change between first and last point */
export function calcPctChange(points: PriceHistoryPoint[]): number | null {
  if (points.length < 2) return null;
  const first = points[0].avg_price;
  const last = points[points.length - 1].avg_price;
  if (first === 0) return null;
  return Math.round(((last - first) / first) * 100);
}

/** Calculate price volatility (coefficient of variation) */
export function calcVolatility(points: PriceHistoryPoint[]): number {
  if (points.length < 2) return 0;
  const prices = points.map((p) => p.avg_price);
  const mean = prices.reduce((s, v) => s + v, 0) / prices.length;
  if (mean === 0) return 0;
  const variance = prices.reduce((s, v) => s + (v - mean) ** 2, 0) / prices.length;
  return Math.round((Math.sqrt(variance) / mean) * 100);
}

/** Get min price across all points */
export function historyMin(points: PriceHistoryPoint[]): number | null {
  if (!points.length) return null;
  return Math.min(...points.map((p) => p.min_price));
}

/** Get max price across all points */
export function historyMax(points: PriceHistoryPoint[]): number | null {
  if (!points.length) return null;
  return Math.max(...points.map((p) => p.max_price));
}

/** Total unique sources across all points */
export function totalSources(points: PriceHistoryPoint[]): number {
  if (!points.length) return 0;
  return Math.max(...points.map((p) => p.source_count));
}
