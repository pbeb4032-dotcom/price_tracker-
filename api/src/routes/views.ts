import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { getDb, type Env } from '../db';
import type { AppAuthContext } from '../auth/appUser';
import { inferCategoryKeyDetailed } from '../ingestion/categoryInfer';
import { buildNameSearchTokens, fetchOpenFoodFactsProduct, inferIdentifierType, normalizeIdentifierValue, normalizeSearchText } from '../catalog/identifierResolver';
import { parseBarcodeInput, resolveBarcodeLookup } from '../catalog/barcodeResolution';
import { pickOfferDelivery as rankDelivery, pickOfferPrice as rankPrice, rankOfferRow, rankOfferRows, scoreProductRow } from '../catalog/offerRanking';

type Ctx = { Bindings: Env; Variables: { auth: AppAuthContext | null } };

export const viewRoutes = new Hono<Ctx>();

// ✅ Force UTF-8 for legacy clients (Windows PowerShell 5.1 often mis-decodes JSON without charset)
viewRoutes.use('*', async (c, next) => {
  await next();
  c.header('Content-Type', 'application/json; charset=utf-8');
});

const clampInt = (value: string | undefined, fallback: number, min: number, max: number) => {
  const n = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};

const asNum = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

const asBool = (v: unknown): boolean => {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return ['true', '1', 'yes', 'y', 'available', 'in_stock', 'in-stock'].includes(v.toLowerCase());
  return false;
};

const parseCodeFromText = (raw: string | null | undefined): { code: string | null; source: string; candidates: string[] } => {
  const text = String(raw ?? '').trim();
  if (!text) return { code: null, source: 'empty', candidates: [] };

  const candidates = new Set<string>();
  const pushCandidate = (s: string) => {
    const normalized = s
      .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
      .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
      .replace(/[^0-9A-Za-z_-]/g, '');
    if (normalized.length >= 8) candidates.add(normalized);
  };

  const direct = text
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .trim();
  if (/^[0-9A-Za-z_-]{8,32}$/.test(direct)) pushCandidate(direct);

  try {
    const url = new URL(text);
    for (const key of ['code', 'barcode', 'ean', 'upc', 'sku', 'id']) {
      const value = url.searchParams.get(key);
      if (value) pushCandidate(value);
    }
    for (const segment of url.pathname.split('/')) {
      if (/^[0-9]{8,14}$/.test(segment)) pushCandidate(segment);
    }
    if (url.hash) {
      const hash = url.hash.replace(/^#/, '');
      for (const part of hash.split(/[?&/]/)) {
        if (/^[0-9]{8,14}$/.test(part)) pushCandidate(part);
      }
    }
  } catch {
    // not a URL
  }

  const numericMatches = text.match(/[0-9٠-٩۰-۹]{8,14}/g) ?? [];
  for (const match of numericMatches) pushCandidate(match);

  const all = Array.from(candidates);
  const preferred = all.find((x) => /^\d{8,14}$/.test(x)) ?? all[0] ?? null;
  return { code: preferred, source: preferred ? 'parsed' : 'unresolved', candidates: all };
};


type ResolvedProductPayload = {
  product: Record<string, unknown> | null;
  matchType: 'identifier' | 'barcode' | 'alias' | 'external' | 'none';
  identifierType: string | null;
  confidence: number;
};

async function lookupInternalProductByCode(db: any, rawCode: string): Promise<ResolvedProductPayload> {
  const code = normalizeIdentifierValue(rawCode);
  if (!code) return { product: null, matchType: 'none', identifierType: null, confidence: 0 };
  const identifierType = inferIdentifierType(code, rawCode);

  const hasIdentifiers = await db.execute(sql`
    select exists(
      select 1
      from information_schema.tables
      where table_schema='public'
        and table_name='product_identifiers'
    ) as ok
  `).then((r: any) => Boolean((r.rows as any[])[0]?.ok)).catch(() => false);

  if (hasIdentifiers) {
    const byIdentifier = await db.execute(sql`
      select p.*, pi.id_type, pi.source as identifier_source, pi.confidence as identifier_confidence
      from public.product_identifiers pi
      join public.products p on p.id = pi.product_id
      where pi.id_value_normalized = ${code}
        and (pi.id_type = ${identifierType} or ${identifierType} in ('unknown','barcode') or pi.id_type in ('barcode','gtin','ean','upc'))
      order by pi.is_primary desc, pi.confidence desc, p.updated_at desc nulls last, p.created_at desc
      limit 5
    `).catch(() => ({ rows: [] as any[] }));
    const product = ((byIdentifier.rows as Record<string, unknown>[]) ?? [])[0] ?? null;
    if (product) {
      return {
        product,
        matchType: 'identifier',
        identifierType: String((product as any).id_type ?? identifierType),
        confidence: Number((product as any).identifier_confidence ?? 1),
      };
    }
  }

  const byBarcode = await db.execute(sql`
    select p.*
    from public.products p
    where regexp_replace(coalesce(p.barcode,''), '[^0-9A-Za-z]+', '', 'g') = ${code}
    order by p.updated_at desc nulls last, p.created_at desc
    limit 5
  `).catch(() => ({ rows: [] as any[] }));
  const barcodeProduct = ((byBarcode.rows as Record<string, unknown>[]) ?? [])[0] ?? null;
  if (barcodeProduct) return { product: barcodeProduct, matchType: 'barcode', identifierType, confidence: 0.98 };

  const aliasProductRes = await db.execute(sql`
    select p.*
    from public.products p
    where exists (
      select 1
      from public.product_aliases pa
      where pa.product_id = p.id
        and regexp_replace(coalesce(pa.alias_name,''), '[^0-9A-Za-z]+', '', 'g') = ${code}
    )
    order by p.updated_at desc nulls last, p.created_at desc
    limit 5
  `).catch(() => ({ rows: [] as any[] }));
  const aliasProduct = ((aliasProductRes.rows as Record<string, unknown>[]) ?? [])[0] ?? null;
  if (aliasProduct) return { product: aliasProduct, matchType: 'alias', identifierType, confidence: 0.72 };

  return { product: null, matchType: 'none', identifierType, confidence: 0 };
}

async function fetchOffersForProduct(db: any, productId: string, regionId: string | null | undefined, limitOffers: number) {
  const conds: any[] = [sql`product_id = ${productId}`];
  if (regionId) conds.push(sql`region_id = ${regionId}`);
  const where = sql`where ${sql.join(conds, sql` and `)}`;
  const offersResult = await db.execute(sql`
    select *
    from public.v_product_all_offers
    ${where}
    order by final_price asc nulls last, observed_at desc nulls last
    limit ${limitOffers}
  `).catch(() => ({ rows: [] as any[] }));
  return (offersResult.rows ?? []) as Record<string, unknown>[];
}

async function searchOffersByExternalCatalog(db: any, external: { name?: string | null; brand?: string | null; quantity?: string | null }, regionId: string | null | undefined, limitOffers: number) {
  const tokens = buildNameSearchTokens(external);
  if (!tokens.length) return [] as Record<string, unknown>[];
  const pattern = `%${tokens[0]}%`;
  const domainCond = regionId ? sql`and v.region_id = ${regionId}` : sql``;
  const rows = await db.execute(sql`
    select v.*, p.taxonomy_key
    from public.v_product_all_offers v
    join public.products p on p.id = v.product_id
    where (
      ${sql.join(tokens.map((t) => sql`coalesce(v.product_name_ar,'') ilike ${`%${t}%`} or coalesce(v.product_name_en,'') ilike ${`%${t}%`} or coalesce(v.brand_ar,'') ilike ${`%${t}%`} or coalesce(v.brand_en,'') ilike ${`%${t}%`}`), sql` or `)}
      or coalesce(v.product_name_ar,'') ilike ${pattern}
      or coalesce(v.product_name_en,'') ilike ${pattern}
    )
    ${domainCond}
    order by v.final_price asc nulls last, v.observed_at desc nulls last
    limit ${Math.max(limitOffers, 20)}
  `).catch(() => ({ rows: [] as any[] }));

  const scored = ((rows.rows ?? []) as Record<string, unknown>[])
    .map((row) => {
      const hay = normalizeSearchText([
        row.product_name_ar,
        row.product_name_en,
        row.brand_ar,
        row.brand_en,
        row.size_value,
        row.size_unit,
      ].filter(Boolean).join(' '));
      let score = 0;
      for (const token of tokens) if (hay.includes(token)) score += 1;
      const brand = normalizeSearchText(external.brand);
      if (brand && hay.includes(brand)) score += 2;
      const qty = normalizeSearchText(external.quantity);
      if (qty && hay.includes(qty)) score += 1;
      return { ...row, match_confidence: Math.min(0.95, 0.35 + score * 0.12) };
    })
    .filter((row: any) => Number(row.match_confidence ?? 0) >= 0.47)
    .sort((a: any, b: any) => {
      const conf = Number(b.match_confidence ?? 0) - Number(a.match_confidence ?? 0);
      if (conf !== 0) return conf;
      return Number(a.final_price ?? Number.MAX_SAFE_INTEGER) - Number(b.final_price ?? Number.MAX_SAFE_INTEGER);
    })
    .slice(0, limitOffers);

  return scored;
}

function summariseExternalCheapest(offers: Record<string, unknown>[]) {
  if (!offers.length) return null;
  const best = offers[0] as any;
  return {
    product_id: best.product_id ?? null,
    final_price: best.final_price ?? null,
    merchant_name: best.merchant_name ?? best.source_name_ar ?? null,
    source_domain: best.source_domain ?? null,
    source_url: best.source_url ?? null,
    match_confidence: best.match_confidence ?? null,
    observed_at: best.observed_at ?? null,
  };
}

const pickPrice = rankPrice;

const pickDelivery = rankDelivery;

const pickTrust = (row: Record<string, unknown>): number => {
  const direct = asNum(row.trust_score) ?? asNum(row.confidence_score) ?? asNum(row.match_confidence);
  if (direct != null) return Math.min(1, Math.max(0, direct > 1 ? direct / 100 : direct));
  let score = 0.4;
  if (asBool(row.is_price_trusted)) score += 0.25;
  if (asBool(row.is_verified) || asBool(row.store_is_verified)) score += 0.2;
  if (asBool(row.in_stock) || asBool(row.is_in_stock)) score += 0.1;

  const pc = asNum(row.price_confidence);
  if (pc != null) score = Math.max(score, Math.min(1, Math.max(0, pc)));

  const crowdPenalty = asNum(row.crowd_penalty) ?? 0;
  if (crowdPenalty > 0) score = Math.max(0, score - Math.min(0.5, crowdPenalty * 0.8));

  return Math.min(1, score);
};

const pickFreshnessScore = (row: Record<string, unknown>): number => {
  const ts = (row.last_seen_at ?? row.observed_at ?? row.created_at) as string | undefined;
  if (!ts) return 0.4;
  const ms = Date.parse(ts);
  if (!Number.isFinite(ms)) return 0.4;
  const ageHours = Math.max(0, (Date.now() - ms) / 36e5);
  if (ageHours <= 6) return 1;
  if (ageHours <= 24) return 0.9;
  if (ageHours <= 72) return 0.75;
  if (ageHours <= 168) return 0.55;
  return 0.35;
};

const pickAvailabilityScore = (row: Record<string, unknown>): number => {
  const status = String(row.availability_status ?? '').toLowerCase();
  if (status.includes('out')) return 0.1;
  if (status.includes('limited')) return 0.6;
  if (status.includes('in')) return 1;
  if (asBool(row.in_stock) || asBool(row.is_in_stock)) return 1;
  return 0.5;
};

const scoreOffer = (row: Record<string, unknown>, cheapestPrice: number | null) => {
  const price = pickPrice(row);
  const delivery = pickDelivery(row);
  const effectivePrice = price == null ? null : Math.max(0, price + Math.max(0, delivery));
  const trust = pickTrust(row);
  const freshness = pickFreshnessScore(row);
  const availability = pickAvailabilityScore(row);
  const priceScore = cheapestPrice && effectivePrice ? Math.min(1, cheapestPrice / effectivePrice) : 0;
  const suspicious = asBool(row.is_price_anomaly) || asBool(row.is_suspected) || asBool(row.is_price_suspected);
  const deliveryImpact = effectivePrice && effectivePrice > 0 ? Math.min(1, Math.max(0, delivery) / effectivePrice) : 0;
  const suspiciousPenalty = suspicious ? 0.18 : 0;
  const deliveryPenalty = deliveryImpact >= 0.35 ? 0.07 : 0;

  const total = Number(
    Math.max(0, (priceScore * 0.45 + trust * 0.25 + freshness * 0.15 + availability * 0.15) - suspiciousPenalty - deliveryPenalty).toFixed(4),
  );

  const reasons: string[] = [];
  if (priceScore >= 0.95) reasons.push('أفضل سعر فعلي تقريبًا');
  else if (priceScore >= 0.8) reasons.push('سعر منافس');
  else if (effectivePrice != null) reasons.push('السعر أعلى من البدائل');
  if (delivery > 0) reasons.push(`رسوم توصيل: ${Math.round(delivery)} د.ع`);
  if (deliveryImpact >= 0.35) reasons.push('التوصيل يأثر بقوة على الإجمالي');
  if (trust >= 0.8) reasons.push('موثوقية عالية');
  if (freshness >= 0.8) reasons.push('تحديث حديث');
  if (suspicious) reasons.push('تنبيه: السعر مشتبه ويحتاج مراجعة');
  if (availability < 0.5) reasons.push('توفر ضعيف/غير مؤكد');

  return {
    effectivePrice,
    breakdown: {
      priceScore: Number(priceScore.toFixed(4)),
      trust: Number(trust.toFixed(4)),
      freshness: Number(freshness.toFixed(4)),
      availability: Number(availability.toFixed(4)),
      suspiciousPenalty: Number(suspiciousPenalty.toFixed(4)),
      deliveryPenalty: Number(deliveryPenalty.toFixed(4)),
      total,
    },
    suspicious,
    reasons,
  };
};

const scoreProduct = (bestOfferRow: Record<string, unknown> | null, offerCount: number) => {
  if (!bestOfferRow) {
    return {
      total: 0,
      breakdown: { price: 0, trust: 0, freshness: 0, availability: 0, coverage: 0, suspiciousPenalty: 0 },
      reasons: ['لا توجد عروض كافية للمقارنة'],
    };
  }

  const trust = pickTrust(bestOfferRow);
  const freshness = pickFreshnessScore(bestOfferRow);
  const availability = pickAvailabilityScore(bestOfferRow);
  const coverage = offerCount <= 0 ? 0 : Math.min(1, offerCount / 5);
  const suspicious = asBool(bestOfferRow.is_price_anomaly) || asBool(bestOfferRow.is_suspected) || asBool(bestOfferRow.is_price_suspected);

  const basePriceScore = asBool(bestOfferRow.is_price_trusted) ? 1 : 0.75;
  const suspiciousPenalty = suspicious ? 0.12 : 0;
  const total = Number(
    Math.max(0, (basePriceScore * 0.35 + trust * 0.25 + freshness * 0.15 + availability * 0.15 + coverage * 0.1) - suspiciousPenalty).toFixed(4),
  );

  const reasons: string[] = [];
  if (asBool(bestOfferRow.is_price_trusted)) reasons.push('أفضل سعر موثّق');
  if (trust >= 0.8) reasons.push('ثقة عالية بالعرض الأفضل');
  if (coverage >= 0.6) reasons.push('تغطية جيدة من عدة عروض');
  if (freshness >= 0.8) reasons.push('بيانات حديثة');
  if (suspicious) reasons.push('تنبيه: أفضل عرض عليه علامة اشتباه');
  if (availability < 0.5) reasons.push('توفر محدود');

  return {
    total,
    breakdown: {
      price: Number(basePriceScore.toFixed(4)),
      trust: Number(trust.toFixed(4)),
      freshness: Number(freshness.toFixed(4)),
      availability: Number(availability.toFixed(4)),
      coverage: Number(coverage.toFixed(4)),
      suspiciousPenalty: Number(suspiciousPenalty.toFixed(4)),
    },
    suspicious,
    reasons,
  };
};

// ✅ Normalize category keys coming from UI or query params
const normalizeCategoryKey = (raw: string | undefined): string | undefined => {
  const v = String(raw ?? '').trim();
  if (!v) return undefined;
  const lower = v.toLowerCase();

  const map: Record<string, string> = {
    'الكل': 'all',
    all: 'all',

    'عام': 'general',
    general: 'general',

    'أساسيات': 'essentials',
    'اساسيات': 'essentials',
    essentials: 'essentials',

    'غذائيات': 'groceries',
    grocery: 'groceries',
    groceries: 'groceries',

    'مشروبات': 'beverages',
    beverages: 'beverages',
    drink: 'beverages',
    drinks: 'beverages',

    'إلكترونيات': 'electronics',
    'الكترونيات': 'electronics',
    electronics: 'electronics',

    'تجميل وعناية': 'beauty',
    'تجميل': 'beauty',
    beauty: 'beauty',

    'أدوات منزلية': 'home',
    home: 'home',

    'ملابس': 'clothing',
    clothing: 'clothing',

    'رياضة': 'sports',
    sports: 'sports',

    'ألعاب': 'toys',
    toys: 'toys',

    'سيارات': 'automotive',
    automotive: 'automotive',

    // ✅ pets (new)
    'حيوانات': 'essentials',
    'حيوانات أليفة': 'essentials',
    'حيوانات اليفة': 'essentials',
    pets: 'essentials',
    pet: 'essentials',
  };

  return map[v] ?? map[lower] ?? lower;
};

// Grocery subcategory keys used by DB/UI.
// Accepts Arabic labels and common variants.
const normalizeGrocerySubcategoryKey = (raw: string | undefined): string | undefined => {
  const v = String(raw ?? '').trim();
  if (!v) return undefined;
  const lower = v.toLowerCase();
  const map: Record<string, string> = {
    all: 'all',
    'الكل': 'all',

    grains: 'grains',
    'حبوب': 'grains',
    'حبوب ورز': 'grains',
    'رز': 'grains',
    'رز وحبوب': 'grains',

    dairy: 'dairy',
    'ألبان': 'dairy',
    'البان': 'dairy',
    'حليب': 'dairy',
    'أجبان': 'dairy',
    'اجبان': 'dairy',

    meat: 'meat',
    'لحوم': 'meat',
    'دواجن': 'meat',
    'لحوم ودواجن': 'meat',

    produce: 'produce',
    'خضار': 'produce',
    'فواكه': 'produce',
    'خضار وفواكه': 'produce',

    oils: 'oils',
    'زيوت': 'oils',
    'سمن': 'oils',
    'زيوت وسمن': 'oils',

    spices: 'spices',
    'بهارات': 'spices',
    'توابل': 'spices',
    'بهارات وتوابل': 'spices',

    canned: 'canned',
    'معلبات': 'canned',
    'مؤن': 'canned',
    'معلبات ومؤن': 'canned',

    snacks: 'snacks',
    'تسالي': 'snacks',
    'حلويات': 'snacks',
    'تسالي وحلويات': 'snacks',

    breakfast: 'breakfast',
    'فطور': 'breakfast',
    'حبوب افطار': 'breakfast',
    'حبوب إفطار': 'breakfast',

    frozen: 'frozen',
    'مجمدات': 'frozen',
    'مجمد': 'frozen',

    bakery: 'bakery',
    'مخبوزات': 'bakery',
    'خبز': 'bakery',
  };
  return map[lower] ?? lower;
};

// ✅ read category from multiple possible param names (front-end may change it)
const readCategoryParam = (c: any): string | undefined => {
  return (
    c.req.query('category') ??
    c.req.query('cat') ??
    c.req.query('categoryKey') ??
    c.req.query('category_key') ??
    c.req.query('categoryId') ??
    c.req.query('categoryName') ??
    c.req.query('category_name') ??
    undefined
  );
};

// =========================
// ✅ PATTERNS (no empty alternatives "||")
// =========================

const PAT_PETS =
  '(pet|pets|cat|cats|dog|dogs|kitten|puppy|litter|litter\\s*box|cat\\s*food|dog\\s*food|pet\\s*food|scratching\\s*post|scratch\\s*post|collar|leash|' +
  'قطط?|قطه|قطة|كلاب?|حيوان(ات)?\\s*(أليفة|اليفة)?|طعام\\s*(ل)?(لقطط|للقطط|للقط|للكلاب)|طعام\\s*جاف\\s*لل?قطط|رمل\\s*قطط?|فضلات\\s*القطط|صندوق\\s*فضلات|بيت\\s*مرحاض\\s*لل?قطط|مجرفة\\s*فضلات|مقود|طوق)';

const PAT_ELECTRONICS =
  '(laptop|notebook|\\bpc\\b|computer|monitor|\\btv\\b|phone|iphone|samsung|android|tablet|ipad|smartwatch|' +
  'earbuds|headphones?|earphone(s)?|charger|cable|usb|router|modem|\\bssd\\b|\\bhdd\\b|camera|printer|playstation|ps5|xbox|' +
  'aqara|hub\\b|switch\\b|sensor\\b|leak\\s*sensor|wireless\\s*switch|' +
  'cooler\\b|argb\\b|rgb\\b|liquid\\s*freeze|\\bcpu\\b|\\bgpu\\b|\\bram\\b|motherboard\\b|\\bpsu\\b|\\bcase\\b|' +
  'لابتوب|كمبيوتر|حاسب|شاش[هة]|تلفزيون|موبايل|هاتف|تابلت|ايباد|ساع[هة]\\s*ذكي[هة]|سماعه|سماعة|سماعات|شاحن|كيبل|راوتر|مودم|كاميرا|طابع[هة]|' +
  'بلايستيشن|اكس\\s*بوكس|مستشعر|حساس|هاب|سويتش)';

const PAT_BEAUTY =
  '(soap|shampoo|conditioner|mask|maske|serum|lotion|body\\s*lotion|cream\\b|cleanser|cleansing\\s*gel|gel\\s*cleanser|toner|scrub|' +
  'micellar\\s*water|micellar|cleansing\\s*foam|foam\\s*cleanser|' +
  'treatment\\b|hair\\s*treatment|leave[-\\s]?in|bond(ing)?\\b|' +
  'deodorant|\\bdeo\\b|deo\\s*spray|body\\s*spray|mist\\b|body\\s*mist|hair\\s*mist|' +
  'spf|sunscreen|sun\\s*block|sunblock|' +
  'perfume|fragrance|' +
  'cosmetic|makeup|foundation|concealer|contour|primer|lipstick|lip\\s*fluid|lip\\s*tint|tint|mascara|eyeliner|blush|bronzer|powder|' +
  'eyeshadow|eye\\s*shadow|palette\\b|lash(es)?\\b|eyelash(es)?\\b|' +
  'puff|sponge|' +
  'wash\\b|hygienic|feminine|intimate\\s*wash|' +
  'nail(s)?\\b|manicure|pedicure|clipper|cutter|' +
  'comedone|blackhead|extractor|extraction\\s*device|facial\\s*tool|skin\\s*tool|' +
  'cotton\\s*pads?|toothpaste|oral\\s*care|wax\\s*strips?|hair\\s*removal|veet|' +
  'cosrx|cathy\\s*doll|baby\\s*bright|essence|dermedic|tresemme|lacura|mio\\s*skin|schaebens|rasasi|suli|kevin\\s*murphy|' +
  'night\\s*de\\s*paris|got2b|kiko\\s*milano|estee\\s*lauder|emmanuelle\\s*jane|artdeco|bourjois|flormar|dunhill|versace|hugo\\s*boss|lanvin|' +
  'صابون|شامبو|بلسم|ماسك|قناع|سيروم|لوشن|مرطب|ترطيب|' +
  'معالج\\s*(شعر|للشعر|ليف\\s*ان|ليڤ\\s*ان)?|علاج\\s*شعر|ليف\\s*ان|ليڤ\\s*ان|' +
  'كريم\\s*(لل|ل)?(وجه|الوجه|جسم|الجسم|قدم|القدم|كعب|الكعب|بشرة|البشرة)?|جل\\s*(منظف|غسول|للوجه|للبشرة)?|غسول|تونر|مقشر|' +
  'واقي\\s*شمس|عطر|عطور|مزيل\\s*العرق|مزيل\\s*عرق|بخاخ\\s*مزيل\\s*العرق|سبلاش|معطر|بودي\\s*سبراي|ميست|' +
  'مكياج|تجميل|كريم\\s*اساس|فاونديشن|خافي\\s*عيوب|كونسيلر|بودرة|اسفنجة|إسفنجة|ماسكرا|كحل|ايلاينر|' +
  'أحمر\\s*شفاه|احمر\\s*شفاه|روج|شفاه|بلاشر|كونتور|برونزر|' +
  'ظلال\\s*عيون|باليت|رموش|' +
  'نسائي|منطقة\\s*حساسة|غسول\\s*نسائي|غسول\\s*مناطق|' +
  'اظافر|أظافر|قاطع\\s*أظافر|قصاصة\\s*أظافر|مبرد\\s*أظافر|' +
  'شفط\\s*(الرؤوس\\s*السوداء|دهون)|سحب\\s*الدهون|تنظيف\\s*المسام|' +
  'قطن\\s*طبي|قطن\\s*مكياج|معجون\\s*اسنان|شمع|ازالة\\s*الشعر|فيت)';

const PAT_HOME =
  '(kitchen|cookware|pan|pot|fryer|kettle|storage|container|plastic|' +
  'grinder\\b|coffee\\s*grinder|blender|mixer|' +
  'tools?\\b|plier(s)?|wrench|spanner|screwdriver|hammer|drill|' +
  'wire\\s*brush|insulating\\s*tape|pvc\\b|tolsen|' +
  'bowl\\b|spoon\\b|feeding\\s*bowl|tip\\s*spoon|' +
  'مطبخ|قباغ|قدر|طنجرة|قوري|صحن|جدر|علب|خزين|بلاستيك|مطحنة|' +
  'عدة|ادوات|كماشة|زرادية|مفتاح|مفك|مطرقة|دريل|وعاء|ملعقة|شريط\\s*عزل)';

const PAT_CLOTHING =
  '(t-?shirt|tee\\b|hoodie|jacket|pants|trousers|jeans|cargo|jogger|sweatpants?|dress|skirt|' +
  'shoe|shoes|sneaker|sneakers|sock|beanie|cap|hat|slippers?|' +
  'تيشيرت|تي\\s*شيرت|هودي|جاكيت|بنطلون|بنطال|جينز|كارغو|جوكَر|فستان|تنور[هة]|حذاء|جزمة|سنيكر|جوارب|بيني|كاب|قبعة|شبشب|شباشب|نعال)';

const PAT_SPORTS =
  '(yoga|fitness|gym|workout|training|dumbbell|kettlebell|barbell|plate|weight|' +
  'resistance\\s*band|hand\\s*grip|pull[-\\s]?up|treadmill|' +
  'tennis|table\\s*tennis|squash|racket|racquet|tennis\\s*ball|squash\\s*ball|\\bgrip\\b|' +
  'basketball|football|soccer|badminton|shuttlecock|jump\\s*rope|swim|swimming|fins|' +
  'sports?\\b|' +
  'يوغا|رياض[هة]|رياضي|جيم|فتنس|تمارين|تدريب|دامبل|دمبل|كيتلبيل|باربل|اوزان|وزن|شريط\\s*مطاطي|تقوية\\s*قبضة|' +
  'تنس|كرة\\s*تنس|سكواش|سكو\\s*اش|كرة\\s*سكواش|مضرب|مضرب\\s*تنس|قبضة|' +
  'كرة\\s*سلة|كرة\\s*قدم|بدمنتن|ريشة|حبل\\s*قفز|قفز|سباحة|زعانف)';

const PAT_TOYS =
  '(toy|lego|doll|puzzle|board\\s*game|kids\\b|flash\\s*cards?|flashcards?|vocabulary\\s*cards?|cards?\\b|' +
  'لعبة|العاب|دمية|بازل|اطفال|بطاقات|مفردات|تعليمي[هة])';

const PAT_AUTOMOTIVE =
  '(engine|motor\\s*oil|oil\\s*filter|spark\\s*plug|brake|pad|battery|tire|tyre|rim|car\\s*accessory|' +
  'محرك|زيت|فلتر|بلك|فرامل|بطارية|تاير|اطار|رنج)';

// ✅ Wipes/paper/diapers: force to essentials before beauty (prevents "serum wet tissues" => beauty)
const PAT_WIPES =
  '(wet\\s*wipes?|wet\\s*tissues?|wipes?|tissues?|paper\\s*towels?|toilet\\s*paper|diaper|diapers|pampers|' +
  'مناديل\\s*مبللة|مناديل|محارم|ورق\\s*مطبخ|ورق\\s*حمام|حفاضات|حفاض|بامبرز)';

// ✅ Snacks/sweets: force to grocery
const PAT_SNACKS =
  '(chocolate|candy|biscuit|cookie|snack|chips|crisps|' +
  'شوكولاتة|حلوى|بسكويت|كوكيز|شبس|رقائق)';

// STRICT beverages: avoid broad false matches
const PAT_BEVERAGES =
  '(coffee|espresso|decaf|matcha|juice|cola|soda|energy\\s*drink|smoothie|' +
  'coffee\\s*beans?|\\bbeans?\\b|' +
  'tea\\s*(bags?|bag|leaves?|leaf|blend|box|pack|packs)|iced\\s*tea|' +
  'swiss\\s*water|mineral\\s*water|bottled\\s*water|drinking\\s*water|' +
  'قهو[هة]|قهوة|اسبريسو|ديكاف|ماتشا|عصير|مشروب|مشروبات|كولا|صودا|طاق[هة]|' +
  'شاي|بن\\b|محمص|مياه?\\s*(شرب|معدنية)|قن(ي)?نة\\s*ماء|كارتون\\s*ماء)';

const PAT_GROCERY =
  '(rice|sugar|flour|pasta|noodles|sauce|ketchup|mayo|mayonnaise|oil|vinegar|spice|spices|' +
  'honey|jam|milk|cheese|yogurt|butter|egg|eggs|meat|chicken|beef|fish|tuna|dates|nuts?|' +
  'رز|سكر|طحين|معكرونة|نودلز|صلصة|صوص|كاتشب|كچب|مايونيز|زيت|خل|بهار|توابل|' +
  'عسل|مربى|حليب|جبن|لبن|زبده|زبدة|بيض|لحم|دجاج|بقر|سمك|تونة|تمر|مكسرات)';

// ✅ Essentials tightened:
// - removed raw "انف/أنف" to avoid matching "لانفين"
// - wipes/paper/diapers moved to PAT_WIPES
const PAT_ESSENTIALS =
  '(detergent|laundry|dish\\s*soap|dishwashing|disinfectant|sanitizer|bleach|' +
  'nasal\\b|decongest|decongestant|bandage|first\\s*aid|thermometer|antiseptic|' +
  'منظفات|منظف\\s*(أرض|ارض|ملابس|مطبخ|حمام)|مطهر|معقم|كلور|' +
  'الانف|الأنف|للأنف|بالأنف|مزيل\\s*احتقان|' +
  'ضماد|اسعافات|ميزان\\s*حرارة|مطهر\\s*جروح)';

viewRoutes.get('/trusted_price_summary', async (c) => {
  const productId = c.req.query('product_id');
  const limit = clampInt(c.req.query('limit'), 200, 1, 2000);
  const db = getDb(c.env);

  if (productId) {
    const r = await db.execute(sql`select * from public.v_trusted_price_summary where product_id = ${productId}`);
    return c.json(r.rows ?? []);
  }

  const r = await db.execute(sql`select * from public.v_trusted_price_summary order by product_name_ar limit ${limit}`);
  return c.json(r.rows ?? []);
});

viewRoutes.get('/best_offers', async (c) => {
  const category = normalizeCategoryKey(readCategoryParam(c));
  const subcategory = normalizeGrocerySubcategoryKey(c.req.query('subcategory'));
  const regionId = c.req.query('region_id');
  const q = c.req.query('q')?.trim();
  const limit = clampInt(c.req.query('limit'), 50, 1, 200);
  const offset = clampInt(c.req.query('offset'), 0, 0, 100_000);
  const includeTotal = ['1', 'true', 'yes'].includes(String(c.req.query('include_total') ?? '').toLowerCase());

  // ✅ optional: show insane outliers (default off)
  const includeOutliers = ['1', 'true', 'yes'].includes(String(c.req.query('include_outliers') ?? '').toLowerCase());

  // IMPORTANT: do NOT backfill category pages from `general` by default.
  // This was a major source of cross-category pollution in Explore.
  // Opt-in only for legacy/dev comparisons.
  const includeGeneralBackfill = ['1', 'true', 'yes'].includes(String(c.req.query('include_general_backfill') ?? '').toLowerCase());
  const includeUnpublished = ['1', 'true', 'yes'].includes(String(c.req.query('include_unpublished') ?? '').toLowerCase());

  const db = getDb(c.env);


// Robust DB view execution:
// Some deployments (older DB volumes) may miss or have an invalid v_best_offers_ui view.
// We attempt UI view first, then fall back to v_best_offers with computed columns.
const execBestOffers = async (uiQuery: any, fallbackQuery: any) => {
  try {
    return await db.execute(uiQuery);
  } catch (e: any) {
    console.warn('[views/best_offers] falling back to v_best_offers:', String(e?.message ?? e));
    return await db.execute(fallbackQuery);
  }
};


  // ✅ IMPORTANT FIX:
  // - Do NOT re-classify categories in /views/best_offers using regex on product text.
  // - Always trust products.category (which is set by 3-pass inference + reclassify job).
  // This prevents "food shows socks" type pollution in the UI.
  const conds: any[] = [];
  if (category && category !== 'all') conds.push(sql`v.category = ${category}`);
  if (subcategory && subcategory !== 'all') conds.push(sql`v.subcategory = ${subcategory}`);
  if (regionId) conds.push(sql`v.region_id = ${regionId}`);
  if (!includeUnpublished) conds.push(sql`coalesce(ps.catalog_publish_enabled, true) = true`);

  if (q) {
    const like = `%${q}%`;
    conds.push(sql`(
      coalesce(v.product_name_ar, '') ilike ${like}
      or coalesce(v.product_name_en, '') ilike ${like}
      or coalesce(v.merchant_name, '') ilike ${like}
      or coalesce(v.source_domain, '') ilike ${like}
      or coalesce(v.source_url, '') ilike ${like}
    )`);
  }

  // ✅ hide insane prices if not trusted (cat products with "14700000" etc)
  if (!includeOutliers) {
    conds.push(
      sql`not (
        coalesce(v.is_price_trusted,false) = false
        and coalesce(v.final_price, v.display_price_iqd, 0)::numeric > 10000000::numeric
      )`,
    );

    // ✅ hide suspiciously low prices that usually come from parsing errors like "100.000" -> 100
    // Keep groceries/beverages flexible; apply mainly to non-food categories.
    conds.push(
      sql`not (
        coalesce(v.is_price_trusted,false) = false
        and coalesce(v.final_price, v.display_price_iqd, 0)::numeric > 0::numeric
        and coalesce(v.final_price, v.display_price_iqd, 0)::numeric < 1000::numeric
        and v.category in ('beauty','electronics','clothing','automotive','home','sports','toys')
      )`,
    );
  }

  const where = conds.length ? sql`where ${sql.join(conds, sql` and `)}` : sql``;
  const prefetchLimit = Math.min(Math.max(limit * 4, limit), 800);

let totalCount: number | null = null;
if (includeTotal) {
  const countResult = await execBestOffers(
    sql`
      select count(*)::bigint as total
      from public.v_best_offers_ui v
      join public.price_sources ps on ps.id = v.source_id
      ${where}
    `,
    sql`
      select count(*)::bigint as total
      from public.v_best_offers v
      join public.price_sources ps on ps.id = v.source_id
      ${where}
    `,
  );
  totalCount = Number(((countResult.rows as any[]) ?? [])[0]?.total ?? 0);
}

const r = await execBestOffers(
  sql`
    select
      v.*,
      ps.certification_tier as source_certification_tier,
      coalesce(ps.quality_score, coalesce(ps.trust_weight_dynamic, ps.trust_weight, 0.50))::numeric as source_quality_score,
      coalesce(ps.catalog_publish_enabled, true) as source_publish_enabled,
      coalesce(ps.trust_weight_dynamic, ps.trust_weight, 0.50)::numeric as trust_score
    from public.v_best_offers_ui v
    join public.price_sources ps on ps.id = v.source_id
    ${where}
    order by v.is_price_trusted desc, v.display_price_iqd asc nulls last, v.last_observed_at desc nulls last
    limit ${prefetchLimit}
    offset ${offset}
  `,
  sql`
    select
      v.*,
      coalesce(v.final_price, v.discount_price, v.base_price)::numeric as display_price_iqd,
      false as is_price_trusted,
      'provisional'::text as price_quality,
      1::int as price_samples,
      null::numeric as low_price_safe,
      null::numeric as high_price_safe,
      v.product_image_url as product_image_url_safe,
      v.observed_at as last_observed_at,
      ps.certification_tier as source_certification_tier,
      coalesce(ps.quality_score, coalesce(ps.trust_weight_dynamic, ps.trust_weight, 0.50))::numeric as source_quality_score,
      coalesce(ps.catalog_publish_enabled, true) as source_publish_enabled,
      coalesce(ps.trust_weight_dynamic, ps.trust_weight, 0.50)::numeric as trust_score
    from public.v_best_offers v
    join public.price_sources ps on ps.id = v.source_id
    ${where}
    order by coalesce(v.final_price, v.discount_price, v.base_price) asc nulls last, v.observed_at desc nulls last
    limit ${prefetchLimit}
    offset ${offset}
  `,
);

  const filterOpenCategoryConflicts = async (rows: any[]) => {
    const items = Array.isArray(rows) ? rows : [];
    if (!items.length) return items;
    const ids = Array.from(new Set(items.map((x: any) => String(x?.product_id ?? '')).filter(Boolean)));
    if (!ids.length) return items;
    try {
      const rConf = await db.execute(sql`
        select product_id::text as product_id
        from public.category_conflict_quarantine
        where status = 'open'
          and product_id in (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})
      `);
      const blocked = new Set<string>(((rConf.rows as any[]) ?? []).map((x) => String(x.product_id)));
      if (!blocked.size) return items;
      return items.filter((x: any) => !blocked.has(String(x?.product_id ?? '')));
    } catch {
      return items;
    }
  };

  let baseRows = await filterOpenCategoryConflicts((r.rows as any[]) ?? []);

  // Optional legacy fallback: backfill from `general` only when explicitly requested.
  // Default is OFF because it can pollute category pages with misclassified/general products.
  if (includeGeneralBackfill && category && category !== 'all' && !subcategory && baseRows.length < limit) {
    const need = limit - baseRows.length;
    const extraFetch = Math.min(need * 8, 600);

    const condsGeneral: any[] = [];
    condsGeneral.push(sql`v.category = 'general'`);
    if (regionId) condsGeneral.push(sql`v.region_id = ${regionId}`);
    if (!includeUnpublished) condsGeneral.push(sql`coalesce(ps.catalog_publish_enabled, true) = true`);
    if (q) {
      const like = `%${q}%`;
      condsGeneral.push(sql`(
        coalesce(v.product_name_ar, '') ilike ${like}
        or coalesce(v.product_name_en, '') ilike ${like}
        or coalesce(v.merchant_name, '') ilike ${like}
        or coalesce(v.source_domain, '') ilike ${like}
        or coalesce(v.source_url, '') ilike ${like}
      )`);
    }
    if (!includeOutliers) {
      condsGeneral.push(sql`not (
        coalesce(v.is_price_trusted,false) = false
        and coalesce(v.final_price, v.display_price_iqd, 0)::numeric > 10000000::numeric
      )`);
      condsGeneral.push(sql`not (
        coalesce(v.is_price_trusted,false) = false
        and coalesce(v.final_price, v.display_price_iqd, 0)::numeric > 0::numeric
        and coalesce(v.final_price, v.display_price_iqd, 0)::numeric < 1000::numeric
        and v.category in ('beauty','electronics','clothing','automotive','home','sports','toys')
      )`);
    }

    const whereGeneral = condsGeneral.length ? sql`where ${sql.join(condsGeneral, sql` and `)}` : sql``;

const r2 = await execBestOffers(
  sql`
    select
      v.*,
      ps.certification_tier as source_certification_tier,
      coalesce(ps.quality_score, coalesce(ps.trust_weight_dynamic, ps.trust_weight, 0.50))::numeric as source_quality_score,
      coalesce(ps.catalog_publish_enabled, true) as source_publish_enabled,
      coalesce(ps.trust_weight_dynamic, ps.trust_weight, 0.50)::numeric as trust_score
    from public.v_best_offers_ui v
    join public.price_sources ps on ps.id = v.source_id
    ${whereGeneral}
    order by v.is_price_trusted desc, v.display_price_iqd asc nulls last, v.last_observed_at desc nulls last
    limit ${extraFetch}
  `,
  sql`
    select
      v.*,
      coalesce(v.final_price, v.discount_price, v.base_price)::numeric as display_price_iqd,
      false as is_price_trusted,
      'provisional'::text as price_quality,
      1::int as price_samples,
      null::numeric as low_price_safe,
      null::numeric as high_price_safe,
      v.product_image_url as product_image_url_safe,
      v.observed_at as last_observed_at,
      ps.certification_tier as source_certification_tier,
      coalesce(ps.quality_score, coalesce(ps.trust_weight_dynamic, ps.trust_weight, 0.50))::numeric as source_quality_score,
      coalesce(ps.catalog_publish_enabled, true) as source_publish_enabled,
      coalesce(ps.trust_weight_dynamic, ps.trust_weight, 0.50)::numeric as trust_score
    from public.v_best_offers v
    join public.price_sources ps on ps.id = v.source_id
    ${whereGeneral}
    order by coalesce(v.final_price, v.discount_price, v.base_price) asc nulls last, v.observed_at desc nulls last
    limit ${extraFetch}
  `,
);

    const extraRows = await filterOpenCategoryConflicts(((r2.rows as any[]) ?? []));
    const taken = new Set<string>(baseRows.map((x: any) => String(x.product_id)));
    for (const row of extraRows) {
      if (baseRows.length >= limit) break;
      const pid = String(row.product_id);
      if (taken.has(pid)) continue;

      const name = [row?.product_name_ar, row?.product_name_en].filter(Boolean).join(' | ');
      const det = inferCategoryKeyDetailed({
        name,
        description: null,
        domain: String(row?.source_domain ?? '') || null,
        url: String(row?.source_url ?? '') || null,
        siteCategory: null,
      });

      // Safe gate: require strong evidence for predicted category.
      const strong = det.textScore >= 3 || det.site === category || det.domain === category;
      if (det.category === category && strong) {
        taken.add(pid);
        baseRows.push({ ...row, category });
      }
    }
  }

type CategoryBadge = 'trusted' | 'medium' | 'weak';

  const computeCategoryMeta = (row: any): { badge: CategoryBadge; confidence: number; reasons: string[]; conflict: boolean } => {
    const current = String(row?.category ?? 'general').trim() || 'general';
    const name = [row?.product_name_ar, row?.product_name_en].filter(Boolean).join(' | ');
    const domain = String(row?.source_domain ?? '').trim() || null;
    const url = String(row?.source_url ?? '').trim() || null;

    // Re-run deterministic inference (text + domain). We don't have siteCategory in this view, so keep it null.
    const det = inferCategoryKeyDetailed({ name, description: null, domain, url, siteCategory: null });

    const reasons: string[] = [];
    let conflict = false;

    if (!current || current === 'general' || current === 'all') {
      reasons.push('تصنيف عام (لا توجد دلائل كافية بعد).');
      return { badge: 'weak', confidence: 0.35, reasons, conflict: false };
    }

    if (det.category === current) {
      if (det.textScore >= 4) {
        reasons.push('النص يدعم التصنيف بقوة.');
        return { badge: 'trusted', confidence: 0.9, reasons, conflict: false };
      }
      if (det.textScore >= 2) {
        reasons.push('النص يدعم التصنيف.');
        return { badge: 'medium', confidence: 0.7, reasons, conflict: false };
      }
      if (det.domain !== 'general' && det.domain === current) {
        reasons.push('الدومين متخصص ويدعم التصنيف.');
        return { badge: 'medium', confidence: 0.65, reasons, conflict: false };
      }
      reasons.push('دلائل النص ضعيفة، لكن التصنيف مثبت من قاعدة البيانات.');
      return { badge: 'weak', confidence: 0.5, reasons, conflict: false };
    }

    // Mismatch between stored category and deterministic inference from name/domain
    if (det.category !== 'general' && det.textScore >= 2) {
      conflict = true;
      reasons.push(`تنبيه: النص يشير إلى "${det.category}" أكثر من "${current}".`);
      reasons.push('قد تحتاج إعادة تصنيف (reclassify job) أو مراجعة المصدر.');
      return { badge: 'weak', confidence: 0.35, reasons, conflict };
    }

    // No strong evidence to override, treat as weak but not conflict.
    reasons.push('دلائل غير كافية لتأكيد التصنيف.');
    return { badge: 'weak', confidence: 0.45, reasons, conflict: false };
  };

  const rows = (baseRows ?? []).map((row) => {
    const normalized = normalizeCategoryKey(String(row.category ?? 'general')) ?? 'general';
    const meta = computeCategoryMeta({ ...row, category: normalized });
    return {
      ...row,
      category: normalized,
      category_badge: meta.badge,
      category_confidence: meta.confidence,
      category_reasons: meta.reasons,
      category_conflict: meta.conflict,
    };
  });
  const rankedRows = rankOfferRows(rows as Record<string, unknown>[], { includeUnpublished, limit });

  c.header('X-Limit', String(limit));
  c.header('X-Offset', String(offset));
  if (includeTotal && totalCount != null) c.header('X-Total-Count', String(totalCount));
  return c.json(rankedRows);
});


viewRoutes.get('/product_offers', async (c) => {
  const productId = c.req.query('product_id');
  if (!productId) return c.json({ error: 'product_id required' }, 400);
  const includeUnpublished = ['1', 'true', 'yes'].includes(String(c.req.query('include_unpublished') ?? '').toLowerCase());
  const db = getDb(c.env);

  const r = await db.execute(sql`
    select
      o.*,
      coalesce(ps.trust_weight_dynamic, ps.trust_weight, 0.50)::numeric(3,2) as trust_score,
      ps.certification_tier as source_certification_tier,
      coalesce(ps.quality_score, coalesce(ps.trust_weight_dynamic, ps.trust_weight, 0.50))::numeric as source_quality_score,
      coalesce(ps.catalog_publish_enabled, true) as source_publish_enabled,
      coalesce(a.reports_total,0)::int as crowd_reports_total,
      coalesce(a.wrong_price,0)::int as crowd_wrong_price,
      coalesce(a.unavailable,0)::int as crowd_unavailable,
      coalesce(a.duplicate,0)::int as crowd_duplicate,
      coalesce(a.other,0)::int as crowd_other,
      coalesce(a.penalty,0)::numeric(3,2) as crowd_penalty,
      a.last_reported_at as crowd_last_reported_at,
      greatest(0, least(1, coalesce(o.price_confidence, 0.50) - coalesce(a.penalty,0)))::numeric(3,2) as price_confidence,
      to_jsonb(array_remove(array[
        case when coalesce(a.reports_total,0) > 0 then 'بلاغات المستخدمين: ' || coalesce(a.reports_total,0)::text end,
        case when coalesce(a.wrong_price,0) >= 3 then 'تم الإبلاغ عن سعر خاطئ عدة مرات' end,
        case when coalesce(a.unavailable,0) >= 3 then 'تم الإبلاغ أنه غير متوفر' end,
        case when coalesce(o.is_price_anomaly,false) then coalesce('اشتباه آلي: ' || nullif(o.anomaly_reason,''), 'اشتباه آلي') end
      ], null)) as confidence_reasons,
      (
        coalesce(o.is_price_anomaly,false)
        or coalesce(a.penalty,0) >= 0.25
        or coalesce(a.wrong_price,0) >= 3
      ) as is_price_suspected,
      case
        when (coalesce(o.is_price_anomaly,false) or coalesce(a.penalty,0) >= 0.25 or coalesce(a.wrong_price,0) >= 3) then 'suspected'
        when greatest(0, least(1, coalesce(o.price_confidence, 0.50) - coalesce(a.penalty,0))) >= 0.78 and coalesce(a.penalty,0) < 0.10 then 'trusted'
        else 'medium'
      end as reliability_badge
    from public.v_product_all_offers o
    join public.price_sources ps on ps.id = o.source_id
    left join public.v_offer_reports_agg a
      on a.offer_id = o.offer_id
    where o.product_id = ${productId}::uuid
      and (${includeUnpublished} = true or coalesce(ps.catalog_publish_enabled, true) = true)
    order by final_price asc nulls last
  `);

  return c.json(rankOfferRows(((r.rows as Record<string, unknown>[]) ?? []), { includeUnpublished }));
});

viewRoutes.get('/compare_offers', async (c) => {
  const productId = c.req.query('product_id');
  const regionId = c.req.query('region_id');
  const limit = clampInt(c.req.query('limit'), 20, 1, 100);
  const includeUnpublished = ['1', 'true', 'yes'].includes(String(c.req.query('include_unpublished') ?? '').toLowerCase());
  if (!productId) return c.json({ error: 'product_id required' }, 400);

  const db = getDb(c.env);
  const conds: any[] = [sql`o.product_id = ${productId}::uuid`];
  if (regionId) conds.push(sql`o.region_id = ${regionId}::uuid`);
  if (!includeUnpublished) conds.push(sql`coalesce(ps.catalog_publish_enabled, true) = true`);
  const where = sql`where ${sql.join(conds, sql` and `)}`;

  const r = await db.execute(sql`
    select
      o.*,
      coalesce(ps.trust_weight_dynamic, ps.trust_weight, 0.50)::numeric(3,2) as trust_score,
      ps.certification_tier as source_certification_tier,
      coalesce(ps.quality_score, coalesce(ps.trust_weight_dynamic, ps.trust_weight, 0.50))::numeric as source_quality_score,
      coalesce(ps.catalog_publish_enabled, true) as source_publish_enabled,
      coalesce(a.reports_total,0)::int as crowd_reports_total,
      coalesce(a.wrong_price,0)::int as crowd_wrong_price,
      coalesce(a.unavailable,0)::int as crowd_unavailable,
      coalesce(a.duplicate,0)::int as crowd_duplicate,
      coalesce(a.other,0)::int as crowd_other,
      coalesce(a.penalty,0)::numeric(3,2) as crowd_penalty,
      greatest(0, least(1, coalesce(o.price_confidence, 0.50) - coalesce(a.penalty,0)))::numeric(3,2) as price_confidence,
      (
        coalesce(o.is_price_anomaly,false)
        or coalesce(a.penalty,0) >= 0.25
        or coalesce(a.wrong_price,0) >= 3
      ) as is_price_suspected
    from public.v_product_all_offers o
    join public.price_sources ps on ps.id = o.source_id
    left join public.v_offer_reports_agg a on a.offer_id = o.offer_id
    ${where}
    order by final_price asc nulls last, observed_at desc nulls last
    limit ${limit}
  `);

  const rows = (r.rows as Record<string, unknown>[]) ?? [];
  const validPrices = rows
    .map((row) => {
      const p = pickPrice(row);
      const d = pickDelivery(row);
      return p == null ? null : Math.max(0, p + Math.max(0, d));
    })
    .filter((x): x is number => x != null && Number.isFinite(x));
  const cheapest = validPrices.length ? Math.min(...validPrices) : null;

  const ranked = rankOfferRows(rows, { includeUnpublished, limit }).map((row) => ({
    ...row,
    comparison: row.comparison ?? rankOfferRow(row, { cheapestPrice: cheapest }),
  }));

  return c.json({
    product_id: productId,
    region_id: regionId ?? null,
    cheapest_effective_price_iqd: cheapest,
    offers: ranked,
    best_offer: ranked[0] ?? null,
  });
});

viewRoutes.get('/compare_products', async (c) => {
  const productAId = c.req.query('product_a_id') ?? c.req.query('left_product_id');
  const productBId = c.req.query('product_b_id') ?? c.req.query('right_product_id');
  const regionId = c.req.query('region_id');
  const includeUnpublished = ['1', 'true', 'yes'].includes(String(c.req.query('include_unpublished') ?? '').toLowerCase());
  if (!productAId || !productBId) {
    return c.json({ error: 'product_a_id and product_b_id are required' }, 400);
  }

  const db = getDb(c.env);
  const offersRegionClause = regionId ? sql`and v.region_id = ${regionId}` : sql``;
  const countsRegionClause = regionId ? sql`and region_id = ${regionId}` : sql``;
  const publishClause = includeUnpublished ? sql`` : sql`and coalesce(ps.catalog_publish_enabled, true) = true`;

  const offersResult = await db.execute(sql`
    select
      v.*,
      coalesce(ps.trust_weight_dynamic, ps.trust_weight, 0.50)::numeric(3,2) as trust_score,
      ps.certification_tier as source_certification_tier,
      coalesce(ps.quality_score, coalesce(ps.trust_weight_dynamic, ps.trust_weight, 0.50))::numeric as source_quality_score,
      coalesce(ps.catalog_publish_enabled, true) as source_publish_enabled
    from public.v_best_offers_ui v
    join public.price_sources ps on ps.id = v.source_id
    where (v.product_id = ${productAId} or v.product_id = ${productBId})
    ${offersRegionClause}
    ${publishClause}
    order by v.is_price_trusted desc, v.display_price_iqd asc nulls last, v.last_observed_at desc nulls last
  `);

  const countsResult = await db.execute(sql`
    select product_id, count(*)::int as offer_count
    from public.v_product_all_offers
    where (product_id = ${productAId} or product_id = ${productBId})
    ${countsRegionClause}
    group by product_id
  `);

  const offerCounts = new Map<string, number>();
  for (const row of (countsResult.rows as any[]) ?? []) {
    offerCounts.set(String(row.product_id), Number(row.offer_count ?? 0));
  }

  const rankedOfferRows = rankOfferRows(((offersResult.rows as Record<string, unknown>[]) ?? []), { includeUnpublished });

  const bestByProduct = new Map<string, Record<string, unknown>>();
  for (const row of rankedOfferRows) {
    const key = String(row['product_id'] ?? '');
    if (!key || bestByProduct.has(key)) continue;
    bestByProduct.set(key, row);
  }

  const aRow = bestByProduct.get(String(productAId)) ?? null;
  const bRow = bestByProduct.get(String(productBId)) ?? null;
  const aBase = scoreProductRow(aRow, offerCounts.get(String(productAId)) ?? 0);
  const bBase = scoreProductRow(bRow, offerCounts.get(String(productBId)) ?? 0);

  const priceA = aRow ? pickPrice(aRow) : null;
  const priceB = bRow ? pickPrice(bRow) : null;
  const hasBothPrices = priceA != null && priceB != null && priceA > 0 && priceB > 0;

  const priceRelA = hasBothPrices ? Math.min(1, (priceB as number) / (priceA as number)) : 0;
  const priceRelB = hasBothPrices ? Math.min(1, (priceA as number) / (priceB as number)) : 0;

  const scoreA = Number((aBase.total * 0.65 + priceRelA * 0.35).toFixed(4));
  const scoreB = Number((bBase.total * 0.65 + priceRelB * 0.35).toFixed(4));

  const winner = scoreA === scoreB ? 'tie' : scoreA > scoreB ? 'product_a' : 'product_b';
  const explanation: string[] = [];
  if (winner === 'tie') explanation.push('النتيجة متقاربة جدًا بين المنتجين');
  if (hasBothPrices) {
    const diff = Math.abs((priceA as number) - (priceB as number));
    explanation.push(`فرق السعر الحالي تقريبًا ${Math.round(diff).toLocaleString('en-US')} د.ع`);
  }
  if (scoreA > scoreB && aBase.breakdown.trust >= bBase.breakdown.trust) explanation.push('المنتج A متفوّق بالثقة والسعر/القيمة');
  if (scoreB > scoreA && bBase.breakdown.trust >= aBase.breakdown.trust) explanation.push('المنتج B متفوّق بالثقة والسعر/القيمة');

  return c.json({
    region_id: regionId ?? null,
    winner,
    recommendation: winner === 'tie' ? 'متقاربين' : winner === 'product_a' ? 'اختر المنتج A' : 'اختر المنتج B',
    scorecards: {
      product_a: {
        product_id: productAId,
        best_offer: aRow,
        offer_count: offerCounts.get(String(productAId)) ?? 0,
        score: scoreA,
        breakdown: { ...aBase.breakdown, relative_price: Number(priceRelA.toFixed(4)) },
        reasons: aBase.reasons,
      },
      product_b: {
        product_id: productBId,
        best_offer: bRow,
        offer_count: offerCounts.get(String(productBId)) ?? 0,
        score: scoreB,
        breakdown: { ...bBase.breakdown, relative_price: Number(priceRelB.toFixed(4)) },
        reasons: bBase.reasons,
      },
    },
    explanation,
  });
});

viewRoutes.get('/qr_resolve', async (c) => {
  const text = c.req.query('text') ?? c.req.query('qr') ?? c.req.query('code') ?? '';
  const parsed = parseBarcodeInput(text);
  return c.json({
    ok: !!parsed.code,
    input: text,
    code: parsed.code,
    source: parsed.source,
    candidates: parsed.candidates,
    identifier_type: parsed.identifierType,
    check_digit_valid: parsed.checkDigitValid,
    gs1: parsed.gs1,
  });
});

viewRoutes.get('/lookup_by_code', async (c) => {
  const raw = c.req.query('code') ?? c.req.query('text');
  const regionId = c.req.query('region_id');
  const limitOffers = clampInt(c.req.query('limit_offers'), 10, 1, 50);
  const db = getDb(c.env);
  const result = await resolveBarcodeLookup(db, raw ?? null, {
    regionId,
    limitOffers,
    allowExternal: false,
  });

  if (!result.resolved_code) {
    return c.json({ error: 'code not found in input', ...result }, 400);
  }

  return c.json(result);
});

viewRoutes.get('/lookup_by_qr', async (c) => {
  const codeOrText = c.req.query('code') ?? c.req.query('qr') ?? c.req.query('text') ?? '';
  const regionId = c.req.query('region_id');
  const limitOffers = clampInt(c.req.query('limit_offers'), 10, 1, 50);
  const db = getDb(c.env);
  const result = await resolveBarcodeLookup(db, codeOrText, {
    regionId,
    limitOffers,
    allowExternal: true,
  });

  if (!result.resolved_code) {
    return c.json({ error: 'code not found in qr/text', ...result }, 400);
  }

  return c.json(result);
});

viewRoutes.get('/ingestion_health', async (c) => {
  const db = getDb(c.env);
  const r = await db.execute(sql`
    select started_at, status
    from public.source_sync_runs
    order by started_at desc
    limit 1
  `);
  const latest = (r.rows as any[])[0] ?? null;
  return c.json({
    lastSyncAt: latest?.started_at ?? null,
    lastStatus: latest?.status ?? null,
    sourceCount: latest ? 1 : 0,
  });
});

// ✅ Product price history for charts (world-scale): raw + rollups automatically.
// Query params:
// - product_id (uuid, required)
// - days (default 90)
// - region_id (uuid, optional)
// - include_delivery (0/1/true/false)
viewRoutes.get('/product_price_history', async (c) => {
  const productId = String(c.req.query('product_id') ?? '').trim();
  if (!productId) return c.json({ error: 'product_id required' }, 400);

  const days = clampInt(c.req.query('days') ?? undefined, 90, 1, 3650);
  const regionId = c.req.query('region_id') ? String(c.req.query('region_id')).trim() : null;
  const includeDelivery = asBool(c.req.query('include_delivery'));

  const db = getDb(c.env);
  const r = await db.execute(sql`
    select * from public.get_product_price_history(
      ${productId}::uuid,
      ${days},
      ${regionId}::uuid,
      ${includeDelivery}
    )
  `);

  const rows = (r.rows ?? []) as any[];
  return c.json(rows.map((row) => ({
    ...row,
    sample_count: Number(row.sample_count ?? row.offer_count ?? 0),
  })));
});
