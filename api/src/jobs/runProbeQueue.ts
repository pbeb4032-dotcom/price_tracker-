import { sql } from 'drizzle-orm';
import { getDb, type Env } from '../db';

const PROBE_TIMEOUT_MS = Math.max(3000, Number(process.env.PROBE_TIMEOUT_MS ?? 12000));
const PROBE_MIN_DELAY_MS = Math.max(0, Number(process.env.PROBE_MIN_DELAY_MS ?? 900));
const PROBE_GLOBAL_CONCURRENCY = Math.max(1, Number(process.env.PROBE_GLOBAL_CONCURRENCY ?? 2));
const PROBE_MAX_PER_RUN = Math.max(1, Math.min(500, Number(process.env.PROBE_MAX_PER_RUN ?? 50)));

type ProbeTask = {
  id: string;
  source_domain: string;
  probe_url: string;
  status: string;
  error_count: number;
};

type ProbeFetchResult = {
  status: number;
  html: string | null;
  contentType: string | null;
  blocked: boolean;
  blockedReason: string | null;
  error?: string | null;
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function detectBotChallenge(html: string | null, headers: Headers): string | null {
  const ct = String(headers.get('content-type') ?? '');
  const h = (html ?? '').toLowerCase();
  if (ct.includes('text/html')) {
    if (h.includes('cf-challenge') || h.includes('cloudflare') || h.includes('attention required')) return 'cloudflare_challenge';
    if (h.includes('captcha') || h.includes('hcaptcha') || h.includes('recaptcha')) return 'captcha';
    if (h.includes('verify you are human') || h.includes('checking your browser')) return 'bot_check';
    if (h.includes('access denied') && h.includes('security')) return 'access_denied';
  }
  return null;
}

function classifyProbeError(r: ProbeFetchResult): { code: string; message: string } {
  if (r.blocked) return { code: 'BOT_CHALLENGE', message: r.blockedReason ?? 'bot_challenge' };
  if (r.status === 429) return { code: 'HTTP_429', message: 'rate_limited' };
  if (r.status === 403) return { code: 'HTTP_403', message: 'forbidden' };
  if (r.status >= 500 && r.status <= 599) return { code: 'HTTP_5XX', message: `server_${r.status}` };
  if (r.status === 0) {
    const m = String(r.error ?? '').toLowerCase();
    if (m.includes('timeout') || m.includes('abort')) return { code: 'TIMEOUT', message: 'timeout' };
    if (m.includes('enotfound') || m.includes('eai_again') || m.includes('getaddrinfo')) return { code: 'DNS_ERROR', message: 'dns' };
    return { code: 'FETCH_FAILED', message: String(r.error ?? 'fetch_failed') };
  }
  if (r.status >= 200 && r.status < 300) return { code: 'OK', message: 'ok' };
  if (r.status === 304) return { code: 'OK', message: 'not_modified' };
  return { code: `HTTP_${r.status}`, message: `http_${r.status}` };
}

function backoffMinutes(code: string, level: number): number {
  const l = Math.max(1, Math.min(8, level));
  const mult = Math.pow(2, l - 1);
  const base =
    code === 'BOT_CHALLENGE' ? 180 :
    code === 'DNS_ERROR' ? 360 :
    code === 'HTTP_429' ? 90 :
    code === 'HTTP_403' ? 180 :
    code === 'TIMEOUT' ? 30 :
    60;
  // cap at 7 days
  return Math.min(base * mult, 60 * 24 * 7);
}

async function fetchProbe(url: string): Promise<ProbeFetchResult> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'PriceTrackerIraqBot/1.0 (+https://example.invalid)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ar-IQ,ar;q=0.9,en-US;q=0.7,en;q=0.6',
      },
    });

    const ct = String(res.headers.get('content-type') ?? null);
    let html: string | null = null;
    // Only read a limited amount (probe is lightweight)
    if (ct.includes('text/html') || ct.includes('application/xhtml')) {
      const text = await res.text().catch(() => '');
      html = text.length > 200_000 ? text.slice(0, 200_000) : text;
    }

    const br = detectBotChallenge(html, res.headers);
    return {
      status: res.status,
      html,
      contentType: ct,
      blocked: Boolean(br),
      blockedReason: br,
      error: null,
    };
  } catch (e: any) {
    const msg = String(e?.cause?.code ?? e?.code ?? e?.name ?? e?.message ?? e);
    return { status: 0, html: null, contentType: null, blocked: false, blockedReason: null, error: msg };
  } finally {
    clearTimeout(t);
  }
}

export async function runProbeQueue(env: Env, opts?: { limit?: number; concurrency?: number }): Promise<any> {
  const db = getDb(env);
  const limit = Math.max(1, Math.min(500, Number(opts?.limit ?? PROBE_MAX_PER_RUN)));
  const concurrency = Math.max(1, Math.min(10, Number(opts?.concurrency ?? PROBE_GLOBAL_CONCURRENCY)));

  // Claim tasks
  const claimed = await db.execute(sql`
    with c as (
      select id
      from public.domain_probe_queue
      where status = 'pending'
        and (next_retry_at is null or next_retry_at <= now())
      order by priority desc, created_at asc
      for update skip locked
      limit ${limit}
    )
    update public.domain_probe_queue q
    set status = 'processing',
        claimed_at = now(),
        updated_at = now()
    from c
    where q.id = c.id
    returning q.id::text as id,
              q.source_domain,
              q.probe_url,
              q.status,
              q.error_count;
  `).catch(() => ({ rows: [] as any[] }));

  const tasks: ProbeTask[] = ((claimed.rows as any[]) ?? []).map((r) => ({
    id: String(r.id),
    source_domain: String(r.source_domain),
    probe_url: String(r.probe_url),
    status: String(r.status),
    error_count: Number(r.error_count ?? 0),
  }));

  if (!tasks.length) return { ok: true, claimed: 0, succeeded: 0, failed: 0 };

  let succeeded = 0;
  let failed = 0;

  const queue = [...tasks];
  const workers = Array.from({ length: concurrency }).map(async () => {
    while (queue.length) {
      const t = queue.shift();
      if (!t) break;

      const r = await fetchProbe(t.probe_url);
      const cls = classifyProbeError(r);

      if (cls.code === 'OK') {
        // Mark queue succeeded
        await db.execute(sql`
          update public.domain_probe_queue
          set status = 'succeeded',
              completed_at = now(),
              last_http_status = ${r.status},
              last_error_code = null,
              last_error = null,
              updated_at = now()
          where id = ${t.id}::uuid
        `).catch(() => {});

        // Clear probe flags and recover source
        await db.execute(sql`
          update public.price_sources
          set probe_required = false,
              probe_until = null,
              last_probe_at = now(),
              last_probe_success_at = now(),
              probe_consecutive_failures = 0,
              last_probe_http_status = ${r.status},
              last_probe_error_code = null,

              auto_disabled = false,
              disabled_until = null,
              disable_level = 0,
              paused_until = null,
              budget_used = 0,
              consecutive_failures = 0,
              consecutive_bot_challenges = 0,
              consecutive_403 = 0,
              consecutive_429 = 0,
              consecutive_timeouts = 0,
              consecutive_dns_errors = 0,
              auto_recovered_at = now(),
              auto_disabled_reason = null,
              auto_disabled_at = null
          where country_code = 'IQ' and domain = ${t.source_domain}
        `).catch(() => {});

        succeeded++;
      } else {
        const nextLevel = Math.min(8, Math.max(1, Number(t.error_count ?? 0) + 1));
        const mins = backoffMinutes(cls.code, nextLevel);

        await db.execute(sql`
          update public.domain_probe_queue
          set status = 'failed',
              completed_at = now(),
              last_http_status = ${r.status || null},
              last_error_code = ${cls.code},
              last_error = ${cls.message},
              error_count = error_count + 1,
              next_retry_at = now() + make_interval(mins => ${mins}),
              updated_at = now()
          where id = ${t.id}::uuid
        `).catch(() => {});

        // Extend backoff on the source (avoid immediate ingestion).
        await db.execute(sql`
          update public.price_sources
          set probe_required = true,
              probe_until = now() + interval '30 minutes',
              last_probe_at = now(),
              last_probe_failure_at = now(),
              probe_consecutive_failures = probe_consecutive_failures + 1,
              last_probe_http_status = ${r.status || null},
              last_probe_error_code = ${cls.code},

              auto_disabled = true,
              auto_disabled_reason = ${cls.code},
              auto_disabled_at = coalesce(auto_disabled_at, now()),
              disable_level = greatest(disable_level, ${nextLevel}),
              disabled_until = greatest(coalesce(disabled_until, now()), now() + make_interval(mins => ${mins}))
          where country_code = 'IQ' and domain = ${t.source_domain}
        `).catch(() => {});

        failed++;
      }

      if (PROBE_MIN_DELAY_MS > 0) await sleep(PROBE_MIN_DELAY_MS);
    }
  });

  await Promise.all(workers);

  return { ok: true, claimed: tasks.length, succeeded, failed };
}
