$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

if (-not (Test-Path ".env")) {
  Write-Host "[!] .env not found. Copying .env.example -> .env"
  Copy-Item ".env.example" ".env"
  Write-Host "[!] Edit .env if you want to change DB/API settings"
}

Write-Host "[1/5] Starting Postgres (Docker)..."
docker compose -f docker-compose.full.yml up -d db searxng

Write-Host "[2/5] Waiting for DB to be ready (psql)..."
$dbReady = $false
for ($i=0; $i -lt 180; $i++) {
  try {
    $q = docker compose exec -T db psql -U postgres -d price_tracker_iraq -t -A -c "select 1;" 2>$null
    if (($q | Out-String).Trim() -eq '1') {
      Write-Host "[db] psql ready"
      $dbReady = $true
      break
    }
  } catch {}
  Start-Sleep -Seconds 1
}

if (-not $dbReady) {
  Write-Host "[!] DB did not become ready. Showing logs..."
  docker compose ps
  docker compose logs --tail 200 db
  throw "Database is not ready. Fix the DB logs above then re-run."
}

Write-Host "[2b/5] Waiting for schema to be ready (exchange_rates + auth.password_auth)..."
$schemaOk = $false
for ($i=0; $i -lt 240; $i++) {
  try {
    $chk = docker compose exec -T db psql -U postgres -d price_tracker_iraq -t -A -c "select (to_regclass('public.exchange_rates') is not null) and (to_regclass('auth.password_auth') is not null);" 2>$null
    if (($chk | Out-String).Trim() -eq 't') {
      Write-Host "[db] schema ok"
      $schemaOk = $true
      break
    }
  } catch {}
  Start-Sleep -Seconds 1
}

if (-not $schemaOk) {
  Write-Host "[!] DB schema is incomplete (init script likely failed)."
  Write-Host "    Fix (fresh boot): docker compose down -v ; docker compose -f docker-compose.full.yml up -d db searxng"
  docker compose logs --tail 200 db
  throw "Database schema incomplete. See logs above."
}

Write-Host "[2c/5] Ensuring compatibility patches (non-destructive)..."
try {
  # Ensure product_url_map has url_hash (older volumes created before the column existed)
  docker compose exec -T db psql -U postgres -d price_tracker_iraq -v ON_ERROR_STOP=1 -c @'
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  -- 1) Fix ambiguous overload (older volumes had both 1-arg + 3-arg signatures)
  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'claim_crawl_frontier_batch'
      AND pg_get_function_identity_arguments(p.oid) = 'p_limit integer'
  ) THEN
    EXECUTE 'DROP FUNCTION public.claim_crawl_frontier_batch(integer)';
  END IF;

  -- 2) Ensure product_url_map has url_hash + upsert index
  IF to_regclass('public.product_url_map') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema='public' AND table_name='product_url_map' AND column_name='url_hash'
    ) THEN
      ALTER TABLE public.product_url_map
        ADD COLUMN url_hash text GENERATED ALWAYS AS (md5(lower(url))) STORED;
    END IF;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_product_url_map_source_url_hash
      ON public.product_url_map(source_id, url_hash);
  END IF;

  -- 2b) Ensure crawl_frontier has the columns used by ingestion/seed jobs
  IF to_regclass('public.crawl_frontier') IS NOT NULL THEN
    ALTER TABLE public.crawl_frontier
      ADD COLUMN IF NOT EXISTS page_type text NOT NULL DEFAULT 'unknown',
      ADD COLUMN IF NOT EXISTS depth int NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS parent_url text NULL;

-- 2d) Ensure source_price_observations has the columns used by health/confidence/quarantine
IF to_regclass('public.source_price_observations') IS NOT NULL THEN
  ALTER TABLE public.source_price_observations
    ADD COLUMN IF NOT EXISTS discount_price numeric,
    ADD COLUMN IF NOT EXISTS delivery_fee numeric,
    ADD COLUMN IF NOT EXISTS in_stock boolean NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS merchant_name text,
    ADD COLUMN IF NOT EXISTS product_condition text NOT NULL DEFAULT 'new',
    ADD COLUMN IF NOT EXISTS is_price_anomaly boolean DEFAULT false,
    ADD COLUMN IF NOT EXISTS anomaly_reason text,
    ADD COLUMN IF NOT EXISTS price_confidence numeric(3,2),
    ADD COLUMN IF NOT EXISTS raw_price_text text,
    ADD COLUMN IF NOT EXISTS normalized_price_iqd numeric,
    ADD COLUMN IF NOT EXISTS created_at timestamptz;

  UPDATE public.source_price_observations
    SET price_confidence = COALESCE(price_confidence, 0.50)
    WHERE price_confidence IS NULL;

  UPDATE public.source_price_observations
    SET created_at = COALESCE(created_at, observed_at, now())
    WHERE created_at IS NULL;

  CREATE INDEX IF NOT EXISTS idx_spo_price_anomaly ON public.source_price_observations(is_price_anomaly);
  CREATE INDEX IF NOT EXISTS idx_spo_created_at_desc ON public.source_price_observations(created_at DESC);
END IF;

  END IF;

  -- 3) Ensure price_sources has the columns expected by admin/import/jobs (and backfill legacy fields)
  IF to_regclass('public.price_sources') IS NOT NULL THEN
    ALTER TABLE public.price_sources
      ADD COLUMN IF NOT EXISTS domain text,
      ADD COLUMN IF NOT EXISTS source_kind text,
      ADD COLUMN IF NOT EXISTS trust_weight numeric(3,2),
      ADD COLUMN IF NOT EXISTS country_code text,
      ADD COLUMN IF NOT EXISTS is_active boolean,
      ADD COLUMN IF NOT EXISTS base_url text,
      ADD COLUMN IF NOT EXISTS logo_url text,
      ADD COLUMN IF NOT EXISTS auto_disabled boolean,
      ADD COLUMN IF NOT EXISTS auto_disabled_forced_inactive boolean,
      ADD COLUMN IF NOT EXISTS auto_disabled_reason text,
      ADD COLUMN IF NOT EXISTS auto_disabled_at timestamptz,
      ADD COLUMN IF NOT EXISTS auto_recovered_at timestamptz,
      ADD COLUMN IF NOT EXISTS trust_weight_dynamic numeric(3,2),
      ADD COLUMN IF NOT EXISTS trust_last_scored_at timestamptz,
      ADD COLUMN IF NOT EXISTS trust_score_meta jsonb,
      ADD COLUMN IF NOT EXISTS lifecycle_status text,
      ADD COLUMN IF NOT EXISTS crawl_enabled boolean,
      ADD COLUMN IF NOT EXISTS validation_state text,
      ADD COLUMN IF NOT EXISTS validation_score numeric(4,3),
      ADD COLUMN IF NOT EXISTS discovered_via text,
      ADD COLUMN IF NOT EXISTS discovery_tags jsonb,
      ADD COLUMN IF NOT EXISTS last_probe_at timestamptz,
      ADD COLUMN IF NOT EXISTS validated_at timestamptz,
      ADD COLUMN IF NOT EXISTS activated_at timestamptz,
      ADD COLUMN IF NOT EXISTS created_at timestamptz;

    UPDATE public.price_sources SET country_code = COALESCE(NULLIF(country_code,''), 'IQ') WHERE country_code IS NULL OR country_code='';
    UPDATE public.price_sources SET is_active = COALESCE(is_active, true) WHERE is_active IS NULL;
    UPDATE public.price_sources SET trust_weight = COALESCE(trust_weight, 0.50) WHERE trust_weight IS NULL;
    UPDATE public.price_sources SET source_kind = COALESCE(NULLIF(source_kind,''), 'retailer') WHERE source_kind IS NULL OR source_kind='';
    UPDATE public.price_sources SET created_at = COALESCE(created_at, now()) WHERE created_at IS NULL;
    UPDATE public.price_sources SET auto_disabled = COALESCE(auto_disabled, false) WHERE auto_disabled IS NULL;
    UPDATE public.price_sources SET auto_disabled_forced_inactive = COALESCE(auto_disabled_forced_inactive, false) WHERE auto_disabled_forced_inactive IS NULL;

    UPDATE public.price_sources SET lifecycle_status = COALESCE(NULLIF(lifecycle_status,''), CASE WHEN COALESCE(is_active,true) THEN 'active' ELSE 'active' END) WHERE lifecycle_status IS NULL OR lifecycle_status='';
    UPDATE public.price_sources SET crawl_enabled = COALESCE(crawl_enabled, true) WHERE crawl_enabled IS NULL;
    UPDATE public.price_sources SET validation_state = COALESCE(NULLIF(validation_state,''), 'unvalidated') WHERE validation_state IS NULL OR validation_state='';
    UPDATE public.price_sources SET discovery_tags = COALESCE(discovery_tags, '{}'::jsonb) WHERE discovery_tags IS NULL;


    -- domain/base_url from legacy website_url
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='price_sources' AND column_name='website_url'
    ) THEN
      EXECUTE $sql$
        UPDATE public.price_sources
        SET domain = COALESCE(NULLIF(domain,''), lower(split_part(regexp_replace(website_url,'^https?://',''), '/', 1)))
        WHERE (domain IS NULL OR domain='') AND website_url IS NOT NULL AND website_url <> ''
      $sql$;

      EXECUTE $sql$
        UPDATE public.price_sources
        SET base_url = COALESCE(NULLIF(base_url,''), regexp_replace(website_url,'/$',''))
        WHERE (base_url IS NULL OR base_url='') AND website_url IS NOT NULL AND website_url <> ''
      $sql$;
    END IF;

    -- trust_weight from legacy reliability_score
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='price_sources' AND column_name='reliability_score'
    ) THEN
      EXECUTE $sql$
        UPDATE public.price_sources
        SET trust_weight = COALESCE(
          trust_weight,
          LEAST(1, GREATEST(0, CASE WHEN reliability_score > 1 THEN reliability_score/100.0 ELSE reliability_score END))
        )
        WHERE trust_weight IS NULL
      $sql$;
    END IF;

    -- source_kind from legacy source_type
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='price_sources' AND column_name='source_type'
    ) THEN
      EXECUTE $sql$
        UPDATE public.price_sources
        SET source_kind = CASE
          WHEN source_kind IS NULL OR source_kind='' THEN
            CASE WHEN lower(source_type) IN ('government','official') THEN 'official' ELSE 'retailer' END
          ELSE source_kind
        END
      $sql$;
    END IF;

    UPDATE public.price_sources SET source_kind='retailer' WHERE source_kind NOT IN ('retailer','marketplace','official');

    UPDATE public.price_sources
    SET base_url = COALESCE(NULLIF(base_url,''), CASE WHEN domain IS NOT NULL AND domain <> '' THEN 'https://' || domain ELSE base_url END)
    WHERE base_url IS NULL OR base_url='';

    CREATE UNIQUE INDEX IF NOT EXISTS idx_price_sources_domain_country_unique
      ON public.price_sources(domain, country_code);
  END IF;

  -- 3b) Crowd signals tables (offer reports)
  IF to_regclass('public.offer_reports') IS NULL THEN
    EXECUTE $sql$
      CREATE TABLE public.offer_reports (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        offer_id uuid NOT NULL REFERENCES public.source_price_observations(id) ON DELETE CASCADE,
        user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
        report_type text NOT NULL CHECK (report_type IN ('wrong_price','unavailable','duplicate','other')),
        severity int NOT NULL DEFAULT 2 CHECK (severity BETWEEN 1 AND 5),
        note text NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (offer_id, user_id, report_type)
      );
      CREATE INDEX IF NOT EXISTS idx_offer_reports_offer_id ON public.offer_reports(offer_id);
      CREATE INDEX IF NOT EXISTS idx_offer_reports_created_at ON public.offer_reports(created_at DESC);
    $sql$;
  END IF;

  EXECUTE $sql$
    CREATE OR REPLACE VIEW public.v_offer_reports_agg
    WITH (security_invoker = on) AS
    SELECT
      offer_id,
      count(*)::int AS reports_total,
      sum(CASE WHEN report_type='wrong_price' THEN 1 ELSE 0 END)::int AS wrong_price,
      sum(CASE WHEN report_type='unavailable' THEN 1 ELSE 0 END)::int AS unavailable,
      sum(CASE WHEN report_type='duplicate' THEN 1 ELSE 0 END)::int AS duplicate,
      sum(CASE WHEN report_type='other' THEN 1 ELSE 0 END)::int AS other,
      max(created_at) AS last_reported_at,
      LEAST(
        0.60,
        (
          sum(CASE WHEN report_type='wrong_price' THEN 1 ELSE 0 END) * 0.15
          + sum(CASE WHEN report_type='unavailable' THEN 1 ELSE 0 END) * 0.10
          + sum(CASE WHEN report_type='duplicate' THEN 1 ELSE 0 END) * 0.08
          + sum(CASE WHEN report_type='other' THEN 1 ELSE 0 END) * 0.05
        )
      )::numeric(3,2) AS penalty
    FROM public.offer_reports
    WHERE created_at >= now() - interval '30 days'
    GROUP BY offer_id;

  $sql$;

  -- 3c) Alerts: include_delivery column (watchlist)
  IF to_regclass('public.alerts') IS NOT NULL THEN
    ALTER TABLE public.alerts
      ADD COLUMN IF NOT EXISTS include_delivery boolean NOT NULL DEFAULT false;

    CREATE INDEX IF NOT EXISTS idx_alerts_user_active
      ON public.alerts (user_id, is_active) WHERE is_active = true;
  END IF;

  -- 4) Ensure plugin tables exist (needed for Source Packs install)
  IF to_regclass('public.domain_url_patterns') IS NULL THEN
    EXECUTE $sql$
      CREATE TABLE public.domain_url_patterns (
        domain text PRIMARY KEY,
        product_regex text NOT NULL,
        category_regex text NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    $sql$;
  END IF;

  IF to_regclass('public.source_entrypoints') IS NULL THEN
    EXECUTE $sql$
      CREATE TABLE public.source_entrypoints (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        domain text NOT NULL,
        url text NOT NULL,
        page_type text NOT NULL DEFAULT 'category',
        priority int NOT NULL DEFAULT 100,
        is_active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(domain, url)
      )
    $sql$;
  END IF;

  IF to_regclass('public.source_adapters') IS NULL THEN
    EXECUTE $sql$
      CREATE TABLE public.source_adapters (
        id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
        source_id uuid NOT NULL REFERENCES public.price_sources(id),
        adapter_type text NOT NULL,
        selectors jsonb NOT NULL DEFAULT '{}'::jsonb,
        is_active boolean NOT NULL DEFAULT true,
        priority int NOT NULL DEFAULT 100,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    $sql$;
  END IF;

  IF to_regclass('public.source_adapters') IS NOT NULL THEN
    -- Deduplicate any old duplicates before creating unique index
    EXECUTE $sql$
      DELETE FROM public.source_adapters a
      USING public.source_adapters b
      WHERE a.source_id = b.source_id
        AND a.adapter_type = b.adapter_type
        AND a.ctid > b.ctid
    $sql$;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_source_adapters_source_type_unique
      ON public.source_adapters(source_id, adapter_type);
  END IF;

  IF to_regclass('public.source_api_endpoints') IS NULL THEN
    EXECUTE $sql$
      CREATE TABLE public.source_api_endpoints (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        domain text NOT NULL,
        url text NOT NULL,
        endpoint_type text NOT NULL,
        priority int NOT NULL DEFAULT 100,
        is_active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (domain, url)
      )
    $sql$;
  END IF;

  IF to_regclass('public.domain_bootstrap_paths') IS NULL THEN
    EXECUTE $sql$
      CREATE TABLE public.domain_bootstrap_paths (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        source_domain text NOT NULL,
        path text NOT NULL,
        page_type text NOT NULL DEFAULT 'category',
        priority int NOT NULL DEFAULT 100,
        is_active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(source_domain, path)
      )
    $sql$;
  END IF;

  -- 5) Refresh v_product_all_offers to expose confidence/anomaly fields for UI
  EXECUTE $sql$
    CREATE OR REPLACE VIEW public.v_product_all_offers AS
    SELECT
      spo.id as offer_id,
      spo.product_id,
      p.name_ar as product_name_ar,
      p.name_en as product_name_en,
      p.image_url as product_image_url,
      p.category,
      p.unit,
      p.brand_ar,
      p.brand_en,
      spo.price as base_price,
      spo.discount_price,
      COALESCE(spo.discount_price, spo.price) as final_price,
      spo.delivery_fee,
      spo.currency,
      spo.in_stock,
      spo.source_url,
      spo.merchant_name,
      spo.observed_at,
      spo.region_id,
      r.name_ar as region_name_ar,
      r.name_en as region_name_en,
      ps.name_ar as source_name_ar,
      ps.domain as source_domain,
      ps.logo_url as source_logo_url,
      ps.source_kind,
      spo.source_id,
      spo.is_verified,
      spo.raw_price_text,
      spo.normalized_price_iqd,
      spo.is_price_anomaly,
      spo.anomaly_reason,
      spo.price_confidence
    FROM public.source_price_observations spo
    JOIN public.products p ON spo.product_id = p.id
    JOIN public.regions r ON spo.region_id = r.id
    JOIN public.price_sources ps ON spo.source_id = ps.id
    WHERE p.is_active = true
      AND p.condition = 'new'
      AND spo.product_condition = 'new'
      AND ps.is_active = true
      AND COALESCE(ps.auto_disabled,false) = false
    ORDER BY COALESCE(spo.discount_price, spo.price) ASC, spo.observed_at DESC;
  $sql$;


  -- 4) source_health_daily + latest view
  CREATE TABLE IF NOT EXISTS public.source_health_daily (
    day date NOT NULL,
    source_id uuid NOT NULL REFERENCES public.price_sources(id) ON DELETE CASCADE,
    domain text NOT NULL,
    successes int NOT NULL DEFAULT 0,
    failures int NOT NULL DEFAULT 0,
    anomalies int NOT NULL DEFAULT 0,
    error_rate numeric(5,4) NULL,
    anomaly_rate numeric(5,4) NULL,
    last_success_at timestamptz NULL,
    last_error_at timestamptz NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(day, source_id)
  );

  CREATE OR REPLACE VIEW public.v_source_health_latest
  WITH (security_invoker = on) AS
  SELECT DISTINCT ON (sh.source_id)
    sh.source_id, sh.day, sh.domain, sh.successes, sh.failures, sh.anomalies,
    sh.error_rate, sh.anomaly_rate, sh.last_success_at, sh.last_error_at, sh.created_at
  FROM public.source_health_daily sh
  ORDER BY sh.source_id, sh.day DESC, sh.created_at DESC;

END $$;
'@ | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Compatibility patch failed (psql exit code $LASTEXITCODE)" }
  Write-Host "[db] compatibility ok"
} catch {
  Write-Host "[!] Compatibility patch failed (safe to ignore for first boot if schema init is still running)."
  docker compose logs --tail 80 db
}

Write-Host "[3/5] Installing web dependencies..."
npm install

Write-Host "[4/5] Installing API dependencies..."
npm --prefix api install

Write-Host "[5/5] Starting API + Web..."
npm run dev:all
