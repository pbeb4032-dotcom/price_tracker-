import pg from 'pg';
import { chromium } from 'playwright';

const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('Missing DATABASE_URL');
  process.exit(1);
}

const GLOBAL_CONCURRENCY = Math.max(1, Number(process.env.RENDER_GLOBAL_CONCURRENCY ?? 2));
const POLL_MS = Math.max(200, Number(process.env.RENDER_WORKER_POLL_MS ?? 1000));
const MIN_DELAY_MS = Math.max(0, Number(process.env.RENDER_MIN_DELAY_MS ?? 800));
const CACHE_TTL_MIN = Math.max(10, Number(process.env.RENDER_CACHE_TTL_MIN ?? 720));
const MAX_HTML_CHARS = Math.max(50_000, Number(process.env.RENDER_MAX_HTML_CHARS ?? 600_000));
const MAX_ATTEMPTS = Math.max(1, Number(process.env.RENDER_MAX_ATTEMPTS ?? 4));
const BACKOFF_BASE_MIN = Math.max(5, Number(process.env.RENDER_BACKOFF_BASE_MIN ?? 15));
const BUDGET_DEFAULT = Math.max(10, Number(process.env.RENDER_BUDGET_PER_HOUR_DEFAULT ?? 80));
const CIRCUIT_BREAKER_ENABLED = String(process.env.RENDER_CIRCUIT_BREAKER_ENABLED ?? '1') !== '0';

const pool = new Pool({ connectionString: DATABASE_URL, max: 5 });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function maxIso(a, b) {
  if (!a) return b;
  if (!b) return a;
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
}

function computeCircuitBreakerPauseMin(code, streak) {
  const s = Number(streak ?? 0);
  if (!CIRCUIT_BREAKER_ENABLED || s <= 0) return 0;

  // Hard cap: if it's failing nonstop, cool it down hard.
  if (s >= 20) return 24 * 60;

  if (code === 'BOT_CHALLENGE') {
    // Never try to bypass; just back off.
    return 12 * 60;
  }
  if (code === 'HTTP_403') {
    return s >= 3 ? 6 * 60 : 0;
  }
  if (code === 'HTTP_429') {
    return s >= 5 ? 90 : 0;
  }
  if (code === 'NAV_ERROR' || code === 'EMPTY' || code === 'HTTP_5XX') {
    return s >= 8 ? 25 : 0;
  }
  return 0;
}

function classify(html, status) {
  const h = (html || '').toLowerCase();
  if (status === 429) return { code: 'HTTP_429', msg: 'rate_limited' };
  if (status === 403 && /captcha|cloudflare|cf-chl|just a moment|checking your browser|verify you are human|bot protection/i.test(h)) {
    return { code: 'BOT_CHALLENGE', msg: 'bot_challenge' };
  }
  if (status === 403) return { code: 'HTTP_403', msg: 'forbidden' };
  if (status && status >= 500) return { code: 'HTTP_5XX', msg: `http_${status}` };
  if (!html || html.length < 500) return { code: 'EMPTY', msg: 'empty_html' };
  return { code: 'OK', msg: 'ok' };
}

async function checkAndConsumeRenderBudget(client, domain) {
  // Reset per hour, increment used, and pause if exceeded.
  const r = await client.query(
    `
    with upd as (
      update public.price_sources
      set
        render_budget_per_hour = coalesce(render_budget_per_hour, $2),
        render_budget_hour_start = case
          when render_budget_hour_start is null or render_budget_hour_start < date_trunc('hour', now()) then date_trunc('hour', now())
          else render_budget_hour_start end,
        render_budget_used = case
          when render_budget_hour_start is null or render_budget_hour_start < date_trunc('hour', now()) then 1
          else render_budget_used + 1 end
      where domain = $1
      returning render_budget_used, render_budget_per_hour, render_budget_hour_start, render_paused_until,
                coalesce(render_cache_ttl_min, $3) as render_cache_ttl_min,
                coalesce(render_stale_serve_min, 1440) as render_stale_serve_min
    )
    select * from upd
    `,
    [domain, BUDGET_DEFAULT, CACHE_TTL_MIN]
  );

  const row = r.rows?.[0];
  if (!row) return { allowed: true, render_cache_ttl_min: CACHE_TTL_MIN, render_stale_serve_min: 1440 };

  const used = Number(row.render_budget_used ?? 0);
  const per = Number(row.render_budget_per_hour ?? BUDGET_DEFAULT);

  const pausedUntil = row.render_paused_until ? new Date(row.render_paused_until).getTime() : 0;
  if (pausedUntil && pausedUntil > Date.now()) return { allowed: false, paused_until: row.render_paused_until, render_cache_ttl_min: Number(row.render_cache_ttl_min ?? CACHE_TTL_MIN), render_stale_serve_min: Number(row.render_stale_serve_min ?? 1440) };

  if (used > per) {
    const pauseTo = new Date(new Date().setMinutes(60, 0, 0)); // next hour
    await client.query(
      `update public.price_sources set render_paused_until = $2 where domain = $1`,
      [domain, pauseTo.toISOString()]
    );
    return { allowed: false, paused_until: pauseTo.toISOString(), render_cache_ttl_min: Number(row.render_cache_ttl_min ?? CACHE_TTL_MIN), render_stale_serve_min: Number(row.render_stale_serve_min ?? 1440) };
  }

  return { allowed: true, render_cache_ttl_min: Number(row.render_cache_ttl_min ?? CACHE_TTL_MIN), render_stale_serve_min: Number(row.render_stale_serve_min ?? 1440) };
}

async function claimJob(client) {
  // New claim strategy:
  // - Skip paused / budget-exhausted domains (best-effort).
  // - Prefer higher page priority.
  // - Break ties by rotating domains (oldest render_last_claim_at first).
  // Fallback to legacy query if schema isn't patched yet.
  try {
    const r = await client.query(
      `
      with c as (
        select rq.id, rq.source_domain
        from public.render_queue rq
        left join public.price_sources ps on ps.domain = rq.source_domain
        where rq.status='pending'
          and (rq.next_retry_at is null or rq.next_retry_at <= now())
          and (ps.render_paused_until is null or ps.render_paused_until <= now())
          and (
            ps.render_budget_hour_start is null
            or ps.render_budget_hour_start < date_trunc('hour', now())
            or coalesce(ps.render_budget_used,0) < coalesce(ps.render_budget_per_hour, $1)
          )
        order by rq.priority desc,
                 coalesce(ps.render_last_claim_at, 'epoch'::timestamptz) asc,
                 rq.updated_at asc
        limit 1
        for update of rq skip locked
      ),
      touch as (
        update public.price_sources ps
        set render_last_claim_at = now()
        from c
        where ps.domain = c.source_domain
        returning 1
      )
      update public.render_queue q
      set status='processing', claimed_at=now(), updated_at=now()
      from c
      where q.id = c.id
      returning q.*
      `,
      [BUDGET_DEFAULT]
    );
    return r.rows?.[0] || null;
  } catch (e) {
    const r = await client.query(
      `
      with c as (
        select id
        from public.render_queue
        where status='pending'
          and (next_retry_at is null or next_retry_at <= now())
        order by priority desc, updated_at asc
        limit 1
        for update skip locked
      )
      update public.render_queue q
      set status='processing', claimed_at=now(), updated_at=now()
      from c
      where q.id = c.id
      returning q.*
      `
    );
    return r.rows?.[0] || null;
  }
}

async function markJobPending(client, id, nextRetryIso, code, msg) {
  await client.query(
    `
    update public.render_queue
    set status='pending',
        next_retry_at = $2::timestamptz,
        last_error_code = $3,
        last_error = $4,
        updated_at = now()
    where id = $1::uuid
    `,
    [id, nextRetryIso, code, msg]
  );
}

async function markJobFinal(client, id, status, code, msg, httpStatus) {
  await client.query(
    `
    update public.render_queue
    set status=$2,
        completed_at=now(),
        last_error_code=$3,
        last_error=$4,
        last_http_status=$5,
        updated_at=now()
    where id=$1::uuid
    `,
    [id, status, code, msg, httpStatus ?? null]
  );
}

async function upsertRenderedPage(client, domain, url, html, httpStatus, contentType, ttlMin) {
  const ttlMinutes = Math.max(10, Number(ttlMin ?? CACHE_TTL_MIN));
  const ttlIso = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString();
  const clipped = html.length > MAX_HTML_CHARS ? html.slice(0, MAX_HTML_CHARS) : html;
  await client.query(
    `
    insert into public.rendered_pages (url, source_domain, html, http_status, content_type, rendered_at, expires_at, html_bytes)
    values ($1, $2, $3, $4, $5, now(), $6::timestamptz, length($3))
    on conflict (url_hash) do update set
      url = excluded.url,
      source_domain = excluded.source_domain,
      html = excluded.html,
      http_status = excluded.http_status,
      content_type = excluded.content_type,
      rendered_at = now(),
      expires_at = excluded.expires_at,
      html_bytes = excluded.html_bytes
    `,
    [url, domain, clipped, httpStatus ?? 200, contentType ?? 'text/html', ttlIso]
  );
}

async function noteRenderSuccess(client, domain, httpStatus) {
  await client.query(
    `
    update public.price_sources
    set last_render_success_at = now(),
        render_consecutive_failures = 0,
        last_render_error_code = null,
        last_render_http_status = $2
    where domain = $1
    `,
    [domain, httpStatus ?? null]
  );
}

async function noteRenderFailure(client, domain, code, httpStatus) {
  const r = await client.query(
    `
    update public.price_sources
    set last_render_failure_at = now(),
        render_consecutive_failures = coalesce(render_consecutive_failures,0) + 1,
        last_render_error_code = $2,
        last_render_http_status = $3
    where domain = $1
    returning render_consecutive_failures, render_paused_until
    `,
    [domain, code, httpStatus ?? null]
  ).catch(() => ({ rows: [] }));

  const row = r.rows?.[0];
  const streak = Number(row?.render_consecutive_failures ?? 0);
  const pauseMin = computeCircuitBreakerPauseMin(code, streak);
  if (!pauseMin) return { streak, paused_until: row?.render_paused_until ?? null };

  const pausedUntilIso = new Date(Date.now() + pauseMin * 60 * 1000).toISOString();
  await client.query(
    `update public.price_sources set render_paused_until = $2 where domain = $1`,
    [domain, pausedUntilIso]
  ).catch(() => {});

  return { streak, paused_until: pausedUntilIso };
}

async function processJob(job) {
  const domain = job.source_domain;
  const url = job.url;

  const client = await pool.connect();
  let browser = null;
  try {
    const budget = await checkAndConsumeRenderBudget(client, domain);
    if (!budget.allowed) {
      await markJobPending(client, job.id, budget.paused_until, 'RENDER_BUDGET', 'render budget paused');
      return;
    }

    browser = await chromium.launch({ args: ['--no-sandbox'] });
    const page = await browser.newPage({
      userAgent: 'Mozilla/5.0 (compatible; PriceTrackerIraqRenderWorker/1.0)',
      locale: 'ar-IQ',
    });

    let status = 0;
    let html = '';
    let ct = 'text/html';
    try {
      const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      status = resp?.status?.() ?? 200;
      ct = resp?.headers?.()['content-type'] ?? 'text/html';
      // Try to wait a little for client-side render
      await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
      html = await page.content();
    } catch (e) {
      const msg = String(e?.message || e);
      const nf = await noteRenderFailure(client, domain, 'NAV_ERROR', null);
      const attempt = Number(job.attempts ?? 0) + 1;
      const backoffMin = BACKOFF_BASE_MIN * Math.pow(2, Math.min(6, attempt - 1));
      const nextRetry = maxIso(nf?.paused_until, new Date(Date.now() + backoffMin * 60 * 1000).toISOString());
      if (attempt >= MAX_ATTEMPTS) {
        await markJobFinal(client, job.id, 'failed_final', 'NAV_ERROR', msg, null);
      } else {
        await client.query(`update public.render_queue set attempts=attempts+1 where id=$1::uuid`, [job.id]).catch(() => {});
        await markJobPending(client, job.id, nextRetry, 'NAV_ERROR', msg);
      }
      return;
    } finally {
      await page.close().catch(() => {});
    }

    const cls = classify(html, status);
    if (cls.code !== 'OK') {
      const nf = await noteRenderFailure(client, domain, cls.code, status);
      const attempt = Number(job.attempts ?? 0) + 1;
      const backoffMin = BACKOFF_BASE_MIN * Math.pow(2, Math.min(6, attempt - 1));
      const nextRetry = maxIso(nf?.paused_until, new Date(Date.now() + backoffMin * 60 * 1000).toISOString());
      if (attempt >= MAX_ATTEMPTS || cls.code === 'BOT_CHALLENGE') {
        await markJobFinal(client, job.id, 'failed_final', cls.code, cls.msg, status);
      } else {
        await client.query(`update public.render_queue set attempts=attempts+1 where id=$1::uuid`, [job.id]).catch(() => {});
        await markJobPending(client, job.id, nextRetry, cls.code, cls.msg);
      }
      return;
    }

    await upsertRenderedPage(client, domain, url, html, status, ct, budget.render_cache_ttl_min);
    await noteRenderSuccess(client, domain, status);
    await markJobFinal(client, job.id, 'succeeded', 'OK', 'ok', status);
  } finally {
    if (browser) await browser.close().catch(() => {});
    client.release();
    if (MIN_DELAY_MS) await sleep(MIN_DELAY_MS);
  }
}

let inFlight = 0;

async function loop() {
  while (true) {
    try {
      while (inFlight < GLOBAL_CONCURRENCY) {
        const client = await pool.connect();
        let job = null;
        try {
          job = await claimJob(client);
          if (!job) {
            client.release();
            break;
          }
        } finally {
          client.release();
        }

        inFlight++;
        processJob(job)
          .catch((e) => console.error('job error', e))
          .finally(() => { inFlight--; });
      }
    } catch (e) {
      console.error('worker loop error', e);
    }
    await sleep(POLL_MS);
  }
}

console.log(`Render Worker started (concurrency=${GLOBAL_CONCURRENCY})`);
loop();
