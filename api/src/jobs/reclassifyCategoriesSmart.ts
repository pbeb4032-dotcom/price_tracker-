import { sql } from 'drizzle-orm';
import { getDb, type Env } from '../db';
import { inferCategoryKeyDetailed, type CategoryKey } from '../ingestion/categoryInfer';
import { classifyGrocerySubcategory } from '../ingestion/groceryTaxonomy';
import { inferTaxonomySuggestion, normalizeSiteCategory, taxonomyKeyToCategoryAndSubcategory } from '../ingestion/taxonomyV2';

/**
 * Smarter reclassifier with canonical taxonomy output.
 *
 * Source of truth:
 * - taxonomy_key is canonical
 * - category/subcategory are cached from taxonomy_key only
 */
export async function reclassifyCategoriesSmart(
  env: Env,
  opts?: { limit?: number; force?: boolean },
): Promise<any> {
  const db = getDb(env);
  const limit = Math.max(1, Math.min(100000, Number(opts?.limit ?? 20000)));
  const force = Boolean(opts?.force ?? false);

  const products = await db.execute(sql`
    select id, name_ar, name_en, description_ar, description_en, category,
           taxonomy_key,
           coalesce(category_manual,false) as category_manual,
           coalesce(taxonomy_manual,false) as taxonomy_manual,
           subcategory,
           coalesce(subcategory_manual,false) as subcategory_manual
    from public.products
    where is_active = true
    order by updated_at desc nulls last
    limit ${limit}
  `);

  let processed = 0;
  let changed = 0;
  const samples: any[] = [];

  for (const p of (products.rows as any[]) ?? []) {
    processed += 1;

    const productId = p.id;
    const current: CategoryKey = (String(p.category ?? 'general') as any) || 'general';
    const currentTaxonomyKey = String(p.taxonomy_key ?? '').trim() || null;
    const categoryManual = Boolean(p.category_manual ?? false);
    const taxonomyManual = Boolean(p.taxonomy_manual ?? false);
    const subManual = Boolean(p.subcategory_manual ?? false);

    const obs = await db.execute(sql`
      with recent as (
        select
          so.category_hint,
          so.category_confidence,
          so.category_conflict,
          (so.category_evidence->>'siteCategoryRaw') as site_cat,
          so.source_url,
          ps.domain as source_domain
        from public.source_price_observations so
        join public.price_sources ps on ps.id = so.source_id
        where so.product_id = ${productId}::uuid
          and coalesce(so.is_synthetic,false) = false
          and coalesce(so.is_price_anomaly,false) = false
        order by so.observed_at desc nulls last
        limit 30
      )
      select
        (
          select category_hint
          from recent
          where coalesce(category_conflict,false) = false
            and coalesce(category_confidence,0)::numeric >= 0.75
            and category_hint is not null
            and category_hint <> 'general'
          group by category_hint
          order by count(*) desc
          limit 1
        ) as best_hint,
        (
          select count(*)
          from recent
          where coalesce(category_conflict,false) = false
            and coalesce(category_confidence,0)::numeric >= 0.75
            and category_hint is not null
            and category_hint <> 'general'
        ) as hint_votes,
        (
          select site_cat
          from recent
          where site_cat is not null and length(site_cat) > 0
          group by site_cat
          order by count(*) desc
          limit 1
        ) as best_site_cat,
        (
          select source_domain
          from recent
          where source_domain is not null and length(source_domain) > 0
          group by source_domain
          order by count(*) desc
          limit 1
        ) as best_domain,
        (
          select source_url
          from recent
          where source_url is not null and length(source_url) > 0
          order by 1 desc
          limit 1
        ) as sample_url
    `);

    const row = (obs.rows as any[])[0] ?? {};
    const bestHint = String(row.best_hint ?? '').trim() as CategoryKey;
    const hintVotes = Number(row.hint_votes ?? 0);
    const bestSiteCat = String(row.best_site_cat ?? '').trim() || null;
    const bestDomain = String(row.best_domain ?? '').trim() || null;
    const sampleUrl = String(row.sample_url ?? '').trim() || null;

    let decided: CategoryKey = 'general';
    let badge: 'trusted' | 'medium' | 'weak' = 'weak';
    const reasons: string[] = [];

    if (bestHint && bestHint !== 'general' && hintVotes >= 2) {
      decided = bestHint;
      badge = 'trusted';
      reasons.push('Aggregated observation hints (>=2 high-confidence votes).');
    } else {
      const det = inferCategoryKeyDetailed({
        name: [p.name_ar, p.name_en].filter(Boolean).join(' | '),
        description: [p.description_ar, p.description_en].filter(Boolean).join(' | '),
        domain: bestDomain,
        url: sampleUrl,
        siteCategory: bestSiteCat,
      });

      decided = det.category;
      if (det.site !== 'general') {
        badge = 'trusted';
        reasons.push('Site category/breadcrumbs support.');
      } else if (det.textScore >= 4) {
        badge = 'trusted';
        reasons.push('Strong text evidence.');
      } else if (det.textScore >= 2) {
        badge = 'medium';
        reasons.push('Medium text evidence.');
      } else if (det.domain !== 'general') {
        badge = 'medium';
        reasons.push('Specialized domain hint.');
      } else {
        badge = 'weak';
        reasons.push('Weak evidence.');
      }
    }

    if (!decided) decided = 'general';

    const subDet = decided === 'groceries'
      ? classifyGrocerySubcategory({
          name: [p.name_ar, p.name_en].filter(Boolean).join(' | '),
          description: [p.description_ar, p.description_en].filter(Boolean).join(' | '),
          siteCategory: bestSiteCat,
        })
      : { subcategory: null, badge: 'weak' as const, confidence: 0.3, reasons: ['not_groceries'] };

    let mappedKey: string | null = null;
    const siteNorm = normalizeSiteCategory(bestSiteCat);
    if (bestDomain && siteNorm) {
      const mapRes = await db.execute(sql`
        select taxonomy_key
        from public.domain_taxonomy_mappings
        where domain = ${bestDomain} and site_category_norm = ${siteNorm} and is_active = true
        limit 1
      `).catch(() => ({ rows: [] as any[] }));
      mappedKey = (mapRes.rows as any[])[0]?.taxonomy_key ?? null;
    }

    const sug = inferTaxonomySuggestion({
      mappedTaxonomyKey: mappedKey,
      category: decided,
      subcategory: subDet.subcategory,
      name: [p.name_ar, p.name_en].filter(Boolean).join(' | '),
      description: [p.description_ar, p.description_en].filter(Boolean).join(' | '),
      siteCategoryRaw: bestSiteCat,
      siteCategoryKey: bestHint && bestHint !== 'general' ? bestHint : decided,
    });

    const mapped = taxonomyKeyToCategoryAndSubcategory(sug.taxonomyKey);
    const canUpdateTaxonomy =
      force ||
      (!taxonomyManual && currentTaxonomyKey == null && (badge === 'trusted' || badge === 'medium') && !!sug.taxonomyKey) ||
      (!taxonomyManual && currentTaxonomyKey !== null && badge === 'trusted' && !!sug.taxonomyKey && currentTaxonomyKey !== sug.taxonomyKey);

    const canUpdateCategory = !categoryManual && mapped.category !== 'general' && (force || badge !== 'weak');
    const canUpdateSub = !subManual && (force || mapped.subcategory != null || (decided === 'groceries' && (subDet.badge === 'trusted' || subDet.badge === 'medium')));

    if ((canUpdateTaxonomy && sug.taxonomyKey && currentTaxonomyKey !== sug.taxonomyKey) || canUpdateCategory || canUpdateSub) {
      await db.execute(sql`
        update public.products
        set
          taxonomy_key = case when ${canUpdateTaxonomy && !!sug.taxonomyKey} then ${sug.taxonomyKey} else taxonomy_key end,
          taxonomy_confidence = case when ${canUpdateTaxonomy && !!sug.taxonomyKey} then ${sug.confidence} else taxonomy_confidence end,
          taxonomy_reason = case when ${canUpdateTaxonomy && !!sug.taxonomyKey} then ${sug.reason} else taxonomy_reason end,
          category = case
            when coalesce(category_manual,false)=true then category
            when ${canUpdateTaxonomy && !!sug.taxonomyKey} then ${mapped.category}
            when ${canUpdateCategory} then ${mapped.category}
            else category
          end,
          subcategory = case
            when coalesce(subcategory_manual,false)=true then subcategory
            when ${canUpdateTaxonomy && !!sug.taxonomyKey} then ${mapped.subcategory}
            when ${canUpdateSub} then ${mapped.subcategory ?? subDet.subcategory}
            else subcategory
          end,
          updated_at = now()
        where id = ${productId}::uuid
      `).catch(() => {});
      changed += 1;
      if (samples.length < 50) {
        samples.push({
          product_id: productId,
          from_category: current,
          to_category: mapped.category,
          from_taxonomy: currentTaxonomyKey,
          to_taxonomy: sug.taxonomyKey,
          badge,
          reasons,
          sub: mapped.subcategory ?? subDet.subcategory,
        });
      }
    }
  }

  return { ok: true, processed, changed, force, samples };
}
