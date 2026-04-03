import { sql } from 'drizzle-orm';
import { getDb, type Env } from '../db';

export async function rebalanceRenderQueuePriorities(env: Env, opts?: { domain?: string; limit?: number }): Promise<any> {
  const db = getDb(env);
  const limit = Math.max(1, Math.min(200000, Number(opts?.limit ?? 20000)));
  const domain = opts?.domain ? String(opts.domain).toLowerCase().replace(/^www\./, '') : null;

  const exists = await db.execute(sql`select to_regclass('public.render_queue') as t`).catch(() => ({ rows: [] as any[] }));
  if (!((exists.rows as any[])[0]?.t)) return { ok: false, error: 'SCHEMA_NOT_PATCHED' };

  const r = await db.execute(sql`
    with pick as (
      select id
      from public.render_queue
      where status in ('pending')
        ${domain ? sql`and source_domain = ${domain}` : sql``}
      order by updated_at asc
      limit ${limit}
    ),
    upd as (
      update public.render_queue rq
      set priority = greatest(
        0,
        least(
          100,
          (
            (
              case
                when lower(rq.url) ~ '(\\.(png|jpe?g|webp|gif|svg|ico|css|js|mjs|map|json|xml|pdf|zip|rar|7z))(\\?|#|$)' then 5
                when lower(rq.url) ~ '(\\/cart\\b|\\/checkout\\b|\\/account\\b|\\/login\\b|\\/register\\b|add-to-cart|\\/wp-admin\\b)' then 0
                when lower(rq.url) ~ '(\\/product\\b|\\/products\\b|\\/p\\/|\\/item\\/|\\/sku\\/|\\bproduct_id=|\\bsku=|\\bprod=|\\/dp\\/|\\/gp\\/product\\b|\\/itm\\/)' then 60
                when lower(rq.url) ~ '(\\/category\\b|\\/categories\\b|\\/cat\\/|\\/shop\\b|\\/store\\b|\\/collections\\b|\\/search\\b|\\bcategory=|\\bcat=|\\bs=|[?&]page=\\d+|[?&]p=\\d+)' then 30
                else 10
              end
            )
            + (
              case
                when rp.url_hash is null then 6
                when rp.expires_at <= now() then 14
                when rp.expires_at <= now() + interval '2 hours' then 8
                else 0
              end
            )
            - least(25, coalesce(rq.attempts,0) * 5)
            - (
              case
                when rq.last_error_code in ('BOT_CHALLENGE','HTTP_403') then 12
                when rq.last_error_code in ('HTTP_429') then 8
                else 0
              end
            )
          )
        )
      )
      from pick p
      left join public.rendered_pages rp on rp.url_hash = rq.url_hash
      where rq.id = p.id
      returning 1
    )
    select count(*)::int as updated from upd
  `).catch(() => ({ rows: [{ updated: 0 }] } as any));

  return { ok: true, updated: Number((r.rows as any[])[0]?.updated ?? 0) };
}
