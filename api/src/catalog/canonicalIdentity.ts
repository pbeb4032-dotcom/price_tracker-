import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';

export type CanonicalIdentityInput = {
  legacyProductId?: string | null;
  nameAr?: string | null;
  nameEn?: string | null;
  brandAr?: string | null;
  brandEn?: string | null;
  barcode?: string | null;
  taxonomyKey?: string | null;
  category?: string | null;
  sizeValue?: number | null;
  sizeUnit?: string | null;
  unit?: string | null;
  condition?: string | null;
};

export type DerivedCanonicalIdentity = {
  normalizedName: string;
  normalizedFamilyName: string;
  normalizedBrand: string | null;
  barcodeNormalized: string | null;
  sizeValue: number | null;
  sizeUnit: string | null;
  packCount: number;
  familyFingerprint: string;
  variantFingerprint: string;
  taxonomyKey: string | null;
  condition: string;
};

export type CanonicalVariantResolution = {
  variantId: string | null;
  familyId: string | null;
  legacyProductId: string | null;
  matchKind: 'identifier' | 'legacy_product' | 'fingerprint' | 'none';
  confidence: number;
};

const ARABIC_DIGITS = '\u0660\u0661\u0662\u0663\u0664\u0665\u0666\u0667\u0668\u0669';
const PERSIAN_DIGITS = '\u06F0\u06F1\u06F2\u06F3\u06F4\u06F5\u06F6\u06F7\u06F8\u06F9';
const MULTIPLY_SYMBOL = '\u00d7';

const ARABIC_LITER = '\u0644\u062A\u0631';
const ARABIC_KG_SHORT = '\u0643\u063A';
const ARABIC_KILO = '\u0643\u064A\u0644\u0648';
const ARABIC_KILOGRAM = '\u0643\u064A\u0644\u0648\u063A\u0631\u0627\u0645';
const ARABIC_G_SHORT = '\u063A';
const ARABIC_GRAM_A = '\u062C\u0631\u0627\u0645';
const ARABIC_GRAM_B = '\u063A\u0631\u0627\u0645';
const ARABIC_ML = '\u0645\u0644';
const ARABIC_PIECE_A = '\u0642\u0637\u0639\u0647';
const ARABIC_PIECE_B = '\u0642\u0637\u0639\u0629';
const ARABIC_ITEM_A = '\u062D\u0628\u0647';
const ARABIC_ITEM_B = '\u062D\u0628\u0629';
const ARABIC_COUNT = '\u0639\u062F\u062F';

const SIZE_UNITS_PATTERN = [
  'ml',
  ARABIC_ML,
  'l',
  'liter',
  'litre',
  ARABIC_LITER,
  'kg',
  ARABIC_KG_SHORT,
  ARABIC_KILO,
  ARABIC_KILOGRAM,
  'g',
  ARABIC_G_SHORT,
  ARABIC_GRAM_A,
  ARABIC_GRAM_B,
].join('|');

const PACK_UNITS_PATTERN = [
  'pcs',
  'pieces',
  'pack',
  'packs',
  ARABIC_PIECE_A,
  ARABIC_PIECE_B,
  ARABIC_ITEM_A,
  ARABIC_ITEM_B,
  ARABIC_COUNT,
].join('|');

const SIZE_PATTERNS = [
  new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(${[
    'ml',
    ARABIC_ML,
    'l',
    'liter',
    'litre',
    ARABIC_LITER,
  ].join('|')})\\b`, 'i'),
  new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(${[
    'kg',
    ARABIC_KG_SHORT,
    ARABIC_KILO,
    ARABIC_KILOGRAM,
    'g',
    ARABIC_G_SHORT,
    ARABIC_GRAM_A,
    ARABIC_GRAM_B,
  ].join('|')})\\b`, 'i'),
];

const COMBINED_PACK_SIZE_PATTERN = new RegExp(
  `\\b\\d{1,3}\\s*(?:x|${MULTIPLY_SYMBOL})\\s*\\d+(?:\\.\\d+)?\\s*(?:${SIZE_UNITS_PATTERN}|${PACK_UNITS_PATTERN})\\b`,
  'giu',
);

const BARE_SIZE_PATTERN = new RegExp(
  `\\b\\d+(?:\\.\\d+)?\\s*(?:${SIZE_UNITS_PATTERN})\\b`,
  'giu',
);

const BARE_PACK_PATTERN = new RegExp(
  `\\b\\d{1,3}\\s*(?:${PACK_UNITS_PATTERN})\\b`,
  'giu',
);

const PACK_MULTIPLIER_PATTERN = new RegExp(
  `\\b(\\d{1,3})\\s*(?:x|${MULTIPLY_SYMBOL})\\s*\\d`,
  'i',
);

function sha(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function normalizeDigits(value: string): string {
  return String(value ?? '')
    .replace(/[\u0660-\u0669]/g, (d) => String(ARABIC_DIGITS.indexOf(d)))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(PERSIAN_DIGITS.indexOf(d)));
}

export function normalizeCatalogText(value: unknown): string {
  return normalizeDigits(String(value ?? ''))
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[\u0623\u0625\u0622]/g, '\u0627')
    .replace(/\u0649/g, '\u064A')
    .replace(/\u0624/g, '\u0648')
    .replace(/\u0626/g, '\u064A')
    .replace(/\u0629/g, '\u0647')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeCatalogIdentifier(value: unknown): string | null {
  const normalized = normalizeDigits(String(value ?? ''))
    .trim()
    .replace(/[^0-9A-Za-z]+/g, '');
  return normalized.length >= 6 ? normalized : null;
}

export function normalizeCatalogUnit(value: unknown): string | null {
  const raw = normalizeCatalogText(value);
  if (!raw) return null;

  if ([ARABIC_ML, 'ml'].includes(raw)) return 'ml';
  if ([ARABIC_LITER, 'l', 'liter', 'litre'].includes(raw)) return 'L';
  if ([ARABIC_G_SHORT, ARABIC_GRAM_A, ARABIC_GRAM_B, 'g'].includes(raw)) return 'g';
  if ([ARABIC_KG_SHORT, ARABIC_KILO, ARABIC_KILOGRAM, 'kg'].includes(raw)) return 'kg';
  if ([ARABIC_PIECE_A, ARABIC_PIECE_B, ARABIC_ITEM_A, ARABIC_ITEM_B, ARABIC_COUNT, 'pcs', 'pieces'].includes(raw)) {
    return 'pcs';
  }

  return raw;
}

export function extractPackCount(value: unknown): number {
  const text = normalizeCatalogText(value);
  if (!text) return 1;

  const xMatch = text.match(PACK_MULTIPLIER_PATTERN);
  if (xMatch?.[1]) return Math.max(1, Number(xMatch[1]));

  const packMatch = text.match(
    new RegExp(`\\b(?:pack|packs|pcs|pieces|${PACK_UNITS_PATTERN})\\s*(?:of\\s*)?(\\d{1,3})\\b`, 'iu'),
  );
  if (packMatch?.[1]) return Math.max(1, Number(packMatch[1]));

  const trailingMatch = text.match(
    new RegExp(`\\b(\\d{1,3})\\s*(?:${PACK_UNITS_PATTERN})\\b`, 'iu'),
  );
  if (trailingMatch?.[1]) return Math.max(1, Number(trailingMatch[1]));

  return 1;
}

export function extractSize(value: unknown): { value: number; unit: string } | null {
  const raw = normalizeDigits(String(value ?? ''));
  if (!raw) return null;

  for (const pattern of SIZE_PATTERNS) {
    const match = raw.match(pattern);
    if (!match?.[1] || !match?.[2]) continue;
    const num = Number(match[1]);
    if (!Number.isFinite(num) || num <= 0) continue;
    const unit = normalizeCatalogUnit(match[2]);
    if (!unit) continue;
    return { value: num, unit };
  }

  return null;
}

export function stripVariantSizeTokens(value: unknown): string {
  let text = normalizeCatalogText(value);
  if (!text) return '';

  text = text.replace(COMBINED_PACK_SIZE_PATTERN, ' ');
  text = text.replace(BARE_SIZE_PATTERN, ' ');
  text = text.replace(BARE_PACK_PATTERN, ' ');
  text = text.replace(new RegExp(`\\b\\d{1,3}\\s*(?:x|${MULTIPLY_SYMBOL})\\b`, 'giu'), ' ');

  return text.replace(/\s+/g, ' ').trim();
}

function normalizedBrand(input: CanonicalIdentityInput): string | null {
  const direct = normalizeCatalogText(input.brandAr ?? input.brandEn ?? '');
  return direct || null;
}

function taxonomyRoot(input: CanonicalIdentityInput): string {
  const key = String(input.taxonomyKey ?? '').trim();
  if (key) return key;
  const category = normalizeCatalogText(input.category ?? '');
  return category || 'general';
}

export function deriveCanonicalIdentity(input: CanonicalIdentityInput): DerivedCanonicalIdentity {
  const rawName = String(input.nameAr ?? input.nameEn ?? '').trim();
  const normalizedName = normalizeCatalogText(rawName);
  const normalizedFamilyName = stripVariantSizeTokens(rawName) || normalizedName;
  const normalizedBrandValue = normalizedBrand(input);
  const barcodeNormalized = normalizeCatalogIdentifier(input.barcode);

  let sizeValue = input.sizeValue != null ? Number(input.sizeValue) : null;
  let sizeUnit = normalizeCatalogUnit(input.sizeUnit ?? input.unit ?? null);
  if ((sizeValue == null || !sizeUnit) && rawName) {
    const parsedSize = extractSize(rawName);
    if (parsedSize) {
      sizeValue = sizeValue ?? parsedSize.value;
      sizeUnit = sizeUnit ?? parsedSize.unit;
    }
  }

  const packCount = extractPackCount(rawName);
  const condition = normalizeCatalogText(input.condition ?? 'new') || 'new';
  const taxonomy = taxonomyRoot(input);

  const familyFingerprint = sha([
    normalizedFamilyName || normalizedName,
    normalizedBrandValue ?? '',
    taxonomy,
  ].join('|'));

  const variantFingerprint = barcodeNormalized
    ? `barcode:${barcodeNormalized}`
    : sha([
        familyFingerprint,
        sizeValue != null ? String(sizeValue) : '',
        sizeUnit ?? '',
        String(packCount),
        condition,
      ].join('|'));

  return {
    normalizedName,
    normalizedFamilyName,
    normalizedBrand: normalizedBrandValue,
    barcodeNormalized,
    sizeValue,
    sizeUnit,
    packCount,
    familyFingerprint,
    variantFingerprint,
    taxonomyKey: taxonomy === 'general' ? null : taxonomy,
    condition,
  };
}

export async function resolveCanonicalVariant(
  db: any,
  input: CanonicalIdentityInput,
): Promise<CanonicalVariantResolution> {
  const derived = deriveCanonicalIdentity(input);

  if (input.legacyProductId) {
    const byLegacy = await db.execute(sql`
      select
        v.id,
        v.family_id,
        l.legacy_product_id
      from public.catalog_variant_legacy_links l
      join public.catalog_product_variants v on v.id = l.variant_id
      where l.legacy_product_id = ${String(input.legacyProductId)}::uuid
      order by l.is_anchor desc, l.updated_at desc nulls last, l.created_at desc
      limit 1
    `).catch(() => ({ rows: [] as any[] }));
    const legacy = (byLegacy.rows as any[])[0] ?? null;
    if (legacy) {
      return {
        variantId: String(legacy.id),
        familyId: String(legacy.family_id),
        legacyProductId: String(legacy.legacy_product_id),
        matchKind: 'legacy_product',
        confidence: 0.99,
      };
    }
  }

  if (derived.barcodeNormalized) {
    const byIdentifier = await db.execute(sql`
      select
        v.id,
        v.family_id,
        coalesce(link.legacy_product_id, v.legacy_anchor_product_id) as legacy_product_id
      from public.catalog_variant_identifiers i
      join public.catalog_product_variants v on v.id = i.variant_id
      left join lateral (
        select legacy_product_id
        from public.catalog_variant_legacy_links l
        where l.variant_id = v.id
        order by l.is_anchor desc, l.updated_at desc nulls last, l.created_at desc
        limit 1
      ) link on true
      where i.id_value_normalized = ${derived.barcodeNormalized}
      order by i.is_primary desc, i.confidence desc, v.updated_at desc nulls last, v.created_at desc
      limit 1
    `).catch(() => ({ rows: [] as any[] }));
    const identifier = (byIdentifier.rows as any[])[0] ?? null;
    if (identifier) {
      return {
        variantId: String(identifier.id),
        familyId: String(identifier.family_id),
        legacyProductId: identifier.legacy_product_id ? String(identifier.legacy_product_id) : null,
        matchKind: 'identifier',
        confidence: 0.995,
      };
    }
  }

  const byFingerprint = await db.execute(sql`
    select
      v.id,
      v.family_id,
      coalesce(link.legacy_product_id, v.legacy_anchor_product_id) as legacy_product_id
    from public.catalog_product_variants v
    left join lateral (
      select legacy_product_id
      from public.catalog_variant_legacy_links l
      where l.variant_id = v.id
      order by l.is_anchor desc, l.updated_at desc nulls last, l.created_at desc
      limit 1
    ) link on true
    where v.fingerprint = ${derived.variantFingerprint}
    order by v.updated_at desc nulls last, v.created_at desc
    limit 1
  `).catch(() => ({ rows: [] as any[] }));
  const fingerprint = (byFingerprint.rows as any[])[0] ?? null;
  if (fingerprint) {
    return {
      variantId: String(fingerprint.id),
      familyId: String(fingerprint.family_id),
      legacyProductId: fingerprint.legacy_product_id ? String(fingerprint.legacy_product_id) : null,
      matchKind: 'fingerprint',
      confidence: 0.93,
    };
  }

  return {
    variantId: null,
    familyId: null,
    legacyProductId: null,
    matchKind: 'none',
    confidence: 0,
  };
}
