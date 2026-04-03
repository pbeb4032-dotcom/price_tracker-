import { sql } from 'drizzle-orm';
import { getDb, type Env } from '../db';

/**
 * Seed probe queue for domains whose backoff expired but are still auto-disabled.
 * This prevents immediate full ingestion retries (bot-war).
 */
export async function seedProbeQueue(env: Env, opts?: { limitDomains?: number }): Promise<any> {
  const db = getDb(env);
  const limitDomains = Math.max(1, Math.min(500, Number(opts?.limitDomains ?? 200)));

  // Best-effort: if table missing, return ok:false
  const ok = await db
    .execute(sql`select 1 from public.domain_probe_queue limit 1`)
    .then(() => true)
    .catch(() => false);
  if (!ok) return { ok: false, error: 'probe_queue_table_missing' };

  const r = await db.execute(sql`
    with candidates as (
      select
        ps.domain as source_domain,
        coalesce(
          (select url from public.source_entrypoints se where se.domain = ps.domain and se.is_active = true order by se.priority asc limit 1),
          (select url from public.crawl_frontier cf where cf.source_domain = ps.domain order by cf.updated_at desc limit 1),
          ('https://' || ps.domain || '/')
        ) as probe_url
      from public.price_sources ps
      where ps.country_code = 'IQ'
        and coalesce(ps.auto_disabled,false) = true
        and coalesce(ps.probe_enabled,true) = true
        and (ps.disabled_until is null or ps.disabled_until <= now())
        and (ps.probe_until is null or ps.probe_until <= now())
      order by coalesce(ps.disabled_until, ps.auto_disabled_at, ps.created_at) asc
      limit ${limitDomains}
    ), ins as (
      insert into public.domain_probe_queue (source_domain, probe_url, status, priority, next_retry_at)
      select c.source_domain, c.probe_url, 'pending', 10, now()
      from candidates c
      where not exists (
        select 1 from public.domain_probe_queue q
        where q.source_domain = c.source_domain and q.status in ('pending','processing')
      )
      on conflict do nothing
      returning source_domain
    )
    update public.price_sources ps
    set probe_required = true,
        probe_until = now() + interval '30 minutes',
        last_probe_at = coalesce(ps.last_probe_at, now())
    where ps.domain in (select source_domain from ins)
      and ps.country_code = 'IQ'
    returning ps.domain
  `).catch(() => ({ rows: [] as any[] }));

  return { ok: true, queued_domains: ((r.rows as any[]) ?? []).map((x) => String((x as any).domain)) };

}
