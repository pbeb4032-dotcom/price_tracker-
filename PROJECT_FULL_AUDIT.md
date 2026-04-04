# Price Tracker Iraq - Full Start-to-End Audit

Date: 2026-04-04
Branch inspected: `prod-ready`
Remote inspected: `https://github.com/pbeb4032-dotcom/price_tracker-.git`

## Purpose

This file is a single-document audit of the current repository from start to end. It is based on direct inspection of the code in this folder plus validation runs executed locally on 2026-04-03.

The goal of this document is to answer four questions:

1. What is the product idea?
2. How is the current implementation structured?
3. What is already implemented and working?
4. What still needs to happen before the project is fully functional and safely releasable?

## Executive Summary

This repository is no longer just a simple "community price report" app.

It has evolved into a hybrid system with two overlapping identities:

- A community fair-price platform where users sign in, browse prices, report prices, set alerts, and use dashboards.
- A standalone ingestion and offer-comparison platform that discovers Iraqi e-commerce sources, crawls pages, detects product APIs, normalizes prices, ranks offers, caches JS-rendered pages, and exposes operations tooling through a large admin panel.

The codebase already contains a lot of real implementation:

- React frontend with routing, auth context, search, compare, alerts, notifications, settings, watchlist, scan, and admin screens.
- Hono API with health, metrics, auth, RPC, views, tables, offers, and a very large admin surface.
- PostgreSQL bootstrap and compatibility patches.
- Many backend jobs for ingestion, source discovery, taxonomy work, render queue management, FX updates, health rollups, and alert dispatching.
- Optional monitoring, Redis caching, email, web push, and a Playwright render worker.

The project builds successfully on the frontend, which is a strong sign that the current UI bundle can compile.

The project is not yet "fully functional" as a clean release, because there is still config drift, test drift, and production wiring inconsistency. The biggest gaps are:

- Test infrastructure is broken on the frontend because `src/test/setup.ts` is missing while `vitest.config.ts` still points to it.
- API tests and API typecheck do not match the current implementation.
- Production environment variable names are inconsistent across the code and Docker files.
- Secret-bearing local files existed in the working tree without ignore protection before this audit.
- Monitoring and production compose files still need alignment with the actual runtime behavior.

## Codebase Size Snapshot

The main areas of the repository currently look like this (excluding `node_modules`):

| Area | Files | Approx. lines |
|---|---:|---:|
| `src` | 222 | 26,702 |
| `api/src` | 76 | 16,633 |
| `db` | 14 | 5,832 |
| `supabase` | 92 | 10,183 |
| `scripts` | 18 | 2,474 |
| `monitoring` | 4 | 303 |
| `nginx` | 4 | 102 |
| `render-worker` | 4 | 373 |
| `docs` | 15 | 1,311 |

This means the repository is already a medium-sized product codebase, not a prototype.

## Product Idea

At the product level, the idea is:

- Collect price intelligence for Iraqi products and merchants.
- Normalize the data into comparable offers.
- Show users the best offer, price history, comparisons, alerts, and source trust signals.
- Support both manual community reports and automated source ingestion.
- Give admins the ability to manage sources, health, taxonomy, review queues, anomalies, and operational jobs.

The clearest sign of this hybrid direction is the gap between old docs and current code:

- Older docs still describe Supabase-centric community reporting and moderation.
- Newer API/admin/job code is heavily focused on crawling, extraction, source onboarding, and operational control.

The current implementation idea is therefore best described as:

`community price reporting + automated offer ingestion + admin operations platform`

## Architecture Overview

### 1. Frontend

Frontend entry flow:

- `src/main.tsx` mounts the app.
- `src/App.tsx` wires providers and routes.
- Providers include:
  - theme provider
  - React Query provider
  - telemetry provider
  - auth provider
  - toaster / notifications UI

Frontend user routes:

- `/` landing page
- `/sign-in`, `/sign-up`
- `/dashboard`
- `/report-price`
- `/prices`
- `/products/:productId`
- `/explore`
- `/explore/:productId`
- `/explore/compare`
- `/notifications`
- `/settings`
- `/watchlist`
- `/scan`
- `/admin`

Important frontend implementation facts:

- Auth is app-owned JWT auth, not Supabase auth at runtime.
- `src/lib/auth/AuthProvider.tsx` stores the token in local storage and restores the session through `/auth/session`.
- `src/integrations/dataMode.ts` switches the app into API mode when `VITE_API_BASE_URL` exists.
- `src/integrations/supabase/client.ts` is now a stub that intentionally throws if Supabase mode is used.
- Search, browse, compare, alerts, watchlist, notifications, and history mostly use API routes and RPC passthroughs.

### 2. API

API entry flow:

- `api/src/server.ts` loads environment variables, initializes monitoring, Redis, notifications, metrics, rate limiting, scheduler tasks, and starts the Hono server.
- `api/src/index.ts` defines the app, auth middleware, health endpoint, metrics endpoint, OpenAPI stub, and route registration.

Main route groups:

- `api/src/routes/auth.ts`
- `api/src/routes/rpc.ts`
- `api/src/routes/views.ts`
- `api/src/routes/tables.ts`
- `api/src/routes/offers.ts`
- `api/src/routes/admin.ts`

Important API facts:

- The API uses Hono on Node.
- DB access is through `pg` + `drizzle-orm`.
- JWT signing and verification are handled in `api/src/auth/jwt.ts`.
- User bootstrap is handled by `api/src/auth/appUser.ts`.
- `/health` and `/metrics` are live endpoints.
- `admin.ts` is the operational control center and exposes roughly 80 route handlers.

### 3. Database and Schema

The database story is also hybrid:

- `db/init/00_schema.sql` is a standalone bootstrap that creates a Supabase-compatible shape locally.
- There are additional `db/init/*.sql` and `db/migrations/*.sql` files for standalone bootstrap and compatibility.
- There is also a full `supabase/` tree with migrations, functions, tests, and config.

Important schema intent:

- local auth compatibility through `auth.users` and `auth.uid()`
- RLS-aware schema shape
- profiles, roles, regions, products, stores, reports, alerts, moderation, audit
- source ingestion tables
- source health rollups
- anomaly quarantine
- taxonomy and category review queues
- render queue and rendered page cache
- notifications and web push

### 4. Background Jobs and Automation

The API exposes a large job system through `api/src/jobs`.

Major jobs include:

- `seedFrontier`
- `ingestProductPages`
- `discoverProductApis`
- `recrawlProductImages`
- `discoverSources`
- `validateCandidateSources`
- `activateCandidateSources`
- `rollupSourceHealth`
- `fxUpdateDaily`
- taxonomy patch/seed/backfill jobs
- probe queue and render queue jobs
- category override and conflict jobs
- cleanup and repair jobs

`api/src/server.ts` also runs periodic intervals for:

- price alert dispatching
- trust recomputation
- health rollups
- FX refresh
- candidate validation / activation
- auto discovery
- auto sector tagging

### 5. Render Worker

`render-worker/index.js` is a separate Playwright-based worker that:

- claims render jobs from `public.render_queue`
- checks render budgets and pause windows
- loads JS-heavy pages in Chromium
- stores rendered HTML in `public.rendered_pages`
- applies retry, backoff, and circuit breaker logic

This is a serious sign that the system is designed to support real-world JS commerce sites, not just static HTML.

### 6. Monitoring and Operations

Ops-related areas now exist across:

- `api/src/lib/monitoring.ts`
- `api/src/lib/cache.ts`
- `api/src/lib/notifications.ts`
- `api/src/lib/rate-limiting.ts`
- `monitoring/prometheus.yml`
- `monitoring/grafana/...`
- `docker-compose.production.yml`
- `nginx/nginx.conf`
- `scripts/setup-production.sh`
- `deploy-production.sh`
- `backup.sh`

The repo clearly contains a productionization push, not just core feature code.

## Start-to-End Runtime Flow

### A. Browser boot

1. `src/main.tsx` mounts React.
2. `src/App.tsx` creates providers and routes.
3. `AuthProvider` tries to restore the saved JWT from local storage.
4. Page hooks fetch through `/views`, `/tables`, or `/rpc`.

### B. User auth flow

1. User signs up or signs in from frontend auth pages.
2. Frontend posts to `/auth/signup` or `/auth/login`.
3. API creates or verifies the user, hashes the password, signs an app JWT, and returns it.
4. Frontend stores the JWT and uses it for later API requests.

### C. Browse and search flow

1. Explore page calls `useBestOffers` and `useSearchEngine`.
2. Frontend prefers API mode if `VITE_API_BASE_URL` is set.
3. API serves browse data through `/views/best_offers`.
4. Search goes through `/rpc/search_products_engine`.
5. Results are normalized, ranked, and rendered into cards.

### D. Product detail and comparison flow

1. Product page loads all offers via `/views/product_offers`.
2. Comparison data comes from `/views/compare_offers`.
3. Price history comes from `/views/product_price_history` which calls a DB function.
4. Alerts are managed through `/tables/alerts`.
5. Watchlist data is synthesized from alerts plus best-offer data.

### E. Reporting flow

1. Authenticated user posts a community price report through `/tables/price_reports`.
2. Community offer-reporting also exists through `/offers/report`.
3. Crowd reports immediately affect trust/confidence and may enqueue anomaly quarantine items.

### F. Admin operations flow

1. Admin UI calls many `/admin/...` endpoints.
2. Admin can inspect dashboard, source health, queues, coverage, category conflicts, taxonomy quarantine, and price anomaly quarantine.
3. Admin can trigger jobs for seeding, ingesting, validating, activating, FX refresh, taxonomy patches, render queue work, and more.

### G. Automated ingestion flow

1. Sources are discovered or seeded.
2. Crawl frontier items are claimed.
3. HTML is fetched or deferred to render worker when needed.
4. Product data is extracted and normalized.
5. Prices are sanity-checked and may be quarantined.
6. Product records, URL maps, observations, images, and health counters are updated.
7. Views expose the best offers back to the frontend.

## What Is Already Implemented

The following are clearly present in code and not just TODO ideas:

- JWT-based app auth
- route guards on the frontend
- explore/search/browse UI
- product offer comparison
- price history retrieval
- alerts and watchlist
- notifications and unread counts
- web push subscription endpoints
- admin dashboard and many admin workflows
- rate limiting middleware
- metrics endpoint
- structured logging
- optional Sentry wiring
- Redis cache wrapper
- email and web push notification helpers
- price anomaly quarantine
- taxonomy review queue
- source discovery and candidate validation
- source health rollups
- render queue and Playwright render worker
- standalone Postgres bootstrap

## What Happened In The Codebase

From inspection, the codebase appears to have gone through a major transition:

1. The original concept was a Supabase-heavy fair-price reporting app.
2. The implementation then shifted toward a standalone API-first architecture.
3. A major production hardening effort added monitoring, caching, notifications, queues, deployment docs, and Docker/Nginx/Grafana/Prometheus support.
4. During that expansion, some docs, env names, test files, and route expectations drifted out of sync.

This means the repository is not failing because "nothing is implemented".
It is failing because a lot has been implemented quickly and some parts are now ahead of their surrounding config/tests.

## Validation Results From This Audit

### 1. Frontend build

Command run:

- `npm run build`

Result:

- Passed.

Important build notes:

- The app bundles successfully.
- Vite warns about large chunks.
- Vite also warns that `NODE_ENV=production` inside `.env` is not the supported way to control build mode.

### 2. Frontend tests

Command run:

- `npm test`

Result:

- Failed before meaningful test execution.

Primary cause:

- `vitest.config.ts` points to `./src/test/setup.ts`
- `src/test/setup.ts` is missing
- a backup file exists at `src/test/setup.ts.bak`

Observed effect:

- 54 frontend test files failed with `Cannot find module '/@id/.../src/test/setup.ts'`

Meaning:

- The current frontend test suite is structurally broken, not just behaviorally failing.

### 3. API typecheck

Command run:

- `npm --prefix api run typecheck`

Result:

- Failed.

Main failures:

- `api/src/db.test.ts` references `dbModule.pool`, but `pool` is not exported from `api/src/db.ts`.
- `api/src/index.test.ts` imports `../lib/monitoring` and `../lib/metrics`, which do not resolve from that location.
- test typing around `Hono` app/env does not match the actual app type.

Meaning:

- API production code is closer to working than API test typing is.

### 4. API tests

Command run:

- `npm --prefix api test`

Result:

- 22 tests passed
- 14 tests failed

Main failure patterns:

- `api/src/routes/auth.test.ts` expects `/auth/sign-up` and `/auth/sign-in`, but the real routes are `/auth/signup` and `/auth/login`.
- `api/src/index.test.ts` mocks the wrong module paths and expects slightly different response details.
- `api/src/db.test.ts` assumes internal pool reset mechanics that the module does not expose.
- `api/src/lib/notifications.test.ts` assumes configured mail transport behavior that is not established in the test lifecycle.
- `api/src/lib/cache.test.ts` expects a null-return path that does not match observed behavior in the mocked scenario.

Meaning:

- API tests are outdated relative to the current code.

## Release Risks And Functional Gaps

These are the biggest items that still need work before the project can be called fully functional.

### 1. Secret hygiene and local file safety

Before this audit, the repo had local `.env` files and SSL material in the working tree without ignore protection.

Risk:

- accidental commit of secrets, private keys, or local certificates

Action taken in this audit:

- `.gitignore` was updated to ignore local env files, local SSL material, API logs, and benchmark outputs while keeping the example env files tracked

### 2. Frontend test harness must be repaired

Current blocker:

- `vitest.config.ts` references `src/test/setup.ts`
- tracked file `src/test/setup.ts` is currently deleted
- a backup copy exists as `src/test/setup.ts.bak`

Needed action:

- decide whether to restore the setup file or intentionally rewrite the test bootstrap
- then rerun the full frontend test suite

### 3. API tests and typecheck must be realigned

Current blockers:

- auth tests use old route names
- test imports use incorrect relative paths
- test assumptions do not match the new Hono typing and module layout

Needed action:

- update tests to match actual routes and module structure
- expose or redesign DB pool reset strategy for tests
- fix mocks to target current files and exports

### 4. Production env names are inconsistent

This is one of the most important config issues.

Observed mismatches:

- frontend code expects `VITE_API_BASE_URL`
- some production files use `VITE_API_URL`
- API code expects `APP_JWT_SECRET`
- `docker-compose.production.yml` uses `JWT_SECRET`

Impact:

- runtime config can silently fail even if containers start
- frontend can fall out of API mode
- API auth can break if the wrong env variable is provided

Needed action:

- standardize env names across frontend code, example env files, Docker files, and deployment docs

### 5. Production web container is not a true production web build

Observed:

- `Dockerfile.web` runs `npm run dev` with Vite instead of building static assets and serving them through a hardened static server

Impact:

- higher runtime overhead
- weaker production posture
- less predictable container behavior

Needed action:

- convert web image to build once and serve static output

### 6. Monitoring configuration is only partially aligned

Observed issues:

- Prometheus config targets `web:5173`, but Docker setup uses different ports elsewhere
- Prometheus config points directly at `postgres:5432` and `redis:6379`, which are not Prometheus exporters
- `checkRedisHealth()` currently returns healthy even though it is effectively a placeholder

Impact:

- observability looks more complete than it actually is
- health status may be overly optimistic

Needed action:

- align scrape targets with actual services
- add exporters where needed
- make Redis health real

### 7. Documentation and product model drift

Observed:

- README and architecture docs still describe older or overlapping system identities
- runtime code is now standalone/API-first, while the repository still contains a large Supabase function/migration layer

Impact:

- new contributors will struggle to know which architecture is canonical
- ops decisions become harder because there are multiple "truths" in the repo

Needed action:

- explicitly decide whether the canonical deployment path is:
  - standalone Postgres + Hono API + render worker
  - Supabase-centric deployment
  - or a supported hybrid model

### 8. Docker and deployment flow need one canonical path

Observed:

- `docker-compose.full.yml` is the most internally consistent local stack
- `docker-compose.yml` and `docker-compose.production.yml` contain env-name drift
- Nginx, web container behavior, and API envs need normalization

Needed action:

- choose one canonical local compose flow
- choose one canonical production compose flow
- align docs and examples to that choice

## Recommended Fix Order

If the goal is "fully functional and releasable", the most efficient next sequence is:

1. Lock secrets down and keep them out of Git.
2. Standardize env variable names across frontend, API, compose files, and examples.
3. Repair frontend test bootstrap (`src/test/setup.ts` decision).
4. Update API tests to match current routes and module layout.
5. Re-run:
   - `npm run build`
   - `npm test`
   - `npm --prefix api run typecheck`
   - `npm --prefix api test`
6. Convert the frontend production image away from `vite dev`.
7. Align monitoring/exporters and health checks with real runtime behavior.
8. Clean up docs so the repo has one primary architecture story.

## Bottom-Line Assessment

The project idea is strong and the implementation is substantial.

This repository already contains:

- a real frontend product
- a real API
- real ingestion logic
- real ops/admin tooling
- real productionization work

The main problem is not lack of code.
The main problem is alignment:

- alignment between tests and code
- alignment between env files and runtime expectations
- alignment between docs and the current architecture
- alignment between "local/dev stack" and "production stack"

Once that alignment work is done, this codebase can move from "large and promising" to "cleanly operable and fully functional".

## Follow-Up Status Update

After the original audit, the repository was further cleaned and validated.

Current validation state:

- `npm --prefix api run typecheck` passes
- `npm --prefix api test` passes
- `npm test` passes
- `npm run build` passes

## Architecture Hardening Status (2026-04-04)

The most important change since the original audit is that the repository is no longer in the same architectural state described at the top of this file.

Several root-cause fixes were implemented and pushed on `prod-ready` after the original audit:

- `Sprint 1`: publication gate + staging/decision records
- `Sprint 2`: canonical identity foundation
- `Sprint 3`: taxonomy governance over canonical variants
- `Sprint 4`: barcode / QR resolution engine
- `Sprint 5`: governed Iraq FX pipeline
- `Sprint 6`: source certification + server-side ranking truth

These changes materially improved the system and reduced the gap between "a lot of code" and "controlled production architecture".

### 1. Publication Gate is now real

The system now has a real ingest gate instead of letting raw ingest mutate public truth directly.

Implemented foundations:

- `public.ingest_documents`
- `public.ingest_listing_candidates`
- `public.ingest_decisions`
- `public.catalog_publish_queue`

Current behavior:

- raw ingest is recorded before publication
- ambiguous items fail closed
- exact-name fallback is no longer enough to publish
- trusted URL / identifier / canonical matches are now the intended publish path

This is the single most important anti-pollution improvement made in the codebase.

### 2. Canonical Identity now exists

The repo now has a real canonical identity layer instead of pretending a legacy `products` row can represent everything.

Implemented foundations:

- `public.catalog_product_families`
- `public.catalog_product_variants`
- `public.catalog_variant_identifiers`
- `public.catalog_variant_legacy_links`
- `public.catalog_merchant_listings`
- `public.catalog_identity_decisions`

Current behavior:

- family, variant, listing, and identifier responsibilities are now separated
- publication gate can resolve canonical family/variant
- barcode and taxonomy logic now have a real identity target

This does not yet mean the entire old catalog has been perfectly cleaned, but it does mean the architecture now has the right target shape.

### 3. Taxonomy is now governed above identity

The repo now has canonical-variant taxonomy governance rather than only heuristic route/job classification on legacy products.

Implemented foundations:

- `public.catalog_taxonomy_shadow_runs`
- `public.catalog_taxonomy_decisions`
- `public.catalog_taxonomy_quarantine`
- `public.catalog_taxonomy_metrics_daily`

Current behavior:

- deny rules for toxic category contamination are explicit
- weak or conflicting taxonomy decisions are quarantined
- shadow reclassification runs operate on canonical variants, not raw `products`

This is the first serious step toward solving the "food contains junk" problem from the root instead of cosmetically.

### 4. Barcode / QR is now a service, not just a fallback route

The repo now has a dedicated barcode resolution layer with auditability.

Implemented foundations:

- `public.barcode_resolution_runs`
- `public.barcode_resolution_candidates`
- `public.barcode_external_catalog_cache`

Current behavior:

- QR / GS1 parsing
- GTIN validation
- canonical identifier lookup
- external catalog lookup
- deterministic candidate scoring
- ranked resolution output with audit history

This is still not the final form of a market-dominating barcode engine, but it is now a real subsystem rather than scattered fallback logic.

### 5. FX is now governed

The repo now has a real FX publication layer rather than only a loose scrape/update job.

Implemented foundations:

- `public.fx_sources`
- `public.fx_observations`
- `public.fx_publications`
- `public.fx_publication_inputs`

Current behavior:

- official and market rates are separated
- publication status can be `current`, `stale`, `frozen`, `fallback`, or `unavailable`
- pricing jobs now read governed FX truth instead of directly trusting legacy `exchange_rates`
- `/tables/exchange_rates` remains backward-compatible while preferring governed publications

Operationally, the local environment confirmed the FX pipeline works end-to-end, but also exposed that local source configuration is weak. On the local DB used during validation:

- official rate was published through fallback API evidence
- market rate fell back to stale prior publication

That is not a pipeline bug. It is a source-input reality.

### 6. Source Certification and Server-Side Ranking Truth now exist

The repo now has the beginning of real source governance instead of "validate then activate then trust route ordering".

Implemented foundations:

- `public.source_certification_runs`
- `public.source_certification_decisions`
- new `price_sources` fields:
  - `certification_tier`
  - `certification_status`
  - `quality_score`
  - `catalog_publish_enabled`
  - `certification_reason`
  - `certification_meta`

Current behavior:

- candidate sources are no longer promoted straight into public influence
- activation now moves sources into observed/pending state first
- certification can classify sources into `sandbox`, `observed`, `published`, `anchor`, or `suspended`
- public ranking routes now read certification and source quality signals
- frontend best-offer hook no longer re-sorts over server truth

This is one of the biggest architecture corrections in the repo because it starts to eliminate split-brain ranking.

## Current Reality After Sprints 1-6

The repository is now in a much stronger state than the original audit snapshot.

What is now genuinely stronger:

- ingest pollution controls are real
- canonical identity exists
- taxonomy governance exists
- barcode resolution is structured
- FX publication is governed
- source certification exists
- ranking truth has started moving decisively to the backend

What is still not finished:

- legacy `products` still exists as a large compatibility surface and has not been fully retired into pure projection status
- `views.ts` still contains too much orchestration logic and should be thinned further into service calls
- ranking logic now has a backend authority, but some legacy scoring helpers still remain in route code and should be removed in the next cleanup pass
- local validation for source certification ran successfully, but the local DB used during testing had `0` Iraqi `price_sources`, so real certification quality must still be proven against populated production-like data
- source onboarding still needs stronger certification-driven rollout discipline in day-to-day operations
- taxonomy precision, barcode resolution precision, and source quality SLAs still need explicit dashboards and operating thresholds on real traffic

## Updated "What Still Needs to Happen"

These are now the highest-value remaining items before the system can be called fully functional in the elite, controlled sense:

### 1. Finish the migration from legacy `products` truth to compatibility projection

What still needs to happen:

- make canonical variant/family/listing truth the primary authority everywhere
- keep `products` only as a backward-compatible projection layer
- remove remaining direct legacy assumptions from routes, jobs, and views

### 2. Complete server-side truth centralization

What still needs to happen:

- move more route-level ranking/orchestration out of `api/src/routes/views.ts`
- reduce route SQL responsibility and move decision-making into explicit backend services
- keep frontend rendering-only for offer ordering and trust presentation

### 3. Prove taxonomy quality on populated real data

What still needs to happen:

- run canonical identity backfill on production-like data in batches
- run taxonomy shadow mode at real scale
- review quarantine queues
- publish branch/category precision dashboards
- refuse cutover decisions until measured precision is strong

### 4. Prove source certification on populated real data

What still needs to happen:

- run certification against a real set of Iraqi sources
- inspect `/admin/source_certification`
- inspect `/admin/source_certification/runs`
- verify that weak sources are held back and strong sources are promoted correctly
- define promotion/demotion SLOs formally

### 5. Tighten barcode ambiguity handling

What still needs to happen:

- add a review workflow for ambiguous barcode matches before stronger auto-linking
- use production evidence to tune candidate thresholds
- measure false positive vs unresolved rate on real scans

### 6. Keep FX source governance improving

What still needs to happen:

- add stronger live Iraqi market sources
- reduce fallback/stale reliance
- monitor freshness and anomaly events continuously
- verify that production FX publications stay current under source failure

Follow-up repo cleanup completed:

- frontend test drift was fixed and the full frontend suite is green
- Vite build chunking was improved, removing the old `>500 kB` bundle warning
- the frontend Vitest run now excludes `api/**`
- Browserslist data was refreshed through `package-lock.json`
- local ignored env files were cleaned so the unsupported Vite `NODE_ENV=production` warning no longer appears on this machine

Remaining warning cleanup status:

- React Router future-flag warnings are filtered in test setup because they are third-party library deprecation noise rather than project failures
- Recharts zero-size container warnings are filtered in test setup for the same reason
- `ReportPrice` SEO tests were updated to wait for async effects to settle, reducing `act(...)` noise from that page

## Local-Only Artifact Review

The remaining local-only files were reviewed and split into two final outcomes.

### 1. Published after cleanup

These assets were aligned to the canonical API-first deployment story and are now fit to track in the repo:

- `.github/workflows/ci-cd.yml`
- `.env.production.example`
- `.env.staging.example`
- `docs/production-deployment-runbook.md`
- `docs/production-operations-manual.md`
- `monitoring/grafana/`
- `scripts/deploy-production.sh`
- `scripts/setup-production.sh`
- `scripts/setup-staging.sh`
- `scripts/performance-test.js`
- `scripts/run-performance-benchmarks.ps1`
- `scripts/run-performance-benchmarks.sh`
- `scripts/test-notifications.sh`

What changed in that cleanup pass:

- old env drift like `JWT_SECRET` and stale `VITE_API_URL` guidance was removed
- AWS and Railway deployment assumptions were dropped from the published docs and CI
- setup scripts were changed from "generate competing config" to "operate the tracked config"
- Grafana provisioning was normalized around the repo's real Prometheus jobs and API metrics

### 2. Intentionally kept local-only

These artifacts are still better treated as private drafts, one-off notes, or machine-specific operational files:

- `FINAL_PRODUCTION_CHECKLIST.md`
- `MISSION_ACCOMPLISHED.md`
- `MONITORING_ALERTS.md`
- `MONITORING_SETUP.md`
- `PRODUCTION_DEPLOYMENT.md`
- `USER_GUIDE.md`
- `backup.sh`
- `deploy-production.sh`
- `logrotate.conf`
- `nginx.conf`
- `price-tracker-iraq.service`
- `api/temp_function.sql`

These are now better understood as:

- duplicate root-level notes that would confuse the canonical docs story
- host-specific operational files that should be reviewed separately before any publication
- temporary handoff artifacts rather than durable repository assets

Recommendation going forward:

- keep long-lived operations documentation under `docs/`
- keep executable tooling under `scripts/`
- treat root-level operational notes as drafts until they earn a permanent tracked location
