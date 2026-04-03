# Hotfix4 — Watchlist + Alerts + Trust Graph + Auto-Apply Crowd Signals

**Date:** 2026-02-27

This build extends Hotfix3 with the "global" step:

## 1) Watchlist (Price Alerts) — real, not demo
- Uses the existing DB table: `public.alerts`.
- New page: `/watchlist` (Arabic RTL) to manage all alerts in one place.
- New API endpoint: `GET /tables/watchlist` returns alerts enriched with **current best price** + would-trigger-now flag.
- Enhanced API patch: `PATCH /tables/alerts/:id` now supports updating:
  - `target_price`, `include_delivery`, `is_active` (and keeps backwards compatibility).

## 2) Alerts → Notifications (Automatic)
- A lightweight **local scheduler** was added to the Node API server:
  - Dispatch triggered alerts into `public.notifications` every **10 minutes** via `enqueue_triggered_price_alert_notifications()`.
  - Can be disabled with `ENABLE_LOCAL_SCHEDULER=0`.
- Admin job endpoint added:
  - `POST /admin/jobs/dispatch_price_alerts`

## 3) Crowd reports auto-apply (Quarantine + Confidence)
- When a user submits a report (`POST /offers/report`), the server now **immediately**:
  - degrades `price_confidence`
  - marks `in_stock=false` after 3+ unavailable reports
  - marks `is_price_anomaly=true` after 3+ wrong_price reports
  - enqueues a row in `public.price_anomaly_quarantine` (if present)

## 4) Trust Graph (dynamic trust weight)
- Adds optional columns:
  - `price_sources.trust_weight_dynamic`, `trust_last_scored_at`, `trust_score_meta`
- Admin endpoint:
  - `POST /admin/jobs/recompute_trust`
- Health UI now shows a **Trust** badge (effective trust).
- Compare Offers now uses `trust_score` derived from effective trust.

## 5) DB compatibility / no-break upgrades
- Added init script: `db/init/30_watchlist_trust.sql` (safe/idempotent)
- Updated `scripts/run-dev.ps1` to ensure:
  - trust columns exist
  - `alerts.include_delivery` exists

