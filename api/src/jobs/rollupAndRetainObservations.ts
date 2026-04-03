import { sql } from 'drizzle-orm';
import { getDb, type Env } from '../db';

type Options = {
  rawKeepDays?: number;
  rollupKeepDays?: number; // 0 = keep forever
  chunkDays?: number;
  deleteMaxRows?: number;
  rollupDeleteMaxRows?: number;
  dryRun?: boolean;
};

const num = (v: unknown, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/**
 * Incremental rollup + safe retention.
 * - Rollups are computed per-day (Baghdad timezone) and stored in source_price_rollups_daily.
 * - Deletion of raw rows happens ONLY if a matching rollup row exists (same day+keys).
 */
export async function rollupAndRetainObservations(env: Env, opts: Options = {}): Promise<any> {
  const db = getDb(env);

  const rawKeepDays = Math.max(7, Math.min(365, Math.floor(num(opts.rawKeepDays ?? process.env.OBS_RAW_KEEP_DAYS, 30))));
  const rollupKeepDays = Math.max(0, Math.min(3650, Math.floor(num(opts.rollupKeepDays ?? process.env.OBS_ROLLUP_KEEP_DAYS, 730))));
  const chunkDays = Math.max(1, Math.min(60, Math.floor(num(opts.chunkDays ?? process.env.OBS_ROLLUP_CHUNK_DAYS, 7))));
  const deleteMaxRows = Math.max(0, Math.min(2_000_000, Math.floor(num(opts.deleteMaxRows ?? process.env.OBS_RAW_DELETE_MAX_ROWS, 250_000))));
  const rollupDeleteMaxRows = Math.max(0, Math.min(2_000_000, Math.floor(num(opts.rollupDeleteMaxRows ?? process.env.OBS_ROLLUP_DELETE_MAX_ROWS, 200_000))));
  const dryRun = Boolean(opts.dryRun ?? ((process.env.OBS_RETENTION_DRY_RUN ?? '0') === '1'));

  // Ensure schema tables exist (best-effort)
  await db.execute(sql`
    create table if not exists public.app_settings (
      key text primary key,
      value text,
      updated_at timestamptz not null default now()
    );
  `).catch(() => {});

  await db.execute(sql`
    create table if not exists public.source_price_rollups_daily (
      day date not null,
      source_id uuid not null,
      product_id uuid not null,
      region_id uuid not null,
      product_condition text not null default 'new',
      unit text,
      min_final_price numeric,
      max_final_price numeric,
      avg_final_price numeric,
      min_effective_price numeric,
      max_effective_price numeric,
      avg_effective_price numeric,
      sample_count int not null default 0,
      in_stock_count int not null default 0,
      first_observed_at timestamptz,
      last_observed_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      primary key (day, source_id, product_id, region_id, product_condition, unit)
    );
  `).catch(() => {});

  // Determine current cursor day
  const cur = await db.execute(sql`
    select value from public.app_settings where key='spo_rollup_cursor_day' limit 1
  `).catch(() => ({ rows: [] as any[] } as any));

  let cursorDay: string | null = (cur.rows as any[])?.[0]?.value ?? null;
  if (!cursorDay) {
    const minDayRes = await db.execute(sql`
      select min((observed_at at time zone 'Asia/Baghdad')::date)::text as d
      from public.source_price_observations
    `);
    cursorDay = (minDayRes.rows as any[])?.[0]?.d ?? null;
    if (cursorDay) {
      await db.execute(sql`
        insert into public.app_settings(key, value)
        values ('spo_rollup_cursor_day', ${cursorDay})
        on conflict (key) do update set value=excluded.value, updated_at=now()
      `);
    }
  }

  // Nothing to roll up if no observations exist yet.
  if (!cursorDay) {
    return {
      ok: true,
      cursor: null,
      rolledRange: null,
      rolledUpRows: 0,
      rawDeleted: 0,
      rollupsDeleted: 0,
      dryRun,
      note: 'no observations yet',
    };
  }

  const maxDayToRollRes = await db.execute(sql`
    select ((now() at time zone 'Asia/Baghdad')::date - ${rawKeepDays}::int)::date::text as d
  `);
  const maxDayToRoll = (maxDayToRollRes.rows as any[])?.[0]?.d as string;

  // Calculate range [cursorDay, endDay] capped by maxDayToRoll
  const rangeRes = await db.execute(sql`
    select
      ${cursorDay}::date as start_day,
      least((${cursorDay}::date + (${chunkDays}::int - 1)), ${maxDayToRoll}::date)::date as end_day,
      (${cursorDay}::date <= ${maxDayToRoll}::date) as should_roll
  `);
  const rr = (rangeRes.rows as any[])?.[0] ?? {};
  const startDay = rr.start_day ? String(rr.start_day) : null;
  const endDay = rr.end_day ? String(rr.end_day) : null;
  const shouldRoll = Boolean(rr.should_roll);

  let rolledUpRows = 0;
  let nextCursor: string | null = cursorDay;

  if (shouldRoll && startDay && endDay) {
    const up = await db.execute(sql`
      insert into public.source_price_rollups_daily (
        day, source_id, product_id, region_id, product_condition, unit,
        min_final_price, max_final_price, avg_final_price,
        min_effective_price, max_effective_price, avg_effective_price,
        sample_count, in_stock_count, first_observed_at, last_observed_at,
        updated_at
      )
      select
        (o.observed_at at time zone 'Asia/Baghdad')::date as day,
        o.source_id,
        o.product_id,
        o.region_id,
        coalesce(nullif(o.product_condition,''), 'new') as product_condition,
        o.unit,

        min(coalesce(o.discount_price, o.price)) as min_final_price,
        max(coalesce(o.discount_price, o.price)) as max_final_price,
        round(avg(coalesce(o.discount_price, o.price)), 4) as avg_final_price,

        min(coalesce(o.discount_price, o.price) + coalesce(o.delivery_fee, 0)) as min_effective_price,
        max(coalesce(o.discount_price, o.price) + coalesce(o.delivery_fee, 0)) as max_effective_price,
        round(avg(coalesce(o.discount_price, o.price) + coalesce(o.delivery_fee, 0)), 4) as avg_effective_price,

        count(*)::int as sample_count,
        sum(case when coalesce(o.in_stock,false) then 1 else 0 end)::int as in_stock_count,
        min(o.observed_at) as first_observed_at,
        max(o.observed_at) as last_observed_at,
        now() as updated_at
      from public.source_price_observations o
      where (o.observed_at at time zone 'Asia/Baghdad')::date between ${startDay}::date and ${endDay}::date
        and coalesce(o.discount_price, o.price) > 0
        and coalesce(o.discount_price, o.price) < 500000000
      group by 1,2,3,4,5,6
      on conflict (day, source_id, product_id, region_id, product_condition, unit)
      do update set
        min_final_price = excluded.min_final_price,
        max_final_price = excluded.max_final_price,
        avg_final_price = excluded.avg_final_price,
        min_effective_price = excluded.min_effective_price,
        max_effective_price = excluded.max_effective_price,
        avg_effective_price = excluded.avg_effective_price,
        sample_count = excluded.sample_count,
        in_stock_count = excluded.in_stock_count,
        first_observed_at = excluded.first_observed_at,
        last_observed_at = excluded.last_observed_at,
        updated_at = now();
    `);

    // drizzle doesn't expose rowCount reliably across adapters, so use the number of returned rows when available.
    rolledUpRows = (up as any)?.rows?.length ? (up as any).rows.length : 0;

    const nextRes = await db.execute(sql`select (${endDay}::date + 1)::date::text as d`);
    nextCursor = (nextRes.rows as any[])?.[0]?.d ?? endDay;

    await db.execute(sql`
      insert into public.app_settings(key, value)
      values ('spo_rollup_cursor_day', ${nextCursor})
      on conflict (key) do update set value=excluded.value, updated_at=now()
    `);
  }

  // Safe raw retention: only delete rows older than rawKeepDays when a matching rollup exists.
  let rawDeleted = 0;
  if (!dryRun && deleteMaxRows > 0) {
    const del = await db.execute(sql`
      with candidates as (
        select o.id
        from public.source_price_observations o
        join public.source_price_rollups_daily r
          on r.day = (o.observed_at at time zone 'Asia/Baghdad')::date
         and r.source_id = o.source_id
         and r.product_id = o.product_id
         and r.region_id = o.region_id
         and r.product_condition = coalesce(nullif(o.product_condition,''), 'new')
         and r.unit is not distinct from o.unit
        where o.observed_at < (now() - (${rawKeepDays} || ' days')::interval)
        order by o.observed_at asc
        limit ${deleteMaxRows}
      )
      delete from public.source_price_observations o
      using candidates c
      where o.id = c.id
      returning 1;
    `);
    rawDeleted = (del.rows as any[])?.length ?? 0;
  }

  // Optional: delete old rollups (keeps DB small forever)
  let rollupsDeleted = 0;
  if (!dryRun && rollupKeepDays > 0 && rollupDeleteMaxRows > 0) {
    const delr = await db.execute(sql`
      with candidates as (
        select day, source_id, product_id, region_id, product_condition, unit
        from public.source_price_rollups_daily
        where day < ((now() at time zone 'Asia/Baghdad')::date - ${rollupKeepDays}::int)
        order by day asc
        limit ${rollupDeleteMaxRows}
      )
      delete from public.source_price_rollups_daily r
      using candidates c
      where r.day = c.day
        and r.source_id = c.source_id
        and r.product_id = c.product_id
        and r.region_id = c.region_id
        and r.product_condition = c.product_condition
        and r.unit is not distinct from c.unit
      returning 1;
    `);
    rollupsDeleted = (delr.rows as any[])?.length ?? 0;
  }

  return {
    ok: true,
    dryRun,
    params: { rawKeepDays, rollupKeepDays, chunkDays, deleteMaxRows, rollupDeleteMaxRows },
    cursor: { before: cursorDay, after: nextCursor },
    rolledRange: shouldRoll && startDay && endDay ? { startDay, endDay } : null,
    rolledUpRows,
    rawDeleted,
    rollupsDeleted,
    maxDayToRoll,
  };
}
