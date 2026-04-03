/**
 * Ingestion module public API.
 */

export type {
  RawSourceItem,
  NormalizedOfferInput,
  SyncRunSummary,
  SourceAdapter,
  IngestionResult,
  ItemProcessingResult,
  RejectReason,
} from './types';

export { sanitizeExternalUrl, validateSourceUrl, isValidImageUrl } from './urlSafety';
export { buildFingerprint, hasBarcodeIdentity, nameSimilarity, matchProduct, FUZZY_CONFIDENCE_THRESHOLD } from './identity';
export { normalizeOffer, type RawOfferFields, type NormalizationResult } from './normalizer';
export { getActiveSources, getSourceById, isSourceActive } from './sourceRegistry';
export { runSourceSync } from './pipeline';
export {
  normalizeImageUrl,
  isExcludedImage,
  isProductImageUrl,
  meetsMinDimensions,
  calculateImageConfidence,
  filterAndRankImages,
  extractFromJsonLd,
  extractImagesFromPayload,
  type RawImageCandidate,
  type ValidatedImage,
} from './imageExtractor';
