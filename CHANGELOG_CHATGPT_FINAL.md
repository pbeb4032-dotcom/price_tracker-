# ChatGPT Final Checkpoint Changelog (this delivery)

## Fixed / Completed in this delivery
- Cleaned and stabilized `api/src/ingestion/priceAnomalyQuarantine.ts`
  - unified input shape for ingestion callsites
  - fixed quarantine insert mappings
  - added fallback insert for legacy/new schema variants
  - improved historical anomaly checks using `observed_at`
- Completed admin quarantine review endpoint restore flow
  - `POST /admin/price_anomaly_quarantine/:id/review`
  - supports `restoreObservation` / `restore_observation`
  - restores approved record into `source_price_observations` (safe duplicate check)
  - returns restore result metadata
- Completed Admin UI support
  - new button: **اعتماد + استرجاع السعر**
  - review mutation sends restore flag
  - toast feedback for restore result
  - fixed missing `Badge` import

## Verified (syntax/transpile checks)
- `api/src/ingestion/priceAnomalyQuarantine.ts`
- `api/src/jobs/ingestProductPages.ts`
- `api/src/jobs/discoverProductApis.ts`
- `api/src/routes/views.ts`
- `api/src/routes/admin.ts`
- `src/pages/Admin.tsx`
- `src/pages/Scan.tsx`
- `src/pages/ProductOffers.tsx`
- `src/pages/ProductCompare.tsx`
- `src/hooks/offers/useApiComparisons.ts`


## Hotfix4 (2026-02-27)
- Watchlist page (/watchlist) + /tables/watchlist enriched endpoint
- Alerts dispatch scheduler + admin job dispatch_price_alerts
- Auto-apply crowd reports to offers + quarantine
- Trust graph (dynamic trust_weight) + admin recompute_trust

