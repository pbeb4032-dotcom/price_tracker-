import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';

export type LegacyCatalogMatchKind = 'url_map' | 'identifier' | 'exact_name' | 'none';

export type LegacyCatalogMatch = {
  sourceId: string | null;
  productId: string | null;
  matchKind: LegacyCatalogMatchKind;
  confidence: number;
};

export type PublicationGateDecision = {
  enabled: boolean;
  publishable: boolean;
  status: 'approved' | 'quarantined';
  identityConfidence: number;
  taxonomyConfidence: number;
  priceConfidence: number;
  reasons: string[];
};

const GATE_VERSION = 'v1';
const TAXONOMY_MIN_CONFIDENCE = 0.9;
const PRICE_MIN_CONFIDENCE = 0.7;
const ENABLE_PUBLICATION_GATE = (process.env.INGEST_PUBLICATION_GATE_ENABLED ?? 'true') !== 'false';
const ALLOW_EXACT_NAME_PUBLISH = (process.env.INGEST_ALLOW_EXACT_NAME_PUBLISH ?? 'false') === 'true';

function normalizeDigits(value: string): string {
  return String(value ?? '')
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
}

function normalizeIdentifier(value: unknown): string | null {
  const normalized = normalizeDigits(String(value ?? ''))
    .trim()
    .replace(/[^0-9A-Za-z]+/g, '');
  return normalized.length >= 6 ? normalized : null;
}

function normalizeName(value: unknown): string {
  return normalizeDigits(String(value ?? ''))
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildPayloadHash(value: unknown): string {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value ?? {});
  return createHash('sha256').update(serialized).digest('hex');
}

function buildPayloadExcerpt(value: unknown, max = 700): string | null {
  const raw = typeof value === 'string' ? value : JSON.stringify(value ?? {});
  const trimmed = raw.replace(/\s+/g, ' ').trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

export function isPublicationGateEnabled(): boolean {
  return ENABLE_PUBLICATION_GATE;
}

export async function resolveLegacyCatalogMatch(
  db: any,
  input: {
    sourceId?: string | null;
    sourceDomain: string;
    sourceUrl?: string | null;
    barcode?: string | null;
    name?: string | null;
  },
): Promise<LegacyCatalogMatch> {
  let sourceId = input.sourceId ? String(input.sourceId) : null;
  if (!sourceId) {
    const src = await db.execute(sql`
      select id
      from public.price_sources
      where domain = ${input.sourceDomain}
      limit 1
    `).catch(() => ({ rows: [] as any[] }));
    sourceId = ((src.rows as any[])[0]?.id as string | undefined) ?? null;
  }

  if (sourceId && input.sourceUrl) {
    const mapped = await db.execute(sql`
      select product_id
      from public.product_url_map
      where source_id = ${sourceId}::uuid
        and url_hash = md5(lower(${String(input.sourceUrl)}))
      limit 1
    `).catch(() => ({ rows: [] as any[] }));
    const mappedId = ((mapped.rows as any[])[0]?.product_id as string | undefined) ?? null;
    if (mappedId) {
      return { sourceId, productId: mappedId, matchKind: 'url_map', confidence: 0.99 };
    }
  }

  const barcode = normalizeIdentifier(input.barcode);
  if (barcode) {
    const byIdentifier = await db.execute(sql`
      select p.id
      from public.product_identifiers pi
      join public.products p on p.id = pi.product_id
      where pi.id_value_normalized = ${barcode}
      order by pi.is_primary desc, pi.confidence desc, p.updated_at desc nulls last, p.created_at desc
      limit 1
    `).catch(() => ({ rows: [] as any[] }));
    const identifierId = ((byIdentifier.rows as any[])[0]?.id as string | undefined) ?? null;
    if (identifierId) {
      return { sourceId, productId: identifierId, matchKind: 'identifier', confidence: 0.995 };
    }

    const byBarcode = await db.execute(sql`
      select id
      from public.products
      where regexp_replace(coalesce(barcode,''), '[^0-9A-Za-z]+', '', 'g') = ${barcode}
      order by updated_at desc nulls last, created_at desc
      limit 1
    `).catch(() => ({ rows: [] as any[] }));
    const barcodeId = ((byBarcode.rows as any[])[0]?.id as string | undefined) ?? null;
    if (barcodeId) {
      return { sourceId, productId: barcodeId, matchKind: 'identifier', confidence: 0.985 };
    }
  }

  const name = String(input.name ?? '').trim();
  if (name) {
    const byName = await db.execute(sql`
      select id
      from public.products
      where lower(coalesce(name_ar,'')) = lower(${name})
         or lower(coalesce(name_en,'')) = lower(${name})
      order by updated_at desc nulls last, created_at desc
      limit 1
    `).catch(() => ({ rows: [] as any[] }));
    const exactNameId = ((byName.rows as any[])[0]?.id as string | undefined) ?? null;
    if (exactNameId) {
      return { sourceId, productId: exactNameId, matchKind: 'exact_name', confidence: 0.62 };
    }
  }

  return { sourceId, productId: null, matchKind: 'none', confidence: 0 };
}

export function assessPublicationGate(input: {
  match: LegacyCatalogMatch;
  taxonomyConfidence?: number | null;
  priceConfidence?: number | null;
  categoryConflict?: boolean;
  taxonomyConflict?: boolean;
}): PublicationGateDecision {
  const identityConfidence = Number(input.match.confidence ?? 0);
  const taxonomyConfidence = Number(input.taxonomyConfidence ?? 0);
  const priceConfidence = Number(input.priceConfidence ?? 0);

  if (!ENABLE_PUBLICATION_GATE) {
    return {
      enabled: false,
      publishable: true,
      status: 'approved',
      identityConfidence,
      taxonomyConfidence,
      priceConfidence,
      reasons: ['gate_disabled'],
    };
  }

  const reasons: string[] = [];
  if (input.match.matchKind === 'none') reasons.push('identity_unresolved');
  if (input.match.matchKind === 'exact_name' && !ALLOW_EXACT_NAME_PUBLISH) reasons.push('exact_name_match_not_publishable');
  if (input.categoryConflict) reasons.push('category_conflict');
  if (input.taxonomyConflict) reasons.push('taxonomy_conflict');
  if (taxonomyConfidence < TAXONOMY_MIN_CONFIDENCE) reasons.push('taxonomy_confidence_low');
  if (priceConfidence < PRICE_MIN_CONFIDENCE) reasons.push('price_confidence_low');

  return {
    enabled: true,
    publishable: reasons.length === 0,
    status: reasons.length === 0 ? 'approved' : 'quarantined',
    identityConfidence,
    taxonomyConfidence,
    priceConfidence,
    reasons,
  };
}

export async function recordPublicationGateArtifacts(
  db: any,
  input: {
    ingestRunId?: string | null;
    sourceId?: string | null;
    sourceDomain: string;
    sourceKind: 'html' | 'api' | 'manual' | 'unknown';
    pageType?: string | null;
    sourceUrl?: string | null;
    canonicalUrl?: string | null;
    externalItemId?: string | null;
    httpStatus?: number | null;
    contentType?: string | null;
    payloadKind?: 'json' | 'html' | 'unknown';
    rawPayload?: Record<string, unknown>;
    extractedPayload?: Record<string, unknown>;
    productName: string;
    barcode?: string | null;
    categoryHint?: string | null;
    subcategoryHint?: string | null;
    taxonomyHint?: string | null;
    categoryConflict?: boolean;
    taxonomyConflict?: boolean;
    match: LegacyCatalogMatch;
    decision: PublicationGateDecision;
  },
): Promise<{ documentId: string; candidateId: string }> {
  const rawPayload = input.rawPayload ?? {};
  const extractedPayload = input.extractedPayload ?? {};
  const sourceId = input.sourceId ?? input.match.sourceId ?? null;
  const document = await db.execute(sql`
    insert into public.ingest_documents (
      ingest_run_id,
      source_id,
      source_domain,
      source_kind,
      page_type,
      source_url,
      canonical_url,
      external_item_id,
      http_status,
      content_type,
      payload_kind,
      payload_hash,
      payload_excerpt,
      raw_payload,
      extracted_payload,
      status
    ) values (
      ${input.ingestRunId ?? null}::uuid,
      ${sourceId}::uuid,
      ${input.sourceDomain},
      ${input.sourceKind},
      ${input.pageType ?? null},
      ${input.sourceUrl ?? null},
      ${input.canonicalUrl ?? null},
      ${input.externalItemId ?? null},
      ${input.httpStatus ?? null},
      ${input.contentType ?? null},
      ${input.payloadKind ?? 'json'},
      ${buildPayloadHash({ rawPayload, extractedPayload, sourceUrl: input.sourceUrl ?? null })},
      ${buildPayloadExcerpt(input.payloadKind === 'html' ? rawPayload : extractedPayload)},
      ${JSON.stringify(rawPayload)}::jsonb,
      ${JSON.stringify(extractedPayload)}::jsonb,
      ${input.decision.publishable ? 'processed' : 'quarantined'}
    )
    returning id
  `);
  const documentId = String((document.rows as any[])[0]?.id ?? '');

  const candidate = await db.execute(sql`
    insert into public.ingest_listing_candidates (
      document_id,
      source_id,
      source_domain,
      source_url,
      canonical_url,
      external_item_id,
      product_name,
      normalized_name,
      barcode_normalized,
      category_hint,
      subcategory_hint,
      taxonomy_hint,
      match_kind,
      matched_product_id,
      identity_confidence,
      taxonomy_confidence,
      price_confidence,
      category_conflict,
      taxonomy_conflict,
      publish_blocked,
      publish_status,
      publish_reason,
      publish_reasons,
      gate_version
    ) values (
      ${documentId}::uuid,
      ${sourceId}::uuid,
      ${input.sourceDomain},
      ${input.sourceUrl ?? null},
      ${input.canonicalUrl ?? null},
      ${input.externalItemId ?? null},
      ${input.productName},
      ${normalizeName(input.productName)},
      ${normalizeIdentifier(input.barcode) ?? null},
      ${input.categoryHint ?? null},
      ${input.subcategoryHint ?? null},
      ${input.taxonomyHint ?? null},
      ${input.match.matchKind},
      ${input.match.productId}::uuid,
      ${input.decision.identityConfidence},
      ${input.decision.taxonomyConfidence},
      ${input.decision.priceConfidence},
      ${Boolean(input.categoryConflict)},
      ${Boolean(input.taxonomyConflict)},
      ${!input.decision.publishable},
      ${input.decision.publishable ? 'approved' : 'quarantined'},
      ${input.decision.reasons[0] ?? (input.decision.publishable ? 'publication_approved' : 'publication_quarantined')},
      ${JSON.stringify(input.decision.reasons)}::jsonb,
      ${GATE_VERSION}
    )
    returning id
  `);
  const candidateId = String((candidate.rows as any[])[0]?.id ?? '');

  const decisions = [
    {
      type: 'identity',
      status: input.match.matchKind === 'url_map' || input.match.matchKind === 'identifier' ? 'approved' : 'quarantined',
      confidence: input.decision.identityConfidence,
      reason: input.match.matchKind === 'none' ? 'identity_unresolved' : input.match.matchKind,
      evidence: { match_kind: input.match.matchKind, matched_product_id: input.match.productId },
    },
    {
      type: 'taxonomy',
      status: input.categoryConflict || input.taxonomyConflict || input.decision.taxonomyConfidence < TAXONOMY_MIN_CONFIDENCE ? 'quarantined' : 'approved',
      confidence: input.decision.taxonomyConfidence,
      reason: input.taxonomyConflict ? 'taxonomy_conflict' : input.categoryConflict ? 'category_conflict' : 'taxonomy_ok',
      evidence: { category_hint: input.categoryHint ?? null, subcategory_hint: input.subcategoryHint ?? null, taxonomy_hint: input.taxonomyHint ?? null },
    },
    {
      type: 'price',
      status: input.decision.priceConfidence < PRICE_MIN_CONFIDENCE ? 'quarantined' : 'approved',
      confidence: input.decision.priceConfidence,
      reason: input.decision.priceConfidence < PRICE_MIN_CONFIDENCE ? 'price_confidence_low' : 'price_ok',
      evidence: {},
    },
    {
      type: 'publication',
      status: input.decision.publishable ? 'approved' : 'quarantined',
      confidence: Math.min(input.decision.identityConfidence, input.decision.taxonomyConfidence || 1, input.decision.priceConfidence || 1),
      reason: input.decision.reasons[0] ?? (input.decision.publishable ? 'publication_approved' : 'publication_quarantined'),
      evidence: { reasons: input.decision.reasons, gate_version: GATE_VERSION },
    },
  ] as const;

  for (const item of decisions) {
    await db.execute(sql`
      insert into public.ingest_decisions (
        candidate_id,
        decision_type,
        decision_status,
        confidence,
        reason,
        evidence,
        decider
      ) values (
        ${candidateId}::uuid,
        ${item.type},
        ${item.status},
        ${item.confidence},
        ${item.reason},
        ${JSON.stringify(item.evidence)}::jsonb,
        'system'
      )
    `);
  }

  if (input.decision.publishable) {
    await db.execute(sql`
      insert into public.catalog_publish_queue (
        candidate_id,
        target_kind,
        legacy_product_id,
        status,
        attempts,
        scheduled_at
      ) values (
        ${candidateId}::uuid,
        'legacy_product_projection',
        ${input.match.productId}::uuid,
        'pending',
        0,
        now()
      )
      on conflict (candidate_id) do update set
        legacy_product_id = excluded.legacy_product_id,
        status = 'pending',
        updated_at = now()
    `);
  }

  return { documentId, candidateId };
}

export async function markPublicationOutcome(
  db: any,
  input: { candidateId: string; legacyProductId?: string | null; status: 'published' | 'failed'; error?: string | null },
): Promise<void> {
  const publishStatus = input.status === 'published' ? 'published' : 'failed';
  await db.execute(sql`
    update public.ingest_listing_candidates
    set
      publish_blocked = ${input.status === 'published' ? false : true},
      publish_status = ${publishStatus},
      matched_product_id = coalesce(${input.legacyProductId ?? null}::uuid, matched_product_id),
      updated_at = now()
    where id = ${input.candidateId}::uuid
  `).catch(() => {});

  await db.execute(sql`
    update public.ingest_documents
    set
      status = ${input.status === 'published' ? 'published' : 'failed'},
      updated_at = now()
    where id = (
      select document_id
      from public.ingest_listing_candidates
      where id = ${input.candidateId}::uuid
    )
  `).catch(() => {});

  await db.execute(sql`
    update public.catalog_publish_queue
    set
      status = ${input.status},
      legacy_product_id = coalesce(${input.legacyProductId ?? null}::uuid, legacy_product_id),
      attempts = attempts + 1,
      last_error = ${input.error ?? null},
      processed_at = now(),
      updated_at = now()
    where candidate_id = ${input.candidateId}::uuid
  `).catch(() => {});
}
