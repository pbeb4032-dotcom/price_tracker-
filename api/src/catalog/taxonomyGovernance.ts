import { sql } from 'drizzle-orm';
import type { CategoryKey } from '../ingestion/categoryInfer';
import { inferCategoryKeyDetailed } from '../ingestion/categoryInfer';
import { classifyGrocerySubcategory } from '../ingestion/groceryTaxonomy';
import {
  inferTaxonomySuggestion,
  normalizeSiteCategory,
  taxonomyKeyToCategoryAndSubcategory,
} from '../ingestion/taxonomyV2';
import { normalizeCatalogText } from './canonicalIdentity';

type RootCategory = Exclude<CategoryKey, 'general'>;

export type GovernedTaxonomyInput = {
  name?: string | null;
  description?: string | null;
  brand?: string | null;
  domain?: string | null;
  url?: string | null;
  siteCategoryRaw?: string | null;
  mappedTaxonomyKey?: string | null;
  fallbackCategory?: CategoryKey | null;
  fallbackSubcategory?: string | null;
};

export type GovernedTaxonomyDecision = {
  category: CategoryKey;
  subcategory: string | null;
  taxonomyKey: string | null;
  confidence: number;
  margin: number;
  badge: 'trusted' | 'medium' | 'weak';
  status: 'approved' | 'quarantined';
  conflict: boolean;
  conflictReasons: string[];
  denyRules: string[];
  reasons: string[];
  forcedByRule: string | null;
  mappedTaxonomyKey: string | null;
  evidence: Record<string, unknown>;
};

type ForceRule = {
  id: string;
  taxonomyKey: string;
  confidence: number;
  minHits?: number;
  terms: string[];
  denyRoots?: RootCategory[];
  reason: string;
};

const ROOT_SIGNAL_TERMS: Record<RootCategory, string[]> = {
  electronics: [
    'iphone', 'samsung', 'android', 'laptop', 'notebook', 'phone', 'tablet', 'charger', 'cable',
    'هاتف', 'موبايل', 'لابتوب', 'تابلت', 'شاحن', 'كيبل',
  ],
  groceries: [
    'rice', 'flour', 'sugar', 'snack', 'chips', 'biscuits', 'cheese', 'yogurt',
    'رز', 'طحين', 'سكر', 'شبس', 'بسكويت', 'جبن', 'لبن',
  ],
  beverages: [
    'coffee', 'tea', 'water', 'juice', 'cola', 'soda', 'energy drink',
    'قهوة', 'شاي', 'ماء', 'عصير', 'مشروب', 'مشروبات',
  ],
  clothing: [
    'shirt', 't shirt', 't-shirt', 'hoodie', 'jeans', 'dress', 'abaya', 'shoes', 'sneaker',
    'تيشيرت', 'قميص', 'هودي', 'جينز', 'فستان', 'عباية', 'حذاء', 'احذية',
  ],
  home: [
    'detergent', 'cleaner', 'kitchen', 'cookware', 'plate', 'cup', 'mug',
    'منظف', 'منظفات', 'مطبخ', 'صحون', 'كوب',
  ],
  beauty: [
    'perfume', 'fragrance', 'parfum', 'cream', 'serum', 'lotion', 'makeup',
    'عطر', 'عطور', 'بارفان', 'كريم', 'سيروم', 'لوشن', 'مكياج',
  ],
  sports: [
    'bicycle', 'bike', 'cycling', 'helmet', 'fitness', 'dumbbell', 'football',
    'دراجة', 'دراجه', 'بايسكل', 'خوذة', 'رياضة', 'دمبل', 'كرة قدم',
  ],
  toys: [
    'toy', 'toys', 'lego', 'puzzle', 'cards game', 'uno',
    'لعبة', 'العاب', 'ألعاب', 'بازل', 'اونو',
  ],
  automotive: [
    'engine oil', 'motor oil', 'brake fluid', 'tire', 'tyre', 'car battery',
    'زيت محرك', 'زيت سيارات', 'زيت قير', 'زيت فرامل', 'اطار', 'بطارية سيارة',
  ],
  essentials: [
    'medicine', 'medical', 'pharmacy', 'vitamin', 'supplement', 'diaper', 'formula',
    'cat food', 'dog food', 'bird food', 'litter', 'pet', 'pets',
    'صيدلية', 'دواء', 'أدوية', 'فيتامين', 'مكمل', 'حفاض', 'حليب أطفال',
    'طعام قطط', 'طعام كلاب', 'طعام طيور', 'حيوانات', 'قطط', 'كلاب', 'طيور',
  ],
};

const FORCE_RULES: ForceRule[] = [
  {
    id: 'pet_products_not_food',
    taxonomyKey: 'essentials/pets',
    confidence: 0.985,
    terms: [
      'cat food', 'dog food', 'pet food', 'bird food', 'litter', 'pet shampoo',
      'طعام قطط', 'طعام كلاب', 'طعام حيوانات', 'طعام طيور', 'رمل قطط', 'ليتر بوكس', 'قفص', 'طيور', 'عصافير',
    ],
    denyRoots: ['groceries', 'beverages'],
    reason: 'Pet and bird supply signals override grocery-style wording.',
  },
  {
    id: 'clothing_not_grocery',
    taxonomyKey: 'clothing/other',
    confidence: 0.97,
    minHits: 2,
    terms: [
      't shirt', 't-shirt', 'shirt', 'hoodie', 'jeans', 'abaya', 'dress', 'sneaker',
      'تيشيرت', 'قميص', 'هودي', 'جينز', 'عباية', 'فستان', 'حذاء',
    ],
    denyRoots: ['groceries', 'beverages'],
    reason: 'Apparel signals are strong enough to block food branches.',
  },
  {
    id: 'playing_cards_not_grocery',
    taxonomyKey: 'toys/general',
    confidence: 0.965,
    terms: [
      'playing cards', 'uno cards', 'game cards', 'deck cards',
      'ورق لعب', 'كوتشينة', 'شدة', 'كارتات لعبة', 'بطاقات لعبة',
    ],
    denyRoots: ['groceries', 'beverages'],
    reason: 'Cards and game decks are never grocery items.',
  },
  {
    id: 'engine_oil_not_cooking_oil',
    taxonomyKey: 'automotive/oils/engine',
    confidence: 0.99,
    terms: [
      'engine oil', 'motor oil', '5w-30', '5w30', '10w-40', '10w40', 'sae', 'dexos', 'acea',
      'زيت محرك', 'زيت سيارات', 'زيت مكينة', 'زيت مكينه',
    ],
    denyRoots: ['groceries'],
    reason: 'Automotive oil signatures must never be mapped to cooking oils.',
  },
];

function rootFromTaxonomyKey(value: string | null | undefined): CategoryKey {
  const key = String(value ?? '').trim();
  if (!key) return 'general';
  const root = key.split('/')[0];
  if (root === 'groceries' && key === 'groceries/beverages') return 'beverages';
  if (['electronics', 'groceries', 'beauty', 'clothing', 'home', 'sports', 'toys', 'automotive', 'essentials'].includes(root)) {
    return root as CategoryKey;
  }
  return 'general';
}

function tokenize(value: string): string[] {
  return value.split(' ').filter(Boolean);
}

function matchTerm(text: string, tokens: string[], term: string): boolean {
  const normalized = normalizeCatalogText(term);
  if (!normalized) return false;
  if (normalized.includes(' ')) return text.includes(normalized);
  if (normalized.length <= 3) return tokens.includes(normalized);
  return tokens.includes(normalized) || text.includes(normalized);
}

function countMatches(text: string, tokens: string[], terms: string[]): number {
  let hits = 0;
  for (const term of terms) {
    if (matchTerm(text, tokens, term)) hits += 1;
  }
  return hits;
}

function computeRootScores(input: GovernedTaxonomyInput) {
  const normalizedText = normalizeCatalogText([
    input.name,
    input.description,
    input.brand,
    input.siteCategoryRaw,
  ].filter(Boolean).join(' | '));
  const tokens = tokenize(normalizedText);
  const catDet = inferCategoryKeyDetailed({
    name: input.name ?? null,
    description: input.description ?? null,
    domain: input.domain ?? null,
    url: input.url ?? null,
    siteCategory: input.siteCategoryRaw ?? null,
  });

  const scores = new Map<CategoryKey, number>();
  (Object.keys(ROOT_SIGNAL_TERMS) as RootCategory[]).forEach((root) => {
    scores.set(root, countMatches(normalizedText, tokens, ROOT_SIGNAL_TERMS[root]));
  });

  if (catDet.category !== 'general') scores.set(catDet.category, (scores.get(catDet.category) ?? 0) + 2.4);
  if (catDet.site !== 'general') scores.set(catDet.site, (scores.get(catDet.site) ?? 0) + 1.6);
  if (catDet.domain !== 'general') scores.set(catDet.domain, (scores.get(catDet.domain) ?? 0) + 1.2);
  if (input.fallbackCategory && input.fallbackCategory !== 'general') {
    scores.set(input.fallbackCategory, (scores.get(input.fallbackCategory) ?? 0) + 0.8);
  }

  const mappedRoot = rootFromTaxonomyKey(input.mappedTaxonomyKey);
  if (mappedRoot !== 'general') scores.set(mappedRoot, (scores.get(mappedRoot) ?? 0) + 2.8);

  const ranked = Array.from(scores.entries())
    .sort((a, b) => b[1] - a[1]);

  return {
    normalizedText,
    tokens,
    catDet,
    scores,
    ranked,
  };
}

function computeBadge(confidence: number): 'trusted' | 'medium' | 'weak' {
  if (confidence >= 0.9) return 'trusted';
  if (confidence >= 0.72) return 'medium';
  return 'weak';
}

export async function resolveMappedTaxonomyKey(
  db: any,
  domain: string | null | undefined,
  siteCategoryRaw: string | null | undefined,
): Promise<string | null> {
  const normalizedDomain = String(domain ?? '').trim().toLowerCase();
  const siteNorm = normalizeSiteCategory(siteCategoryRaw);
  if (!normalizedDomain || !siteNorm) return null;

  const rows = await db.execute(sql`
    select taxonomy_key
    from public.domain_taxonomy_mappings
    where domain = ${normalizedDomain}
      and site_category_norm = ${siteNorm}
      and is_active = true
    limit 1
  `).catch(() => ({ rows: [] as any[] }));

  return ((rows.rows as any[])[0]?.taxonomy_key as string | undefined) ?? null;
}

export function classifyGovernedTaxonomy(input: GovernedTaxonomyInput): GovernedTaxonomyDecision {
  const { normalizedText, tokens, catDet, scores, ranked } = computeRootScores(input);
  const mappedRoot = rootFromTaxonomyKey(input.mappedTaxonomyKey);
  const denyRules: string[] = [];
  const conflictReasons: string[] = [];
  const reasons: string[] = [];

  let forcedByRule: string | null = null;
  let forcedTaxonomyKey: string | null = null;
  let forcedConfidence = 0;

  for (const rule of FORCE_RULES) {
    const hits = countMatches(normalizedText, tokens, rule.terms);
    if (hits < (rule.minHits ?? 1)) continue;
    forcedByRule = rule.id;
    forcedTaxonomyKey = rule.taxonomyKey;
    forcedConfidence = rule.confidence;
    denyRules.push(...(rule.denyRoots ?? []));
    reasons.push(rule.reason);
    break;
  }

  const subDet = catDet.category === 'groceries'
    ? classifyGrocerySubcategory({
        name: input.name ?? null,
        description: input.description ?? null,
        siteCategory: input.siteCategoryRaw ?? null,
      })
    : { subcategory: null, badge: 'weak' as const, confidence: 0.3, reasons: ['not_groceries'] };

  const baseSuggestion = inferTaxonomySuggestion({
    mappedTaxonomyKey: forcedTaxonomyKey ? null : input.mappedTaxonomyKey,
    category: input.fallbackCategory && input.fallbackCategory !== 'general' ? input.fallbackCategory : catDet.category,
    subcategory: input.fallbackSubcategory ?? subDet.subcategory,
    name: input.name ?? null,
    description: input.description ?? null,
    siteCategoryRaw: input.siteCategoryRaw ?? null,
    siteCategoryKey: catDet.site,
  });

  let taxonomyKey = forcedTaxonomyKey ?? baseSuggestion.taxonomyKey;
  let category = taxonomyKey ? taxonomyKeyToCategoryAndSubcategory(taxonomyKey).category : catDet.category;
  let subcategory = taxonomyKey ? taxonomyKeyToCategoryAndSubcategory(taxonomyKey).subcategory : input.fallbackSubcategory ?? subDet.subcategory;

  if (!taxonomyKey && mappedRoot !== 'general') {
    category = mappedRoot;
  }

  const top = ranked[0] ?? (['general', 0] as [CategoryKey, number]);
  const second = ranked[1] ?? (['general', 0] as [CategoryKey, number]);
  const margin = top[1] <= 0 ? 0 : Number(((top[1] - second[1]) / Math.max(top[1], 1)).toFixed(3));

  if (forcedByRule) {
    if (catDet.site !== 'general' && catDet.site !== category) {
      conflictReasons.push(`site_hint_disagrees:${catDet.site}`);
    }
    if (mappedRoot !== 'general' && mappedRoot !== category) {
      conflictReasons.push(`mapped_taxonomy_disagrees:${mappedRoot}`);
    }
  } else {
    if (baseSuggestion.conflict && baseSuggestion.conflictReason) {
      conflictReasons.push(baseSuggestion.conflictReason);
    }
    if (catDet.site !== 'general' && category !== 'general' && catDet.site !== category) {
      conflictReasons.push(`site_hint_disagrees:${catDet.site}`);
    }
    if (mappedRoot !== 'general' && category !== 'general' && mappedRoot !== category) {
      conflictReasons.push(`mapped_taxonomy_disagrees:${mappedRoot}`);
    }
  }

  let confidence = forcedByRule
    ? forcedConfidence
    : Number(baseSuggestion.confidence ?? 0);

  if (!forcedByRule) {
    if (margin >= 0.25) confidence += 0.06;
    else if (margin >= 0.12) confidence += 0.03;
    if (catDet.site !== 'general' && catDet.site === category) confidence += 0.03;
    if (mappedRoot !== 'general' && mappedRoot === category) confidence += 0.04;
    if (top[1] <= 0) confidence -= 0.2;
  }

  if (forcedByRule && (catDet.site === category || mappedRoot === category || mappedRoot === 'general')) {
    confidence += 0.005;
  }

  if (conflictReasons.length) confidence -= forcedByRule ? 0.04 : 0.08;

  confidence = Math.max(0.3, Math.min(0.995, Number(confidence.toFixed(3))));

  if (!taxonomyKey) {
    reasons.push('No canonical taxonomy leaf could be assigned.');
  } else if (!forcedByRule) {
    reasons.push(baseSuggestion.reason);
  }

  const conflict = conflictReasons.length > 0;
  const status = taxonomyKey && (forcedByRule
    ? confidence >= 0.92
    : confidence >= 0.88 && margin >= 0.1 && !conflict)
    ? 'approved'
    : 'quarantined';

  const badge = computeBadge(confidence);

  return {
    category,
    subcategory,
    taxonomyKey,
    confidence,
    margin,
    badge,
    status,
    conflict,
    conflictReasons,
    denyRules,
    reasons,
    forcedByRule,
    mappedTaxonomyKey: input.mappedTaxonomyKey ?? null,
    evidence: {
      normalized_text: normalizedText,
      base_category: catDet.category,
      site_hint: catDet.site,
      domain_hint: catDet.domain,
      subcategory_candidate: subDet.subcategory,
      base_taxonomy: baseSuggestion.taxonomyKey,
      root_scores: Object.fromEntries(Array.from(scores.entries()).map(([k, v]) => [k, Number(v.toFixed(3))])),
      top_root: top[0],
      top_root_score: top[1],
      second_root: second[0],
      second_root_score: second[1],
      mapped_root: mappedRoot,
      forced_by_rule: forcedByRule,
    },
  };
}
