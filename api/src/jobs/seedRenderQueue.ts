import { sql } from 'drizzle-orm';
import { getDb, type Env } from '../db';

export async function seedRenderQueue(env: Env, opts?: { domain?: string; limit?: number }): Promise<any> {
  const db = getDb(env);
  const limit = Math.max(1, Math.min(20000, Number(opts?.limit ?? 2000)));
  const domain = opts?.domain ? String(opts.domain).toLowerCase().replace(/^www\./, '') : null;

  // Best-effort: if schema isn't patched yet, return ok:false.
  const exists = await db.execute(sql`select to_regclass('public.render_queue') as t`).catch(() => ({ rows: [] as any[] }));
  if (!((exists.rows as any[])[0]?.t)) return { ok: false, error: 'SCHEMA_NOT_PATCHED' };

  const r = await db.execute(sql`
    with src as (
      select domain
      from public.price_sources
      where country_code='IQ'
        and coalesce(js_only,false)=true
        ${domain ? sql`and domain = ${domain}` : sql``}
    ),
    pick as (
      select
        cf.source_domain,
        cf.url,
        (
          case
            when lower(cf.url) ~ '(\\.(png|jpe?g|webp|gif|svg|ico|css|js|mjs|map|json|xml|pdf|zip|rar|7z))(\\?|#|$)' then 5
            when lower(cf.url) ~ '(\\/cart\\b|\\/checkout\\b|\\/account\\b|\\/login\\b|\\/register\\b|add-to-cart|\\/wp-admin\\b)' then 0
            when lower(cf.url) ~ '(\\/product\\b|\\/products\\b|\\/p\\/|\\/item\\/|\\/sku\\/|\\bproduct_id=|\\bsku=|\\bprod=|\\/dp\\/|\\/gp\\/product\\b|\\/itm\\/)' then 60
            when lower(cf.url) ~ '(\\/category\\b|\\/categories\\b|\\/cat\\/|\\/shop\\b|\\/store\\b|\\/collections\\b|\\/search\\b|\\bcategory=|\\bcat=|\\bs=|[?&]page=\\d+|[?&]p=\\d+)' then 30
            else 10
          end
          + (
            case
              when rp.url_hash is null then 6
              when rp.expires_at <= now() then 14
              when rp.expires_at <= now() + interval '2 hours' then 8
              else 0
            end
          )
        )::int as priority
      from public.crawl_frontier cf
      join src on src.domain = cf.source_domain
      left join public.rendered_pages rp on rp.url_hash = md5(lower(cf.url))
      where cf.status in ('pending','processing','failed')
        and (rp.url_hash is null or rp.expires_at <= now() + interval '2 hours')
      order by cf.updated_at desc
      limit ${limit}
    ),
    ins as (
      insert into public.render_queue (source_domain, url, status, priority, discovered_from, next_retry_at)
      select p.source_domain, p.url, 'pending', p.priority, 'seed_render_queue', now()
      from pick p
      on conflict (url_hash) do update
      set
        source_domain = excluded.source_domain,
        priority = greatest(public.render_queue.priority, excluded.priority),
        discovered_from = excluded.discovered_from,
        status = case when public.render_queue.status='processing' then public.render_queue.status else 'pending' end,
        next_retry_at = case when public.render_queue.status='processing' then public.render_queue.next_retry_at else now() end,
        updated_at = now()
      returning 1
    )
    select count(*)::int as inserted from ins
  `).catch(() => ({ rows: [{ inserted: 0 }] } as any));

  return { ok: true, inserted: Number((r.rows as any[])[0]?.inserted ?? 0) };
}
