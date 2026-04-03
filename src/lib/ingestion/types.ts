/**
 * Ingestion domain types — strict typing for the Iraqi sources pipeline.
 */

/** Raw item fetched from a source before normalization */
export interface RawSourceItem {
  external_item_id: string | null;
  raw_payload: Record<string, unknown>;
  raw_url: string | null;
  raw_title: string | null;
  fetched_at: string;
}

/** Normalized offer ready for product matching + DB upsert */
export interface NormalizedOfferInput {
  source_id: string;
  source_url: string;
  external_item_id: string | null;
  product_name_ar: string;
  product_name_en: string | null;
  brand_ar: string | null;
  brand_en: string | null;
  barcode: string | null;
  size_value: number | null;
  size_unit: string | null;
  category: string;
  unit: string;
  image_url: string | null;
  base_price: number;
  discount_price: number | null;
  final_price: number;
  delivery_fee: number | null;
  currency: 'IQD';
  in_stock: boolean;
  merchant_name: string | null;
  region_id: string;
  observed_at: string;
}

/** Summary of a sync run */
export interface SyncRunSummary {
  run_id: string;
  source_id: string;
  status: 'running' | 'success' | 'partial' | 'failed';
  started_at: string;
  finished_at: string | null;
  fetched_count: number;
  normalized_count: number;
  inserted_count: number;
  updated_count: number;
  error_count: number;
  error_summary: string | null;
}

/** Source adapter interface — each Iraqi source implements this */
export interface SourceAdapter {
  /** Unique source_id matching price_sources.id */
  sourceId: string;
  /** Human-readable source name */
  sourceName: string;
  /** Base domain for URL validation */
  baseDomain: string;
  /** Fetch raw items from the source. Returns raw payloads. */
  fetchItems(): Promise<RawSourceItem[]>;
  /** Parse a raw payload into a normalized offer. Returns null if invalid. */
  parseItem(raw: RawSourceItem): NormalizedOfferInput | null;
}

/** Result of processing a single item */
export interface ItemProcessingResult {
  external_item_id: string | null;
  status: 'inserted' | 'updated' | 'skipped' | 'invalid' | 'error';
  reason?: string;
}

/** Result of a full ingestion run */
export interface IngestionResult {
  run_id: string;
  source_id: string;
  status: 'success' | 'partial' | 'failed';
  summary: SyncRunSummary;
  items: ItemProcessingResult[];
}

/** Normalization rejection reason */
export type RejectReason =
  | 'empty_name'
  | 'invalid_price'
  | 'absurd_price'
  | 'unsafe_url'
  | 'missing_region'
  | 'invalid_currency'
  | 'missing_source_id';
