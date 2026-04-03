# Real fixes applied to this project

## 1) Category system hard refactor
- Removed client-side category guessing from `src/hooks/offers/useBestOffers.ts`.
- Backend/server taxonomy is now the only source of truth for best-offer category data.
- Expanded and normalized taxonomy handling in:
  - `api/src/ingestion/taxonomyV2.ts`
  - `api/src/jobs/seedTaxonomyV2.ts`
  - `api/src/jobs/reclassifyCategoriesSmart.ts`
- `products.taxonomy_key` is now treated as canonical, while `category/subcategory` are treated as derived/cache fields.
- Added DB helpers and trigger logic in `api/src/jobs/patchTaxonomyV2Schema.ts` so category/subcategory can be synced from taxonomy.
- Patched `v_best_offers` generation so it exposes canonical taxonomy-driven category/subcategory instead of trusting free text.

## 2) QR / barcode architecture fixes
- Added `product_identifiers` table creation and backfill logic in `api/src/jobs/patchTaxonomyV2Schema.ts`.
- Rebuilt QR/code resolution path in `api/src/routes/views.ts`:
  - internal exact match prefers `product_identifiers`
  - fallback to normalized `products.barcode`
  - fallback to `product_aliases.alias_name`
- Removed the broken assumption that `product_aliases` behaves like an identifiers table.
- Added external catalog fallback support through `api/src/catalog/identifierResolver.ts`.
- `/views/lookup_by_qr` now attempts external catalog enrichment and local cheapest-offer matching instead of returning empty immediately.
- `src/pages/Scan.tsx` now renders:
  - resolution type / confidence
  - external catalog details
  - cheapest matched local/external-style price candidates

## 3) FX / USD-IQD trust fixes
- Reworked `api/src/jobs/fxUpdateDaily.ts` so market rate is no longer fabricated from official rate + premium.
- Added raw/effective FX tables in `api/src/jobs/patchTaxonomyV2Schema.ts`:
  - `fx_rate_raw`
  - `fx_rate_effective`
- Market fallback now uses stale persisted market observations when available instead of inventing a new market rate.
- Legacy compatibility is preserved by upserting into `exchange_rates` while recording quality metadata.
- `/tables/exchange_rates` now prefers `fx_rate_effective` and falls back to legacy rows only when needed.

## 4) Startup safety / rollout
- `api/src/server.ts` now auto-runs:
  - taxonomy v2 schema patch
  - taxonomy seed job
- This helps bring new deployments closer to the intended canonical schema automatically.

## 5) Release cleanup
- Updated release packaging scripts to exclude `.env`, `.env.*`, `node_modules`, logs, and temp artifacts.
- This project was originally uploaded with polluted release contents; the clean zip produced here avoids that.

## 6) Extra TypeScript cleanup completed
- Fixed `useProductPriceHistory` typing drift so the frontend app type-checks cleanly.
- Fixed dependent typing issues in price history consumers and recent-report mapping.

## Validation completed here
- Frontend syntax validation: passed
- Frontend TypeScript app compile (`tsc -p tsconfig.app.json --noEmit`): passed
- API typecheck: passed

## Important note about Vite build in the uploaded environment
The uploaded `node_modules` bundle is broken (missing Rollup native optional dependency), so direct build in this environment fails unless dependencies are reinstalled.
This clean release intentionally excludes `node_modules`; after extraction, run a fresh install:

```bash
npm install
npm --prefix api install
npm run build
```

If the build still complains about Rollup optional native packages, remove `node_modules` and lockfile caches locally and reinstall once.
