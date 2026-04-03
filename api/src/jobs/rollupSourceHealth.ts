import { sql } from 'drizzle-orm';
import { getDb, type Env } from '../db';

type RollupOpts = {
  hours?: number;
  countryCode?: string;
};

export async function rollupSourceHealth(env: Env, opts?: RollupOpts): Promise<any> {
  const db = getDb(env);
  const hours = Math.max(6, Math.min(168, Number(opts?.hours ?? 24)));
  const countryCode = (opts?.countryCode ?? 'IQ').toUpperCase();

  // Roll up into today's row per source
  const r = await db.execute(sql`
    with src as (
      select id, domain
      from public.price_sources
      where country_code=${countryCode}
    ),
    ok as (
      select source_id, count(*)::int as successes, max(created_at) as last_success_at,
             sum(case when coalesce(is_price_anomaly,false) then 1 else 0 end)::int as anomalies
      from public.source_price_observations
      where created_at >= now() - (${hours}::int * interval '1 hour')
      group by source_id
    ),
    err as (
      select source_domain, count(*)::int as failures, max(created_at) as last_error_at
      from public.ingestion_error_events
      where created_at >= now() - (${hours}::int * interval '1 hour')
      group by source_domain
    ),
    calc as (
      select
        s.id as source_id,
        s.domain,
        coalesce(ok.successes,0)::int as successes,
        coalesce(err.failures,0)::int as failures,
        coalesce(ok.anomalies,0)::int as anomalies,
        ok.last_success_at,
        err.last_error_at,
        case when (coalesce(ok.successes,0)+coalesce(err.failures,0)) = 0 then null
             else round(err.failures::numeric / (ok.successes + err.failures), 4) end as error_rate,
        case when coalesce(ok.successes,0) = 0 then null
             else round(ok.anomalies::numeric / ok.successes, 4) end as anomaly_rate
      from src s
      left join ok on ok.source_id = s.id
      left join err on err.source_domain = s.domain
    )
    insert into public.source_health_daily (
      day, source_id, domain, successes, failures, anomalies,
      error_rate, anomaly_rate, last_success_at, last_error_at
    )
    select
      current_date,
      c.source_id,
      c.domain,
      c.successes,
      c.failures,
      c.anomalies,
      c.error_rate,
      c.anomaly_rate,
      c.last_success_at,
      c.last_error_at
    from calc c
    on conflict (day, source_id) do update set
      successes=excluded.successes,
      failures=excluded.failures,
      anomalies=excluded.anomalies,
      error_rate=excluded.error_rate,
      anomaly_rate=excluded.anomaly_rate,
      last_success_at=excluded.last_success_at,
      last_error_at=excluded.last_error_at,
      created_at=now()
    returning 1
  `);

  return { ok: true, hours, upserted: (r.rows as any[])?.length ?? 0 };
}
