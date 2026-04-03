export type GrocerySubcategoryKey =
  | 'all'
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
  | 'bakery';

export const GROCERY_SUBCATEGORIES: { key: GrocerySubcategoryKey; label: string }[] = [
  { key: 'all', label: 'الكل' },
  { key: 'grains', label: 'حبوب ورز' },
  { key: 'dairy', label: 'ألبان' },
  { key: 'meat', label: 'لحوم ودواجن' },
  { key: 'produce', label: 'خضار وفواكه' },
  { key: 'oils', label: 'زيوت وسمن' },
  { key: 'spices', label: 'بهارات' },
  { key: 'canned', label: 'معلبات' },
  { key: 'snacks', label: 'تسالي وحلويات' },
  { key: 'breakfast', label: 'فطور' },
  { key: 'frozen', label: 'مجمدات' },
  { key: 'bakery', label: 'مخبوزات' },
];

export function getGrocerySubcategoryLabel(key: string | null | undefined): string | null {
  const k = String(key ?? '').trim();
  if (!k || k === 'all') return null;
  const found = GROCERY_SUBCATEGORIES.find((x) => x.key === (k as any));
  return found?.label ?? k;
}
