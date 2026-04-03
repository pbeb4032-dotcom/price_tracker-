/**
 * Shkad Aadel — Arabic label helpers for categories and regions.
 */

// ---- Category Arabic Labels ----

const CATEGORY_AR: Record<string, string> = {
  vegetables: 'خضروات',
  grains: 'حبوب',
  fruits: 'فواكه',
  dairy: 'ألبان',
  meat: 'لحوم',
  poultry: 'دواجن',
  fish: 'أسماك',
  oils: 'زيوت',
  spices: 'بهارات',
  beverages: 'مشروبات',
  others: 'أخرى',
};

export function getCategoryLabel(category: string): string {
  if (!category) return 'غير مصنفة';
  return CATEGORY_AR[category] ?? 'غير مصنفة';
}

// ---- Region Arabic Fallback ----

const REGION_AR: Record<string, string> = {
  Baghdad: 'بغداد',
  Basra: 'البصرة',
  Nineveh: 'نينوى',
  Erbil: 'أربيل',
  Duhok: 'دهوك',
  Sulaymaniyah: 'السليمانية',
  Kirkuk: 'كركوك',
  Najaf: 'النجف',
  Karbala: 'كربلاء',
  Babylon: 'بابل',
  Wasit: 'واسط',
  Diyala: 'ديالى',
  Saladin: 'صلاح الدين',
  Anbar: 'الأنبار',
  'Dhi Qar': 'ذي قار',
  Maysan: 'ميسان',
  Muthanna: 'المثنى',
  Qadisiyah: 'القادسية',
};

export function getRegionLabel(regionNameAr: string, regionNameEn: string): string {
  if (regionNameAr && regionNameAr !== '—') return regionNameAr;
  if (regionNameEn) return REGION_AR[regionNameEn] ?? regionNameEn;
  return 'غير محددة';
}
