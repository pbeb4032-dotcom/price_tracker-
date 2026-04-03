import { Hono } from 'hono';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { getDb, type Env } from '../db';
import type { AppAuthContext } from '../auth/appUser';

type Ctx = { Bindings: Env; Variables: { auth: AppAuthContext | null } };

const rpcBodySchema = z.record(z.any());

export const rpcRoutes = new Hono<Ctx>();

// Only expose the RPCs that the current frontend uses (safety).
const ALLOWED_RPCS = new Set([
  'has_role',
  'get_ingestion_dashboard',
  'search_products',
  'search_products_engine',
  'search_offers_cached',
  'get_product_price_history',
]);

rpcRoutes.post('/:name', async (c) => {
  const name = c.req.param('name');
  if (!ALLOWED_RPCS.has(name)) return c.json({ error: 'RPC_NOT_ALLOWED' }, 404);

  const body = rpcBodySchema.parse(await c.req.json().catch(() => ({})));
  const db = getDb(c.env);

  // Map each RPC to a parameterized SQL call.
  switch (name) {
    case 'has_role': {
      const role = String((body as any)._role ?? (body as any).role ?? "");
      const userId = String((body as any)._user_id ?? (body as any).user_id ?? c.get("auth")?.appUserId ?? "");
      if (!userId || !role) return c.json({ error: "BAD_REQUEST" }, 400);
      const r = await db.execute(sql`select public.has_role(${userId}::uuid, ${role}::app_role) as ok`);
      return c.json(Boolean((r.rows as any[])[0]?.ok));
    }

    case 'get_ingestion_dashboard': {
      const r = await db.execute(sql`select public.get_ingestion_dashboard() as data`);
      return c.json((r.rows as any[])[0]?.data ?? {});
    }

    case 'search_products': {
      const q = String(body.search_query ?? '');
      const category = body.category_filter === null || body.category_filter === undefined
        ? null
        : String(body.category_filter);
      const limit = Number(body.limit_count ?? 50);
      const r = await db.execute(sql`select * from public.search_products(${q}, ${category}, ${limit})`);
      return c.json(r.rows ?? []);
    }

    case 'search_products_engine': {
      const q = String(body.p_query ?? "");
      const regionId = body.p_region_id ? String(body.p_region_id) : null;
      const filtersJson = JSON.stringify(body.p_filters ?? {});
      const limit = Number(body.p_limit ?? 24);
      const offset = Number(body.p_offset ?? 0);
      const sort = String(body.p_sort ?? "best");
      const r = await db.execute(sql`select * from public.search_products_engine(${q}, ${regionId}, ${filtersJson}::jsonb, ${limit}, ${offset}, ${sort})`);
      return c.json(r.rows ?? []);
    }

    case 'search_offers_cached': {
      const q = String(body.p_query ?? "");
      const category = body.p_category === null || body.p_category === undefined ? null : String(body.p_category);
      const regionId = body.p_region_id ? String(body.p_region_id) : null;
      const limit = Number(body.p_limit ?? 24);
      const r = await db.execute(sql`select * from public.search_offers_cached(${q}, ${category}, ${regionId}, ${limit})`);
      return c.json(r.rows ?? []);
    }

    case 'get_product_price_history': {
      const productId = String((body as any).product_id ?? (body as any).p_product_id ?? '');
      const regionId = (body as any).region_id || (body as any).p_region_id
        ? String((body as any).region_id ?? (body as any).p_region_id)
        : null;
      const days = Number((body as any).days ?? (body as any).p_days ?? 90);
      const includeDelivery = Boolean(
        (body as any).include_delivery ?? (body as any).includeDelivery ?? (body as any).p_include_delivery ?? false
      );
      if (!productId) return c.json({ error: 'BAD_REQUEST' }, 400);

      // DB signature: (p_product_id uuid, p_days int, p_region_id uuid, p_include_delivery boolean)
      const r = await db.execute(sql`
        select * from public.get_product_price_history(
          ${productId}::uuid,
          ${days},
          ${regionId}::uuid,
          ${includeDelivery}
        )
      `);

      // Backward/forward compatible mapping:
      // - DB function historically returns offer_count/source_count.
      // - Frontend chart expects sample_count (same as offer_count).
      const rows = (r.rows ?? []) as any[];
      const mapped = rows.map((row) => ({
        ...row,
        sample_count: Number(row.sample_count ?? row.offer_count ?? 0),
      }));
      return c.json(mapped);
    }

    default:
      return c.json({ error: 'NOT_IMPLEMENTED' }, 501);
  }
});
