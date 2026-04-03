// Grocery taxonomy (subcategories) for Iraq.
// Goal: reduce "all groceries in one bucket" and enable UI sub-filters.
// Design: deterministic keyword scoring + conservative thresholds.

export type GrocerySubcategoryKey =
  | 'grains'
  | 'dairy'
  | 'meat'
  | 'produce'
  | 'oils'
  | 'spices'
  | 'canned'
  | 'snacks'
  | 'breakfast'
  | 'frozen'
  | 'bakery'
  | 'other';

export const GROCERY_SUBCATEGORY_LABELS_AR: Record<GrocerySubcategoryKey, string> = {
  grains: 'حبوب ورز',
  dairy: 'ألبان',
  meat: 'لحوم ودواجن',
  produce: 'خضار وفواكه',
  oils: 'زيوت وسمن',
  spices: 'بهارات وتوابل',
  canned: 'معلبات ومؤن',
  snacks: 'تسالي وحلويات',
  breakfast: 'فطور وحبوب إفطار',
  frozen: 'مجمدات',
  bakery: 'مخبوزات',
  other: 'أخرى',
};

function norm(s: unknown): string {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '') // Arabic diacritics + tatweel
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[\s\p{P}\p{S}]+/gu, ' ')
    .trim();
}

function tokenize(text: string): string[] {
  const n = norm(text);
  if (!n) return [];
  return n.split(' ').filter(Boolean);
}

function matchKw(textNorm: string, tokens: string[], kw: string): boolean {
  const k = norm(kw);
  if (!k) return false;
  if (k.includes(' ')) return textNorm.includes(k);
  if (k.length <= 3) return tokens.includes(k);
  return tokens.includes(k) || textNorm.includes(k);
}

const GUARDS = {
  // Prevent "زيت محرك" etc from being mis-tagged as food oils.
  carOil: [
    'engine oil', 'motor oil', 'car oil',
    'زيت محرك', 'زيت سيارات', 'زيت مكينه', 'زيت مكينة', 'زيت قير', 'زيت فرامل',
  ],
};

const SUB_KWS: Record<GrocerySubcategoryKey, string[]> = {
  grains: [
    'rice', 'basmati', 'flour', 'wheat', 'oats', 'lentil', 'lentils', 'beans', 'chickpeas', 'bulgur',
    'رز', 'بسمتي', 'طحين', 'دقيق', 'حنطه', 'حنطة', 'شوفان', 'عدس', 'فاصوليا', 'حمص', 'برغل',
  ],
  dairy: [
    'milk', 'yogurt', 'cheese', 'cream', 'butter', 'labneh',
    'حليب', 'لبن', 'زبادي', 'زبادي', 'جبن', 'جبنة', 'قشطه', 'قشطة', 'زبدة', 'لبنه',
  ],
  meat: [
    'meat', 'beef', 'lamb', 'chicken', 'turkey', 'fish', 'tuna', 'sausages',
    'لحم', 'غنم', 'خروف', 'بقر', 'دجاج', 'ديك رومي', 'سمك', 'تونه', 'تونة', 'نقانق',
  ],
  produce: [
    'tomato', 'potato', 'onion', 'garlic', 'banana', 'apple', 'orange', 'lemon', 'vegetable', 'fruit',
    'طماطم', 'بطاطا', 'بطاطس', 'بصل', 'ثوم', 'موز', 'تفاح', 'برتقال', 'ليمون', 'خضار', 'فواكه',
  ],
  oils: [
    'olive oil', 'cooking oil', 'sunflower oil', 'vegetable oil', 'corn oil', 'ghee', 'butter ghee',
    'زيت زيتون', 'زيت طبخ', 'زيت نباتي', 'زيت دوار الشمس', 'زيت ذره', 'زيت ذرة', 'سمن', 'دهن',
  ],
  spices: [
    'spice', 'spices', 'pepper', 'black pepper', 'salt', 'cumin', 'turmeric', 'coriander', 'paprika',
    'بهارات', 'فلفل', 'فلفل اسود', 'فلفل أسود', 'ملح', 'كمون', 'كركم', 'كزبره', 'كزبرة', 'بابريكا',
  ],
  canned: [
    'canned', 'can', 'tomato paste', 'ketchup', 'sauce', 'beans', 'tuna', 'jam', 'honey',
    'معلب', 'معلبات', 'معجون طماطم', 'دبس طماطم', 'كاتشب', 'صلصه', 'صلصة', 'مربى', 'عسل',
  ],
  snacks: [
    'snack', 'chips', 'biscuits', 'cookie', 'cookies', 'chocolate', 'candy', 'nuts',
    'شبس', 'بطاطا', 'بسكويت', 'كوكيز', 'شوكولاته', 'شوكولاتة', 'حلاوه', 'حلاوة', 'مكسرات',
  ],
  breakfast: [
    'cereal', 'corn flakes', 'granola', 'breakfast', 'oats', 'honey', 'jam',
    'كورنفليكس', 'كورن فليكس', 'جرانولا', 'فطور', 'شوفان', 'عسل', 'مربى',
  ],
  frozen: [
    'frozen', 'ice cream', 'french fries',
    'مجمد', 'مجمدات', 'ايس كريم', 'آيس كريم', 'بطاطا مجمده', 'بطاطا مجمدة',
  ],
  bakery: [
    'bread', 'toast', 'bun', 'cake', 'biscuit',
    'خبز', 'صمون', 'توست', 'كعك', 'كيك',
  ],
  other: [],
};

export function classifyGrocerySubcategory(input: {
  name?: string | null;
  description?: string | null;
  siteCategory?: string | null;
}): {
  subcategory: GrocerySubcategoryKey | null;
  badge: 'trusted' | 'medium' | 'weak';
  confidence: number;
  reasons: string[];
} {
  const text = [input.name, input.description, input.siteCategory].filter(Boolean).join(' | ');
  const textNorm = norm(text);
  const tokens = tokenize(textNorm);

  // Guard rails
  if (GUARDS.carOil.some((k) => matchKw(textNorm, tokens, k))) {
    return { subcategory: null, badge: 'weak', confidence: 0.3, reasons: ['Guard: car-oil keywords detected'] };
  }

  let best: GrocerySubcategoryKey | null = null;
  let bestScore = 0;
  const reasons: string[] = [];

  for (const [sub, kws] of Object.entries(SUB_KWS) as [GrocerySubcategoryKey, string[]][]) {
    if (sub === 'other') continue;
    let score = 0;
    for (const kw of kws) {
      if (matchKw(textNorm, tokens, kw)) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = sub;
    }
  }

  if (!best || bestScore <= 0) {
    return { subcategory: null, badge: 'weak', confidence: 0.35, reasons: ['No subcategory signal'] };
  }

  // Conservative thresholds to avoid false positives.
  if (bestScore >= 3) {
    reasons.push('Strong keyword evidence');
    return { subcategory: best, badge: 'trusted', confidence: 0.9, reasons };
  }
  if (bestScore === 2) {
    reasons.push('Medium keyword evidence');
    return { subcategory: best, badge: 'medium', confidence: 0.7, reasons };
  }

  // score=1 is too weak for taxonomy; return null.
  return { subcategory: null, badge: 'weak', confidence: 0.45, reasons: ['Weak evidence'] };
}
