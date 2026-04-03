import { sql } from 'drizzle-orm';

export type OverrideMatchKind = 'source_id' | 'domain' | 'pattern';

export type CategoryOverrideRow = {
  id: string;
  match_kind: OverrideMatchKind;
  match_value: string;
  category: string;
  subcategory: string | null;
  priority: number;
  lock_category: boolean;
  lock_subcategory: boolean;
  is_active: boolean;
  note?: string | null;
};

function safeRegex(pattern: string): RegExp | null {
  try {
    return new RegExp(String(pattern), 'i');
  } catch {
    return null;
  }
}

function normalizeText(value: unknown): string {
  return String(value ?? '')
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

export async function loadCategoryOverrides(db: any): Promise<CategoryOverrideRow[]> {
  try {
    const r = await db.execute(sql`
      select id, match_kind, match_value, category, subcategory, priority,
             lock_category, lock_subcategory, is_active, note
      from public.category_overrides
      where is_active = true
      order by priority asc, created_at asc
      limit 500
    `);

    return ((r.rows as any[]) ?? []).map((x) => ({
      id: String(x.id),
      match_kind: String(x.match_kind) as OverrideMatchKind,
      match_value: String(x.match_value),
      category: String(x.category),
      subcategory: x.subcategory ? String(x.subcategory) : null,
      priority: Number(x.priority ?? 100),
      lock_category: Boolean(x.lock_category ?? true),
      lock_subcategory: Boolean(x.lock_subcategory ?? true),
      is_active: Boolean(x.is_active ?? true),
      note: x.note ? String(x.note) : null,
    }));
  } catch {
    return [];
  }
}

export function matchCategoryOverride(
  overrides: CategoryOverrideRow[],
  input: {
    sourceId?: string | null;
    domain?: string | null;
    url?: string | null;
    name?: string | null;
    description?: string | null;
  },
): CategoryOverrideRow | null {
  if (!overrides?.length) return null;

  const sourceId = input.sourceId ? String(input.sourceId) : null;
  const domain = input.domain ? String(input.domain).toLowerCase().replace(/^www\./, '') : null;
  const textNorm = normalizeText([input.name, input.description, input.url, input.domain].filter(Boolean).join(' | '));

  for (const o of overrides) {
    if (!o.is_active) continue;

    if (o.match_kind === 'source_id') {
      if (sourceId && o.match_value === sourceId) return o;
      continue;
    }

    if (o.match_kind === 'domain') {
      const mv = String(o.match_value || '').toLowerCase().replace(/^www\./, '');
      if (domain && mv && domain === mv) return o;
      continue;
    }

    if (o.match_kind === 'pattern') {
      const re = safeRegex(o.match_value);
      if (re && re.test(textNorm)) return o;
      // Fallback: plain substring when regex fails
      const mv = normalizeText(o.match_value);
      if (mv && mv.length >= 3 && textNorm.includes(mv)) return o;
      continue;
    }
  }

  return null;
}
