import { sql } from 'drizzle-orm';
import {
  deriveCanonicalIdentity,
  normalizeCatalogIdentifier,
  normalizeCatalogText,
} from './canonicalIdentity';
import {
  buildNameSearchTokens,
  fetchOpenFoodFactsProduct,
  inferIdentifierType,
  normalizeIdentifierValue,
  type ExternalCatalogProduct,
  type ProductIdentifierType,
} from './identifierResolver';
import { classifyGovernedTaxonomy } from './taxonomyGovernance';

type DbLike = {
  execute: (query: any) => Promise<{ rows?: unknown[] }>;
};

export type BarcodeParseSource =
  | 'empty'
  | 'direct'
  | 'numeric_scan'
  | 'query_param'
  | 'path_segment'
  | 'digital_link'
  | 'unresolved';

export type BarcodeParseResult = {
  code: string | null;
  candidates: string[];
  source: BarcodeParseSource;
  identifierType: ProductIdentifierType | null;
  checkDigitValid: boolean | null;
  gs1: Record<string, string> | null;
};

export type BarcodeCatalogCandidateScore = {
  accepted: boolean;
  confidence: number;
  reasons: string[];
  blockingReasons: string[];
};

type CanonicalVariantProjection = {
  variantId: string;
  familyId: string;
  legacyProductId: string | null;
  displayNameAr: string | null;
  displayNameEn: string | null;
  familyNameAr: string | null;
  familyNameEn: string | null;
  normalizedBrand: string | null;
  sizeValue: number | null;
  sizeUnit: string | null;
  packCount: number;
  taxonomyKey: string | null;
  barcodePrimary: string | null;
  product: Record<string, unknown> | null;
};

type CatalogMatchCandidate = CanonicalVariantProjection & {
  matchConfidence: number;
  matchReasons: string[];
};

type InternalMatch = {
  matchType: string;
  confidence: number;
  identifierType: ProductIdentifierType | null;
  product: Record<string, unknown> | null;
  canonicalVariant: CanonicalVariantProjection | null;
};

type ExternalBarcodeResolver = (code: string, identifierType: ProductIdentifierType | null) => Promise<ExternalCatalogProduct | null>;

export type BarcodeResolutionResponse = {
  ok: boolean;
  input: string | null;
  resolved_code: string | null;
  candidates: string[];
  identifier_type: ProductIdentifierType | null;
  resolution: {
    match_type: string;
    confidence: number;
    parse_source: BarcodeParseSource;
    check_digit_valid: boolean | null;
  };
  product: Record<string, unknown> | null;
  canonical_variant: Record<string, unknown> | null;
  offers: Record<string, unknown>[];
  external_catalog: Record<string, unknown> | null;
  external_prices: Record<string, unknown>[];
  cheapest_external: Record<string, unknown> | null;
  catalog_matches: Record<string, unknown>[];
};

type ResolveBarcodeLookupOptions = {
  regionId?: string | null;
  limitOffers?: number;
  allowExternal?: boolean;
  externalResolvers?: ExternalBarcodeResolver[];
};

const DEFAULT_EXTERNAL_RESOLVERS: ExternalBarcodeResolver[] = [
  async (code) => fetchOpenFoodFactsProduct(code),
];

function normalizeDigits(value: string): string {
  return String(value ?? '')
    .replace(/[\u0660-\u0669]/g, (d) => String('\u0660\u0661\u0662\u0663\u0664\u0665\u0666\u0667\u0668\u0669'.indexOf(d)))
    .replace(/[\u06F0-\u06F9]/g, (d) => String('\u06F0\u06F1\u06F2\u06F3\u06F4\u06F5\u06F6\u06F7\u06F8\u06F9'.indexOf(d)));
}

function normalizeCodeCandidate(value: string): string {
  return normalizeDigits(String(value ?? ''))
    .trim()
    .replace(/[^0-9A-Za-z:_./-]+/g, '');
}

function compatibleIdentifierTypes(identifierType: ProductIdentifierType | null): string[] {
  switch (identifierType) {
    case 'gtin':
    case 'ean':
    case 'upc':
    case 'barcode':
    case 'digital_link':
      return ['gtin', 'barcode', 'ean', 'upc', 'digital_link', 'qr_url'];
    case 'sku':
    case 'merchant_sku':
      return ['sku', 'merchant_sku', 'unknown'];
    case 'qr_url':
      return ['qr_url', 'digital_link', 'unknown'];
    default:
      return ['gtin', 'barcode', 'ean', 'upc', 'sku', 'merchant_sku', 'digital_link', 'qr_url', 'unknown'];
  }
}

function asNum(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asBool(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    return ['true', '1', 'yes', 'y', 'available', 'in_stock', 'in-stock'].includes(value.toLowerCase());
  }
  return false;
}

function getRootTaxonomyKey(value: string | null | undefined): string | null {
  const key = String(value ?? '').trim();
  if (!key) return null;
  return key.split('/')[0] || null;
}

function normalizeSizeToBase(value: number | null | undefined, unit: string | null | undefined): { value: number; unit: string } | null {
  if (value == null || !Number.isFinite(Number(value))) return null;
  const normalizedUnit = String(unit ?? '').trim().toLowerCase();
  const num = Number(value);
  if (!normalizedUnit) return null;
  if (normalizedUnit === 'ml') return { value: num, unit: 'ml' };
  if (normalizedUnit === 'l') return { value: num * 1000, unit: 'ml' };
  if (normalizedUnit === 'g') return { value: num, unit: 'g' };
  if (normalizedUnit === 'kg') return { value: num * 1000, unit: 'g' };
  return { value: num, unit: normalizedUnit };
}

function computePrice(value: Record<string, unknown>): number | null {
  return (
    asNum(value.final_price) ??
    asNum(value.display_price_iqd) ??
    asNum(value.current_price) ??
    asNum(value.price_iqd) ??
    asNum(value.price) ??
    null
  );
}

function computeDelivery(value: Record<string, unknown>): number {
  return asNum(value.delivery_fee_iqd) ?? asNum(value.delivery_fee) ?? 0;
}

function computeTrust(value: Record<string, unknown>): number {
  const direct = asNum(value.trust_score) ?? asNum(value.price_confidence) ?? asNum(value.match_confidence);
  if (direct != null) return Math.min(1, Math.max(0, direct > 1 ? direct / 100 : direct));

  let trust = 0.45;
  if (asBool(value.is_verified) || asBool(value.store_is_verified)) trust += 0.18;
  if (asBool(value.is_price_trusted)) trust += 0.16;
  if (asBool(value.in_stock) || asBool(value.is_in_stock)) trust += 0.08;
  if (asBool(value.is_price_anomaly) || asBool(value.is_price_suspected)) trust -= 0.18;
  return Math.min(1, Math.max(0, trust));
}

function computeFreshness(value: Record<string, unknown>): number {
  const raw = String(value.last_seen_at ?? value.observed_at ?? value.created_at ?? '');
  if (!raw) return 0.4;
  const ts = Date.parse(raw);
  if (!Number.isFinite(ts)) return 0.4;
  const ageHours = Math.max(0, (Date.now() - ts) / 36e5);
  if (ageHours <= 6) return 1;
  if (ageHours <= 24) return 0.9;
  if (ageHours <= 72) return 0.72;
  if (ageHours <= 168) return 0.55;
  return 0.35;
}

function computeAvailability(value: Record<string, unknown>): number {
  if (asBool(value.in_stock) || asBool(value.is_in_stock)) return 1;
  const status = String(value.availability_status ?? '').toLowerCase();
  if (status.includes('out')) return 0.1;
  if (status.includes('limited')) return 0.55;
  return 0.45;
}

function rankMatchedOffers(offers: Record<string, unknown>[]): Record<string, unknown>[] {
  const effectivePrices = offers
    .map((offer) => {
      const price = computePrice(offer);
      return price == null ? null : Math.max(0, price + computeDelivery(offer));
    })
    .filter((value): value is number => value != null && Number.isFinite(value));
  const cheapest = effectivePrices.length ? Math.min(...effectivePrices) : null;

  return offers
    .map((offer) => {
      const price = computePrice(offer);
      const delivery = computeDelivery(offer);
      const effectivePrice = price == null ? null : Math.max(0, price + delivery);
      const candidateConfidence = asNum(offer.match_confidence) ?? 0.35;
      const trust = computeTrust(offer);
      const freshness = computeFreshness(offer);
      const availability = computeAvailability(offer);
      const priceScore = cheapest && effectivePrice ? Math.min(1, cheapest / effectivePrice) : 0;
      const score = Number((
        candidateConfidence * 0.4 +
        priceScore * 0.22 +
        trust * 0.18 +
        freshness * 0.1 +
        availability * 0.1
      ).toFixed(4));
      return {
        ...offer,
        offer_rank_score: score,
        effective_price_iqd: effectivePrice,
      };
    })
    .sort((a, b) => {
      const scoreDiff = Number((b as any).offer_rank_score ?? 0) - Number((a as any).offer_rank_score ?? 0);
      if (scoreDiff !== 0) return scoreDiff;
      return Number((a as any).effective_price_iqd ?? Number.MAX_SAFE_INTEGER) - Number((b as any).effective_price_iqd ?? Number.MAX_SAFE_INTEGER);
    });
}

export function computeGtinCheckDigit(body: string): number | null {
  if (!/^\d+$/.test(body) || body.length < 7) return null;
  const digits = body.split('').map((digit) => Number(digit));
  let sum = 0;
  let useThree = true;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    sum += digits[index] * (useThree ? 3 : 1);
    useThree = !useThree;
  }
  return (10 - (sum % 10)) % 10;
}

export function isValidGtinIdentifier(code: string): boolean | null {
  const normalized = normalizeIdentifierValue(code);
  if (!/^\d{8}$|^\d{12}$|^\d{13}$|^\d{14}$/.test(normalized)) return null;
  const body = normalized.slice(0, -1);
  const expected = computeGtinCheckDigit(body);
  if (expected == null) return null;
  return expected === Number(normalized.slice(-1));
}

function extractGs1DigitalLink(url: URL): Record<string, string> | null {
  const parts = url.pathname.split('/').filter(Boolean);
  const aiIndex = parts.findIndex((part) => part === '01');
  if (aiIndex >= 0 && /^\d{8,14}$/.test(parts[aiIndex + 1] ?? '')) {
    const result: Record<string, string> = { gtin: parts[aiIndex + 1] };
    const lotIndex = parts.findIndex((part) => part === '10');
    const serialIndex = parts.findIndex((part) => part === '21');
    const expIndex = parts.findIndex((part) => part === '17');
    if (lotIndex >= 0 && parts[lotIndex + 1]) result.lot = parts[lotIndex + 1];
    if (serialIndex >= 0 && parts[serialIndex + 1]) result.serial = parts[serialIndex + 1];
    if (expIndex >= 0 && parts[expIndex + 1]) result.expiry = parts[expIndex + 1];
    return result;
  }

  const gtin = url.searchParams.get('01') ?? url.searchParams.get('gtin') ?? url.searchParams.get('barcode');
  if (gtin && /^\d{8,14}$/.test(gtin)) {
    return { gtin };
  }

  return null;
}

export function parseBarcodeInput(raw: string | null | undefined): BarcodeParseResult {
  const text = String(raw ?? '').trim();
  if (!text) {
    return {
      code: null,
      candidates: [],
      source: 'empty',
      identifierType: null,
      checkDigitValid: null,
      gs1: null,
    };
  }

  const candidates = new Set<string>();
  let source: BarcodeParseSource = 'unresolved';
  let gs1: Record<string, string> | null = null;

  const pushCandidate = (value: string, candidateSource: BarcodeParseSource) => {
    const normalized = normalizeCodeCandidate(value);
    if (normalized.length < 8) return;
    candidates.add(normalized);
    if (source === 'unresolved' || source === 'empty' || (source !== 'digital_link' && candidateSource === 'digital_link')) {
      source = candidateSource;
    }
  };

  const direct = normalizeDigits(text).trim();
  if (/^[0-9A-Za-z:_./-]{8,64}$/.test(direct)) pushCandidate(direct, 'direct');

  try {
    const url = new URL(text);
    const digitalLink = extractGs1DigitalLink(url);
    if (digitalLink?.gtin) {
      gs1 = digitalLink;
      pushCandidate(digitalLink.gtin, 'digital_link');
    }

    for (const key of ['code', 'barcode', 'ean', 'upc', 'sku', 'id']) {
      const value = url.searchParams.get(key);
      if (value) pushCandidate(value, 'query_param');
    }

    for (const segment of url.pathname.split('/')) {
      if (/^[0-9A-Za-z:_./-]{8,64}$/.test(segment)) pushCandidate(segment, 'path_segment');
    }
  } catch {
    // not a URL
  }

  const numericMatches = text.match(/[0-9\u0660-\u0669\u06F0-\u06F9]{8,14}/g) ?? [];
  for (const match of numericMatches) {
    pushCandidate(match, 'numeric_scan');
  }

  const all = Array.from(candidates);
  const preferred = gs1?.gtin ?? all.find((candidate) => /^\d{8,14}$/.test(candidate)) ?? all[0] ?? null;
  const identifierType = preferred
    ? (gs1?.gtin ? 'digital_link' : inferIdentifierType(preferred, text))
    : null;
  const checkDigitValid = preferred ? isValidGtinIdentifier(preferred) : null;

  return {
    code: preferred,
    candidates: all,
    source,
    identifierType,
    checkDigitValid,
    gs1,
  };
}

function candidateNameText(candidate: CanonicalVariantProjection): string {
  return normalizeCatalogText([
    candidate.displayNameAr,
    candidate.displayNameEn,
    candidate.familyNameAr,
    candidate.familyNameEn,
  ].filter(Boolean).join(' '));
}

export function scoreBarcodeCatalogCandidate(input: {
  external: {
    code?: string | null;
    name?: string | null;
    brand?: string | null;
    quantity?: string | null;
    taxonomyKey?: string | null;
  };
  candidate: {
    displayNameAr?: string | null;
    displayNameEn?: string | null;
    familyNameAr?: string | null;
    familyNameEn?: string | null;
    normalizedBrand?: string | null;
    sizeValue?: number | null;
    sizeUnit?: string | null;
    packCount?: number | null;
    taxonomyKey?: string | null;
    barcodePrimary?: string | null;
  };
}): BarcodeCatalogCandidateScore {
  const blockingReasons: string[] = [];
  const reasons: string[] = [];
  let confidence = 0;

  const externalName = [input.external.name, input.external.quantity].filter(Boolean).join(' ').trim() || input.external.name || '';
  const externalIdentity = deriveCanonicalIdentity({
    nameAr: externalName,
    brandAr: input.external.brand ?? null,
    taxonomyKey: input.external.taxonomyKey ?? null,
  });
  const externalTokens = buildNameSearchTokens({
    name: input.external.name ?? null,
    brand: input.external.brand ?? null,
    quantity: input.external.quantity ?? null,
  });

  const candidateBrand = normalizeCatalogText(input.candidate.normalizedBrand ?? '');
  const candidateText = normalizeCatalogText([
    input.candidate.displayNameAr,
    input.candidate.displayNameEn,
    input.candidate.familyNameAr,
    input.candidate.familyNameEn,
  ].filter(Boolean).join(' '));
  const externalBrand = externalIdentity.normalizedBrand ?? '';

  if (input.external.code && normalizeCatalogIdentifier(input.candidate.barcodePrimary) === normalizeCatalogIdentifier(input.external.code)) {
    confidence += 0.48;
    reasons.push('exact_barcode_match');
  }

  if (externalBrand && candidateBrand) {
    if (externalBrand === candidateBrand) {
      confidence += 0.28;
      reasons.push('brand_exact');
    } else if (candidateBrand.includes(externalBrand) || externalBrand.includes(candidateBrand)) {
      confidence += 0.16;
      reasons.push('brand_family_match');
    } else {
      blockingReasons.push('brand_mismatch');
    }
  } else if (externalBrand && candidateText.includes(externalBrand)) {
    confidence += 0.12;
    reasons.push('brand_present_in_name');
  }

  if (externalTokens.length) {
    const matchedTokens = externalTokens.filter((token) => candidateText.includes(token));
    const overlap = matchedTokens.length / externalTokens.length;
    confidence += Math.min(0.32, overlap * 0.32);
    if (matchedTokens.length) reasons.push(`token_overlap:${matchedTokens.length}/${externalTokens.length}`);
  }

  const externalSize = normalizeSizeToBase(externalIdentity.sizeValue, externalIdentity.sizeUnit);
  const candidateSize = normalizeSizeToBase(asNum(input.candidate.sizeValue), input.candidate.sizeUnit ?? null);
  if (externalSize && candidateSize && externalSize.unit === candidateSize.unit) {
    const diffRatio = Math.abs(externalSize.value - candidateSize.value) / Math.max(externalSize.value, candidateSize.value, 1);
    if (diffRatio <= 0.02) {
      confidence += 0.18;
      reasons.push('size_exact');
    } else if (diffRatio <= 0.12) {
      confidence += 0.1;
      reasons.push('size_close');
    } else if (diffRatio >= 0.2) {
      blockingReasons.push('size_mismatch');
    }
  }

  const externalPack = Math.max(1, Number(externalIdentity.packCount ?? 1));
  const candidatePack = Math.max(1, Number(input.candidate.packCount ?? 1));
  if (externalPack > 1 || candidatePack > 1) {
    if (externalPack === candidatePack) {
      confidence += 0.08;
      reasons.push('pack_exact');
    } else if (externalPack > 1 && candidatePack > 1) {
      blockingReasons.push('pack_mismatch');
    } else {
      confidence -= 0.04;
      reasons.push('pack_uncertain');
    }
  }

  const externalRoot = getRootTaxonomyKey(input.external.taxonomyKey);
  const candidateRoot = getRootTaxonomyKey(input.candidate.taxonomyKey);
  if (externalRoot && candidateRoot) {
    if (externalRoot === candidateRoot) {
      confidence += 0.08;
      reasons.push('taxonomy_root_match');
    } else {
      confidence -= 0.08;
      reasons.push(`taxonomy_root_mismatch:${externalRoot}:${candidateRoot}`);
    }
  }

  confidence = Math.max(0, Math.min(0.995, Number(confidence.toFixed(3))));
  const accepted = blockingReasons.length === 0 && confidence >= 0.58;

  return {
    accepted,
    confidence,
    reasons,
    blockingReasons,
  };
}

async function createBarcodeRun(
  db: DbLike,
  inputText: string | null,
  parsed: BarcodeParseResult,
  regionId: string | null | undefined,
): Promise<string | null> {
  try {
    const result = await db.execute(sql`
      insert into public.barcode_resolution_runs (
        input_text,
        parsed_code,
        identifier_type,
        parse_source,
        resolution_status,
        region_id,
        evidence
      ) values (
        ${inputText},
        ${parsed.code},
        ${parsed.identifierType},
        ${parsed.source},
        'running',
        ${regionId ?? null}::uuid,
        ${JSON.stringify({
          candidates: parsed.candidates,
          check_digit_valid: parsed.checkDigitValid,
          gs1: parsed.gs1,
        })}::jsonb
      )
      returning id
    `);
    return String((result.rows as any[])[0]?.id ?? '');
  } catch {
    return null;
  }
}

async function completeBarcodeRun(
  db: DbLike,
  runId: string | null,
  payload: {
    status: 'resolved_internal' | 'resolved_external' | 'ambiguous' | 'not_found' | 'failed';
    variantId?: string | null;
    familyId?: string | null;
    legacyProductId?: string | null;
    externalSource?: string | null;
    confidence?: number | null;
    evidence?: Record<string, unknown>;
  },
): Promise<void> {
  if (!runId) return;
  await db.execute(sql`
    update public.barcode_resolution_runs
    set
      resolution_status = ${payload.status},
      variant_id = ${payload.variantId ?? null}::uuid,
      family_id = ${payload.familyId ?? null}::uuid,
      legacy_product_id = ${payload.legacyProductId ?? null}::uuid,
      external_source = ${payload.externalSource ?? null},
      confidence = ${payload.confidence ?? null},
      evidence = coalesce(evidence, '{}'::jsonb) || ${JSON.stringify(payload.evidence ?? {})}::jsonb,
      completed_at = now(),
      updated_at = now()
    where id = ${runId}::uuid
  `).catch(() => {});
}

async function recordBarcodeCandidate(
  db: DbLike,
  runId: string | null,
  payload: {
    candidateType: 'internal_variant' | 'legacy_product' | 'external_catalog' | 'catalog_match' | 'offer_match';
    candidateRank: number;
    candidateStatus: 'selected' | 'ranked' | 'ambiguous' | 'quarantined' | 'rejected';
    variantId?: string | null;
    familyId?: string | null;
    legacyProductId?: string | null;
    listingId?: string | null;
    sourceDomain?: string | null;
    confidence?: number | null;
    reasons?: string[];
    evidence?: Record<string, unknown>;
  },
): Promise<void> {
  if (!runId) return;
  await db.execute(sql`
    insert into public.barcode_resolution_candidates (
      run_id,
      candidate_type,
      candidate_rank,
      candidate_status,
      variant_id,
      family_id,
      legacy_product_id,
      listing_id,
      source_domain,
      confidence,
      reasons,
      evidence
    ) values (
      ${runId}::uuid,
      ${payload.candidateType},
      ${payload.candidateRank},
      ${payload.candidateStatus},
      ${payload.variantId ?? null}::uuid,
      ${payload.familyId ?? null}::uuid,
      ${payload.legacyProductId ?? null}::uuid,
      ${payload.listingId ?? null}::uuid,
      ${payload.sourceDomain ?? null},
      ${payload.confidence ?? null},
      ${JSON.stringify(payload.reasons ?? [])}::jsonb,
      ${JSON.stringify(payload.evidence ?? {})}::jsonb
    )
  `).catch(() => {});
}

async function getCachedExternalCatalog(db: DbLike, code: string): Promise<ExternalCatalogProduct | null> {
  const rows = await db.execute(sql`
    select payload
    from public.barcode_external_catalog_cache
    where normalized_code = ${code}
      and expires_at > now()
    limit 1
  `).catch(() => ({ rows: [] as any[] }));

  const payload = ((rows.rows as any[])?.[0]?.payload ?? null) as ExternalCatalogProduct | null;
  return payload && typeof payload === 'object' ? payload : null;
}

async function cacheExternalCatalog(
  db: DbLike,
  code: string,
  identifierType: ProductIdentifierType | null,
  external: ExternalCatalogProduct,
): Promise<void> {
  await db.execute(sql`
    insert into public.barcode_external_catalog_cache (
      normalized_code,
      identifier_type,
      source,
      payload,
      fetched_at,
      expires_at,
      updated_at
    ) values (
      ${code},
      ${identifierType},
      ${external.source},
      ${JSON.stringify(external)}::jsonb,
      now(),
      now() + interval '7 days',
      now()
    )
    on conflict (normalized_code) do update set
      identifier_type = excluded.identifier_type,
      source = excluded.source,
      payload = excluded.payload,
      fetched_at = excluded.fetched_at,
      expires_at = excluded.expires_at,
      updated_at = now()
  `).catch(() => {});
}

async function fetchCanonicalVariantProjection(
  db: DbLike,
  variantId: string,
): Promise<CanonicalVariantProjection | null> {
  const rows = await db.execute(sql`
    select
      v.id as variant_id,
      v.family_id,
      coalesce(anchor.legacy_product_id, v.legacy_anchor_product_id) as legacy_product_id,
      v.display_name_ar,
      v.display_name_en,
      f.canonical_name_ar as family_name_ar,
      f.canonical_name_en as family_name_en,
      v.normalized_brand,
      v.size_value,
      v.size_unit,
      v.pack_count,
      coalesce(v.taxonomy_key, f.taxonomy_key) as taxonomy_key,
      v.barcode_primary,
      p.id as product_id,
      p.name_ar as product_name_ar,
      p.name_en as product_name_en,
      p.brand_ar,
      p.brand_en,
      p.image_url,
      p.barcode,
      p.category,
      p.subcategory,
      p.taxonomy_key as product_taxonomy_key,
      p.size_value as product_size_value,
      p.size_unit as product_size_unit
    from public.catalog_product_variants v
    join public.catalog_product_families f on f.id = v.family_id
    left join lateral (
      select legacy_product_id
      from public.catalog_variant_legacy_links l
      where l.variant_id = v.id
      order by l.is_anchor desc, l.updated_at desc nulls last, l.created_at desc
      limit 1
    ) anchor on true
    left join public.products p on p.id = coalesce(anchor.legacy_product_id, v.legacy_anchor_product_id)
    where v.id = ${variantId}::uuid
    limit 1
  `).catch(() => ({ rows: [] as any[] }));

  const row = (rows.rows as any[])[0] ?? null;
  if (!row) return null;

  const product = row.product_id
    ? {
        id: row.product_id,
        name_ar: row.product_name_ar ?? row.display_name_ar,
        name_en: row.product_name_en ?? row.display_name_en,
        brand_ar: row.brand_ar ?? null,
        brand_en: row.brand_en ?? null,
        image_url: row.image_url ?? null,
        barcode: row.barcode ?? row.barcode_primary ?? null,
        category: row.category ?? null,
        subcategory: row.subcategory ?? null,
        taxonomy_key: row.product_taxonomy_key ?? row.taxonomy_key ?? null,
        size_value: row.product_size_value ?? row.size_value ?? null,
        size_unit: row.product_size_unit ?? row.size_unit ?? null,
      }
    : null;

  return {
    variantId: String(row.variant_id),
    familyId: String(row.family_id),
    legacyProductId: row.legacy_product_id ? String(row.legacy_product_id) : null,
    displayNameAr: row.display_name_ar ? String(row.display_name_ar) : null,
    displayNameEn: row.display_name_en ? String(row.display_name_en) : null,
    familyNameAr: row.family_name_ar ? String(row.family_name_ar) : null,
    familyNameEn: row.family_name_en ? String(row.family_name_en) : null,
    normalizedBrand: row.normalized_brand ? String(row.normalized_brand) : null,
    sizeValue: asNum(row.size_value),
    sizeUnit: row.size_unit ? String(row.size_unit) : null,
    packCount: Number(row.pack_count ?? 1),
    taxonomyKey: row.taxonomy_key ? String(row.taxonomy_key) : null,
    barcodePrimary: row.barcode_primary ? String(row.barcode_primary) : null,
    product,
  };
}

async function fetchOffersForVariant(
  db: DbLike,
  variantId: string,
  regionId: string | null | undefined,
  limitOffers: number,
): Promise<Record<string, unknown>[]> {
  const regionClause = regionId ? sql`and o.region_id = ${regionId}` : sql``;
  const rows = await db.execute(sql`
    select distinct on (o.offer_id)
      o.*
    from public.v_product_all_offers o
    join public.catalog_variant_legacy_links link on link.legacy_product_id = o.product_id
    where link.variant_id = ${variantId}::uuid
    ${regionClause}
    order by o.offer_id, o.final_price asc nulls last, o.observed_at desc nulls last
    limit ${limitOffers}
  `).catch(() => ({ rows: [] as any[] }));

  return ((rows.rows as any[]) ?? []) as Record<string, unknown>[];
}

async function fetchOffersForProduct(
  db: DbLike,
  productId: string,
  regionId: string | null | undefined,
  limitOffers: number,
): Promise<Record<string, unknown>[]> {
  const regionClause = regionId ? sql`and o.region_id = ${regionId}` : sql``;
  const rows = await db.execute(sql`
    select o.*
    from public.v_product_all_offers o
    where o.product_id = ${productId}::uuid
    ${regionClause}
    order by o.final_price asc nulls last, o.observed_at desc nulls last
    limit ${limitOffers}
  `).catch(() => ({ rows: [] as any[] }));

  return ((rows.rows as any[]) ?? []) as Record<string, unknown>[];
}

async function lookupCanonicalVariantByIdentifier(
  db: DbLike,
  code: string,
  identifierType: ProductIdentifierType | null,
): Promise<CanonicalVariantProjection | null> {
  const typePriority = compatibleIdentifierTypes(identifierType);
  const rows = await db.execute(sql`
    select
      i.variant_id
    from public.catalog_variant_identifiers i
    join public.catalog_product_variants v on v.id = i.variant_id
    where i.id_value_normalized = ${code}
      and i.id_type = any(${typePriority}::text[])
    order by i.is_primary desc, i.confidence desc, v.updated_at desc nulls last, v.created_at desc
    limit 1
  `).catch(() => ({ rows: [] as any[] }));

  const variantId = ((rows.rows as any[])[0]?.variant_id as string | undefined) ?? null;
  return variantId ? fetchCanonicalVariantProjection(db, variantId) : null;
}

async function lookupCanonicalVariantByListingCode(
  db: DbLike,
  code: string,
): Promise<CanonicalVariantProjection | null> {
  const rows = await db.execute(sql`
    select variant_id
    from public.catalog_merchant_listings
    where external_item_id = ${code}
      and status in ('active', 'quarantined')
    order by updated_at desc nulls last, created_at desc
    limit 1
  `).catch(() => ({ rows: [] as any[] }));
  const variantId = ((rows.rows as any[])[0]?.variant_id as string | undefined) ?? null;
  return variantId ? fetchCanonicalVariantProjection(db, variantId) : null;
}

async function lookupVariantByLegacyProductId(
  db: DbLike,
  legacyProductId: string,
): Promise<CanonicalVariantProjection | null> {
  const rows = await db.execute(sql`
    select variant_id
    from public.catalog_variant_legacy_links
    where legacy_product_id = ${legacyProductId}::uuid
    limit 1
  `).catch(() => ({ rows: [] as any[] }));
  const variantId = ((rows.rows as any[])[0]?.variant_id as string | undefined) ?? null;
  return variantId ? fetchCanonicalVariantProjection(db, variantId) : null;
}

async function lookupLegacyFallbackProduct(
  db: DbLike,
  code: string,
  identifierType: ProductIdentifierType | null,
): Promise<InternalMatch | null> {
  const compatibleTypes = compatibleIdentifierTypes(identifierType);

  const byIdentifier = await db.execute(sql`
    select
      p.id,
      p.name_ar,
      p.name_en,
      p.brand_ar,
      p.brand_en,
      p.image_url,
      p.barcode,
      p.category,
      p.subcategory,
      p.taxonomy_key,
      p.size_value,
      p.size_unit,
      pi.id_type,
      pi.confidence as identifier_confidence
    from public.product_identifiers pi
    join public.products p on p.id = pi.product_id
    where pi.id_value_normalized = ${code}
      and pi.id_type = any(${compatibleTypes}::text[])
    order by pi.is_primary desc, pi.confidence desc, p.updated_at desc nulls last, p.created_at desc
    limit 1
  `).catch(() => ({ rows: [] as any[] }));

  const product = ((byIdentifier.rows as any[])?.[0] ?? null) as Record<string, unknown> | null;
  if (product) {
    const variant = await lookupVariantByLegacyProductId(db, String(product.id));
    return {
      matchType: 'legacy_identifier',
      confidence: Number(product.identifier_confidence ?? 0.96),
      identifierType: String(product.id_type ?? identifierType ?? 'unknown') as ProductIdentifierType,
      product,
      canonicalVariant: variant,
    };
  }

  const byBarcode = await db.execute(sql`
    select
      p.id,
      p.name_ar,
      p.name_en,
      p.brand_ar,
      p.brand_en,
      p.image_url,
      p.barcode,
      p.category,
      p.subcategory,
      p.taxonomy_key,
      p.size_value,
      p.size_unit
    from public.products p
    where regexp_replace(coalesce(p.barcode, ''), '[^0-9A-Za-z]+', '', 'g') = ${code}
    order by p.updated_at desc nulls last, p.created_at desc
    limit 1
  `).catch(() => ({ rows: [] as any[] }));

  const barcodeProduct = ((byBarcode.rows as any[])?.[0] ?? null) as Record<string, unknown> | null;
  if (barcodeProduct) {
    const variant = await lookupVariantByLegacyProductId(db, String(barcodeProduct.id));
    return {
      matchType: 'legacy_barcode',
      confidence: 0.98,
      identifierType,
      product: barcodeProduct,
      canonicalVariant: variant,
    };
  }

  const byAlias = await db.execute(sql`
    select
      p.id,
      p.name_ar,
      p.name_en,
      p.brand_ar,
      p.brand_en,
      p.image_url,
      p.barcode,
      p.category,
      p.subcategory,
      p.taxonomy_key,
      p.size_value,
      p.size_unit
    from public.products p
    where exists (
      select 1
      from public.product_aliases pa
      where pa.product_id = p.id
        and regexp_replace(coalesce(pa.alias_name, ''), '[^0-9A-Za-z]+', '', 'g') = ${code}
    )
    order by p.updated_at desc nulls last, p.created_at desc
    limit 1
  `).catch(() => ({ rows: [] as any[] }));

  const aliasProduct = ((byAlias.rows as any[])?.[0] ?? null) as Record<string, unknown> | null;
  if (aliasProduct) {
    const variant = await lookupVariantByLegacyProductId(db, String(aliasProduct.id));
    return {
      matchType: 'legacy_alias',
      confidence: 0.72,
      identifierType,
      product: aliasProduct,
      canonicalVariant: variant,
    };
  }

  return null;
}

async function lookupInternalBarcodeMatch(
  db: DbLike,
  code: string,
  identifierType: ProductIdentifierType | null,
): Promise<InternalMatch | null> {
  if (identifierType === 'sku' || identifierType === 'merchant_sku') {
    const listingVariant = await lookupCanonicalVariantByListingCode(db, code);
    if (listingVariant) {
      return {
        matchType: 'listing_external_id',
        confidence: 0.985,
        identifierType,
        product: listingVariant.product,
        canonicalVariant: listingVariant,
      };
    }
  }

  const canonical = await lookupCanonicalVariantByIdentifier(db, code, identifierType);
  if (canonical) {
    return {
      matchType: 'canonical_identifier',
      confidence: 0.995,
      identifierType,
      product: canonical.product,
      canonicalVariant: canonical,
    };
  }

  const legacy = await lookupLegacyFallbackProduct(db, code, identifierType);
  if (legacy) return legacy;

  return null;
}

async function resolveExternalCatalog(
  db: DbLike,
  code: string,
  identifierType: ProductIdentifierType | null,
  resolvers: ExternalBarcodeResolver[],
): Promise<ExternalCatalogProduct | null> {
  const cached = await getCachedExternalCatalog(db, code);
  if (cached) return cached;

  for (const resolver of resolvers) {
    const external = await resolver(code, identifierType).catch(() => null);
    if (!external) continue;
    await cacheExternalCatalog(db, code, identifierType, external);
    return external;
  }

  return null;
}

async function searchCatalogMatchesForExternal(
  db: DbLike,
  external: ExternalCatalogProduct,
): Promise<CatalogMatchCandidate[]> {
  const taxonomyDecision = classifyGovernedTaxonomy({
    name: external.name,
    description: external.categories?.join(' | ') ?? null,
    brand: external.brand,
    mappedTaxonomyKey: null,
    fallbackCategory: null,
    fallbackSubcategory: null,
  });

  const tokens = buildNameSearchTokens({
    name: external.name,
    brand: external.brand,
    quantity: external.quantity,
  });
  if (!tokens.length) return [];

  const conditions = tokens.map((token) => sql`
    v.normalized_variant_name ilike ${`%${token}%`}
    or coalesce(v.normalized_brand, '') ilike ${`%${token}%`}
    or f.normalized_family_name ilike ${`%${token}%`}
    or coalesce(p.name_ar, '') ilike ${`%${token}%`}
    or coalesce(p.name_en, '') ilike ${`%${token}%`}
  `);

  const rows = await db.execute(sql`
    select
      v.id as variant_id,
      v.family_id,
      coalesce(anchor.legacy_product_id, v.legacy_anchor_product_id) as legacy_product_id,
      v.display_name_ar,
      v.display_name_en,
      f.canonical_name_ar as family_name_ar,
      f.canonical_name_en as family_name_en,
      v.normalized_brand,
      v.size_value,
      v.size_unit,
      v.pack_count,
      coalesce(v.taxonomy_key, f.taxonomy_key) as taxonomy_key,
      v.barcode_primary,
      p.id as product_id,
      p.name_ar as product_name_ar,
      p.name_en as product_name_en,
      p.brand_ar,
      p.brand_en,
      p.image_url,
      p.barcode,
      p.category,
      p.subcategory,
      p.taxonomy_key as product_taxonomy_key,
      p.size_value as product_size_value,
      p.size_unit as product_size_unit
    from public.catalog_product_variants v
    join public.catalog_product_families f on f.id = v.family_id
    left join lateral (
      select legacy_product_id
      from public.catalog_variant_legacy_links l
      where l.variant_id = v.id
      order by l.is_anchor desc, l.updated_at desc nulls last, l.created_at desc
      limit 1
    ) anchor on true
    left join public.products p on p.id = coalesce(anchor.legacy_product_id, v.legacy_anchor_product_id)
    where ${sql.join(conditions, sql` or `)}
    order by v.updated_at desc nulls last, v.created_at desc
    limit 80
  `).catch(() => ({ rows: [] as any[] }));

  const candidates: CatalogMatchCandidate[] = [];
  for (const row of (rows.rows as any[]) ?? []) {
    const projection: CanonicalVariantProjection = {
      variantId: String(row.variant_id),
      familyId: String(row.family_id),
      legacyProductId: row.legacy_product_id ? String(row.legacy_product_id) : null,
      displayNameAr: row.display_name_ar ? String(row.display_name_ar) : null,
      displayNameEn: row.display_name_en ? String(row.display_name_en) : null,
      familyNameAr: row.family_name_ar ? String(row.family_name_ar) : null,
      familyNameEn: row.family_name_en ? String(row.family_name_en) : null,
      normalizedBrand: row.normalized_brand ? String(row.normalized_brand) : null,
      sizeValue: asNum(row.size_value),
      sizeUnit: row.size_unit ? String(row.size_unit) : null,
      packCount: Number(row.pack_count ?? 1),
      taxonomyKey: row.taxonomy_key ? String(row.taxonomy_key) : null,
      barcodePrimary: row.barcode_primary ? String(row.barcode_primary) : null,
      product: row.product_id
        ? {
            id: row.product_id,
            name_ar: row.product_name_ar ?? row.display_name_ar,
            name_en: row.product_name_en ?? row.display_name_en,
            brand_ar: row.brand_ar ?? null,
            brand_en: row.brand_en ?? null,
            image_url: row.image_url ?? null,
            barcode: row.barcode ?? row.barcode_primary ?? null,
            category: row.category ?? null,
            subcategory: row.subcategory ?? null,
            taxonomy_key: row.product_taxonomy_key ?? row.taxonomy_key ?? null,
            size_value: row.product_size_value ?? row.size_value ?? null,
            size_unit: row.product_size_unit ?? row.size_unit ?? null,
          }
        : null,
    };

    const scored = scoreBarcodeCatalogCandidate({
      external: {
        code: external.code,
        name: external.name,
        brand: external.brand,
        quantity: external.quantity,
        taxonomyKey: taxonomyDecision.taxonomyKey,
      },
      candidate: {
        displayNameAr: projection.displayNameAr,
        displayNameEn: projection.displayNameEn,
        familyNameAr: projection.familyNameAr,
        familyNameEn: projection.familyNameEn,
        normalizedBrand: projection.normalizedBrand,
        sizeValue: projection.sizeValue,
        sizeUnit: projection.sizeUnit,
        packCount: projection.packCount,
        taxonomyKey: projection.taxonomyKey,
        barcodePrimary: projection.barcodePrimary,
      },
    });

    if (!scored.accepted) continue;
    candidates.push({
      ...projection,
      matchConfidence: scored.confidence,
      matchReasons: scored.reasons,
    });
  }

  return candidates
    .sort((left, right) => {
      const confidenceDiff = right.matchConfidence - left.matchConfidence;
      if (confidenceDiff !== 0) return confidenceDiff;
      return candidateNameText(left).localeCompare(candidateNameText(right));
    })
    .slice(0, 8);
}

function buildCanonicalVariantPayload(variant: CanonicalVariantProjection | null): Record<string, unknown> | null {
  if (!variant) return null;
  return {
    variant_id: variant.variantId,
    family_id: variant.familyId,
    legacy_product_id: variant.legacyProductId,
    display_name_ar: variant.displayNameAr,
    display_name_en: variant.displayNameEn,
    family_name_ar: variant.familyNameAr,
    family_name_en: variant.familyNameEn,
    normalized_brand: variant.normalizedBrand,
    size_value: variant.sizeValue,
    size_unit: variant.sizeUnit,
    pack_count: variant.packCount,
    taxonomy_key: variant.taxonomyKey,
    barcode_primary: variant.barcodePrimary,
  };
}

function summariseCheapestExternal(offers: Record<string, unknown>[]): Record<string, unknown> | null {
  if (!offers.length) return null;
  const best = offers[0] as any;
  return {
    product_id: best.product_id ?? null,
    variant_id: best.variant_id ?? null,
    final_price: best.final_price ?? best.effective_price_iqd ?? null,
    merchant_name: best.merchant_name ?? best.source_name_ar ?? null,
    source_domain: best.source_domain ?? null,
    source_url: best.source_url ?? best.product_url ?? null,
    match_confidence: best.match_confidence ?? null,
    observed_at: best.observed_at ?? null,
  };
}

export async function resolveBarcodeLookup(
  db: DbLike,
  rawInput: string | null | undefined,
  options?: ResolveBarcodeLookupOptions,
): Promise<BarcodeResolutionResponse> {
  const parsed = parseBarcodeInput(rawInput);
  const limitOffers = Math.max(1, Math.min(50, Number(options?.limitOffers ?? 10)));
  const regionId = options?.regionId ?? null;
  const allowExternal = options?.allowExternal !== false;
  const externalResolvers = options?.externalResolvers ?? DEFAULT_EXTERNAL_RESOLVERS;
  const runId = await createBarcodeRun(db, rawInput ?? null, parsed, regionId);

  const baseResponse = {
    input: rawInput ?? null,
    resolved_code: parsed.code,
    candidates: parsed.candidates,
    identifier_type: parsed.identifierType,
  };

  if (!parsed.code) {
    await completeBarcodeRun(db, runId, {
      status: 'not_found',
      confidence: 0,
      evidence: { reason: 'code_not_found_in_input' },
    });
    return {
      ok: false,
      ...baseResponse,
      resolution: {
        match_type: 'none',
        confidence: 0,
        parse_source: parsed.source,
        check_digit_valid: parsed.checkDigitValid,
      },
      product: null,
      canonical_variant: null,
      offers: [],
      external_catalog: null,
      external_prices: [],
      cheapest_external: null,
      catalog_matches: [],
    };
  }

  const internalMatch = await lookupInternalBarcodeMatch(db, parsed.code, parsed.identifierType);
  if (internalMatch?.canonicalVariant) {
    const offers = await fetchOffersForVariant(db, internalMatch.canonicalVariant.variantId, regionId, limitOffers);
    await recordBarcodeCandidate(db, runId, {
      candidateType: 'internal_variant',
      candidateRank: 1,
      candidateStatus: 'selected',
      variantId: internalMatch.canonicalVariant.variantId,
      familyId: internalMatch.canonicalVariant.familyId,
      legacyProductId: internalMatch.canonicalVariant.legacyProductId,
      confidence: internalMatch.confidence,
      reasons: [internalMatch.matchType],
      evidence: {
        identifier_type: internalMatch.identifierType,
        parse_source: parsed.source,
      },
    });
    await completeBarcodeRun(db, runId, {
      status: 'resolved_internal',
      variantId: internalMatch.canonicalVariant.variantId,
      familyId: internalMatch.canonicalVariant.familyId,
      legacyProductId: internalMatch.canonicalVariant.legacyProductId,
      confidence: internalMatch.confidence,
      evidence: {
        match_type: internalMatch.matchType,
        offer_count: offers.length,
      },
    });

    return {
      ok: true,
      ...baseResponse,
      identifier_type: internalMatch.identifierType,
      resolution: {
        match_type: internalMatch.matchType,
        confidence: internalMatch.confidence,
        parse_source: parsed.source,
        check_digit_valid: parsed.checkDigitValid,
      },
      product: internalMatch.product,
      canonical_variant: buildCanonicalVariantPayload(internalMatch.canonicalVariant),
      offers,
      external_catalog: null,
      external_prices: [],
      cheapest_external: null,
      catalog_matches: [],
    };
  }

  if (internalMatch?.product) {
    const offers = await fetchOffersForProduct(db, String(internalMatch.product.id), regionId, limitOffers);
    await recordBarcodeCandidate(db, runId, {
      candidateType: 'legacy_product',
      candidateRank: 1,
      candidateStatus: 'selected',
      legacyProductId: String(internalMatch.product.id),
      confidence: internalMatch.confidence,
      reasons: [internalMatch.matchType],
    });
    await completeBarcodeRun(db, runId, {
      status: 'resolved_internal',
      legacyProductId: String(internalMatch.product.id),
      confidence: internalMatch.confidence,
      evidence: { match_type: internalMatch.matchType, offer_count: offers.length },
    });

    return {
      ok: true,
      ...baseResponse,
      identifier_type: internalMatch.identifierType,
      resolution: {
        match_type: internalMatch.matchType,
        confidence: internalMatch.confidence,
        parse_source: parsed.source,
        check_digit_valid: parsed.checkDigitValid,
      },
      product: internalMatch.product,
      canonical_variant: buildCanonicalVariantPayload(internalMatch.canonicalVariant),
      offers,
      external_catalog: null,
      external_prices: [],
      cheapest_external: null,
      catalog_matches: [],
    };
  }

  if (!allowExternal) {
    await completeBarcodeRun(db, runId, {
      status: 'not_found',
      confidence: 0,
      evidence: { reason: 'internal_lookup_miss' },
    });
    return {
      ok: false,
      ...baseResponse,
      resolution: {
        match_type: 'none',
        confidence: 0,
        parse_source: parsed.source,
        check_digit_valid: parsed.checkDigitValid,
      },
      product: null,
      canonical_variant: null,
      offers: [],
      external_catalog: null,
      external_prices: [],
      cheapest_external: null,
      catalog_matches: [],
    };
  }

  const externalCatalog = await resolveExternalCatalog(db, parsed.code, parsed.identifierType, externalResolvers);
  if (!externalCatalog) {
    await completeBarcodeRun(db, runId, {
      status: 'not_found',
      confidence: 0,
      evidence: { reason: 'external_registry_miss' },
    });
    return {
      ok: false,
      ...baseResponse,
      resolution: {
        match_type: 'none',
        confidence: 0,
        parse_source: parsed.source,
        check_digit_valid: parsed.checkDigitValid,
      },
      product: null,
      canonical_variant: null,
      offers: [],
      external_catalog: null,
      external_prices: [],
      cheapest_external: null,
      catalog_matches: [],
    };
  }

  await recordBarcodeCandidate(db, runId, {
    candidateType: 'external_catalog',
    candidateRank: 1,
    candidateStatus: 'ranked',
    confidence: 0.72,
    reasons: [externalCatalog.source],
    evidence: {
      source_url: externalCatalog.sourceUrl,
      name: externalCatalog.name,
      brand: externalCatalog.brand,
      quantity: externalCatalog.quantity,
    },
  });

  const catalogMatches = await searchCatalogMatchesForExternal(db, externalCatalog);
  const scoredMatches = catalogMatches.slice(0, 5);
  for (const [index, match] of scoredMatches.entries()) {
    await recordBarcodeCandidate(db, runId, {
      candidateType: 'catalog_match',
      candidateRank: index + 1,
      candidateStatus: index === 0 ? 'ranked' : 'ranked',
      variantId: match.variantId,
      familyId: match.familyId,
      legacyProductId: match.legacyProductId,
      confidence: match.matchConfidence,
      reasons: match.matchReasons,
      evidence: {
        candidate_name: match.displayNameAr ?? match.displayNameEn,
        candidate_taxonomy_key: match.taxonomyKey,
      },
    });
  }

  const topMatch = scoredMatches[0] ?? null;
  const secondMatch = scoredMatches[1] ?? null;
  const margin = topMatch
    ? Number((topMatch.matchConfidence - Number(secondMatch?.matchConfidence ?? 0)).toFixed(3))
    : 0;

  let resolvedProduct: Record<string, unknown> | null = null;
  let resolvedVariant: CanonicalVariantProjection | null = null;
  let localOffers: Record<string, unknown>[] = [];
  let resolutionType = 'external_catalog_only';
  let resolutionConfidence = 0.55;
  let runStatus: 'resolved_external' | 'ambiguous' | 'not_found' = scoredMatches.length ? 'resolved_external' : 'not_found';
  let rankedExternalOffers: Record<string, unknown>[] = [];

  if (topMatch) {
    const perCandidateLimit = Math.max(3, Math.min(limitOffers, 5));
    const flattenedOffers: Record<string, unknown>[] = [];
    for (const [index, match] of scoredMatches.entries()) {
      const offers = match.legacyProductId
        ? await fetchOffersForVariant(db, match.variantId, regionId, perCandidateLimit)
        : [];
      for (const offer of offers) {
        flattenedOffers.push({
          ...offer,
          variant_id: match.variantId,
          match_confidence: match.matchConfidence,
          match_reasons: match.matchReasons,
          match_rank: index + 1,
        });
      }
    }
    rankedExternalOffers = rankMatchedOffers(flattenedOffers).slice(0, limitOffers);

    const highConfidenceMatch = topMatch.matchConfidence >= 0.82 && margin >= 0.08;
    const ambiguousMatch = topMatch.matchConfidence >= 0.66 && margin < 0.08;

    if (highConfidenceMatch) {
      resolvedVariant = topMatch;
      resolvedProduct = topMatch.product;
      localOffers = topMatch.legacyProductId
        ? await fetchOffersForVariant(db, topMatch.variantId, regionId, limitOffers)
        : [];
      resolutionType = 'external_catalog_match';
      resolutionConfidence = topMatch.matchConfidence;
      runStatus = 'resolved_external';
    } else if (ambiguousMatch) {
      resolutionType = 'external_catalog_ambiguous';
      resolutionConfidence = topMatch.matchConfidence;
      runStatus = 'ambiguous';
    } else {
      resolutionType = rankedExternalOffers.length ? 'external_catalog_candidate' : 'external_catalog_only';
      resolutionConfidence = Math.max(0.55, topMatch.matchConfidence);
      runStatus = 'resolved_external';
    }
  }

  await completeBarcodeRun(db, runId, {
    status: runStatus,
    variantId: resolvedVariant?.variantId ?? null,
    familyId: resolvedVariant?.familyId ?? null,
    legacyProductId: resolvedVariant?.legacyProductId ?? null,
    externalSource: externalCatalog.source,
    confidence: resolutionConfidence,
    evidence: {
      match_type: resolutionType,
      external_name: externalCatalog.name,
      top_match_variant_id: topMatch?.variantId ?? null,
      top_match_confidence: topMatch?.matchConfidence ?? null,
      top_match_margin: margin,
    },
  });

  return {
    ok: true,
    ...baseResponse,
    identifier_type: parsed.identifierType ?? externalCatalog.identifierType,
    resolution: {
      match_type: resolutionType,
      confidence: resolutionConfidence,
      parse_source: parsed.source,
      check_digit_valid: parsed.checkDigitValid,
    },
    product: resolvedProduct,
    canonical_variant: buildCanonicalVariantPayload(resolvedVariant ?? topMatch),
    offers: localOffers,
    external_catalog: {
      source: externalCatalog.source,
      source_url: externalCatalog.sourceUrl,
      code: externalCatalog.code,
      identifier_type: externalCatalog.identifierType,
      name: externalCatalog.name,
      brand: externalCatalog.brand,
      quantity: externalCatalog.quantity,
      image_url: externalCatalog.imageUrl,
      categories: externalCatalog.categories,
    },
    external_prices: rankedExternalOffers,
    cheapest_external: summariseCheapestExternal(rankedExternalOffers),
    catalog_matches: scoredMatches.map((match, index) => ({
      match_rank: index + 1,
      match_confidence: match.matchConfidence,
      match_reasons: match.matchReasons,
      variant_id: match.variantId,
      family_id: match.familyId,
      legacy_product_id: match.legacyProductId,
      display_name_ar: match.displayNameAr,
      display_name_en: match.displayNameEn,
      family_name_ar: match.familyNameAr,
      family_name_en: match.familyNameEn,
      normalized_brand: match.normalizedBrand,
      size_value: match.sizeValue,
      size_unit: match.sizeUnit,
      pack_count: match.packCount,
      taxonomy_key: match.taxonomyKey,
      product: match.product,
    })),
  };
}
