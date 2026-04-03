import { sql } from 'drizzle-orm';
import { getDb, type Env } from '../db';

/**
 * Reset render health counters for a single domain.
 * Safe + admin-only (via route). Useful after fixing a site or changing worker settings.
 */
export async function resetRenderHealth(env: Env, opts: { domain: string }): Promise<any> {
  const db = getDb(env);
  const domain = String(opts?.domain || '').toLowerCase().replace(/^www\./, '').trim();
  if (!domain) return { ok: false, error: 'MISSING_DOMAIN' };

  const exists = await db.execute(sql`select to_regclass('public.price_sources') as t`).catch(() => ({ rows: [] as any[] }));
  if (!((exists.rows as any[])[0]?.t)) return { ok: false, error: 'SCHEMA_NOT_PATCHED' };

  await db.execute(sql`
    update public.price_sources
    set
      render_consecutive_failures = 0,
      last_render_error_code = null,
      last_render_http_status = null,
      last_render_failure_at = null,
      render_paused_until = null
    where domain = ${domain}
  `);

  return { ok: true, domain };
}
