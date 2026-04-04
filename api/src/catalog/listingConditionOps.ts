import { sql } from 'drizzle-orm';

type ListingConditionOverviewOpts = {
  hours?: number;
  limitSources?: number;
  domains?: string[];
};

type ListingConditionQuarantineOpts = {
  hours?: number;
  limit?: number;
  reason?: string | null;
  sourceId?: string | null;
  sourceDomain?: string | null;
  domains?: string[];
};

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

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

export async function getListingConditionOverview(db: any, opts: ListingConditionOverviewOpts = {}) {
  const hours = clampInt(opts.hours, 1, 24 * 30, 72);
  const limitSources = clampInt(opts.limitSources, 1, 200, 30);
  const requestedDomains = normalizeScopedDomains(opts.domains ?? []);

  const summaryRes = await db.execute(sql`
    with filtered as (
      select *
      from public.ingest_listing_candidates
      where created_at >= now() - (${hours}::int * interval '1 hour')
        and (${requestedDomains.length} = 0 or source_domain = any(${requestedDomains}::text[]))
    )
    select
      count(*)::bigint as total_candidates,
      count(*) filter (where publish_status = 'approved')::bigint as approved_candidates,
      count(*) filter (where publish_status = 'quarantined')::bigint as quarantined_candidates,
      count(*) filter (where publish_blocked = true)::bigint as blocked_candidates,
      count(*) filter (where listing_condition = 'new')::bigint as new_candidates,
      count(*) filter (where listing_condition = 'unknown')::bigint as unknown_candidates,
      count(*) filter (where listing_condition = 'used')::bigint as used_candidates,
      count(*) filter (where listing_condition = 'refurbished')::bigint as refurbished_candidates,
      count(*) filter (where listing_condition = 'open_box')::bigint as open_box_candidates,
      count(*) filter (where publish_reason = 'mixed_source_requires_section_allowlist')::bigint as mixed_without_allowlist_count,
      count(*) filter (where matched_section_policy_id is not null)::bigint as section_policy_matched_count
    from filtered
  `).catch(() => ({ rows: [] as any[] }));

  const reasonsRes = await db.execute(sql`
    with filtered as (
      select
        coalesce(nullif(condition_reason, ''), nullif(publish_reason, ''), 'unknown') as reason_key
      from public.ingest_listing_candidates
      where created_at >= now() - (${hours}::int * interval '1 hour')
        and publish_blocked = true
        and (${requestedDomains.length} = 0 or source_domain = any(${requestedDomains}::text[]))
    )
    select reason_key, count(*)::bigint as count
    from filtered
    group by reason_key
    order by count desc, reason_key asc
    limit 20
  `).catch(() => ({ rows: [] as any[] }));

  const sourceRes = await db.execute(sql`
    with filtered as (
      select
        c.source_id,
        c.source_domain,
        c.publish_status,
        c.publish_blocked,
        c.listing_condition,
        c.publish_reason,
        c.condition_reason,
        c.matched_section_policy_id
      from public.ingest_listing_candidates c
      where c.created_at >= now() - (${hours}::int * interval '1 hour')
        and (${requestedDomains.length} = 0 or c.source_domain = any(${requestedDomains}::text[]))
    )
    select
      f.source_id,
      f.source_domain,
      max(ps.name_ar) as source_name,
      max(ps.source_kind) as source_kind,
      max(ps.source_channel) as source_channel,
      max(ps.catalog_condition_policy) as catalog_condition_policy,
      count(*)::bigint as total_candidates,
      count(*) filter (where f.publish_status = 'approved')::bigint as approved_candidates,
      count(*) filter (where f.publish_status = 'quarantined')::bigint as quarantined_candidates,
      count(*) filter (where f.publish_blocked = true)::bigint as blocked_candidates,
      count(*) filter (where f.listing_condition = 'unknown')::bigint as unknown_candidates,
      count(*) filter (where f.listing_condition = 'used')::bigint as used_candidates,
      count(*) filter (where f.listing_condition = 'refurbished')::bigint as refurbished_candidates,
      count(*) filter (where f.listing_condition = 'open_box')::bigint as open_box_candidates,
      count(*) filter (where f.publish_reason = 'mixed_source_requires_section_allowlist')::bigint as mixed_without_allowlist_count,
      count(*) filter (where f.matched_section_policy_id is not null)::bigint as section_policy_matched_count
    from filtered f
    left join public.price_sources ps on ps.id = f.source_id
    group by f.source_id, f.source_domain
    order by
      count(*) filter (where f.publish_blocked = true) desc,
      count(*) filter (where f.publish_reason = 'mixed_source_requires_section_allowlist') desc,
      count(*) desc,
      f.source_domain asc
    limit ${limitSources}::int
  `).catch(() => ({ rows: [] as any[] }));

  return {
    ok: true,
    hours,
    requested_domains: requestedDomains,
    summary: (summaryRes.rows as any[])[0] ?? {},
    reasons: reasonsRes.rows ?? [],
    sources: sourceRes.rows ?? [],
  };
}

export async function getListingConditionQuarantine(db: any, opts: ListingConditionQuarantineOpts = {}) {
  const hours = clampInt(opts.hours, 1, 24 * 30, 72);
  const limit = clampInt(opts.limit, 1, 200, 50);
  const requestedDomains = normalizeScopedDomains(opts.domains ?? []);
  const filters: any[] = [
    sql`c.created_at >= now() - (${hours}::int * interval '1 hour')`,
    sql`exists (
      select 1
      from public.ingest_decisions d
      where d.candidate_id = c.id
        and d.decision_type = 'condition'
        and d.decision_status = 'quarantined'
    )`,
  ];

  if (opts.reason && String(opts.reason).trim() && String(opts.reason).trim().toLowerCase() !== 'all') {
    const reason = String(opts.reason).trim();
    filters.push(sql`coalesce(nullif(c.condition_reason, ''), nullif(c.publish_reason, ''), 'unknown') = ${reason}`);
  }
  if (opts.sourceId && String(opts.sourceId).trim()) {
    filters.push(sql`c.source_id = ${String(opts.sourceId).trim()}::uuid`);
  }
  if (opts.sourceDomain && String(opts.sourceDomain).trim()) {
    filters.push(sql`c.source_domain = ${String(opts.sourceDomain).trim().toLowerCase()}`);
  }
  if (requestedDomains.length) {
    filters.push(sql`c.source_domain = any(${requestedDomains}::text[])`);
  }

  const rows = await db.execute(sql`
    select
      c.id,
      c.created_at,
      c.source_id,
      c.source_domain,
      ps.name_ar as source_name,
      ps.source_kind,
      ps.source_channel,
      ps.catalog_condition_policy,
      c.product_name,
      c.source_url,
      c.canonical_url,
      c.category_hint,
      c.subcategory_hint,
      c.taxonomy_hint,
      c.listing_condition,
      c.condition_confidence,
      c.condition_policy,
      c.condition_reason,
      c.publish_status,
      c.publish_reason,
      c.publish_reasons,
      c.matched_section_policy_id,
      sp.section_key,
      sp.section_label,
      sp.section_url,
      sp.policy_scope,
      sp.condition_policy as section_condition_policy,
      doc.payload_excerpt,
      cond.decision_status as condition_status,
      cond.evidence as condition_evidence
    from public.ingest_listing_candidates c
    join public.ingest_documents doc on doc.id = c.document_id
    left join public.price_sources ps on ps.id = c.source_id
    left join public.source_section_policies sp on sp.id = c.matched_section_policy_id
    left join lateral (
      select d.decision_status, d.evidence
      from public.ingest_decisions d
      where d.candidate_id = c.id
        and d.decision_type = 'condition'
      order by d.created_at desc
      limit 1
    ) cond on true
    where ${sql.join(filters, sql` and `)}
    order by c.created_at desc
    limit ${limit}::int
  `).catch(() => ({ rows: [] as any[] }));

  return {
    ok: true,
    hours,
    requested_domains: requestedDomains,
    items: rows.rows ?? [],
  };
}
