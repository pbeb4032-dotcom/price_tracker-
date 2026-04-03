import { sql } from 'drizzle-orm';
import { getDb, type Env } from '../db';

type ActivateOpts = {
  limit?: number;
  countryCode?: string;
  minScore?: number;
};

export async function activateCandidateSources(env: Env, opts?: ActivateOpts): Promise<any> {
  const db = getDb(env);
  const countryCode = (opts?.countryCode ?? 'IQ').toUpperCase();
  const limit = Math.max(1, Math.min(1000, Number(opts?.limit ?? 300)));
  const minScore = Math.max(0, Math.min(1, Number(opts?.minScore ?? 0.70)));

  const rows = await db.execute(sql`
    select id, domain, validation_score, validation_state
    from public.price_sources
    where country_code = ${countryCode}
      and lifecycle_status = 'candidate'
      and validation_state = 'passed'
      and coalesce(validation_score,0) >= ${minScore}::numeric
    order by validation_score desc nulls last, created_at asc
    limit ${limit}::int
  `);

  const items = (rows.rows as any[]) ?? [];
  if (!items.length) return { ok: true, activated: 0, message: 'no_passed_candidates' };

  const activatedDomains: string[] = [];

  for (const r of items) {
    await db.execute(sql`
      update public.price_sources
      set lifecycle_status='active',
          is_active=true,
          crawl_enabled=true,
          validated_at=coalesce(validated_at, now()),
          activated_at=now()
      where id=${String(r.id)}::uuid
    `);
    activatedDomains.push(String(r.domain));
  }

  return { ok: true, activated: activatedDomains.length, domains: activatedDomains };
}
