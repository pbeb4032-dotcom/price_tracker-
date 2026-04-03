# Shkad Aadel — Runbook

## Local Setup

```bash
# 1. Clone and install
git clone <repo-url> && cd shkad-aadel
bun install

# 2. Environment
# .env is auto-managed by Lovable Cloud. For local dev, copy:
cp .env.example .env
# Fill in VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY, VITE_SUPABASE_PROJECT_ID

# 3. Start dev server
bun run dev
```

## CI Pipeline

All checks run on push/PR to `main`:

```bash
# Run locally before pushing:
bun run ci:check   # lint + typecheck + test + build
```

Individual jobs:
- `bun run lint` — ESLint
- `bun run typecheck` — tsc --noEmit
- `bun run test:run` — Vitest (single run)
- `bun run build` — Production build

## Database Migrations

### Apply migration
Migrations are applied automatically via Lovable Cloud when approved in the UI.

### Manual rollback (emergency)
Go to **Lovable Cloud → Backend → Run SQL** and execute the rollback SQL.

Example rollback for the hardening migration:
```sql
-- Rollback constraints
ALTER TABLE public.report_votes DROP CONSTRAINT IF EXISTS uq_report_votes_user_report;
ALTER TABLE public.product_aliases DROP CONSTRAINT IF EXISTS uq_product_alias_norm;
ALTER TABLE public.alerts DROP CONSTRAINT IF EXISTS uq_alerts_dedup;
ALTER TABLE public.price_reports DROP CONSTRAINT IF EXISTS chk_price_range;
ALTER TABLE public.price_reports DROP CONSTRAINT IF EXISTS chk_quantity_positive;
ALTER TABLE public.price_reports DROP CONSTRAINT IF EXISTS chk_trust_score_range;
ALTER TABLE public.alerts DROP CONSTRAINT IF EXISTS chk_alert_target_price;
ALTER TABLE public.stores DROP CONSTRAINT IF EXISTS chk_store_latitude;
ALTER TABLE public.stores DROP CONSTRAINT IF EXISTS chk_store_longitude;
ALTER TABLE public.regions DROP CONSTRAINT IF EXISTS chk_region_latitude;
ALTER TABLE public.regions DROP CONSTRAINT IF EXISTS chk_region_longitude;

-- Rollback views
DROP VIEW IF EXISTS public.v_product_price_summary;
DROP VIEW IF EXISTS public.v_approved_reports;

-- Rollback indexes
DROP INDEX IF EXISTS idx_price_reports_product_id;
DROP INDEX IF EXISTS idx_price_reports_region_id;
DROP INDEX IF EXISTS idx_price_reports_created_at;
DROP INDEX IF EXISTS idx_price_reports_status;
DROP INDEX IF EXISTS idx_price_reports_user_id;
DROP INDEX IF EXISTS idx_price_reports_store_id;
DROP INDEX IF EXISTS idx_alerts_user_id;
DROP INDEX IF EXISTS idx_alerts_product_id;
DROP INDEX IF EXISTS idx_stores_region_id;
DROP INDEX IF EXISTS idx_product_aliases_product_id;
DROP INDEX IF EXISTS idx_audit_logs_created_at;
DROP INDEX IF EXISTS idx_audit_logs_table_name;
DROP INDEX IF EXISTS idx_user_roles_user_id;
DROP INDEX IF EXISTS idx_report_votes_report_id;
```

## Incident Quick Steps

### 1. App is down / blank page
- Check Lovable Cloud status
- Check browser console for JS errors
- Verify `.env` variables are set

### 2. Database errors (RLS violations)
- Check if user is authenticated
- Verify user_id matches auth.uid() in the insert/update
- Check user_roles table for correct role assignment

### 3. Data integrity issue
- Check audit_logs for recent changes: `SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 20;`
- Verify constraints haven't been violated

### 4. Performance degradation
- Check if indexes exist: `\di` in SQL console
- Check for missing WHERE clauses on large tables
- Review query plans with `EXPLAIN ANALYZE`
