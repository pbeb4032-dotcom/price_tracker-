import { sql } from 'drizzle-orm';
import { getDb, type Env } from '../db';

/**
 * Cleanup job for rendered_pages TTL cache + old queue rows.
 * Safe to run frequently.
 */
export async function cleanupRenderCache(env: Env, opts?: { maxAgeDays?: number }): Promise<any> {
  const db = getDb(env);
  const maxAgeDays = Math.max(1, Math.min(60, Number(opts?.maxAgeDays ?? 7)));

  const exists = await db.execute(sql`
    select
      to_regclass('public.rendered_pages') as rendered,
      to_regclass('public.render_queue') as queue
  `).catch(() => ({ rows: [] as any[] }));
  const row = (exists.rows as any[])?.[0];
  if (!row?.rendered || !row?.queue) return { ok: false, error: 'SCHEMA_NOT_PATCHED' };

  const delCache = await db.execute(sql`
    with d as (
      delete from public.rendered_pages rp
      using public.price_sources ps
      where ps.domain = rp.source_domain
        and rp.expires_at + make_interval(mins => greatest(coalesce(ps.render_stale_serve_min, 0), 0)) <= now()
      returning 1
    )
    select count(*)::int as n from d
  `).catch(async () => {
    const fallback = await db.execute(sql`
      with d as (
        delete from public.rendered_pages
        where expires_at <= now()
        returning 1
      )
      select count(*)::int as n from d
    `).catch(() => ({ rows: [{ n: 0 }] } as any));
    return fallback as any;
  });

  const delQueue = await db.execute(sql`
    with d as (
      delete from public.render_queue
      where status in ('succeeded','failed_final')
        and completed_at is not null
        and completed_at < now() - make_interval(days => ${maxAgeDays})
      returning 1
    )
    select count(*)::int as n from d
  `).catch(() => ({ rows: [{ n: 0 }] } as any));

  // Reclaim stuck processing (worker crashed)
  const reclaimed = await db.execute(sql`
    update public.render_queue
    set status='pending',
        attempts = coalesce(attempts,0) + 1,
        next_retry_at = now() + interval '5 minutes',
        last_error_code = 'WORKER_STUCK',
        last_error = 'reclaimed processing timeout',
        updated_at = now()
    where status='processing'
      and claimed_at < now() - interval '30 minutes'
  `).catch(() => ({ rowCount: 0 } as any));

  return {
    ok: true,
    deleted_cache: Number((delCache.rows as any[])[0]?.n ?? 0),
    deleted_queue: Number((delQueue.rows as any[])[0]?.n ?? 0),
    reclaimed_processing: Number((reclaimed as any).rowCount ?? 0),
  };
}
