import { sql } from 'drizzle-orm';
import { getDb, type Env } from '../db';
import { extractNumberLike, isSaneIqdPrice, normalizeToIqdSmart, validateImageUrl } from '../ingestion/sanity';
import { assessAndMaybeQuarantinePrice, enqueuePriceAnomalyQuarantine } from '../ingestion/priceAnomalyQuarantine';
import { inferCategoryKey } from '../ingestion/categoryInfer';
import { taxonomyKeyToCategoryAndSubcategory } from '../ingestion/taxonomyV2';
import {
  assessPublicationGate,
  markPublicationOutcome,
  recordPublicationGateArtifacts,
  resolveLegacyCatalogMatch,
} from '../ingestion/publicationGate';
import { assessListingCondition, loadSourceConditionContext, type SourceConditionContext } from '../catalog/listingCondition';
import { classifyGovernedTaxonomy } from '../catalog/taxonomyGovernance';
import { getLatestFxRateForPricing } from '../fx/governedFx';

const DEFAULT_FALLBACK_FX = 1470;
const FETCH_TIMEOUT_MS = 15_000;

type EndpointType = 'shopify_products_json' | 'woocommerce_store_api';

type ExtractedApiProduct = {
  name: string;
  description: string | null;
  price: number;
  currency: string | null;
  priceText?: string | null;
  image: string | null;
  sourceUrl: string;
  inStock: boolean;
};

export async function discoverProductApis(env: Env, opts?: { domain?: string; ingestNow?: boolean; maxPages?: number }): Promise<any> {
  const db = getDb(env);

  const ingestNow = opts?.ingestNow !== false;
  const maxPages = Math.max(1, Math.min(10, Number(opts?.maxPages ?? 3)));

  // Region
  const regionId = await ensureOnlineRegion(db);

  // FX
  const fxRate = await getLatestFxRateForPricing(db, DEFAULT_FALLBACK_FX);

  const src = await db.execute(sql`
    select
      id,
      domain,
      name_ar,
      coalesce(trust_weight_dynamic, trust_weight) as trust_weight
    from public.price_sources
    where is_active=true and country_code='IQ' and coalesce(auto_disabled,false)=false
    ${opts?.domain ? sql`and domain = ${opts.domain}` : sql``}
  `);

  const sources = (src.rows as any[]) ?? [];
  const results: Record<string, any> = {};
  let totalDiscovered = 0;
  let totalInserted = 0;

  for (const s of sources) {
    const domain = String(s.domain);
    const sourceConditionContext = await loadSourceConditionContext(db, String(s.id));
    results[domain] = { endpoints: [], discovered: 0, inserted: 0, errors: [] as string[] };

    const endpoints = await detectEndpoints(domain);
    if (!endpoints.length) {
      results[domain].errors.push('no_endpoints_detected');
      continue;
    }

    // Save endpoints
    for (const ep of endpoints) {
      results[domain].endpoints.push(ep);
      await db.execute(sql`
        insert into public.source_api_endpoints (domain, url, endpoint_type, priority, is_active)
        values (${domain}, ${ep.url}, ${ep.endpoint_type}, ${ep.priority}, true)
        on conflict (domain, url) do update set
          endpoint_type = excluded.endpoint_type,
          priority = excluded.priority,
          is_active = true,
          updated_at = now()
      `).catch(() => {});
    }

    if (!ingestNow) continue;

    for (const ep of endpoints) {
      try {
        const { discovered, inserted } = await ingestEndpoint(db, {
          domain,
          sourceId: String(s.id),
          merchantName: String(s.name_ar ?? domain),
          trustWeight: Number(s.trust_weight ?? 0.5),
          regionId,
          fxRate,
          sourceConditionContext,
          endpoint: ep,
          maxPages,
        });
        results[domain].discovered += discovered;
        results[domain].inserted += inserted;
        totalDiscovered += discovered;
        totalInserted += inserted;
      } catch (e: any) {
        results[domain].errors.push(`${ep.url}: ${String(e?.message ?? e).slice(0, 160)}`);
      }
    }
  }

  return { success: true, totalDiscovered, totalInserted, results };
}

async function detectEndpoints(domain: string): Promise<Array<{ url: string; endpoint_type: EndpointType; priority: number }>> {
  const out: Array<{ url: string; endpoint_type: EndpointType; priority: number }> = [];

  // Shopify candidates
  const shopifyCandidates = [
    `https://${domain}/products.json?limit=1&page=1`,
    `https://${domain}/collections/all/products.json?limit=1&page=1`,
  ];
  for (const u of shopifyCandidates) {
    const j = await fetchJson(u);
    if (j && typeof j === 'object' && Array.isArray((j as any).products)) {
      out.push({ url: u.replace('limit=1', 'limit=250'), endpoint_type: 'shopify_products_json', priority: 10 });
      break;
    }
  }

  // WooCommerce Store API
  const wooCandidates = [
    `https://${domain}/wp-json/wc/store/v1/products?per_page=1&page=1`,
    `https://${domain}/wp-json/wc/store/v1/products?per_page=1`,
  ];
  for (const u of wooCandidates) {
    const j = await fetchJson(u);
    if (Array.isArray(j) && j.length && (j[0] as any)?.name && ((j[0] as any)?.prices || (j[0] as any)?.price)) {
      out.push({ url: u.includes('per_page=') ? u.replace('per_page=1', 'per_page=100') : `${u}&per_page=100`, endpoint_type: 'woocommerce_store_api', priority: 20 });
      break;
    }
  }

  return out;
}

async function ingestEndpoint(
  db: any,
  args: {
    domain: string;
    sourceId: string;
    merchantName: string;
    trustWeight: number;
    regionId: string;
    fxRate: number;
    sourceConditionContext: SourceConditionContext;
    endpoint: { url: string; endpoint_type: EndpointType };
    maxPages: number;
  },
): Promise<{ discovered: number; inserted: number }> {
  const { endpoint, maxPages } = args;
  let discovered = 0;
  let inserted = 0;

  for (let page = 1; page <= maxPages; page++) {
    const url = setQueryParam(endpoint.url, 'page', String(page));
    const raw = await fetchText(url);
    if (!raw) break;

    const products = endpoint.endpoint_type === 'shopify_products_json'
      ? parseShopify(raw, args.domain)
      : parseWoo(raw);

    if (!products.length) break;
    discovered += products.length;

    for (const p of products) {
      const ins = await upsertApiProduct(db, p, args);
      inserted += ins ? 1 : 0;
    }
  }

  return { discovered, inserted };
}

async function upsertApiProduct(
  db: any,
  p: ExtractedApiProduct,
  args: { domain: string; sourceId: string; merchantName: string; trustWeight: number; regionId: string; fxRate: number; sourceConditionContext: SourceConditionContext },
): Promise<boolean> {
  // Preserve the legacy category hint for compatibility with downstream price logic,
  // but let governed taxonomy decide the publishable taxonomy/category truth.
  const inferredCategory = inferCategoryKey({
    name: p?.name ?? null,
    description: p?.description ?? null,
    domain: args.domain,
    url: p?.sourceUrl ?? null,
  });
  const governed = classifyGovernedTaxonomy({
    name: p.name,
    description: p.description ?? null,
    domain: args.domain,
    url: p.sourceUrl,
    fallbackCategory: inferredCategory,
  });

  const { priceIqd, normalizationFactor, parsedCurrency } = normalizeToIqdSmart(
    p.price,
    p.currency ?? 'IQD',
    args.fxRate,
    { categoryHint: inferredCategory, domain: args.domain, rawText: p.priceText ?? String(p.price), name: p.name }
  );
  const sanity = isSaneIqdPrice(priceIqd);
  if (!sanity.ok) {
    await enqueuePriceAnomalyQuarantine(db, {
      sourceId: args.sourceId,
      sourceName: args.merchantName || args.domain,
      regionId: args.regionId,
      productName: p.name,
      pageUrl: p.sourceUrl,
      rawPriceText: `${String(p.priceText ?? p.price)} ${parsedCurrency}`,
      parsedPriceIqd: priceIqd,
      currency: parsedCurrency,
      anomalyReason: `sanity:${sanity.reason}`,
      anomalyContext: { stage: 'discoverProductApis' },
    });
    return false;
  }

  const taxonomySuggestion = {
    taxonomyKey: governed.taxonomyKey,
    confidence: governed.confidence,
    reason: governed.reasons.join(' | '),
    conflict: governed.conflict,
    conflictReason: governed.conflictReasons.join(' | ') || null,
  };
  const priceConfidence = 0.85;

  const legacyMatch = await resolveLegacyCatalogMatch(db, {
    sourceId: args.sourceId,
    sourceDomain: args.domain,
    sourceUrl: p.sourceUrl,
    name: p.name,
  });

  const listingCondition = assessListingCondition({
    source: args.sourceConditionContext.source,
    sectionPolicies: args.sourceConditionContext.sectionPolicies,
    sourceUrl: p.sourceUrl,
    canonicalUrl: p.sourceUrl,
    productName: p.name,
    description: p.description ?? null,
    categoryHint: governed.category,
    taxonomyHint: taxonomySuggestion.taxonomyKey,
  });

  const gateDecision = assessPublicationGate({
    match: legacyMatch,
    taxonomyConfidence: taxonomySuggestion.confidence,
    priceConfidence,
    categoryConflict: false,
    taxonomyConflict: Boolean(taxonomySuggestion.conflict),
    conditionDecision: listingCondition,
  });

  let gateRecord: { documentId: string; candidateId: string };
  try {
    gateRecord = await recordPublicationGateArtifacts(db, {
      sourceId: args.sourceId,
      sourceDomain: args.domain,
      sourceKind: 'api',
      pageType: 'product',
      sourceUrl: p.sourceUrl,
      canonicalUrl: p.sourceUrl,
      payloadKind: 'json',
      rawPayload: {
        source: 'discoverProductApis',
        merchant_name: args.merchantName,
        trust_weight: args.trustWeight,
      },
      extractedPayload: {
        name: p.name,
        description: p.description ?? null,
        price: p.price,
        price_text: p.priceText ?? null,
        currency: p.currency ?? null,
        image: p.image ?? null,
        in_stock: p.inStock,
        governed_taxonomy: governed,
        taxonomy_suggestion: taxonomySuggestion,
      },
      productName: p.name,
      categoryHint: governed.category,
      subcategoryHint: governed.subcategory,
      taxonomyHint: taxonomySuggestion.taxonomyKey,
      listingCondition: listingCondition.normalizedCondition,
      conditionPolicy: listingCondition.sourcePolicy,
      conditionReason: listingCondition.reason,
      categoryConflict: governed.conflict,
      taxonomyConflict: Boolean(taxonomySuggestion.conflict),
      conditionDecision: listingCondition,
      match: legacyMatch,
      decision: gateDecision,
    });
  } catch {
    return false;
  }

  if (!gateDecision.publishable) {
    return false;
  }

  // Product by trusted legacy mapping only when the gate allows publication.
  const productId = await upsertProduct(db, args.sourceId, args.domain, p.sourceUrl, p, {
    existingProductId: legacyMatch.productId,
    allowCreate: false,
    productCondition: listingCondition.normalizedCondition,
  });

  if (!productId) {
    await markPublicationOutcome(db, {
      candidateId: gateRecord.candidateId,
      status: 'failed',
      error: 'product_upsert_failed',
    });
    return false;
  }

  try {
    if (taxonomySuggestion.taxonomyKey) {
      const mapped = taxonomyKeyToCategoryAndSubcategory(taxonomySuggestion.taxonomyKey);
      await db.execute(sql`
        update public.products
        set
          taxonomy_key = case when coalesce(taxonomy_manual,false)=true then taxonomy_key else ${taxonomySuggestion.taxonomyKey} end,
          taxonomy_confidence = case when coalesce(taxonomy_manual,false)=true then taxonomy_confidence else ${taxonomySuggestion.confidence} end,
          taxonomy_reason = case when coalesce(taxonomy_manual,false)=true then taxonomy_reason else ${taxonomySuggestion.reason} end,
          category = case when coalesce(category_manual,false)=true then category else ${mapped.category} end,
          subcategory = case when coalesce(subcategory_manual,false)=true then subcategory else ${mapped.subcategory} end,
          updated_at = now()
        where id = ${productId}::uuid
      `).catch(() => {});

      const needQuarantine = Boolean(taxonomySuggestion.conflict) || taxonomySuggestion.confidence < 0.85;
      if (needQuarantine) {
        await db.execute(sql`
          insert into public.taxonomy_quarantine (
            product_id, domain, url, product_name,
            site_category_raw, site_category_norm,
            current_taxonomy_key, inferred_taxonomy_key,
            confidence, reason,
            conflict, conflict_reason,
            status
          ) values (
            ${productId}::uuid,
            ${args.domain},
            ${p.sourceUrl},
            ${p.name},
            null,
            null,
            null,
            ${taxonomySuggestion.taxonomyKey},
            ${taxonomySuggestion.confidence},
            ${taxonomySuggestion.reason},
            ${Boolean(taxonomySuggestion.conflict)},
            ${taxonomySuggestion.conflictReason},
            'pending'
          )
          on conflict (product_id, status) do nothing
        `).catch(() => {});
      }
    }
  } catch {
    // ignore taxonomy updates on older DBs
  }

  // Duplicate daily check
  const today = new Date().toISOString().slice(0, 10);
  const quarantineCheck = await assessAndMaybeQuarantinePrice(db, {
    sourceId: args.sourceId,
    sourceName: args.merchantName || args.domain,
    productId,
    regionId: args.regionId,
    productName: p.name,
    pageUrl: p.sourceUrl,
    rawPriceText: `${String(p.priceText ?? p.price)} ${parsedCurrency}`,
    parsedPriceIqd: priceIqd,
    currency: parsedCurrency,
    anomalyReason: 'api_ingest_price_anomaly',
    anomalyContext: { stage: 'discoverProductApis' },
  });
  if (quarantineCheck.quarantined) {
    await markPublicationOutcome(db, {
      candidateId: gateRecord.candidateId,
      legacyProductId: productId,
      status: 'published',
    });
    return false;
  }

  const existing = await db.execute(sql`
    select id
    from public.source_price_observations
    where product_id = ${productId}::uuid
      and source_id = ${args.sourceId}::uuid
      and source_url = ${p.sourceUrl}
      and (observed_at at time zone 'UTC')::date >= ${today}::date
    limit 1
  `);

  if (!(existing.rows as any[])[0]?.id) {
    const autoVerified = args.trustWeight >= 0.4;

    await db.execute(sql`
      insert into public.source_price_observations (
        product_id, source_id, source_url,
        price, normalized_price_iqd, currency,
        parsed_currency, raw_price_text, normalization_factor,
        is_price_anomaly, anomaly_reason,
        price_confidence, unit, region_id,
        evidence_type, evidence_ref,
        in_stock, is_synthetic, is_verified,
        observed_at, merchant_name
      ) values (
        ${productId}::uuid,
        ${args.sourceId}::uuid,
        ${p.sourceUrl},
        ${priceIqd},
        ${priceIqd},
        'IQD',
        ${parsedCurrency},
        ${String(p.price)} || ' ' || ${parsedCurrency},
        ${normalizationFactor},
        false,
        null,
        0.85,
        'pcs',
        ${args.regionId}::uuid,
        'api',
        ${args.domain},
        ${p.inStock},
        false,
        ${autoVerified},
        now(),
        ${args.merchantName}
      )
    `).catch(() => {});
  }

  const img = validateImageUrl(p.image);
  if (img) {
    await db.execute(sql`
      insert into public.product_images (
        product_id, image_url, source_site, source_page_url,
        is_primary, is_verified, confidence_score, position
      ) values (
        ${productId}::uuid,
        ${img},
        ${args.domain},
        ${p.sourceUrl},
        true,
        true,
        0.85,
        0
      )
      on conflict (product_id, image_url) do nothing
    `).catch(() => {});
  }

  await markPublicationOutcome(db, {
    candidateId: gateRecord.candidateId,
    legacyProductId: productId,
    status: 'published',
  });

  return true;
}

async function upsertProduct(
  db: any,
  sourceId: string,
  sourceDomain: string,
  url: string,
  p: ExtractedApiProduct,
  opts?: { existingProductId?: string | null; allowCreate?: boolean; productCondition?: string | null },
): Promise<string | null> {
  const forcedProductId = opts?.existingProductId ? String(opts.existingProductId) : null;
  const inferredCategory = inferCategoryKey({
    name: p?.name ?? null,
    description: p?.description ?? null,
    domain: sourceDomain,
    url,
  });
  const mapped = forcedProductId
    ? { rows: [{ product_id: forcedProductId }] as any[] }
    : await db.execute(sql`
        select product_id
        from public.product_url_map
        where url_hash = md5(lower(${url}))
          and source_id = ${sourceId}::uuid
        limit 1
      `).catch(() => ({ rows: [] as any[] }));

  const mappedId = (mapped.rows as any[])[0]?.product_id as string | undefined;
  const productCondition = String(opts?.productCondition ?? 'new').trim() || 'new';
  if (mappedId) {
    if (forcedProductId) {
      await db.execute(sql`
        insert into public.product_url_map (source_id, url, canonical_url, product_id, status, last_seen_at)
        values (${sourceId}::uuid, ${url}, null, ${mappedId}::uuid, 'mapped', now())
        on conflict (source_id, url_hash) do update set
          product_id = excluded.product_id,
          status = 'mapped',
          last_seen_at = now(),
          updated_at = now()
      `).catch(() => {});
    }
    await db.execute(sql`
      update public.products
      set condition = ${productCondition}, updated_at = now()
      where id = ${mappedId}::uuid
    `).catch(() => {});
    return mappedId;
  }

  const byName = await db.execute(sql`
    select id
    from public.products
    where lower(name_ar) = lower(${p.name})
    limit 1
  `);

  let productId = (byName.rows as any[])[0]?.id as string | undefined;
  if (!productId) {
    if (opts?.allowCreate === false) return null;
    const created = await db.execute(sql`
      insert into public.products (name_ar, category, unit, description_ar, image_url, is_active, condition)
      values (${p.name}, ${inferredCategory}, 'pcs', ${p.description ?? null}, ${p.image ?? null}, true, ${productCondition})
      returning id
    `);
    productId = (created.rows as any[])[0]?.id as string | undefined;
  }

  if (!productId) return null;

  await db.execute(sql`
    update public.products
    set condition = ${productCondition}, updated_at = now()
    where id = ${productId}::uuid
  `).catch(() => {});

  await db.execute(sql`
    insert into public.product_url_map (source_id, url, canonical_url, product_id, status, last_seen_at)
    values (${sourceId}::uuid, ${url}, null, ${productId}::uuid, 'mapped', now())
    on conflict (source_id, url_hash) do update set
      source_id = excluded.source_id,
      product_id = excluded.product_id,
      status = 'mapped',
      last_seen_at = now(),
      updated_at = now()
  `).catch(() => {});

  return productId;
}

function parseShopify(raw: string, domain: string): ExtractedApiProduct[] {
  try {
    const j = JSON.parse(raw);
    const products = Array.isArray(j.products) ? j.products : [];
    return products.map((p: any) => {
      const v = Array.isArray(p.variants) && p.variants.length ? p.variants[0] : null;
      const rawPriceText = String(v?.price ?? '').trim();
      const price = extractNumberLike(rawPriceText) ?? 0;
      const img = p.image?.src ?? (Array.isArray(p.images) && p.images[0]?.src) ?? null;
      return {
        name: String(p.title ?? '').trim(),
        description: stripHtml(String(p.body_html ?? '')) || null,
        price,
        priceText: rawPriceText || null,
        currency: null, // Store currency is often IQD in Iraq; leave null and let normalizeToIqdSmart infer safely
        image: img ? String(img) : null,
        sourceUrl: p.handle ? `https://${domain}/products/${p.handle}` : '',
        inStock: Boolean(v?.available ?? true),
      } as ExtractedApiProduct;
    }).filter((p: ExtractedApiProduct) => p.name && p.price > 0 && p.sourceUrl);
  } catch {
    return [];
  }
}

function parseWoo(raw: string): ExtractedApiProduct[] {
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.map((p: any) => {
      const priceStr = String(p.prices?.price ?? p.price ?? '').trim();
      const n = extractNumberLike(priceStr);
      const minor = Number(p.prices?.currency_minor_unit ?? 0);
      const currencyCodeRaw = String(p.prices?.currency_code ?? p.prices?.currency ?? p.currency ?? '').trim();
      const currency = currencyCodeRaw ? currencyCodeRaw.toUpperCase() : null;

      let price = n ?? 0;
      // Woo Store API often returns minor units (e.g., 1099 with minor_unit=2 => 10.99)
      if (price && Number.isFinite(minor) && minor > 0 && minor <= 4 && !/[\.,]/.test(priceStr)) {
        price = price / Math.pow(10, minor);
      }
      const img = Array.isArray(p.images) && p.images[0]?.src ? p.images[0].src : null;
      return {
        name: String(p.name ?? '').trim(),
        description: stripHtml(String(p.description ?? '')) || null,
        price,
        priceText: priceStr || null,
        currency,
        image: img ? String(img) : null,
        sourceUrl: String(p.permalink ?? ''),
        inStock: Boolean(p.is_in_stock ?? true),
      } as ExtractedApiProduct;
    }).filter((p: ExtractedApiProduct) => p.name && p.price > 0 && p.sourceUrl);
  } catch {
    return [];
  }
}

function stripHtml(input: string) {
  return input.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function setQueryParam(url: string, key: string, value: string) {
  const u = new URL(url);
  u.searchParams.set(key, value);
  return u.toString();
}

async function fetchText(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; PriceTrackerIraqBot/1.0)',
        'Accept': 'application/json,text/plain,*/*',
      },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJson(url: string): Promise<any | null> {
  const raw = await fetchText(url);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

async function ensureOnlineRegion(db: any): Promise<string> {
  const r = await db.execute(sql`select id from public.regions where name_ar = 'اونلاين' limit 1`);
  const existing = (r.rows as any[])[0]?.id as string | undefined;
  if (existing) return existing;

  const ins = await db.execute(sql`
    insert into public.regions (name_ar, name_en, is_active)
    values ('اونلاين', 'Online', true)
    returning id
  `);
  return (ins.rows as any[])[0]?.id as string;
}
