// Minimal, deterministic category inference.
// Goal: reduce obvious mismatches (e.g., electronics filter showing socks) while staying safe.

export type CategoryKey =
  | 'general'
  | 'electronics'
  | 'groceries'
  | 'beverages'
  | 'clothing'
  | 'home'
  | 'beauty'
  | 'sports'
  | 'toys'
  | 'automotive'
  | 'essentials';

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
  // Phrase keyword: use substring match.
  if (k.includes(' ')) return textNorm.includes(k);
  // Very short keywords are dangerous (e.g., "cap" inside "caple"). Match as whole token.
  if (k.length <= 3) return tokens.includes(k);
  // Normal keyword: token match first, then fallback substring.
  return tokens.includes(k) || textNorm.includes(k);
}


const SITE_CATEGORY_SYNONYMS: Record<Exclude<CategoryKey, 'general'>, string[]> = {
  electronics: ['electronics','electronic','phones','mobile','mobiles','laptops','computers','gaming','accessories','الكترونيات','موبايلات','هواتف','حاسبات','العاب الكترونيه','ألعاب إلكترونية'],
  groceries: ['groceries','grocery','food','foods','supermarket','snacks','dairy','meat','frozen','produce','bakery','pantry','مواد غذائيه','مواد غذائية','بقاله','بقالة','سوبرماركت','اغذيه','أغذية','وجبات خفيفة'],
  beverages: ['beverages','beverage','drinks','drink','coffee','tea','water','juice','مشروبات','مشروب','قهوه','قهوة','شاي','ماء','عصائر'],
  clothing: ['fashion','clothing','clothes','apparel','shoes','bags','wallets','accessories','ملابس','موضه','موضة','أحذية','احذيه','حقائب','شنط','محافظ'],
  home: ['home','kitchen','household','furniture','decor','cleaning','appliances','منزل','منزليه','منزلية','مطبخ','أدوات منزلية','تنظيف'],
  beauty: ['beauty','cosmetics','cosmetic','skincare','makeup','fragrance','perfume','تجميل','عنايه','عناية','مكياج','عطور'],
  sports: ['sports','sport','fitness','outdoor','bikes','cycling','رياضه','رياضة','لياقه','لياقة','دراجات'],
  toys: ['toys','toy','kids toys','baby toys','العاب','ألعاب','لعب'],
  automotive: ['automotive','auto','car accessories','car care','motor','سيارات','سيارة','اكسسوارات سيارة','زيوت سيارات'],
  essentials: ['health','medical','pharmacy','baby care','pet supplies','essentials','صيدليه','صيدلية','عناية الطفل','مستلزمات الحيوانات','اساسيات','أساسيات'],
};

const KEYWORDS: Record<Exclude<CategoryKey, 'general'>, string[]> = {
  electronics: [
    'laptop', 'notebook', 'pc', 'computer', 'monitor', 'screen', 'tv', 'smart tv',
    'phone', 'iphone', 'samsung', 'android', 'tablet', 'ipad', 'smartwatch',
    'earbuds', 'headphone', 'speaker', 'bluetooth', 'charger', 'cable', 'usb',
    'power bank', 'router', 'modem', 'keyboard', 'mouse', 'ssd', 'hdd', 'camera',
    'printer', 'playstation', 'ps5', 'xbox',
    'لابتوب', 'كمبيوتر', 'حاسبه', 'شاشه', 'تلفزيون', 'هاتف', 'موبايل', 'تابلت', 'ايباد',
    'ساعه ذكيه', 'سماعه', 'شاحن', 'كيبل', 'باور بانك', 'راوتر', 'مودم', 'كيبورد', 'ماوس',
    'كاميرا', 'طابعه', 'بلايستيشن', 'اكس بوكس'
  ],
  groceries: [
    'rice', 'sugar', 'flour', 'milk', 'yogurt', 'cheese', 'egg', 'meat', 'chicken',
    'pasta', 'noodles', 'sauce', 'ketchup', 'snack', 'chips', 'biscuits', 'chocolate',
    // cooking oils (explicit only — avoid confusing car oil)
    'olive oil', 'cooking oil', 'sunflower oil', 'vegetable oil',
    'رز', 'سكر', 'طحين', 'حليب', 'لبن', 'جبن', 'بيض', 'لحم', 'دجاج',
    'معكرونه', 'معكرونة', 'نودلز', 'صلصه', 'صلصة', 'كاتشب', 'شبس', 'بسكويت', 'شوكولاته', 'شوكولاتة',
    'زيت زيتون', 'زيت طبخ', 'زيت نباتي', 'زيت دوار الشمس', 'مواد غذائيه', 'مواد غذائية'
  ],
  
  beverages: [
    'water', 'juice', 'tea', 'coffee', 'cola', 'soda', 'energy',
    'ماء', 'عصير', 'شاي', 'قهوه', 'مشروب', 'مشروبات', 'طاقه'
  ],
  clothing: [
    'shirt', 't shirt', 't-shirt', 'pants', 'jeans', 'dress', 'abaya', 'shoe', 'shoes',
    'sneaker', 'bag', 'handbag', 'wallet', 'jacket', 'hoodie', 'sock',
    'قميص', 'تيشيرت', 'بنطرون', 'جينز', 'فستان', 'عبايه', 'حذاء', 'احذيه', 'شنطه',
    'حقيبه', 'محفظه', 'جاكيت', 'هودي', 'جوارب'
  ],
  home: [
    'kitchen', 'cookware', 'pan', 'pot', 'plate', 'vacuum', 'vacuum cleaner', 'cleaner',
    'bedding', 'blanket', 'pillow', 'lamp', 'storage', 'iron', 'mop',
    'مطبخ', 'قدر', 'طنجره', 'طنجرة', 'مقلاه', 'مقلاة', 'صحون', 'مكنسه', 'مكنسة', 'منظف', 'تنظيف',
    'بطانيه', 'بطانية', 'وساده', 'وسادة', 'لمبه', 'لمبة', 'تخزين', 'مكوى', 'ممسحه', 'ممسحة'
  ],
  
  beauty: [
    'makeup', 'cosmetic', 'lipstick', 'mascara', 'foundation', 'powder',
    // Perfume / fragrance (common on Iraqi sites)
    'perfume', 'perfumes', 'fragrance', 'cologne', 'parfum', 'eau de parfum', 'eau de toilette', 'edp', 'edt', 'pour homme', 'pour femme',
    'cream', 'serum', 'shampoo', 'conditioner', 'soap', 'skincare',
    'مكياج', 'تجميل', 'روج', 'ماسكارا', 'فاونديشن', 'بودره',
    // عطور
    'عطر', 'عطور', 'بارفان', 'برفان', 'بارفيوم', 'برفيوم', 'ادو بارفان', 'ادو تواليت', 'كولونيا',
    'كريم', 'سيروم', 'شامبو', 'بلسم', 'صابون', 'عنايه'
  ],
  sports: [
    'gym', 'fitness', 'dumbbell', 'yoga', 'pilates', 'mat', 'treadmill',
    'football', 'basketball', 'tennis', 'table tennis', 'ping pong', 'dart', 'sports',
    'bicycle', 'bike', 'cycling', 'helmet', 'knee pad',
    'رياضه', 'رياضة', 'جيم', 'لياقه', 'لياقة', 'دمبل', 'يوغا', 'بيلاتس', 'حصيره', 'حصيرة', 'بساط', 'مات',
    'كره قدم', 'كرة قدم', 'كره سله', 'كرة سلة', 'تنس', 'تنس الطاوله', 'تنس الطاولة', 'بليارد', 'سهام', 'دارت',
    'دراجه', 'دراجة', 'بايسكل', 'دراجات', 'خوذه', 'خوذة', 'واقي ركبه', 'واقي ركبة'
  ],
  
  toys: [
    'toy', 'lego', 'doll', 'puzzle', 'rc',
    'لعبه', 'العاب', 'دمية', 'بازل'
  ],
  automotive: [
    'car', 'engine oil', 'motor oil', 'brake', 'tire', 'tyre',
    // Keep batteries scoped to cars only; general batteries belong to essentials.
    'car battery',
    'سياره', 'زيت محرك', 'فرامل', 'اطار', 'بطارية سيارة', 'بطاريه سياره'
  ],
  essentials: [
    'vitamin', 'supplement', 'medicine', 'medical', 'ointment', 'bandage', 'thermometer',
    'diaper', 'formula', 'feeding bottle', 'baby', 'infant',
    'pet', 'cat', 'dog',
    // Small batteries & everyday supplies
    'battery', 'batteries', 'aa', 'aaa', 'alkaline', 'duracell', 'energizer',
    'book', 'novel', 'notebook',
    'صيدليه', 'دواء', 'ادويه', 'فيتامين', 'مكمل', 'مرهم', 'ضماد', 'ميزان حراره',
    'حفاض', 'حفاضات', 'حليب اطفال', 'رضاعه', 'طفل',
    'قطط', 'كلاب', 'حيوانات',
    'بطارية', 'بطاريه', 'بطاريات', 'دوراسيل',
    'كتاب', 'كتب', 'روايه', 'دفتر'
  ],
};

// Domain hints should be used ONLY for sites that are clearly specialized.
// Keep this list conservative; it's safer to miss than to misclassify.
const DOMAIN_HINTS_STRONG: Partial<Record<Exclude<CategoryKey, 'general'>, string[]>> = {
  electronics: ['electronics', 'mobile', 'laptop', 'gaming', 'computer'],
  groceries: ['grocery', 'groceries', 'supermarket', 'food'],
  beverages: ['beverage', 'beverages', 'coffee', 'tea', 'juice'],
  clothing: ['fashion', 'clothing', 'shoes', 'bags'],
  home: ['home', 'kitchen', 'household'],
  beauty: ['beauty', 'cosmetic', 'makeup', 'perfume', 'skincare'],
  sports: ['sports', 'fitness', 'cycling', 'bike'],
  toys: ['toy', 'toys', 'lego'],
  automotive: ['automotive', 'car', 'motor'],
  essentials: ['pharmacy', 'medical', 'baby', 'pet'],
};

function inferFromUrlPath(url: string | null | undefined): CategoryKey {
  try {
    const u = String(url ?? '').trim();
    if (!u) return 'general';
    const parsed = new URL(/^https?:\/\//i.test(u) ? u : `https://${u}`);
    const path = norm(parsed.pathname);
    if (!path) return 'general';
    // Reuse site synonyms against URL path
    for (const [cat, syns] of Object.entries(SITE_CATEGORY_SYNONYMS) as any) {
      if (!Array.isArray(syns)) continue;
      if (syns.some((x: string) => path.includes(norm(x)))) return cat as CategoryKey;
    }
    return 'general';
  } catch {
    return 'general';
  }
}

function inferFromSiteCategory(siteCategory: string | null | undefined): CategoryKey {
  const s = norm(siteCategory);
  if (!s) return 'general';
  for (const [cat, syns] of Object.entries(SITE_CATEGORY_SYNONYMS) as any) {
    if (!Array.isArray(syns)) continue;
    if (syns.some((x: string) => s.includes(norm(x)))) return cat as CategoryKey;
  }
  return 'general';
}

function inferFromDomainStrong(domain: string | null | undefined): CategoryKey {
  const d = norm(domain);
  if (!d) return 'general';
  for (const [cat, hints] of Object.entries(DOMAIN_HINTS_STRONG) as any) {
    if (!Array.isArray(hints)) continue;
    if (hints.some((h: string) => d.includes(norm(h)))) return cat as CategoryKey;
  }
  return 'general';
}

export function inferCategoryKeyDetailed(input: {
  name?: string | null;
  description?: string | null;
  domain?: string | null;
  url?: string | null;
  siteCategory?: string | null;
}): { category: CategoryKey; textScore: number; site: CategoryKey; domain: CategoryKey } {
  const textNorm = norm([input.name, input.description].filter(Boolean).join(' | '));
  const tokens = tokenize(textNorm);


  // 2) Signal B: site-provided category (if present), fallback to URL path hint
  const siteRaw = inferFromSiteCategory(input.siteCategory);
  const site = siteRaw !== 'general' ? siteRaw : inferFromUrlPath(input.url);

  // 3) Signal C: domain hint (ONLY for specialized sites)
  const domain = inferFromDomainStrong(input.domain);

  // ✅ Hard overrides for common Iraq pitfalls:
  // - Pet products should not leak into human grocery/beverages
  // - Bicycles should be sports, not automotive
  // - "engine oil" should be automotive, not food
  const PET_KWS = ['pet','cat','kitten','dog','قطط','قطه','قطه','كلاب','حيوانات','طعام قطط','طعام كلاب','cat food','dog food'];
  const BIKE_KWS = ['bicycle','bike','cycling','دراجه','دراجة','بايسكل','دراجات','دراجة هوائية','دراجه هوائيه'];
  const CAR_OIL_KWS = ['engine oil','motor oil','car oil','زيت محرك','زيت سيارات','زيت مكينه','زيت مكينة','زيت قير','زيت فرامل'];
  const BEAUTY_HARD_KWS = [
    'perfume','perfumes','fragrance','cologne','parfum','eau de parfum','eau de toilette','edp','edt',
    'soap','shampoo','conditioner','cream','serum','lotion','micellar water','cleanser','face wash','moisturizer',
    'عطر','عطور','بارفان','برفان','بارفيوم','برفيوم','ادو بارفان','ادو تواليت','كولونيا',
    'صابون','شامبو','بلسم','كريم','سيروم','لوشن','ماء ميسيلار','غسول','مرطب'
  ];

  const hasPet = PET_KWS.some((k) => matchKw(textNorm, tokens, k));
  if (hasPet) return { category: 'essentials', textScore: 99, site, domain };

  const hasBike = BIKE_KWS.some((k) => matchKw(textNorm, tokens, k));
  if (hasBike) return { category: 'sports', textScore: 99, site, domain };

  const hasCarOil = CAR_OIL_KWS.some((k) => matchKw(textNorm, tokens, k));
  if (hasCarOil) return { category: 'automotive', textScore: 99, site, domain };

  const hasBeautyHard = BEAUTY_HARD_KWS.some((k) => matchKw(textNorm, tokens, k));
  if (hasBeautyHard) return { category: 'beauty', textScore: 99, site, domain };

  const GAME_HARD_KWS = ['ps4','ps5','playstation','xbox','nintendo','switch game','video game','gaming cd','pc game','لعبه بلايستيشن','لعبة بلايستيشن','اكس بوكس','نينتندو'];
  const hasGameHard = GAME_HARD_KWS.some((k) => matchKw(textNorm, tokens, k));
  if (hasGameHard) return { category: 'electronics', textScore: 99, site, domain };


  // 1) Signal A: product text (strongest)
  let best: CategoryKey = 'general';
  let bestScore = 0;
  for (const [cat, kws] of Object.entries(KEYWORDS) as [Exclude<CategoryKey, 'general'>, string[]][]) {
    let score = 0;
    for (const kw of kws) {
      if (matchKw(textNorm, tokens, kw)) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = cat;
    }
  }

  // Triple-check decision:
  // - If any two signals agree => accept.
  // - Else prefer strong text, then site, then domain.
  const votes = [best, site, domain].filter((c) => c && c !== 'general');
  const counts = new Map<CategoryKey, number>();
  for (const v of votes) counts.set(v, (counts.get(v) ?? 0) + 1);
  for (const [cat, n] of counts.entries()) {
    if (n >= 2) return { category: cat, textScore: bestScore, site, domain };
  }

  if (best !== 'general' && bestScore >= 2) return { category: best, textScore: bestScore, site, domain };
  if (site !== 'general') return { category: site, textScore: bestScore, site, domain };
  if (domain !== 'general') return { category: domain, textScore: bestScore, site, domain };
  return { category: 'general', textScore: bestScore, site, domain };
}

export function inferCategoryKey(input: {
  name?: string | null;
  description?: string | null;
  domain?: string | null;
  url?: string | null;
  siteCategory?: string | null;
}): CategoryKey {
  return inferCategoryKeyDetailed(input).category;
}
