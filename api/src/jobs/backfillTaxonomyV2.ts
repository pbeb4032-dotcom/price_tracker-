import { sql } from 'drizzle-orm';
import { getDb, type Env } from '../db';
import { inferCategoryKeyDetailed } from '../ingestion/categoryInfer';
import { classifyGrocerySubcategory } from '../ingestion/groceryTaxonomy';
import { inferTaxonomySuggestion, normalizeSiteCategory, taxonomyKeyToCategoryAndSubcategory } from '../ingestion/taxonomyV2';

export async function backfillTaxonomyV2(env: Env, args: { limit: number }): Promise<any> {
  const db = getDb(env);
  const limit = Math.max(1, Math.min(200000, Number(args.limit ?? 5000)));

  // Older DB volumes may not have source_price_observations.category_evidence.
  // If it doesn't exist, we still backfill using name/description + domain/url only.
  const hasCategoryEvidence = await db
    .execute(sql`
      select exists(
        select 1
        from information_schema.columns
        where table_schema='public'
          and table_name='source_price_observations'
          and column_name='category_evidence'
      ) as ok
    `)
    .then((x) => Boolean((x.rows as any[])[0]?.ok))
    .catch(() => false);

  // Latest observation per product to get url/domain/siteCategoryRaw
  const r = hasCategoryEvidence
    ? await db.execute(sql`
        with latest as (
          select distinct on (o.product_id)
            o.product_id,
            o.source_id,
            o.source_url,
            (o.category_evidence->>'siteCategoryRaw') as site_category_raw,
            o.observed_at
          from public.source_price_observations o
          where o.observed_at >= now() - interval '60 days'
          order by o.product_id, o.observed_at desc
        )
        select
          p.id as product_id,
          p.name_ar,
          p.description_ar,
          p.category,
          p.subcategory,
          coalesce(p.taxonomy_key,'') as taxonomy_key,
          coalesce(p.taxonomy_manual,false) as taxonomy_manual,
          coalesce(p.category_manual,false) as category_manual,
          coalesce(p.subcategory_manual,false) as subcategory_manual,
          ps.domain as domain,
          l.source_url as url,
          l.site_category_raw as site_category_raw
        from public.products p
        left join latest l on l.product_id = p.id
        left join public.price_sources ps on ps.id = l.source_id
        where p.is_active = true
          and (p.taxonomy_key is null or coalesce(p.taxonomy_manual,false)=false)
        order by p.updated_at desc nulls last
        limit ${limit}
      `)
    : await db.execute(sql`
        with latest as (
          select distinct on (o.product_id)
            o.product_id,
            o.source_id,
            o.source_url,
            null::text as site_category_raw,
            o.observed_at
          from public.source_price_observations o
          where o.observed_at >= now() - interval '60 days'
          order by o.product_id, o.observed_at desc
        )
        select
          p.id as product_id,
          p.name_ar,
          p.description_ar,
          p.category,
          p.subcategory,
          coalesce(p.taxonomy_key,'') as taxonomy_key,
          coalesce(p.taxonomy_manual,false) as taxonomy_manual,
          coalesce(p.category_manual,false) as category_manual,
          coalesce(p.subcategory_manual,false) as subcategory_manual,
          ps.domain as domain,
          l.source_url as url,
          l.site_category_raw as site_category_raw
        from public.products p
        left join latest l on l.product_id = p.id
        left join public.price_sources ps on ps.id = l.source_id
        where p.is_active = true
          and (p.taxonomy_key is null or coalesce(p.taxonomy_manual,false)=false)
        order by p.updated_at desc nulls last
        limit ${limit}
      `);

  let updated = 0;
  let quarantined = 0;

  for (const row of (r.rows as any[])) {
    const name = String(row.name_ar ?? '');
    const desc = row.description_ar ? String(row.description_ar) : null;
    const domain = row.domain ? String(row.domain) : null;
    const url = row.url ? String(row.url) : null;
    const siteCategoryRaw = row.site_category_raw ? String(row.site_category_raw) : null;

    const catDet = inferCategoryKeyDetailed({
      name,
      description: desc,
      domain,
      url,
      siteCategory: siteCategoryRaw,
    });

    const subDet = catDet.category === 'groceries'
      ? classifyGrocerySubcategory({ name, description: desc, siteCategory: siteCategoryRaw })
      : { subcategory: null, badge: 'weak' as const, confidence: 0.3, reasons: ['not_groceries'] };

    let mappedKey: string | null = null;
    const siteNorm = normalizeSiteCategory(siteCategoryRaw);
    if (domain && siteNorm) {
      try {
        const mr = await db.execute(sql`
          select taxonomy_key
          from public.domain_taxonomy_mappings
          where domain = ${domain} and site_category_norm = ${siteNorm} and is_active = true
          limit 1
        `);
        mappedKey = (mr.rows as any[])[0]?.taxonomy_key ?? null;
      } catch {
        mappedKey = null;
      }
    }

    const sug = inferTaxonomySuggestion({
      mappedTaxonomyKey: mappedKey,
      category: catDet.category,
      subcategory: subDet.subcategory,
      name,
      description: desc,
      siteCategoryRaw,
      siteCategoryKey: catDet.site,
    });

    if (!sug.taxonomyKey) continue;

    const currentKey = String(row.taxonomy_key ?? '').trim() || null;
    const needQuarantine = Boolean(sug.conflict) || sug.confidence < 0.85 || (currentKey && currentKey !== sug.taxonomyKey);

    const mapped = taxonomyKeyToCategoryAndSubcategory(sug.taxonomyKey);

    try {
      await db.execute(sql`
        update public.products
        set
          taxonomy_key = case when coalesce(taxonomy_manual,false)=true then taxonomy_key else ${sug.taxonomyKey} end,
          taxonomy_confidence = case when coalesce(taxonomy_manual,false)=true then taxonomy_confidence else ${sug.confidence} end,
          taxonomy_reason = case when coalesce(taxonomy_manual,false)=true then taxonomy_reason else ${sug.reason} end,
          category = case when coalesce(category_manual,false)=true then category else ${mapped.category} end,
          subcategory = case when coalesce(subcategory_manual,false)=true then subcategory else ${mapped.subcategory} end,
          updated_at = now()
        where id = ${row.product_id}::uuid
      `);
      updated++;
    } catch {
      // schema not patched
      continue;
    }

    if (needQuarantine) {
      try {
        await db.execute(sql`
          insert into public.taxonomy_quarantine (
            product_id, domain, url, product_name,
            site_category_raw, site_category_norm,
            current_taxonomy_key, inferred_taxonomy_key,
            confidence, reason,
            conflict, conflict_reason,
            status
          ) values (
            ${row.product_id}::uuid,
            ${domain},
            ${url},
            ${name},
            ${siteCategoryRaw},
            ${siteNorm || null},
            ${currentKey},
            ${sug.taxonomyKey},
            ${sug.confidence},
            ${sug.reason},
            ${Boolean(sug.conflict)},
            ${sug.conflictReason},
            'pending'
          )
          on conflict (product_id, status) do nothing
        `);
        quarantined++;
      } catch {
        // ignore
      }
    }
  }

  return { ok: true, updated, quarantined, scanned: (r.rows as any[]).length };
}
