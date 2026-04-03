/**
 * Offers module barrel export.
 */

export type { BestOffer, ProductOffer, ProductSearchResult, OfferSortKey, CategoryKey } from './types';
export { PRODUCT_CATEGORIES } from './types';
export {
  normalizeArabicText,
  stripDiacritics,
  parseSize,
  isValidPrice,
  isReasonableIQDPrice,
  formatIQDPrice,
  discountPercent,
  relativeTimeAr,
} from './normalization';
export { rankOffers, computeFinalPrice, getBestOfferReason } from './ranking';
export type { PriceHistoryPoint, HistoryRange } from './history';
export { calcTrend, calcPctChange, calcVolatility, historyMin, historyMax, totalSources } from './history';
