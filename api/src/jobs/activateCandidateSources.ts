import { sql } from 'drizzle-orm';
import { getDb, type Env } from '../db';

type ActivateOpts = {
  limit?: number;
  countryCode?: string;
  minScore?: number;
  domains?: string[];
};

function normalizeScopedDomain(input: string): string {
  return String(input || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '')
    .replace(/\/$/, '');
}

function normalizeScopedDomains(input: unknown): string[] {
  const raw = Array.isArray(input)
    ? input
    : typeof input === 'string'
      ? input.split(/[,\n\r\t ]+/g)
      : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    const domain = normalizeScopedDomain(String(item ?? ''));
    if (!domain || seen.has(domain)) continue;
    seen.add(domain);
    out.push(domain);
  }
  return out;
}

export async function activateCandidateSources(env: Env, opts?: ActivateOpts): Promise<any> {
  const db = getDb(env);
  const countryCode = (opts?.countryCode ?? 'IQ').toUpperCase();
  const limit = Math.max(1, Math.min(1000, Number(opts?.limit ?? 300)));
  const minScore = Math.max(0, Math.min(1, Number(opts?.minScore ?? 0.70)));
  const requestedDomains = normalizeScopedDomains(opts?.domains ?? []);

  const rows = await db.execute(sql`
    select id, domain, validation_score, validation_state
    from public.price_sources
    where country_code = ${countryCode}
      and lifecycle_status = 'candidate'
      and validation_state = 'passed'
      and coalesce(validation_score,0) >= ${minScore}::numeric
      and (${requestedDomains.length} = 0 or domain = any(${requestedDomains}::text[]))
    order by validation_score desc nulls last, created_at asc
    limit ${limit}::int
  `);

  const items = (rows.rows as any[]) ?? [];
  if (!items.length) {
    return {
      ok: true,
      activated: 0,
      message: requestedDomains.length ? 'no_matching_passed_candidates' : 'no_passed_candidates',
      requested_domains: requestedDomains,
      scoped_domains: [],
    };
  }

  const activatedDomains: string[] = [];

  for (const r of items) {
    await db.execute(sql`
      update public.price_sources
      set lifecycle_status='active',
          is_active=true,
          crawl_enabled=true,
          validated_at=coalesce(validated_at, now()),
          activated_at=now(),
          certification_tier='observed',
          certification_status='pending',
          catalog_publish_enabled=false,
          certification_reason='activated_for_observation_not_publication',
          certification_meta=jsonb_build_object(
            'activated_from_candidate', true,
            'activation_score', ${Number(r.validation_score ?? 0)}::numeric,
            'activated_at', now()
          ),
          quality_score=greatest(coalesce(validation_score, 0), coalesce(trust_weight_dynamic, trust_weight, 0.50)),
          quality_updated_at=now()
      where id=${String(r.id)}::uuid
    `);
    activatedDomains.push(String(r.domain));
  }

  return {
    ok: true,
    activated: activatedDomains.length,
    domains: activatedDomains,
    requested_domains: requestedDomains,
    scoped_domains: [...new Set(activatedDomains)],
  };
}
