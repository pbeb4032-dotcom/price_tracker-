import { Hono } from 'hono';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { getDb, type Env } from '../db';
import type { AppAuthContext } from '../auth/appUser';

type Ctx = { Bindings: Env; Variables: { auth: AppAuthContext | null } };

export const offerRoutes = new Hono<Ctx>();

const createOfferReportSchema = z.object({
  offer_id: z.string().uuid(),
  report_type: z.enum(['wrong_price', 'unavailable', 'duplicate', 'other']),
  severity: z.number().int().min(1).max(5).optional(),
  note: z.string().max(500).optional().nullable(),
});

offerRoutes.post('/report', async (c) => {
  const auth = c.get('auth');
  if (!auth) return c.json({ error: 'UNAUTHORIZED' }, 401);
  const body = createOfferReportSchema.parse(await c.req.json());
  const db = getDb(c.env);

  // Guard: offer exists
  const exists = await db.execute(sql`
    select id from public.source_price_observations where id = ${body.offer_id}::uuid limit 1
  `);
  if (!(exists.rows as any[])[0]?.id) return c.json({ error: 'OFFER_NOT_FOUND' }, 404);

  const severity = Number(body.severity ?? 2);
  const note = body.note ? String(body.note).trim().slice(0, 500) : null;

  await db.execute(sql`
    insert into public.offer_reports (offer_id, user_id, report_type, severity, note)
    values (${body.offer_id}::uuid, ${auth.appUserId}::uuid, ${body.report_type}, ${severity}, ${note})
    on conflict (offer_id, user_id, report_type) do update set
      severity = excluded.severity,
      note = excluded.note,
      updated_at = now()
  `);

  const agg = await db.execute(sql`
  select * from public.v_offer_reports_agg where offer_id = ${body.offer_id}::uuid
`);
const aggRow = (agg.rows as any[])[0] ?? null;

// Apply crowd signals immediately (no cron needed): degrade confidence / mark anomaly / mark unavailable.
// Admin job `/admin/jobs/apply_offer_reports` still exists for backfill across historical rows.
if (aggRow) {
  const wrong = Number(aggRow.wrong_price ?? 0);
  const unav = Number(aggRow.unavailable ?? 0);
  const dup = Number(aggRow.duplicate ?? 0);
  const oth = Number(aggRow.other ?? 0);

  const penalty = Math.min(0.50, wrong * 0.12 + unav * 0.08 + dup * 0.05 + oth * 0.03);

  try {
    await db.execute(sql`
      update public.source_price_observations
      set
        in_stock = case when ${unav}::int >= 3 then false else in_stock end,
        is_price_anomaly = case when ${wrong}::int >= 3 then true else is_price_anomaly end,
        anomaly_reason = case
          when ${wrong}::int >= 3 then coalesce(nullif(anomaly_reason,''), 'crowd_wrong_price')
          else anomaly_reason
        end,
        price_confidence = greatest(
          0.05,
          least(
            1,
            coalesce(price_confidence, 0.50) - ${penalty}::numeric
          )
        )
      where id = ${body.offer_id}::uuid
    `);
  } catch {
    // If running against an older schema missing these columns, don't fail the report request.
  }

  // If "wrong_price" is strongly confirmed by crowd, enqueue to the quarantine queue (if present).
  if (wrong >= 3) {
    try {
      await db.execute(sql`
        insert into public.price_anomaly_quarantine (
          status, created_at, updated_at,
          product_id, source_id, source_domain, source_name,
          product_name, product_url,
          raw_price, parsed_price, currency,
          reason_code, reason_detail, observed_payload
        )
        select
          'pending', now(), now(),
          spo.product_id, spo.source_id, ps.domain, ps.name_ar,
          p.name_ar, spo.source_url,
          coalesce(spo.raw_price_text, spo.price::text), coalesce(spo.discount_price, spo.price), spo.currency,
          'crowd_wrong_price', '3+ user reports (wrong price) on same offer',
          jsonb_build_object(
            'offer_id', spo.id,
            'reports', jsonb_build_object(
              'wrong_price', ${wrong}::int,
              'unavailable', ${unav}::int,
              'duplicate', ${dup}::int,
              'other', ${oth}::int
            )
          )
        from public.source_price_observations spo
        join public.products p on p.id = spo.product_id
        join public.price_sources ps on ps.id = spo.source_id
        where spo.id = ${body.offer_id}::uuid
          and not exists (
            select 1
            from public.price_anomaly_quarantine q
            where q.product_url = spo.source_url
              and q.reason_code = 'crowd_wrong_price'
              and q.status = 'pending'
          )
      `);
    } catch {
      // ignore if quarantine table doesn't exist in some deployments
    }
  }
}

return c.json({ ok: true, offer_id: body.offer_id, agg: (agg.rows as any[])[0] ?? null });
});

// Optional helper: get aggregated crowd signals for a product (used by UI if needed)
offerRoutes.get('/summary', async (c) => {
  const productId = c.req.query('product_id');
  if (!productId) return c.json({ error: 'product_id required' }, 400);
  const db = getDb(c.env);
  const r = await db.execute(sql`
    select o.offer_id, coalesce(a.reports_total,0)::int as reports_total,
           coalesce(a.wrong_price,0)::int as wrong_price,
           coalesce(a.unavailable,0)::int as unavailable,
           coalesce(a.duplicate,0)::int as duplicate,
           coalesce(a.other,0)::int as other,
           coalesce(a.penalty,0)::numeric(3,2) as penalty,
           a.last_reported_at
    from (select offer_id from public.v_product_all_offers where product_id = ${productId}::uuid) o
    left join public.v_offer_reports_agg a on a.offer_id = o.offer_id
    order by reports_total desc, last_reported_at desc nulls last
  `);
  return c.json(r.rows ?? []);
});
