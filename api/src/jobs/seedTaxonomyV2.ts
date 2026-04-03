import { sql } from 'drizzle-orm';
import { getDb, type Env } from '../db';

type NodeSeed = {
  key: string;
  parent_key: string | null;
  label_ar: string;
  label_en: string;
  synonyms: string[];
  is_leaf: boolean;
};

const NODES: NodeSeed[] = [
  // Automotive
  { key: 'automotive', parent_key: null, label_ar: 'سيارات', label_en: 'Automotive', synonyms: ['سيارات','سيارة','اوتوموتيف','automotive','car'], is_leaf: false },
  { key: 'automotive/oils', parent_key: 'automotive', label_ar: 'زيوت', label_en: 'Oils', synonyms: ['زيوت','oil','oils','زيت'], is_leaf: false },
  { key: 'automotive/oils/engine', parent_key: 'automotive/oils', label_ar: 'زيت محرك', label_en: 'Engine Oil', synonyms: ['زيت محرك','engine oil','motor oil','5w-30','10w-40','sae','acea','dexos','api sn','api sp','fully synthetic','زيت مكينة','زيت مكينه','زيت سيارات'], is_leaf: true },
  { key: 'automotive/oils/gear', parent_key: 'automotive/oils', label_ar: 'زيت قير', label_en: 'Gear Oil', synonyms: ['زيت قير','gear oil','transmission oil','atf','manual transmission'], is_leaf: true },
  { key: 'automotive/oils/brake', parent_key: 'automotive/oils', label_ar: 'زيت/سائل فرامل', label_en: 'Brake Fluid', synonyms: ['زيت فرامل','سائل فرامل','brake fluid','dot3','dot4','dot5'], is_leaf: true },
  { key: 'automotive/tires', parent_key: 'automotive', label_ar: 'إطارات', label_en: 'Tires', synonyms: ['اطار','اطارات','إطارات','tire','tires','tyre','tyres','تاير'], is_leaf: true },
  { key: 'automotive/batteries', parent_key: 'automotive', label_ar: 'بطاريات سيارات', label_en: 'Car Batteries', synonyms: ['بطارية سيارة','بطاريات سيارات','car battery','بطاريه سياره','بطاريه سيارة'], is_leaf: true },
  { key: 'automotive/spare_parts', parent_key: 'automotive', label_ar: 'قطع غيار', label_en: 'Spare Parts', synonyms: ['قطع غيار','سبير','spare parts','brake','فرامل','فلتر','filter','spark plug','بوجيه'], is_leaf: true },
  { key: 'automotive/accessories', parent_key: 'automotive', label_ar: 'إكسسوارات', label_en: 'Accessories', synonyms: ['اكسسوار','اكسسوارات','زينة','accessory','accessories'], is_leaf: true },

  // Groceries
  { key: 'groceries', parent_key: null, label_ar: 'بقالة', label_en: 'Groceries', synonyms: ['بقالة','مواد غذائية','مواد غذائيه','groceries','grocery','food'], is_leaf: false },
  { key: 'groceries/staples', parent_key: 'groceries', label_ar: 'مواد أساسية', label_en: 'Staples', synonyms: ['رز','rice','بسمتي','basmati','سكر','sugar','طحين','دقيق','flour','معكرونة','pasta','عدس','lentils'], is_leaf: true },
  { key: 'groceries/dairy', parent_key: 'groceries', label_ar: 'ألبان', label_en: 'Dairy', synonyms: ['حليب','milk','لبن','yogurt','زبادي','جبن','cheese','قشطة','cream','زبدة','butter','لبنة'], is_leaf: true },
  { key: 'groceries/canned', parent_key: 'groceries', label_ar: 'معلبات', label_en: 'Canned', synonyms: ['معلبات','canned','تونة','tuna','معجون طماطم','tomato paste','كاتشب','ketchup','صلصة','sauce','مربى','jam'], is_leaf: true },
  { key: 'groceries/cooking_oils', parent_key: 'groceries', label_ar: 'زيوت طبخ', label_en: 'Cooking Oils', synonyms: ['زيت طبخ','زيت نباتي','زيت زيتون','olive oil','cooking oil','sunflower oil','vegetable oil','زيت دوار الشمس'], is_leaf: true },
  { key: 'groceries/snacks', parent_key: 'groceries', label_ar: 'تسالي وحلويات', label_en: 'Snacks', synonyms: ['شبس','chips','بسكويت','biscuits','كوكيز','cookies','شوكولاتة','chocolate','حلويات','candy','مكسرات','nuts'], is_leaf: true },
  { key: 'groceries/beverages', parent_key: 'groceries', label_ar: 'مشروبات', label_en: 'Beverages', synonyms: ['مشروبات','عصير','juice','شاي','tea','قهوة','coffee','ماء','water','cola','soda','energy'], is_leaf: true },
  { key: 'groceries/produce', parent_key: 'groceries', label_ar: 'خضار وفواكه', label_en: 'Produce', synonyms: ['خضار','فواكه','vegetables','fruits','طماطم','tomato','بطاطا','potato','تفاح','apple','موز','banana'], is_leaf: true },
  { key: 'groceries/meat', parent_key: 'groceries', label_ar: 'لحوم ودواجن', label_en: 'Meat', synonyms: ['لحم','meat','دجاج','chicken','سمك','fish','غنم','lamb','بقر','beef'], is_leaf: true },
  { key: 'groceries/other', parent_key: 'groceries', label_ar: 'أخرى', label_en: 'Other', synonyms: ['groceries other','misc'], is_leaf: true },

  // Electronics
  { key: 'electronics', parent_key: null, label_ar: 'إلكترونيات', label_en: 'Electronics', synonyms: ['الكترونيات','إلكترونيات','electronics','tech'], is_leaf: false },
  { key: 'electronics/phones', parent_key: 'electronics', label_ar: 'هواتف', label_en: 'Phones', synonyms: ['هاتف','موبايل','جوال','ايفون','iphone','samsung','galaxy','android'], is_leaf: true },
  { key: 'electronics/laptops', parent_key: 'electronics', label_ar: 'لابتوبات', label_en: 'Laptops', synonyms: ['لابتوب','laptop','notebook','macbook','كمبيوتر','حاسبة','حاسبه','pc'], is_leaf: true },
  { key: 'electronics/chargers_cables', parent_key: 'electronics', label_ar: 'شواحن وكوابل', label_en: 'Chargers & Cables', synonyms: ['شاحن','كيبل','سلك','charger','cable','usb','type c','type-c','power bank','باور بانك'], is_leaf: true },
  { key: 'electronics/audio', parent_key: 'electronics', label_ar: 'سماعات وصوتيات', label_en: 'Audio', synonyms: ['سماعة','سماعه','speaker','earbuds','headphone','headphones','bluetooth','ايربودز'], is_leaf: true },
  { key: 'electronics/tablets', parent_key: 'electronics', label_ar: 'تابلت', label_en: 'Tablets', synonyms: ['تابلت','ايباد','ipad','tablet'], is_leaf: true },
  { key: 'electronics/accessories', parent_key: 'electronics', label_ar: 'إكسسوارات', label_en: 'Accessories', synonyms: ['كفر','حماية شاشة','case','screen protector','memory','sd card','ميموري'], is_leaf: true },

  // Home
  { key: 'home', parent_key: null, label_ar: 'منزل', label_en: 'Home', synonyms: ['منزل','منزلية','home','house'], is_leaf: false },
  { key: 'home/cleaning', parent_key: 'home', label_ar: 'منظفات', label_en: 'Cleaning', synonyms: ['منظف','منظفات','detergent','cleaner','bleach','disinfectant','ديتول','كلور'], is_leaf: true },
  { key: 'home/kitchen', parent_key: 'home', label_ar: 'مطبخ', label_en: 'Kitchen', synonyms: ['مطبخ','kitchen','cookware','pan','pot','plate','cup','mug','صحون','طنجرة','مقلاة'], is_leaf: true },
  { key: 'home/other', parent_key: 'home', label_ar: 'أخرى', label_en: 'Other', synonyms: ['home other','misc'], is_leaf: true },

  // Beauty
  { key: 'beauty', parent_key: null, label_ar: 'تجميل وعناية', label_en: 'Beauty', synonyms: ['beauty','cosmetics','makeup','fragrance','عناية','تجميل','مكياج','عطور'], is_leaf: false },
  { key: 'beauty/makeup', parent_key: 'beauty', label_ar: 'مكياج', label_en: 'Makeup', synonyms: ['makeup','cosmetics','lipstick','mascara','foundation','powder','روج','ماسكارا','فاونديشن','بودرة'], is_leaf: true },
  { key: 'beauty/skincare', parent_key: 'beauty', label_ar: 'عناية بالبشرة', label_en: 'Skincare', synonyms: ['skincare','cleanser','moisturizer','cream','serum','شامبو','بلسم','غسول','مرطب','كريم','سيروم'], is_leaf: true },
  { key: 'beauty/fragrance', parent_key: 'beauty', label_ar: 'عطور', label_en: 'Fragrance', synonyms: ['perfume','fragrance','cologne','parfum','عطر','عطور','بارفان','برفان','بارفيوم','كولونيا'], is_leaf: true },

  // Clothing
  { key: 'clothing', parent_key: null, label_ar: 'ملابس وأزياء', label_en: 'Clothing', synonyms: ['clothing','fashion','apparel','ملابس','موضة','أزياء'], is_leaf: false },
  { key: 'clothing/men', parent_key: 'clothing', label_ar: 'رجالي', label_en: 'Men', synonyms: ['shirt','pants','jeans','hoodie','قميص','تيشيرت','بنطرون','جينز','هودي'], is_leaf: true },
  { key: 'clothing/women', parent_key: 'clothing', label_ar: 'نسائي', label_en: 'Women', synonyms: ['abaya','dress','عباية','عبايه','فستان'], is_leaf: true },
  { key: 'clothing/shoes', parent_key: 'clothing', label_ar: 'أحذية', label_en: 'Shoes', synonyms: ['shoe','shoes','sneaker','sneakers','حذاء','أحذية','احذية'], is_leaf: true },
  { key: 'clothing/accessories', parent_key: 'clothing', label_ar: 'إكسسوارات', label_en: 'Accessories', synonyms: ['bag','handbag','wallet','شنطة','حقيبة','محفظة'], is_leaf: true },
  { key: 'clothing/other', parent_key: 'clothing', label_ar: 'أخرى', label_en: 'Other', synonyms: ['clothing other'], is_leaf: true },

  // Sports
  { key: 'sports', parent_key: null, label_ar: 'رياضة', label_en: 'Sports', synonyms: ['sports','fitness','رياضة','لياقة'], is_leaf: false },
  { key: 'sports/fitness', parent_key: 'sports', label_ar: 'لياقة', label_en: 'Fitness', synonyms: ['gym','fitness','dumbbell','yoga','pilates','جيم','لياقة','دمبل','يوغا'], is_leaf: true },
  { key: 'sports/team_sports', parent_key: 'sports', label_ar: 'رياضات جماعية', label_en: 'Team Sports', synonyms: ['football','basketball','tennis','كرة قدم','كرة سلة','تنس'], is_leaf: true },
  { key: 'sports/cycling', parent_key: 'sports', label_ar: 'دراجات', label_en: 'Cycling', synonyms: ['bicycle','bike','cycling','helmet','دراجة','دراجه','بايسكل','خوذة'], is_leaf: true },

  // Toys
  { key: 'toys', parent_key: null, label_ar: 'ألعاب', label_en: 'Toys', synonyms: ['toys','toy','العاب','ألعاب'], is_leaf: false },
  { key: 'toys/general', parent_key: 'toys', label_ar: 'ألعاب عامة', label_en: 'General Toys', synonyms: ['toy','toys','doll','rc','لعبة','العاب','ألعاب','دمية'], is_leaf: true },
  { key: 'toys/educational', parent_key: 'toys', label_ar: 'ألعاب تعليمية', label_en: 'Educational Toys', synonyms: ['lego','puzzle','بازل'], is_leaf: true },

  // Essentials
  { key: 'essentials', parent_key: null, label_ar: 'أساسيات', label_en: 'Essentials', synonyms: ['essentials','أساسيات','صيدلية','طفل','حيوانات'], is_leaf: false },
  { key: 'essentials/health', parent_key: 'essentials', label_ar: 'صحة وصيدلية', label_en: 'Health', synonyms: ['pharmacy','medical','medicine','vitamin','supplement','صيدلية','دواء','أدوية','فيتامين','مكمل'], is_leaf: true },
  { key: 'essentials/baby', parent_key: 'essentials', label_ar: 'مستلزمات أطفال', label_en: 'Baby', synonyms: ['baby','infant','diaper','formula','feeding bottle','طفل','رضيع','حفاض','حفاضات','رضاعة'], is_leaf: true },
  { key: 'essentials/pets', parent_key: 'essentials', label_ar: 'حيوانات أليفة', label_en: 'Pets', synonyms: ['pet','pets','cat food','dog food','قطط','كلاب','حيوانات','طعام قطط','طعام كلاب'], is_leaf: true },
  { key: 'essentials/daily_supplies', parent_key: 'essentials', label_ar: 'مستلزمات يومية', label_en: 'Daily Supplies', synonyms: ['battery','batteries','aa','aaa','alkaline','duracell','energizer','بطارية','بطاريات','دوراسيل'], is_leaf: true },
];

export async function seedTaxonomyV2(env: Env): Promise<any> {
  const db = getDb(env);

  let upserted = 0;
  for (const n of NODES) {
    await db.execute(sql`
      insert into public.taxonomy_nodes (key, parent_key, label_ar, label_en, synonyms, is_leaf)
      values (${n.key}, ${n.parent_key}, ${n.label_ar}, ${n.label_en}, ${n.synonyms}::text[], ${n.is_leaf})
      on conflict (key) do update set
        parent_key = excluded.parent_key,
        label_ar = coalesce(public.taxonomy_nodes.label_ar, excluded.label_ar),
        label_en = coalesce(public.taxonomy_nodes.label_en, excluded.label_en),
        is_leaf = excluded.is_leaf,
        synonyms = (
          select array(
            select distinct unnest(coalesce(public.taxonomy_nodes.synonyms, '{}'::text[]) || coalesce(excluded.synonyms, '{}'::text[]))
          )
        ),
        updated_at = now()
    `).catch(() => {});
    upserted++;
  }

  const total = await db.execute(sql`select count(*)::int as n from public.taxonomy_nodes`).catch(() => ({ rows: [{ n: upserted }] } as any));

  return { ok: true, upserted, total_nodes: (total.rows as any[])[0]?.n ?? upserted };
}
