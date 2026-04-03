import { Hono } from 'hono';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { getDb, type Env } from '../db';
import type { AppAuthContext } from '../auth/appUser';

type Ctx = { Bindings: Env; Variables: { auth: AppAuthContext | null } };

export const tableRoutes = new Hono<Ctx>();

// ----- public read-only tables

tableRoutes.get('/exchange_rates', async (c) => {
  const db = getDb(c.env);

  const effective = await db.execute(sql`
    select *
    from public.fx_rate_effective
    order by rate_date desc, updated_at desc
    limit 1
  `).catch(() => ({ rows: [] as any[] }));
  const fx = (effective.rows as any[])[0] ?? null;

  if (fx) {
    const rows = [] as any[];
    if (fx.official_rate != null) {
      rows.push({
        id: `gov-${fx.rate_date}`,
        rate_date: fx.rate_date,
        source_type: 'gov',
        source_name: 'Gov: effective',
        buy_iqd_per_usd: fx.official_rate,
        sell_iqd_per_usd: fx.official_rate,
        mid_iqd_per_usd: fx.official_rate,
        is_active: true,
        created_at: fx.updated_at ?? fx.created_at,
        meta: { quality_flag: fx.quality_flag, ...(fx.meta?.gov ?? {}) },
      });
    }
    if (fx.market_mid_baghdad != null) {
      rows.push({
        id: `market-${fx.rate_date}`,
        rate_date: fx.rate_date,
        source_type: 'market',
        source_name: 'Market: effective',
        buy_iqd_per_usd: fx.market_buy_baghdad,
        sell_iqd_per_usd: fx.market_sell_baghdad,
        mid_iqd_per_usd: fx.market_mid_baghdad,
        is_active: true,
        created_at: fx.updated_at ?? fx.created_at,
        meta: { quality_flag: fx.quality_flag, ...(fx.meta?.market ?? {}) },
      });
    }
    if (rows.length) return c.json(rows);
  }

  const r = await db.execute(sql`
    select * from public.exchange_rates
    where is_active = true
    order by rate_date desc, created_at desc
    limit 10
  `);
  return c.json(r.rows ?? []);
});

tableRoutes.get('/product_images', async (c) => {
  const productId = c.req.query('product_id');
  if (!productId) return c.json({ error: 'product_id required' }, 400);
  const db = getDb(c.env);
  const r = await db.execute(sql`
    select id, image_url, source_site, source_page_url, position, confidence_score, is_primary, is_verified, width, height
    from public.product_images
    where product_id = ${productId}
      and confidence_score >= 0.5
    order by is_primary desc, position asc
  `);
  return c.json(r.rows ?? []);
});

tableRoutes.get('/price_sources', async (c) => {
  const onlyActive = c.req.query('active') === 'true';
  const db = getDb(c.env);
  const r = await db.execute(sql`
    select id, name_ar, domain, source_kind, is_active, trust_weight, base_url, logo_url
    from public.price_sources
    where country_code = 'IQ'
      ${onlyActive ? sql`and is_active = true and coalesce(auto_disabled,false)=false` : sql``}
    order by created_at desc
  `);
  return c.json(r.rows ?? []);
});

// ----- authenticated user tables

const upsertUserSettingsSchema = z.object({
  push_enabled: z.boolean().optional(),
  email_enabled: z.boolean().optional(),
  notifications_unread_only: z.boolean().optional(),
  quiet_hours_start: z.string().nullable().optional(),
  quiet_hours_end: z.string().nullable().optional(),
  timezone: z.string().optional(),
});

tableRoutes.get('/user_settings', async (c) => {
  const auth = c.get('auth');
  if (!auth) return c.json({ error: 'UNAUTHORIZED' }, 401);
  const db = getDb(c.env);
  const r = await db.execute(sql`
    select user_id, push_enabled, email_enabled, notifications_unread_only, quiet_hours_start, quiet_hours_end, timezone
    from public.user_settings
    where user_id = ${auth.appUserId}::uuid
    limit 1
  `);
  return c.json((r.rows as any[])[0] ?? null);
});

tableRoutes.post('/user_settings', async (c) => {
  const auth = c.get('auth');
  if (!auth) return c.json({ error: 'UNAUTHORIZED' }, 401);
  const patch = upsertUserSettingsSchema.parse(await c.req.json());
  const db = getDb(c.env);
  await db.execute(sql`
    insert into public.user_settings (user_id, push_enabled, email_enabled, notifications_unread_only, quiet_hours_start, quiet_hours_end, timezone, updated_at)
    values (
      ${auth.appUserId}::uuid,
      ${patch.push_enabled ?? false},
      ${patch.email_enabled ?? true},
      ${patch.notifications_unread_only ?? false},
      ${patch.quiet_hours_start ?? null},
      ${patch.quiet_hours_end ?? null},
      ${patch.timezone ?? 'Asia/Baghdad'},
      now()
    )
    on conflict (user_id) do update set
      push_enabled = coalesce(${patch.push_enabled ?? null}, user_settings.push_enabled),
      email_enabled = coalesce(${patch.email_enabled ?? null}, user_settings.email_enabled),
      notifications_unread_only = coalesce(${patch.notifications_unread_only ?? null}, user_settings.notifications_unread_only),
      quiet_hours_start = coalesce(${patch.quiet_hours_start ?? null}, user_settings.quiet_hours_start),
      quiet_hours_end = coalesce(${patch.quiet_hours_end ?? null}, user_settings.quiet_hours_end),
      timezone = coalesce(${patch.timezone ?? null}, user_settings.timezone),
      updated_at = now()
  `);
  return c.json({ ok: true });
});

// ----- catalogs for ReportPrice

tableRoutes.get('/products', async (c) => {
  const active = c.req.query('active') === 'true';
  const ids = (c.req.query('ids') || '').split(',').map((s) => s.trim()).filter(Boolean);
  const db = getDb(c.env);

  if (ids.length > 0) {
    const r = await db.execute(sql`
      select id, name_ar
      from public.products
      where id = any(${ids}::uuid[])
    `);
    return c.json(r.rows ?? []);
  }

  const r = await db.execute(sql`
    select id, name_ar
    from public.products
    where ${active ? sql`is_active = true` : sql`true`}
    order by name_ar
    limit 2000
  `);
  return c.json(r.rows ?? []);
});

tableRoutes.get('/regions', async (c) => {
  const active = c.req.query('active') === 'true';
  const ids = (c.req.query('ids') || '').split(',').map((s) => s.trim()).filter(Boolean);
  const db = getDb(c.env);

  if (ids.length > 0) {
    const r = await db.execute(sql`
      select id, name_ar
      from public.regions
      where id = any(${ids}::uuid[])
    `);
    return c.json(r.rows ?? []);
  }

  const r = await db.execute(sql`
    select id, name_ar
    from public.regions
    where ${active ? sql`is_active = true` : sql`true`}
    order by name_ar
    limit 1000
  `);
  return c.json(r.rows ?? []);
});

tableRoutes.get('/stores', async (c) => {
  const db = getDb(c.env);
  const r = await db.execute(sql`
    select id, name_ar, region_id
    from public.stores
    order by name_ar
    limit 5000
  `);
  return c.json(r.rows ?? []);
});

// ----- price reports (authenticated)

const createPriceReportSchema = z.object({
  product_id: z.string().uuid(),
  region_id: z.string().uuid(),
  store_id: z.string().uuid().nullable().optional(),
  price: z.number().positive(),
  currency: z.string().default('IQD'),
  unit: z.string().default('kg'),
  quantity: z.number().positive().default(1),
  notes: z.string().nullable().optional(),
});

tableRoutes.get('/price_reports/recent', async (c) => {
  const auth = c.get('auth');
  if (!auth) return c.json({ error: 'UNAUTHORIZED' }, 401);
  const limit = Number(c.req.query('limit') ?? 5);
  const db = getDb(c.env);
  const r = await db.execute(sql`
    select id, price, currency, unit, status, created_at, product_id, region_id
    from public.price_reports
    where user_id = ${auth.appUserId}::uuid
    order by created_at desc
    limit ${limit}
  `);
  return c.json(r.rows ?? []);
});

tableRoutes.post('/price_reports', async (c) => {
  const auth = c.get('auth');
  if (!auth) return c.json({ error: 'UNAUTHORIZED' }, 401);
  const body = createPriceReportSchema.parse(await c.req.json());
  const db = getDb(c.env);

  await db.execute(sql`
    insert into public.price_reports (user_id, product_id, region_id, store_id, price, currency, unit, quantity, notes)
    values (
      ${auth.appUserId}::uuid,
      ${body.product_id},
      ${body.region_id},
      ${body.store_id ?? null},
      ${body.price},
      ${body.currency},
      ${body.unit},
      ${body.quantity},
      ${body.notes ?? null}
    )
  `);

  return c.json({ ok: true });
});

// ----- alerts (authenticated)

const createAlertSchema = z.object({
  product_id: z.string().uuid(),
  target_price: z.number().positive(),
  region_id: z.string().uuid().nullable().optional(),
  include_delivery: z.boolean().optional(),
});


tableRoutes.get('/alerts', async (c) => {
  const auth = c.get('auth');
  if (!auth) return c.json({ error: 'UNAUTHORIZED' }, 401);
  const productId = c.req.query('product_id');
  const limit = Math.max(10, Math.min(200, Number(c.req.query('limit') ?? 200)));
  const db = getDb(c.env);

  const r = await db.execute(sql`
    select id, product_id, region_id, target_price, include_delivery, is_active, alert_type, last_triggered_at, created_at
    from public.alerts
    where user_id = ${auth.appUserId}::uuid
      ${productId ? sql`and product_id = ${productId}::uuid` : sql``}
    order by created_at desc
    limit ${limit}
  `);
  return c.json(r.rows ?? []);
});

tableRoutes.post('/alerts', async (c) => {
  const auth = c.get('auth');
  if (!auth) return c.json({ error: 'UNAUTHORIZED' }, 401);
  const body = createAlertSchema.parse(await c.req.json());
  const db = getDb(c.env);
  const r = await db.execute(sql`
    insert into public.alerts (user_id, product_id, region_id, target_price, include_delivery, alert_type)
    values (
      ${auth.appUserId}::uuid,
      ${body.product_id},
      ${body.region_id ?? null},
      ${body.target_price},
      ${body.include_delivery ?? false},
      'price_drop'
    )
    returning id, product_id, region_id, target_price, include_delivery, is_active, alert_type, last_triggered_at, created_at
  `);
  return c.json((r.rows as any[])[0] ?? null);
});


tableRoutes.patch('/alerts/:id', async (c) => {
  const auth = c.get('auth');
  if (!auth) return c.json({ error: 'UNAUTHORIZED' }, 401);
  const id = c.req.param('id');

  const body = z.object({
    is_active: z.boolean().optional(),
    target_price: z.number().positive().optional(),
    include_delivery: z.boolean().optional(),
    region_id: z.string().uuid().nullable().optional(),
  }).refine((x) => Object.keys(x).length > 0, { message: 'no fields' }).parse(await c.req.json());

  const db = getDb(c.env);

  await db.execute(sql`
    update public.alerts
    set
      is_active = coalesce(${body.is_active ?? null}::boolean, is_active),
      target_price = coalesce(${body.target_price ?? null}::numeric, target_price),
      include_delivery = coalesce(${body.include_delivery ?? null}::boolean, include_delivery),
      region_id = coalesce(${body.region_id ?? null}::uuid, region_id),
      updated_at = now()
    where id = ${id} and user_id = ${auth.appUserId}::uuid
  `);

  return c.json({ ok: true });
});

tableRoutes.delete('/alerts/:id', async (c) => {
  const auth = c.get('auth');
  if (!auth) return c.json({ error: 'UNAUTHORIZED' }, 401);
  const id = c.req.param('id');
  const db = getDb(c.env);
  await db.execute(sql`delete from public.alerts where id = ${id} and user_id = ${auth.appUserId}::uuid`);
  return c.json({ ok: true });
});


tableRoutes.get('/watchlist', async (c) => {
  const auth = c.get('auth');
  if (!auth) return c.json({ error: 'UNAUTHORIZED' }, 401);
  const db = getDb(c.env);
  const limit = Math.max(10, Math.min(200, Number(c.req.query('limit') ?? 100)));

  const r = await db.execute(sql`
    select
      a.id,
      a.product_id,
      a.region_id,
      a.target_price,
      a.include_delivery,
      a.is_active,
      a.alert_type,
      a.last_triggered_at,
      a.created_at,
      p.name_ar as product_name_ar,
      p.name_en as product_name_en,
      p.image_url as product_image_url,
      p.category as product_category,
      p.unit as product_unit,
      bo.best_price as current_best_price,
      bo.best_source_domain as current_best_source_domain,
      bo.best_observed_at as current_best_observed_at,
      case
        when a.target_price is null or bo.best_price is null then false
        else (bo.best_price <= a.target_price)
      end as would_trigger_now
    from public.alerts a
    join public.products p on p.id = a.product_id
    left join lateral (
      select
        case
          when a.include_delivery
            then (coalesce(o.final_price,0) + coalesce(o.delivery_fee,0))
          else coalesce(o.final_price,0)
        end as best_price,
        o.source_domain as best_source_domain,
        o.observed_at as best_observed_at
      from public.v_product_all_offers o
      where o.product_id = a.product_id
        and o.is_verified = true
        and o.in_stock = true
        and (a.region_id is null or o.region_id = a.region_id)
        and coalesce(o.final_price,0) > 0
        and coalesce(o.is_price_anomaly,false) = false
      order by
        case
          when a.include_delivery
            then (coalesce(o.final_price,0) + coalesce(o.delivery_fee,0))
          else coalesce(o.final_price,0)
        end asc,
        o.observed_at desc
      limit 1
    ) bo on true
    where a.user_id = ${auth.appUserId}::uuid
    order by a.created_at desc
    limit ${limit}
  `);

  return c.json(r.rows ?? []);
});


// ----- notifications (authenticated)

tableRoutes.get('/notifications', async (c) => {
  const auth = c.get('auth');
  if (!auth) return c.json({ error: 'UNAUTHORIZED' }, 401);
  const limit = Number(c.req.query('limit') ?? 20);
  const unreadOnly = c.req.query('unreadOnly') === 'true';
  const db = getDb(c.env);

  const r = await db.execute(sql`
    select id, user_id, type, title_ar, body_ar, payload, is_read, read_at, created_at
    from public.notifications
    where user_id = ${auth.appUserId}::uuid
      ${unreadOnly ? sql`and is_read = false` : sql``}
    order by created_at desc
    limit ${limit}
  `);
  return c.json(r.rows ?? []);
});

tableRoutes.get('/notifications/unread_count', async (c) => {
  const auth = c.get('auth');
  if (!auth) return c.json({ error: 'UNAUTHORIZED' }, 401);
  const db = getDb(c.env);
  const r = await db.execute(sql`
    select count(*)::int as cnt
    from public.notifications
    where user_id = ${auth.appUserId}::uuid and is_read = false
  `);
  return c.json({ count: Number((r.rows as any[])[0]?.cnt ?? 0) });
});

tableRoutes.patch('/notifications/:id/read', async (c) => {
  const auth = c.get('auth');
  if (!auth) return c.json({ error: 'UNAUTHORIZED' }, 401);
  const id = c.req.param('id');
  const db = getDb(c.env);
  await db.execute(sql`
    update public.notifications
    set is_read = true, read_at = now()
    where id = ${id} and user_id = ${auth.appUserId}::uuid
  `);
  return c.json({ ok: true });
});

tableRoutes.post('/notifications/read_all', async (c) => {
  const auth = c.get('auth');
  if (!auth) return c.json({ error: 'UNAUTHORIZED' }, 401);
  const db = getDb(c.env);
  await db.execute(sql`
    update public.notifications
    set is_read = true, read_at = now()
    where user_id = ${auth.appUserId}::uuid and is_read = false
  `);
  return c.json({ ok: true });
});

// ----- web push subscriptions (authenticated)

const upsertPushSchema = z.object({
  endpoint: z.string().url(),
  p256dh: z.string(),
  auth: z.string(),
  user_agent: z.string().optional(),
});

tableRoutes.post('/web_push_subscriptions', async (c) => {
  const auth = c.get('auth');
  if (!auth) return c.json({ error: 'UNAUTHORIZED' }, 401);
  const body = upsertPushSchema.parse(await c.req.json());
  const db = getDb(c.env);

  await db.execute(sql`
    insert into public.web_push_subscriptions (user_id, endpoint, p256dh, auth, user_agent, is_active, updated_at)
    values (${auth.appUserId}::uuid, ${body.endpoint}, ${body.p256dh}, ${body.auth}, ${body.user_agent ?? null}, true, now())
    on conflict (endpoint) do update set
      user_id = excluded.user_id,
      p256dh = excluded.p256dh,
      auth = excluded.auth,
      user_agent = excluded.user_agent,
      is_active = true,
      updated_at = now()
  `);

  return c.json({ ok: true });
});

tableRoutes.post('/web_push_subscriptions/unsubscribe', async (c) => {
  const auth = c.get('auth');
  if (!auth) return c.json({ error: 'UNAUTHORIZED' }, 401);
  const body = z.object({ endpoint: z.string().url() }).parse(await c.req.json());
  const db = getDb(c.env);

  await db.execute(sql`
    update public.web_push_subscriptions
    set is_active = false, updated_at = now()
    where user_id = ${auth.appUserId}::uuid and endpoint = ${body.endpoint}
  `);

  return c.json({ ok: true });
});
