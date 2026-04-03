import { sql } from 'drizzle-orm';
import { getDb, type Env } from '../db';

/**
 * Sprint 5 foundation:
 * governed FX source registry, raw observations, publications,
 * and publication input audit trail.
 */
export async function patchGovernedFxSchema(env: Env): Promise<any> {
  const db = getDb(env);

  await db.execute(sql`
    create table if not exists public.fx_sources (
      id uuid primary key default gen_random_uuid(),
      source_code text not null unique,
      source_name text not null,
      source_kind text not null
        check (source_kind in ('official', 'market_exchange_house', 'bank', 'transfer', 'regional_market', 'media_reference', 'api_fallback', 'override')),
      rate_type text not null
        check (rate_type in ('official', 'market', 'bank', 'transfer', 'regional')),
      region_key text not null default 'country:iq',
      fetch_url text,
      parser_type text not null
        check (parser_type in ('text_iqd', 'json_usd_rates', 'manual_override')),
      parser_version text not null default 'v1',
      parser_config jsonb not null default '{}'::jsonb,
      trust_score numeric(4,3) not null default 0.500,
      freshness_sla_minutes integer not null default 1440,
      publication_enabled boolean not null default true,
      is_active boolean not null default true,
      priority integer not null default 100,
      meta jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `);
  await db.execute(sql`create index if not exists idx_fx_sources_active on public.fx_sources(rate_type, region_key, is_active, publication_enabled, priority asc)`).catch(() => {});

  await db.execute(sql`
    create table if not exists public.fx_observations (
      id uuid primary key default gen_random_uuid(),
      source_id uuid not null references public.fx_sources(id) on delete cascade,
      observed_at timestamptz not null,
      fetched_at timestamptz not null default now(),
      rate_type text not null
        check (rate_type in ('official', 'market', 'bank', 'transfer', 'regional')),
      region_key text not null,
      buy_rate numeric(12,4),
      sell_rate numeric(12,4),
      mid_rate numeric(12,4),
      currency_pair text not null default 'USD/IQD',
      parse_status text not null
        check (parse_status in ('ok', 'parse_failed', 'http_error', 'stale', 'invalid')),
      parser_version text not null default 'v1',
      raw_payload jsonb not null default '{}'::jsonb,
      anomaly_flags jsonb not null default '[]'::jsonb,
      error text,
      created_at timestamptz not null default now()
    )
  `);
  await db.execute(sql`create index if not exists idx_fx_observations_lookup on public.fx_observations(rate_type, region_key, observed_at desc)`).catch(() => {});
  await db.execute(sql`create index if not exists idx_fx_observations_source on public.fx_observations(source_id, observed_at desc)`).catch(() => {});

  await db.execute(sql`
    create table if not exists public.fx_publications (
      id uuid primary key default gen_random_uuid(),
      rate_date date not null default current_date,
      rate_type text not null
        check (rate_type in ('official', 'market', 'bank', 'transfer', 'regional')),
      region_key text not null,
      publication_status text not null
        check (publication_status in ('current', 'stale', 'frozen', 'fallback', 'unavailable')),
      buy_rate numeric(12,4),
      sell_rate numeric(12,4),
      mid_rate numeric(12,4),
      effective_for_pricing boolean not null default false,
      quality_flag text not null default 'unverified',
      based_on_n_sources integer not null default 0,
      confidence numeric(4,3),
      freshness_seconds integer,
      source_summary jsonb not null default '[]'::jsonb,
      decision_meta jsonb not null default '{}'::jsonb,
      published_at timestamptz not null default now(),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `);
  await db.execute(sql`create index if not exists idx_fx_publications_lookup on public.fx_publications(rate_type, region_key, published_at desc)`).catch(() => {});

  await db.execute(sql`
    create table if not exists public.fx_publication_inputs (
      id uuid primary key default gen_random_uuid(),
      publication_id uuid not null references public.fx_publications(id) on delete cascade,
      source_id uuid not null references public.fx_sources(id) on delete cascade,
      observation_id uuid null references public.fx_observations(id) on delete set null,
      accepted boolean not null default true,
      weight numeric(6,3) not null default 1.000,
      reject_reason text,
      created_at timestamptz not null default now(),
      unique(publication_id, source_id, observation_id)
    )
  `);
  await db.execute(sql`create index if not exists idx_fx_publication_inputs_publication on public.fx_publication_inputs(publication_id, accepted desc, weight desc)`).catch(() => {});

  return { ok: true };
}
