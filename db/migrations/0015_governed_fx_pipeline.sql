-- Sprint 5 foundation: governed FX ingestion and publication pipeline.

CREATE TABLE IF NOT EXISTS public.fx_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_code text NOT NULL UNIQUE,
  source_name text NOT NULL,
  source_kind text NOT NULL
    CHECK (source_kind IN ('official', 'market_exchange_house', 'bank', 'transfer', 'regional_market', 'media_reference', 'api_fallback', 'override')),
  rate_type text NOT NULL
    CHECK (rate_type IN ('official', 'market', 'bank', 'transfer', 'regional')),
  region_key text NOT NULL DEFAULT 'country:iq',
  fetch_url text,
  parser_type text NOT NULL
    CHECK (parser_type IN ('text_iqd', 'json_usd_rates', 'manual_override')),
  parser_version text NOT NULL DEFAULT 'v1',
  parser_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  trust_score numeric(4,3) NOT NULL DEFAULT 0.500,
  freshness_sla_minutes integer NOT NULL DEFAULT 1440,
  publication_enabled boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  priority integer NOT NULL DEFAULT 100,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fx_sources_active
  ON public.fx_sources(rate_type, region_key, is_active, publication_enabled, priority ASC);

CREATE TABLE IF NOT EXISTS public.fx_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES public.fx_sources(id) ON DELETE CASCADE,
  observed_at timestamptz NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  rate_type text NOT NULL
    CHECK (rate_type IN ('official', 'market', 'bank', 'transfer', 'regional')),
  region_key text NOT NULL,
  buy_rate numeric(12,4),
  sell_rate numeric(12,4),
  mid_rate numeric(12,4),
  currency_pair text NOT NULL DEFAULT 'USD/IQD',
  parse_status text NOT NULL
    CHECK (parse_status IN ('ok', 'parse_failed', 'http_error', 'stale', 'invalid')),
  parser_version text NOT NULL DEFAULT 'v1',
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  anomaly_flags jsonb NOT NULL DEFAULT '[]'::jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fx_observations_lookup
  ON public.fx_observations(rate_type, region_key, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_fx_observations_source
  ON public.fx_observations(source_id, observed_at DESC);

CREATE TABLE IF NOT EXISTS public.fx_publications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rate_date date NOT NULL DEFAULT current_date,
  rate_type text NOT NULL
    CHECK (rate_type IN ('official', 'market', 'bank', 'transfer', 'regional')),
  region_key text NOT NULL,
  publication_status text NOT NULL
    CHECK (publication_status IN ('current', 'stale', 'frozen', 'fallback', 'unavailable')),
  buy_rate numeric(12,4),
  sell_rate numeric(12,4),
  mid_rate numeric(12,4),
  effective_for_pricing boolean NOT NULL DEFAULT false,
  quality_flag text NOT NULL DEFAULT 'unverified',
  based_on_n_sources integer NOT NULL DEFAULT 0,
  confidence numeric(4,3),
  freshness_seconds integer,
  source_summary jsonb NOT NULL DEFAULT '[]'::jsonb,
  decision_meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  published_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fx_publications_lookup
  ON public.fx_publications(rate_type, region_key, published_at DESC);

CREATE TABLE IF NOT EXISTS public.fx_publication_inputs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  publication_id uuid NOT NULL REFERENCES public.fx_publications(id) ON DELETE CASCADE,
  source_id uuid NOT NULL REFERENCES public.fx_sources(id) ON DELETE CASCADE,
  observation_id uuid NULL REFERENCES public.fx_observations(id) ON DELETE SET NULL,
  accepted boolean NOT NULL DEFAULT true,
  weight numeric(6,3) NOT NULL DEFAULT 1.000,
  reject_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(publication_id, source_id, observation_id)
);

CREATE INDEX IF NOT EXISTS idx_fx_publication_inputs_publication
  ON public.fx_publication_inputs(publication_id, accepted DESC, weight DESC);
