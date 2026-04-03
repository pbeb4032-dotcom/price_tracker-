import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { getDb, type Env } from '../db';
import {
  deriveCanonicalIdentity,
  normalizeCatalogIdentifier,
  normalizeCatalogText,
} from '../catalog/canonicalIdentity';
import { patchCanonicalIdentitySchema } from './patchCanonicalIdentitySchema';

type BackfillOpts = {
  limit?: number;
  offset?: number;
};

function hashUrl(value: string): string {
  return createHash('md5').update(String(value).toLowerCase()).digest('hex');
}

function identifierTypeFromBarcode(value: string): string {
  if (value.length === 8) return 'ean';
  if (value.length === 12) return 'upc';
  if (value.length === 13 || value.length === 14) return 'gtin';
  return 'barcode';
}

export async function backfillCanonicalIdentity(env: Env, opts?: BackfillOpts): Promise<any> {
  await patchCanonicalIdentitySchema(env);
  const db = getDb(env);

  const limit = Math.max(1, Math.min(5000, Number(opts?.limit ?? 1000)));
  const offset = Math.max(0, Number(opts?.offset ?? 0));

  const rows = await db.execute(sql`
    select
      p.id,
      p.name_ar,
      p.name_en,
      p.brand_ar,
      p.brand_en,
      p.barcode,
      p.taxonomy_key,
      p.category,
      p.size_value,
      p.size_unit,
      p.unit,
      p.condition
    from public.products p
    where p.is_active = true
    order by p.created_at asc, p.id asc
    limit ${limit}::int
    offset ${offset}::int
  `);

  const products = (rows.rows as any[]) ?? [];
  const hasLegacyIdentifiers = await db.execute(sql`
    select exists(
      select 1
      from information_schema.tables
      where table_schema = 'public'
        and table_name = 'product_identifiers'
    ) as ok
  `).then((r: any) => Boolean((r.rows as any[])[0]?.ok)).catch(() => false);

  let familiesUpserted = 0;
  let variantsUpserted = 0;
  let legacyLinksUpserted = 0;
  let identifiersUpserted = 0;
  let listingsUpserted = 0;

  for (const product of products) {
    const legacyProductId = String(product.id);
    const identity = deriveCanonicalIdentity({
      legacyProductId,
      nameAr: product.name_ar,
      nameEn: product.name_en,
      brandAr: product.brand_ar,
      brandEn: product.brand_en,
      barcode: product.barcode,
      taxonomyKey: product.taxonomy_key,
      category: product.category,
      sizeValue: product.size_value != null ? Number(product.size_value) : null,
      sizeUnit: product.size_unit,
      unit: product.unit,
      condition: product.condition,
    });

    const familyNameAr = String(product.name_ar ?? '').trim() || identity.normalizedFamilyName || identity.normalizedName;
    const familyNameEn = String(product.name_en ?? '').trim() || null;

    const family = await db.execute(sql`
      insert into public.catalog_product_families (
        family_fingerprint,
        canonical_name_ar,
        canonical_name_en,
        normalized_family_name,
        normalized_brand,
        taxonomy_key,
        legacy_anchor_product_id,
        status
      ) values (
        ${identity.familyFingerprint},
        ${familyNameAr},
        ${familyNameEn},
        ${identity.normalizedFamilyName || identity.normalizedName || normalizeCatalogText(familyNameAr)},
        ${identity.normalizedBrand},
        ${identity.taxonomyKey},
        ${legacyProductId}::uuid,
        'active'
      )
      on conflict (family_fingerprint) do update set
        canonical_name_ar = coalesce(public.catalog_product_families.canonical_name_ar, excluded.canonical_name_ar),
        canonical_name_en = coalesce(public.catalog_product_families.canonical_name_en, excluded.canonical_name_en),
        normalized_brand = coalesce(public.catalog_product_families.normalized_brand, excluded.normalized_brand),
        taxonomy_key = coalesce(public.catalog_product_families.taxonomy_key, excluded.taxonomy_key),
        legacy_anchor_product_id = coalesce(public.catalog_product_families.legacy_anchor_product_id, excluded.legacy_anchor_product_id),
        updated_at = now()
      returning id
    `);
    const familyId = String((family.rows as any[])[0]?.id ?? '');
    familiesUpserted += familyId ? 1 : 0;

    const variant = await db.execute(sql`
      insert into public.catalog_product_variants (
        family_id,
        legacy_anchor_product_id,
        display_name_ar,
        display_name_en,
        normalized_variant_name,
        normalized_brand,
        size_value,
        size_unit,
        pack_count,
        barcode_primary,
        fingerprint,
        taxonomy_key,
        condition,
        status
      ) values (
        ${familyId}::uuid,
        ${legacyProductId}::uuid,
        ${String(product.name_ar ?? '').trim() || familyNameAr},
        ${String(product.name_en ?? '').trim() || null},
        ${identity.normalizedName || normalizeCatalogText(product.name_ar ?? product.name_en ?? '')},
        ${identity.normalizedBrand},
        ${identity.sizeValue},
        ${identity.sizeUnit},
        ${identity.packCount},
        ${identity.barcodeNormalized},
        ${identity.variantFingerprint},
        ${identity.taxonomyKey},
        ${identity.condition},
        'active'
      )
      on conflict (fingerprint) do update set
        family_id = excluded.family_id,
        display_name_ar = coalesce(public.catalog_product_variants.display_name_ar, excluded.display_name_ar),
        display_name_en = coalesce(public.catalog_product_variants.display_name_en, excluded.display_name_en),
        normalized_variant_name = excluded.normalized_variant_name,
        normalized_brand = coalesce(public.catalog_product_variants.normalized_brand, excluded.normalized_brand),
        size_value = coalesce(public.catalog_product_variants.size_value, excluded.size_value),
        size_unit = coalesce(public.catalog_product_variants.size_unit, excluded.size_unit),
        pack_count = greatest(public.catalog_product_variants.pack_count, excluded.pack_count),
        barcode_primary = coalesce(public.catalog_product_variants.barcode_primary, excluded.barcode_primary),
        taxonomy_key = coalesce(public.catalog_product_variants.taxonomy_key, excluded.taxonomy_key),
        condition = excluded.condition,
        legacy_anchor_product_id = coalesce(public.catalog_product_variants.legacy_anchor_product_id, excluded.legacy_anchor_product_id),
        updated_at = now()
      returning id
    `);
    const variantId = String((variant.rows as any[])[0]?.id ?? '');
    variantsUpserted += variantId ? 1 : 0;

    await db.execute(sql`
      insert into public.catalog_variant_legacy_links (
        variant_id,
        legacy_product_id,
        is_anchor,
        source,
        metadata
      ) values (
        ${variantId}::uuid,
        ${legacyProductId}::uuid,
        true,
        'legacy_products_backfill',
        ${JSON.stringify({
          family_fingerprint: identity.familyFingerprint,
          variant_fingerprint: identity.variantFingerprint,
        })}::jsonb
      )
      on conflict (legacy_product_id) do update set
        variant_id = excluded.variant_id,
        is_anchor = public.catalog_variant_legacy_links.is_anchor or excluded.is_anchor,
        updated_at = now()
    `).catch(() => {});
    legacyLinksUpserted += 1;

    await db.execute(sql`
      update public.catalog_product_variants
      set legacy_anchor_product_id = coalesce(legacy_anchor_product_id, ${legacyProductId}::uuid),
          updated_at = now()
      where id = ${variantId}::uuid
    `).catch(() => {});

    await db.execute(sql`
      insert into public.catalog_identity_decisions (
        family_id,
        variant_id,
        legacy_product_id,
        decision_type,
        decision_status,
        confidence,
        reason,
        evidence,
        decider
      ) values (
        ${familyId}::uuid,
        ${variantId}::uuid,
        ${legacyProductId}::uuid,
        'variant_seed',
        'approved',
        0.95,
        'legacy_product_backfill',
        ${JSON.stringify({
          family_fingerprint: identity.familyFingerprint,
          variant_fingerprint: identity.variantFingerprint,
          normalized_brand: identity.normalizedBrand,
          size_value: identity.sizeValue,
          size_unit: identity.sizeUnit,
          pack_count: identity.packCount,
        })}::jsonb,
        'system_backfill'
      )
    `).catch(() => {});

    if (identity.barcodeNormalized) {
      const idType = identifierTypeFromBarcode(identity.barcodeNormalized);
      await db.execute(sql`
        insert into public.catalog_variant_identifiers (
          variant_id,
          legacy_product_id,
          id_type,
          id_value_normalized,
          id_value_raw,
          source,
          confidence,
          is_primary,
          metadata
        ) values (
          ${variantId}::uuid,
          ${legacyProductId}::uuid,
          ${idType},
          ${identity.barcodeNormalized},
          ${String(product.barcode ?? '')},
          'legacy_products_barcode',
          1.000,
          true,
          ${JSON.stringify({ legacy_product_id: legacyProductId })}::jsonb
        )
        on conflict (variant_id, id_type, id_value_normalized) do nothing
      `).catch(() => {});
      identifiersUpserted += 1;

      await db.execute(sql`
        insert into public.catalog_identity_decisions (
          family_id,
          variant_id,
          legacy_product_id,
          decision_type,
          decision_status,
          confidence,
          reason,
          evidence,
          decider
        ) values (
          ${familyId}::uuid,
          ${variantId}::uuid,
          ${legacyProductId}::uuid,
          'identifier_seed',
          'approved',
          1.000,
          'barcode_backfill',
          ${JSON.stringify({
            id_type: idType,
            id_value_normalized: identity.barcodeNormalized,
          })}::jsonb,
          'system_backfill'
        )
      `).catch(() => {});
    }

    if (hasLegacyIdentifiers) {
      const legacyIdentifiers = await db.execute(sql`
        select id_type, id_value_normalized, id_value_raw, source, confidence, is_primary, metadata
        from public.product_identifiers
        where product_id = ${legacyProductId}::uuid
      `).catch(() => ({ rows: [] as any[] }));

      for (const identifier of (legacyIdentifiers.rows as any[]) ?? []) {
        const normalized = normalizeCatalogIdentifier(identifier.id_value_normalized ?? identifier.id_value_raw);
        if (!normalized) continue;
        await db.execute(sql`
          insert into public.catalog_variant_identifiers (
            variant_id,
            legacy_product_id,
            id_type,
            id_value_normalized,
            id_value_raw,
            source,
            confidence,
            is_primary,
            metadata
          ) values (
            ${variantId}::uuid,
            ${legacyProductId}::uuid,
            ${String(identifier.id_type ?? 'unknown')},
            ${normalized},
            ${String(identifier.id_value_raw ?? normalized)},
            ${String(identifier.source ?? 'product_identifiers')},
            ${Number(identifier.confidence ?? 1)},
            ${Boolean(identifier.is_primary ?? false)},
            ${JSON.stringify(identifier.metadata ?? {})}::jsonb
          )
          on conflict (variant_id, id_type, id_value_normalized) do nothing
        `).catch(() => {});
        identifiersUpserted += 1;
      }
    }

    const listings = await db.execute(sql`
      select source_id, url, canonical_url, status
      from public.product_url_map
      where product_id = ${legacyProductId}::uuid
    `).catch(() => ({ rows: [] as any[] }));

    for (const listing of (listings.rows as any[]) ?? []) {
      const sourceUrl = String(listing.url ?? '').trim();
      if (!sourceUrl) continue;
      await db.execute(sql`
        insert into public.catalog_merchant_listings (
          variant_id,
          legacy_product_id,
          source_id,
          source_url,
          source_url_hash,
          canonical_url,
          external_item_id,
          status
        ) values (
          ${variantId}::uuid,
          ${legacyProductId}::uuid,
          ${String(listing.source_id)}::uuid,
          ${sourceUrl},
          ${hashUrl(sourceUrl)},
          ${String(listing.canonical_url ?? '').trim() || null},
          null,
          ${String(listing.status ?? 'active') === 'mapped' ? 'active' : 'quarantined'}
        )
        on conflict (source_id, source_url_hash) do update set
          variant_id = excluded.variant_id,
          legacy_product_id = coalesce(public.catalog_merchant_listings.legacy_product_id, excluded.legacy_product_id),
          canonical_url = coalesce(excluded.canonical_url, public.catalog_merchant_listings.canonical_url),
          updated_at = now()
      `).catch(() => {});
      listingsUpserted += 1;
    }
  }

  return {
    ok: true,
    scanned: products.length,
    familiesUpserted,
    variantsUpserted,
    legacyLinksUpserted,
    identifiersUpserted,
    listingsUpserted,
    limit,
    offset,
  };
}
