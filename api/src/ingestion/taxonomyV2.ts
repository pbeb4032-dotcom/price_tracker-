import type { CategoryKey } from './categoryInfer';
import type { GrocerySubcategoryKey } from './groceryTaxonomy';

export type TaxonomySuggestion = {
  taxonomyKey: string | null;
  confidence: number;
  reason: string;
  conflict: boolean;
  conflictReason: string | null;
};

function norm(s: unknown): string {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[\s\p{P}\p{S}]+/gu, ' ')
    .trim();
}

export function normalizeSiteCategory(input: string | null | undefined): string {
  const s = norm(input);
  if (!s) return '';
  return s.slice(0, 120);
}

function hasAny(text: string, kws: string[]): boolean {
  for (const k of kws) {
    if (!k) continue;
    if (text.includes(norm(k))) return true;
  }
  return false;
}

function scoreAny(text: string, kws: string[]): number {
  return kws.reduce((n, k) => n + (text.includes(norm(k)) ? 1 : 0), 0);
}

function isEngineOil(text: string): boolean {
  if (/\b\d{1,2}w-\d{2}\b/i.test(text)) return true;
  if (text.includes('sae') || text.includes('acea') || text.includes('dexos')) return true;
  if (text.includes('api sn') || text.includes('api sp') || text.includes('api sl')) return true;
  if (text.includes('fully synthetic') || text.includes('synthetic')) return true;
  if (text.includes('زيت محرك') || text.includes('زيت مكينه') || text.includes('زيت مكينة') || text.includes('زيت سيارات') || text.includes('زيت قير') || text.includes('زيت فرامل')) return true;
  return false;
}

function mapElectronics(text: string): { key: string; conf: number; why: string } {
  const phone = ['iphone','samsung','galaxy','android','phone','smartphone','موبايل','هاتف','جوال','ايفون','سامسونج','جالكسي'];
  const laptop = ['laptop','notebook','macbook','pc','computer','لابتوب','حاسبه','حاسبة','كمبيوتر','ماكبوك'];
  const chargers = ['charger','charging','cable','usb','type c','type-c','power bank','شاحن','كيبل','سلك','باور بانك','يو اس بي','تايب سي'];
  const audio = ['earbuds','headphone','headphones','speaker','bluetooth','سماعه','سماعة','سبيكر','بلوتوث','ايربودز'];
  const tablet = ['tablet','ipad','تابلت','ايباد'];

  const buckets = [
    { k: 'electronics/phones', s: scoreAny(text, phone), why: 'phone keywords' },
    { k: 'electronics/laptops', s: scoreAny(text, laptop), why: 'laptop keywords' },
    { k: 'electronics/chargers_cables', s: scoreAny(text, chargers), why: 'charger/cable keywords' },
    { k: 'electronics/audio', s: scoreAny(text, audio), why: 'audio keywords' },
    { k: 'electronics/tablets', s: scoreAny(text, tablet), why: 'tablet keywords' },
  ].sort((a, b) => b.s - a.s);

  const best = buckets[0];
  if (!best || best.s <= 0) return { key: 'electronics/accessories', conf: 0.65, why: 'default accessories' };
  if (best.s >= 3) return { key: best.k, conf: 0.92, why: best.why };
  if (best.s === 2) return { key: best.k, conf: 0.82, why: best.why };
  return { key: best.k, conf: 0.72, why: best.why };
}

function mapAutomotive(text: string): { key: string; conf: number; why: string } {
  if (isEngineOil(text)) return { key: 'automotive/oils/engine', conf: 0.93, why: 'engine-oil signals' };
  if (hasAny(text, ['tire','tyre','tires','tyres','اطار','اطارات','تاير'])) return { key: 'automotive/tires', conf: 0.90, why: 'tire keywords' };
  if (hasAny(text, ['car battery','بطارية سيارة','بطاريه سياره','بطارية سيارات','بطاريه سيارات'])) return { key: 'automotive/batteries', conf: 0.90, why: 'car battery keywords' };
  if (hasAny(text, ['accessory','accessories','اكسسوار','اكسسوارات','زينة','زينه'])) return { key: 'automotive/accessories', conf: 0.78, why: 'accessories keywords' };
  if (hasAny(text, ['brake','فرامل'])) return { key: 'automotive/spare_parts', conf: 0.78, why: 'spare parts keywords' };
  return { key: 'automotive/spare_parts', conf: 0.70, why: 'default spare parts' };
}

function mapGroceries(sub: string | null | undefined): { key: string; conf: number; why: string } {
  const s = String(sub ?? '').trim();
  switch (s as GrocerySubcategoryKey) {
    case 'grains': return { key: 'groceries/staples', conf: 0.90, why: 'grocery subcategory grains' };
    case 'dairy': return { key: 'groceries/dairy', conf: 0.90, why: 'grocery subcategory dairy' };
    case 'canned': return { key: 'groceries/canned', conf: 0.88, why: 'grocery subcategory canned' };
    case 'oils': return { key: 'groceries/cooking_oils', conf: 0.86, why: 'grocery subcategory oils' };
    case 'snacks': return { key: 'groceries/snacks', conf: 0.86, why: 'grocery subcategory snacks' };
    case 'breakfast': return { key: 'groceries/staples', conf: 0.78, why: 'grocery subcategory breakfast' };
    case 'produce': return { key: 'groceries/produce', conf: 0.78, why: 'grocery subcategory produce' };
    case 'meat': return { key: 'groceries/meat', conf: 0.78, why: 'grocery subcategory meat' };
    default: return { key: 'groceries/other', conf: 0.65, why: 'grocery default' };
  }
}

function mapBeauty(text: string): { key: string; conf: number; why: string } {
  if (hasAny(text, ['perfume','perfumes','fragrance','cologne','parfum','eau de parfum','eau de toilette','عطر','عطور','بارفان','برفان','بارفيوم','برفيوم','ادو بارفان','ادو تواليت','كولونيا'])) {
    return { key: 'beauty/fragrance', conf: 0.91, why: 'fragrance keywords' };
  }
  if (hasAny(text, ['makeup','cosmetic','cosmetics','lipstick','mascara','foundation','powder','concealer','eyeliner','blush','مكياج','تجميل','روج','ماسكارا','فاونديشن','بودرة','بودره','كونسيلر','ايلاينر'])) {
    return { key: 'beauty/makeup', conf: 0.88, why: 'makeup keywords' };
  }
  if (hasAny(text, ['cream','serum','shampoo','conditioner','soap','body wash','skincare','cleanser','moisturizer','كريم','سيروم','شامبو','بلسم','صابون','غسول','عناية','مرطب'])) {
    return { key: 'beauty/skincare', conf: 0.84, why: 'skincare keywords' };
  }
  return { key: 'beauty/skincare', conf: 0.68, why: 'beauty default' };
}

function mapClothing(text: string): { key: string; conf: number; why: string } {
  if (hasAny(text, ['abaya','dress','fستان','عبايه','عباية','فستان'])) return { key: 'clothing/women', conf: 0.84, why: 'women apparel keywords' };
  if (hasAny(text, ['shirt','t shirt','t-shirt','pants','jeans','hoodie','قميص','تيشيرت','بنطرون','جينز','هودي'])) return { key: 'clothing/men', conf: 0.80, why: 'men apparel keywords' };
  if (hasAny(text, ['shoe','shoes','sneaker','sneakers','حذاء','احذية','أحذية'])) return { key: 'clothing/shoes', conf: 0.83, why: 'shoes keywords' };
  if (hasAny(text, ['bag','handbag','wallet','شنطة','حقيبة','محفظة'])) return { key: 'clothing/accessories', conf: 0.79, why: 'accessories keywords' };
  return { key: 'clothing/other', conf: 0.66, why: 'clothing default' };
}

function mapHome(text: string): { key: string; conf: number; why: string } {
  if (hasAny(text, ['detergent','cleaner','soap','bleach','disinfectant','منظف','منظفات','تعقيم','كلور','صابون','ديتول'])) {
    return { key: 'home/cleaning', conf: 0.80, why: 'cleaning keywords' };
  }
  if (hasAny(text, ['kitchen','cookware','pan','pot','plate','cup','mug','مطبخ','قدر','طنجرة','مقلاة','صحون','كوب'])) {
    return { key: 'home/kitchen', conf: 0.80, why: 'kitchen keywords' };
  }
  return { key: 'home/other', conf: 0.65, why: 'home default' };
}

function mapSports(text: string): { key: string; conf: number; why: string } {
  if (hasAny(text, ['bicycle','bike','cycling','helmet','دراجة','دراجه','بايسكل','خوذة','خوذه'])) return { key: 'sports/cycling', conf: 0.88, why: 'cycling keywords' };
  if (hasAny(text, ['football','basketball','tennis','كرة قدم','كرة سلة','تنس'])) return { key: 'sports/team_sports', conf: 0.82, why: 'sports keywords' };
  if (hasAny(text, ['gym','fitness','dumbbell','yoga','pilates','جيم','لياقة','دمبل','يوغا','بيلاتس'])) return { key: 'sports/fitness', conf: 0.84, why: 'fitness keywords' };
  return { key: 'sports/fitness', conf: 0.66, why: 'sports default' };
}

function mapToys(text: string): { key: string; conf: number; why: string } {
  if (hasAny(text, ['lego','puzzle','بازل'])) return { key: 'toys/educational', conf: 0.82, why: 'educational toy keywords' };
  if (hasAny(text, ['toy','toys','doll','rc','لعبة','العاب','ألعاب','دمية'])) return { key: 'toys/general', conf: 0.76, why: 'toy keywords' };
  return { key: 'toys/general', conf: 0.62, why: 'toys default' };
}

function mapEssentials(text: string): { key: string; conf: number; why: string } {
  if (hasAny(text, ['cat food','dog food','pet','pets','litter','طعام قطط','طعام كلاب','قطط','كلاب','حيوانات'])) return { key: 'essentials/pets', conf: 0.88, why: 'pet keywords' };
  if (hasAny(text, ['baby','infant','newborn','diaper','formula','feeding bottle','طفل','أطفال','رضيع','حفاض','حفاضات','حليب أطفال','رضاعة'])) return { key: 'essentials/baby', conf: 0.86, why: 'baby keywords' };
  if (hasAny(text, ['vitamin','supplement','medical','medicine','ointment','bandage','thermometer','صيدلية','دواء','أدوية','فيتامين','مكمل','مرهم','ضماد','ميزان حرارة'])) return { key: 'essentials/health', conf: 0.84, why: 'health keywords' };
  if (hasAny(text, ['battery','batteries','aa','aaa','alkaline','duracell','energizer','بطارية','بطاريات','دوراسيل'])) return { key: 'essentials/daily_supplies', conf: 0.75, why: 'daily supplies keywords' };
  return { key: 'essentials/daily_supplies', conf: 0.62, why: 'essentials default' };
}

export function inferTaxonomySuggestion(input: {
  mappedTaxonomyKey?: string | null;
  category: CategoryKey;
  subcategory?: string | null;
  name?: string | null;
  description?: string | null;
  siteCategoryRaw?: string | null;
  siteCategoryKey?: CategoryKey;
}): TaxonomySuggestion {
  const mapped = String(input.mappedTaxonomyKey ?? '').trim();
  if (mapped) {
    return { taxonomyKey: mapped, confidence: 0.99, reason: 'domain_mapping', conflict: false, conflictReason: null };
  }

  const text = norm([input.name, input.description, input.siteCategoryRaw].filter(Boolean).join(' | '));
  const siteKey = input.siteCategoryKey ?? 'general';

  let key: string | null = null;
  let confidence = 0.6;
  let reason = 'heuristic';

  if (input.category === 'electronics') {
    const r = mapElectronics(text);
    key = r.key;
    confidence = r.conf;
    reason = r.why;
  } else if (input.category === 'automotive') {
    const r = mapAutomotive(text);
    key = r.key;
    confidence = r.conf;
    reason = r.why;
  } else if (input.category === 'groceries' || input.category === 'beverages') {
    const r = mapGroceries(input.subcategory);
    key = input.category === 'beverages' ? 'groceries/beverages' : r.key;
    confidence = input.category === 'beverages' ? 0.80 : r.conf;
    reason = input.category === 'beverages' ? 'beverages category' : r.why;
  } else if (input.category === 'home') {
    const r = mapHome(text);
    key = r.key;
    confidence = r.conf;
    reason = r.why;
  } else if (input.category === 'beauty') {
    const r = mapBeauty(text);
    key = r.key;
    confidence = r.conf;
    reason = r.why;
  } else if (input.category === 'clothing') {
    const r = mapClothing(text);
    key = r.key;
    confidence = r.conf;
    reason = r.why;
  } else if (input.category === 'sports') {
    const r = mapSports(text);
    key = r.key;
    confidence = r.conf;
    reason = r.why;
  } else if (input.category === 'toys') {
    const r = mapToys(text);
    key = r.key;
    confidence = r.conf;
    reason = r.why;
  } else if (input.category === 'essentials') {
    const r = mapEssentials(text);
    key = r.key;
    confidence = r.conf;
    reason = r.why;
  }

  const top = (k: string) => k.split('/')[0];
  const conflict = Boolean(key) && siteKey !== 'general' && top(key!) !== topCategoryFromSite(siteKey);
  const conflictReason = conflict ? `site=${siteKey} vs inferred=${top(key!)}` : null;
  const finalConfidence = conflict ? Math.max(0.45, confidence - 0.18) : confidence;

  return { taxonomyKey: key, confidence: finalConfidence, reason, conflict, conflictReason };
}

function topCategoryFromSite(site: CategoryKey): string {
  if (site === 'beverages') return 'groceries';
  return site;
}

export function taxonomyKeyToCategoryAndSubcategory(key: string | null | undefined): { category: CategoryKey; subcategory: string | null } {
  const k = String(key ?? '').trim();
  if (!k) return { category: 'general', subcategory: null };
  const root = k.split('/')[0];

  if (root === 'electronics') return { category: 'electronics', subcategory: null };
  if (root === 'automotive') return { category: 'automotive', subcategory: null };
  if (root === 'home') return { category: 'home', subcategory: k === 'home/cleaning' ? 'cleaning' : k === 'home/kitchen' ? 'kitchen' : null };
  if (root === 'beauty') return { category: 'beauty', subcategory: null };
  if (root === 'clothing') return { category: 'clothing', subcategory: null };
  if (root === 'sports') return { category: 'sports', subcategory: null };
  if (root === 'toys') return { category: 'toys', subcategory: null };
  if (root === 'essentials') return { category: 'essentials', subcategory: null };
  if (root === 'groceries') {
    if (k === 'groceries/staples') return { category: 'groceries', subcategory: 'grains' };
    if (k === 'groceries/dairy') return { category: 'groceries', subcategory: 'dairy' };
    if (k === 'groceries/canned') return { category: 'groceries', subcategory: 'canned' };
    if (k === 'groceries/cooking_oils') return { category: 'groceries', subcategory: 'oils' };
    if (k === 'groceries/snacks') return { category: 'groceries', subcategory: 'snacks' };
    if (k === 'groceries/beverages') return { category: 'beverages', subcategory: null };
    return { category: 'groceries', subcategory: null };
  }
  return { category: 'general', subcategory: null };
}
