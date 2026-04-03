import { sql } from 'drizzle-orm';
import { getDb, type Env } from '../db';

export const IRAQ_PROVINCES: string[] = [
  'بغداد',
  'البصرة',
  'نينوى',
  'أربيل',
  'النجف',
  'كربلاء',
  'السليمانية',
  'دهوك',
  'ذي قار',
  'بابل',
  'ديالى',
  'صلاح الدين',
  'الأنبار',
  'المثنى',
  'واسط',
  'القادسية',
  'كركوك',
  'ميسان',
  'حلبجة',
];

export const DISCOVERY_SECTORS: string[] = [
  'سوبرماركت',
  'الكترونيات',
  'موبايلات',
  'ملابس',
  'أحذية',
  'صيدلية',
  'عطور',
  'أجهزة منزلية',
  'أثاث',
  'مواد بناء',
  'سيارات',
  'رياضة',
  'أطفال',
  'مكياج',
  'كتب',
];

type Bucket = { name: string; count: number };

async function jsonbArrayCounts(db: any, key: 'provinces' | 'sectors'): Promise<Map<string, number>> {
  const r = await db
    .execute(sql`
      with tagged as (
        select
          ps.id,
          jsonb_array_elements_text(coalesce(ps.discovery_tags->${key}, '[]'::jsonb)) as tag
        from public.price_sources ps
        where ps.country_code='IQ'
          and ps.is_active = true
      )
      select tag, count(distinct id)::int as count
      from tagged
      group by tag
    `)
    .catch(() => ({ rows: [] as any[] }));

  const m = new Map<string, number>();
  for (const row of (r.rows as any[]) ?? []) {
    const k = String((row as any).tag ?? '').trim();
    if (!k) continue;
    m.set(k, Number((row as any).count ?? 0));
  }
  return m;
}

export async function getCoverageStats(env: Env): Promise<any> {
  const db = getDb(env);

  const totals = await db
    .execute(sql`
      select
        count(*)::int as total,
        count(*) filter (where is_active=true)::int as active,
        count(*) filter (where lifecycle_status='candidate')::int as candidates
      from public.price_sources
      where country_code='IQ'
    `)
    .catch(() => ({ rows: [] as any[] }));

  const provinceCounts = await jsonbArrayCounts(db, 'provinces');
  const sectorCounts = await jsonbArrayCounts(db, 'sectors');

  const provinces: Bucket[] = IRAQ_PROVINCES.map((p) => ({ name: p, count: provinceCounts.get(p) ?? 0 }))
    .sort((a, b) => a.count - b.count || a.name.localeCompare(b.name, 'ar'));

  const sectors: Bucket[] = DISCOVERY_SECTORS.map((s) => ({ name: s, count: sectorCounts.get(s) ?? 0 }))
    .sort((a, b) => a.count - b.count || a.name.localeCompare(b.name, 'ar'));

  const unknown = await db
    .execute(sql`
      select
        count(*) filter (where is_active=true and (discovery_tags->'provinces' is null or jsonb_array_length(coalesce(discovery_tags->'provinces','[]'::jsonb))=0))::int as active_without_province,
        count(*) filter (where is_active=true and (discovery_tags->'sectors' is null or jsonb_array_length(coalesce(discovery_tags->'sectors','[]'::jsonb))=0))::int as active_without_sector
      from public.price_sources
      where country_code='IQ'
    `)
    .catch(() => ({ rows: [] as any[] }));

  const t = (totals.rows as any[])[0] ?? {};
  const u = (unknown.rows as any[])[0] ?? {};

  return {
    ok: true,
    totals: {
      total: Number(t.total ?? 0),
      active: Number(t.active ?? 0),
      candidates: Number(t.candidates ?? 0),
      active_without_province: Number(u.active_without_province ?? 0),
      active_without_sector: Number(u.active_without_sector ?? 0),
    },
    provinces,
    sectors,
  };
}
