import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { getDb, type Env } from '../db';
import {
  classifyGovernedTaxonomy,
  resolveMappedTaxonomyKey,
} from '../catalog/taxonomyGovernance';
import type { CategoryKey } from '../ingestion/categoryInfer';
import { patchCatalogTaxonomyGovernanceSchema } from './patchCatalogTaxonomyGovernanceSchema';

type ShadowOpts = {
  limit?: number;
  offset?: number;
  applyApproved?: boolean;
};

function computeReviewPriority(input: {
  confidence: number;
  margin: number;
  conflict: boolean;
  denyRules: string[];
  sourceDomain?: string | null;
}): number {
  let priority = 100;
  if (input.conflict) priority -= 35;
  if (input.denyRules.length) priority -= 25;
  if (input.confidence < 0.8) priority -= 20;
  if (input.margin < 0.1) priority -= 10;
  if (!input.sourceDomain) priority -= 5;
  return Math.max(1, Math.min(200, priority));
}

export async function reclassifyCanonicalTaxonomyShadow(
  env: Env,
  opts?: ShadowOpts,
): Promise<any> {
  await patchCatalogTaxonomyGovernanceSchema(env);
  const db = getDb(env);
  const limit = Math.max(1, Math.min(20000, Number(opts?.limit ?? 1000)));
  const offset = Math.max(0, Number(opts?.offset ?? 0));
  const applyApproved = Boolean(opts?.applyApproved ?? false);
  const runId = randomUUID();
  const mode = applyApproved ? 'apply' : 'shadow';

  await db.execute(sql`
    insert into public.catalog_taxonomy_shadow_runs (id, mode, status, started_at)
    values (${runId}::uuid, ${mode}, 'running', now())
  `).catch(() => {});

  let scanned = 0;
  let approved = 0;
  let quarantined = 0;
  let applied = 0;
  let changed = 0;

  try {
    const variants = await db.execute(sql`
      select
        v.id as variant_id,
        v.family_id,
        v.legacy_anchor_product_id,
        v.display_name_ar,
        v.display_name_en,
        v.normalized_brand,
        v.taxonomy_key as current_taxonomy_key,
        f.canonical_name_ar,
        f.canonical_name_en,
        link.legacy_product_id,
        p.category as current_category,
        p.subcategory as current_subcategory,
        p.taxonomy_key as current_product_taxonomy_key,
        coalesce(p.taxonomy_manual, false) as taxonomy_manual,
        coalesce(p.category_manual, false) as category_manual,
        coalesce(p.subcategory_manual, false) as subcategory_manual,
        listing.source_domain,
        listing.source_url,
        listing.site_category_raw
      from public.catalog_product_variants v
      join public.catalog_product_families f on f.id = v.family_id
      left join lateral (
        select legacy_product_id
        from public.catalog_variant_legacy_links l
        where l.variant_id = v.id
        order by l.is_anchor desc, l.updated_at desc nulls last, l.created_at desc
        limit 1
      ) link on true
      left join public.products p on p.id = link.legacy_product_id
      left join lateral (
        select
          ps.domain as source_domain,
          ml.source_url,
          (
            select o.category_evidence->>'siteCategoryRaw'
            from public.source_price_observations o
            where o.product_id = coalesce(link.legacy_product_id, v.legacy_anchor_product_id)
              and o.source_id = ml.source_id
            order by o.observed_at desc nulls last
            limit 1
          ) as site_category_raw
        from public.catalog_merchant_listings ml
        join public.price_sources ps on ps.id = ml.source_id
        where ml.variant_id = v.id
        order by ml.updated_at desc nulls last, ml.created_at desc
        limit 1
      ) listing on true
      where v.status = 'active'
      order by v.updated_at desc nulls last, v.created_at desc
      limit ${limit}::int
      offset ${offset}::int
    `);

    for (const row of (variants.rows as any[]) ?? []) {
      scanned += 1;
      const mappedTaxonomyKey = await resolveMappedTaxonomyKey(
        db,
        row.source_domain ? String(row.source_domain) : null,
        row.site_category_raw ? String(row.site_category_raw) : null,
      );

      const decision = classifyGovernedTaxonomy({
        name: [row.display_name_ar, row.display_name_en, row.canonical_name_ar, row.canonical_name_en].filter(Boolean).join(' | '),
        description: row.normalized_brand ? String(row.normalized_brand) : null,
        brand: row.normalized_brand ? String(row.normalized_brand) : null,
        domain: row.source_domain ? String(row.source_domain) : null,
        url: row.source_url ? String(row.source_url) : null,
        siteCategoryRaw: row.site_category_raw ? String(row.site_category_raw) : null,
        mappedTaxonomyKey,
        fallbackCategory: row.current_category ? (String(row.current_category) as CategoryKey) : 'general',
        fallbackSubcategory: row.current_subcategory ? String(row.current_subcategory) : null,
      });

      const reviewPriority = computeReviewPriority({
        confidence: decision.confidence,
        margin: decision.margin,
        conflict: decision.conflict,
        denyRules: decision.denyRules,
        sourceDomain: row.source_domain ? String(row.source_domain) : null,
      });

      const insertedDecision = await db.execute(sql`
        insert into public.catalog_taxonomy_decisions (
          run_id,
          variant_id,
          family_id,
          legacy_product_id,
          source_domain,
          source_url,
          site_category_raw,
          decision_mode,
          decided_taxonomy_key,
          decided_category,
          decided_subcategory,
          confidence,
          margin,
          decision_status,
          review_priority,
          reason,
          conflict,
          conflict_reasons,
          deny_rules,
          evidence
        ) values (
          ${runId}::uuid,
          ${String(row.variant_id)}::uuid,
          ${String(row.family_id)}::uuid,
          ${row.legacy_product_id ? String(row.legacy_product_id) : null}::uuid,
          ${row.source_domain ? String(row.source_domain) : null},
          ${row.source_url ? String(row.source_url) : null},
          ${row.site_category_raw ? String(row.site_category_raw) : null},
          ${mode},
          ${decision.taxonomyKey},
          ${decision.category},
          ${decision.subcategory},
          ${decision.confidence},
          ${decision.margin},
          ${decision.status},
          ${reviewPriority},
          ${decision.reasons.join(' | ')},
          ${decision.conflict},
          ${JSON.stringify(decision.conflictReasons)}::jsonb,
          ${decision.denyRules}::text[],
          ${JSON.stringify(decision.evidence)}::jsonb
        )
        on conflict (run_id, variant_id) do update set
          decided_taxonomy_key = excluded.decided_taxonomy_key,
          decided_category = excluded.decided_category,
          decided_subcategory = excluded.decided_subcategory,
          confidence = excluded.confidence,
          margin = excluded.margin,
          decision_status = excluded.decision_status,
          review_priority = excluded.review_priority,
          reason = excluded.reason,
          conflict = excluded.conflict,
          conflict_reasons = excluded.conflict_reasons,
          deny_rules = excluded.deny_rules,
          evidence = excluded.evidence,
          updated_at = now()
        returning id
      `).catch(() => ({ rows: [] as any[] }));
      const decisionId = ((insertedDecision.rows as any[])[0]?.id as string | undefined) ?? null;

      if (decision.status === 'approved') approved += 1;
      else quarantined += 1;

      if (decision.status === 'quarantined') {
        await db.execute(sql`
          insert into public.catalog_taxonomy_quarantine (
            run_id,
            latest_decision_id,
            variant_id,
            family_id,
            legacy_product_id,
            source_domain,
            source_url,
            product_name,
            current_taxonomy_key,
            inferred_taxonomy_key,
            inferred_category,
            inferred_subcategory,
            confidence,
            margin,
            review_priority,
            deny_rules,
            conflict,
            conflict_reasons,
            evidence,
            status
          ) values (
            ${runId}::uuid,
            ${decisionId}::uuid,
            ${String(row.variant_id)}::uuid,
            ${String(row.family_id)}::uuid,
            ${row.legacy_product_id ? String(row.legacy_product_id) : null}::uuid,
            ${row.source_domain ? String(row.source_domain) : null},
            ${row.source_url ? String(row.source_url) : null},
            ${String(row.display_name_ar ?? row.display_name_en ?? row.canonical_name_ar ?? '')},
            ${String(row.current_taxonomy_key ?? row.current_product_taxonomy_key ?? '') || null},
            ${decision.taxonomyKey},
            ${decision.category},
            ${decision.subcategory},
            ${decision.confidence},
            ${decision.margin},
            ${reviewPriority},
            ${decision.denyRules}::text[],
            ${decision.conflict},
            ${JSON.stringify(decision.conflictReasons)}::jsonb,
            ${JSON.stringify(decision.evidence)}::jsonb,
            'pending'
          )
          on conflict (variant_id, status) do update set
            latest_decision_id = excluded.latest_decision_id,
            run_id = excluded.run_id,
            current_taxonomy_key = excluded.current_taxonomy_key,
            inferred_taxonomy_key = excluded.inferred_taxonomy_key,
            inferred_category = excluded.inferred_category,
            inferred_subcategory = excluded.inferred_subcategory,
            confidence = excluded.confidence,
            margin = excluded.margin,
            review_priority = excluded.review_priority,
            deny_rules = excluded.deny_rules,
            conflict = excluded.conflict,
            conflict_reasons = excluded.conflict_reasons,
            evidence = excluded.evidence,
            updated_at = now()
        `).catch(() => {});
      }

      if (
        applyApproved &&
        decision.status === 'approved' &&
        decision.taxonomyKey &&
        String(row.current_taxonomy_key ?? '') !== decision.taxonomyKey
      ) {
        await db.execute(sql`
          update public.catalog_product_variants
          set taxonomy_key = ${decision.taxonomyKey},
              updated_at = now()
          where id = ${String(row.variant_id)}::uuid
        `).catch(() => {});
        applied += 1;
        changed += 1;

        if (row.legacy_product_id) {
          await db.execute(sql`
            update public.products
            set
              taxonomy_key = case when coalesce(taxonomy_manual, false) = true then taxonomy_key else ${decision.taxonomyKey} end,
              taxonomy_confidence = case when coalesce(taxonomy_manual, false) = true then taxonomy_confidence else ${decision.confidence} end,
              taxonomy_reason = case when coalesce(taxonomy_manual, false) = true then taxonomy_reason else ${decision.reasons.join(' | ')} end,
              category = case when coalesce(category_manual, false) = true then category else ${decision.category} end,
              subcategory = case when coalesce(subcategory_manual, false) = true then subcategory else ${decision.subcategory} end,
              updated_at = now()
            where id = ${String(row.legacy_product_id)}::uuid
          `).catch(() => {});
        }
      }
    }

    await db.execute(sql`
      insert into public.catalog_taxonomy_metrics_daily (
        day,
        source_domain,
        decided_category,
        decided_taxonomy_key,
        decision_status,
        decisions_count,
        conflict_count,
        deny_rule_count
      )
      select
        current_date,
        coalesce(source_domain, '(unknown)'),
        decided_category,
        decided_taxonomy_key,
        decision_status,
        count(*)::int,
        sum(case when conflict then 1 else 0 end)::int,
        sum(case when array_length(deny_rules, 1) is null then 0 else 1 end)::int
      from public.catalog_taxonomy_decisions
      where run_id = ${runId}::uuid
      group by 1, 2, 3, 4, 5
      on conflict (day, source_domain, decided_category, decided_taxonomy_key, decision_status) do update set
        decisions_count = excluded.decisions_count,
        conflict_count = excluded.conflict_count,
        deny_rule_count = excluded.deny_rule_count,
        updated_at = now()
    `).catch(() => {});

    await db.execute(sql`
      update public.catalog_taxonomy_shadow_runs
      set
        status = 'completed',
        scanned_count = ${scanned},
        approved_count = ${approved},
        quarantined_count = ${quarantined},
        applied_count = ${applied},
        changed_count = ${changed},
        notes = jsonb_build_object('limit', ${limit}, 'offset', ${offset}),
        completed_at = now(),
        updated_at = now()
      where id = ${runId}::uuid
    `).catch(() => {});

    return {
      ok: true,
      runId,
      mode,
      scanned,
      approved,
      quarantined,
      applied,
      changed,
      limit,
      offset,
    };
  } catch (error: any) {
    await db.execute(sql`
      update public.catalog_taxonomy_shadow_runs
      set
        status = 'failed',
        scanned_count = ${scanned},
        approved_count = ${approved},
        quarantined_count = ${quarantined},
        applied_count = ${applied},
        changed_count = ${changed},
        notes = jsonb_build_object(
          'limit', ${limit},
          'offset', ${offset},
          'error', ${String(error?.message ?? error)}
        ),
        completed_at = now(),
        updated_at = now()
      where id = ${runId}::uuid
    `).catch(() => {});
    throw error;
  }
}
