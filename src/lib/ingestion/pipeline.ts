/**
 * Ingestion pipeline — orchestrates fetch → normalize → identity → upsert.
 *
 * Designed for edge function execution but callable from any context.
 * Single-item failures are isolated — they don't kill the whole run.
 */

import type {
  SourceAdapter,
  IngestionResult,
  ItemProcessingResult,
  SyncRunSummary,
} from './types';
import { normalizeOffer, type RawOfferFields } from './normalizer';
import { sanitizeExternalUrl } from './urlSafety';
import { buildFingerprint } from './identity';

/**
 * Run a complete sync for a given source adapter.
 *
 * Steps:
 * 1. Fetch raw items from source
 * 2. Normalize each item
 * 3. Build fingerprint for product identity
 * 4. Upsert products + observations
 * 5. Return summary
 *
 * This is the orchestration layer — actual DB writes would happen
 * via edge functions with service role. This module provides the
 * pure logic pipeline.
 */
export async function runSourceSync(
  adapter: SourceAdapter,
): Promise<IngestionResult> {
  const runId = crypto.randomUUID();
  const startedAt = new Date().toISOString();

  const itemResults: ItemProcessingResult[] = [];
  let fetchedCount = 0;
  let normalizedCount = 0;
  let insertedCount = 0;
  let updatedCount = 0;
  let errorCount = 0;
  const errors: string[] = [];

  try {
    // Step 1: Fetch
    const rawItems = await adapter.fetchItems();
    fetchedCount = rawItems.length;

    // Step 2-4: Process each item with isolation
    for (const raw of rawItems) {
      try {
        // Parse via adapter
        const parsed = adapter.parseItem(raw);
        if (!parsed) {
          itemResults.push({
            external_item_id: raw.external_item_id,
            status: 'skipped',
            reason: 'Adapter returned null (item not parseable)',
          });
          continue;
        }

        // Validate source URL against adapter domain
        const safeUrl = sanitizeExternalUrl(parsed.source_url);
        if (!safeUrl) {
          itemResults.push({
            external_item_id: raw.external_item_id,
            status: 'invalid',
            reason: `Unsafe source URL: ${parsed.source_url}`,
          });
          errorCount++;
          continue;
        }

        // Build raw fields for normalizer
        const rawFields: RawOfferFields = {
          source_id: parsed.source_id,
          source_url: safeUrl,
          external_item_id: parsed.external_item_id,
          product_name_ar: parsed.product_name_ar,
          product_name_en: parsed.product_name_en,
          brand_ar: parsed.brand_ar,
          brand_en: parsed.brand_en,
          barcode: parsed.barcode,
          category: parsed.category,
          unit: parsed.unit,
          image_url: parsed.image_url,
          base_price: parsed.base_price,
          discount_price: parsed.discount_price,
          delivery_fee: parsed.delivery_fee,
          currency: parsed.currency,
          in_stock: parsed.in_stock,
          merchant_name: parsed.merchant_name,
          region_id: parsed.region_id,
          observed_at: parsed.observed_at,
        };

        const normalized = normalizeOffer(rawFields);
        if (!normalized.ok) {
          const rejection = normalized as { ok: false; reason: string; detail: string };
          itemResults.push({
            external_item_id: raw.external_item_id,
            status: 'invalid',
            reason: `${rejection.reason}: ${rejection.detail}`,
          });
          errorCount++;
          continue;
        }

        normalizedCount++;

        // Build fingerprint for identity resolution
        const _fingerprint = buildFingerprint({
          barcode: normalized.offer.barcode,
          name_ar: normalized.offer.product_name_ar,
          name_en: normalized.offer.product_name_en,
          brand_ar: normalized.offer.brand_ar,
          brand_en: normalized.offer.brand_en,
          size_value: normalized.offer.size_value,
          size_unit: normalized.offer.size_unit,
          category: normalized.offer.category,
        });

        // In a real edge function, this is where we'd upsert to DB.
        // For now, mark as inserted (the edge function layer handles persistence).
        itemResults.push({
          external_item_id: raw.external_item_id,
          status: 'inserted',
        });
        insertedCount++;
      } catch (itemError) {
        const msg = itemError instanceof Error ? itemError.message : 'Unknown item error';
        errors.push(`Item ${raw.external_item_id ?? 'unknown'}: ${msg}`);
        errorCount++;
        itemResults.push({
          external_item_id: raw.external_item_id,
          status: 'error',
          reason: msg,
        });
      }
    }
  } catch (fetchError) {
    const msg = fetchError instanceof Error ? fetchError.message : 'Fetch failed';
    errors.push(msg);
    errorCount = fetchedCount || 1;
  }

  // Determine overall status
  let status: 'success' | 'partial' | 'failed';
  if (errorCount === 0 && normalizedCount > 0) {
    status = 'success';
  } else if (normalizedCount > 0 && errorCount > 0) {
    status = 'partial';
  } else {
    status = 'failed';
  }

  const summary: SyncRunSummary = {
    run_id: runId,
    source_id: adapter.sourceId,
    status,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    fetched_count: fetchedCount,
    normalized_count: normalizedCount,
    inserted_count: insertedCount,
    updated_count: updatedCount,
    error_count: errorCount,
    error_summary: errors.length > 0 ? errors.slice(0, 10).join('; ') : null,
  };

  return {
    run_id: runId,
    source_id: adapter.sourceId,
    status,
    summary,
    items: itemResults,
  };
}
