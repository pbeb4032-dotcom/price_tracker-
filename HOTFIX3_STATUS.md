# Hotfix3 Final — Crowd Signals + Health Monitor + Smart Import URL

## 1) Crowd Signals (User Reports)
- DB: `public.offer_reports` + view `public.v_offer_reports_agg`.
- API:
  - `POST /offers/report` (auth required) — report an offer as: wrong_price / unavailable / duplicate.
  - `GET /offers/summary?product_id=...` — aggregated reports per offer (optional helper).
- UI:
  - Product Offers page now shows **Report buttons** under each offer.
  - Offers show **بلاغات: N** badge when there are reports.
- Penalties:
  - `/views/product_offers` and `/views/compare_offers` now include:
    - `crowd_reports_total`, `crowd_wrong_price`, `crowd_unavailable`, `crowd_duplicate`, `crowd_penalty`
    - `price_confidence` (adjusted) + `confidence_reasons`
    - `reliability_badge` + `is_price_suspected`

## 2) Source Health Monitor + Auto Disable / Recover
- DB: price_sources columns:
  - `auto_disabled`, `auto_disabled_reason`, `auto_disabled_at`, `auto_recovered_at`, `auto_disabled_forced_inactive`
- API:
  - `GET /admin/source_health?hours=24`
  - `POST /admin/jobs/health_scan` (24h window by default)
- Jobs now skip auto-disabled sources:
  - seedFrontier / discoverProductApis / ingestProductPages

## 3) Smart Import Any URL (Admin)
- API:
  - `POST /admin/smart_import_url { url }`
  - Creates source row if missing, then:
    - category/unknown -> adds to `source_entrypoints`
    - product -> adds to `crawl_frontier` as pending
- UI:
  - Admin tab: **استيراد URL**

## Compatibility
- `scripts/run-dev.ps1` applies **non-destructive patches** on existing DB volumes:
  - Ensures crawl_frontier columns used by jobs
  - Ensures offer_reports + aggregation view
  - Ensures v_product_all_offers exposes anomaly/confidence fields
