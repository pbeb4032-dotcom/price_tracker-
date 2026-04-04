import { sql } from 'drizzle-orm';
import { normalizeCatalogText } from './canonicalIdentity';

export type ListingCondition =
  | 'new'
  | 'used'
  | 'refurbished'
  | 'open_box'
  | 'unknown';

export type SourceConditionProfile = {
  sourceId: string;
  domain: string;
  sourceKind?: string | null;
  sourceChannel?: string | null;
  catalogConditionPolicy?: string | null;
  conditionConfidence?: number | null;
};

export type SourceSectionPolicy = {
  id?: string | null;
  sectionKey: string;
  sectionLabel?: string | null;
  sectionUrl?: string | null;
  policyScope: 'allow' | 'block';
  conditionPolicy: string;
  priority?: number | null;
  isActive?: boolean | null;
};

export type SourceConditionContext = {
  source: SourceConditionProfile;
  sectionPolicies: SourceSectionPolicy[];
};

export type ListingConditionDecision = {
  normalizedCondition: ListingCondition;
  publishable: boolean;
  confidence: number;
  reason: string;
  reasons: string[];
  sourcePolicy: 'new_only' | 'mixed' | 'unknown';
  matchedSectionPolicyId: string | null;
  matchedSectionPolicyKey: string | null;
  matchedSectionPolicyScope: 'allow' | 'block' | null;
  evidence: Record<string, unknown>;
};

const USED_PATTERNS = [
  /\bused\b/i,
  /\bsecond[\s-]?hand\b/i,
  /\bpre[\s-]?owned\b/i,
  /\bpreviously used\b/i,
  /\blike[\s-]?new\b/i,
  /\bشبه جديد\b/i,
  /\bمستعمل\b/i,
  /\bمستخدم\b/i,
  /\bاستعمال\b/i,
];

const REFURBISHED_PATTERNS = [
  /\brefurb(?:ished)?\b/i,
  /\brenew(?:ed)?\b/i,
  /\breconditioned\b/i,
  /\bمجدد\b/i,
  /\bمجدده\b/i,
  /\bمعاد تجديده\b/i,
];

const OPEN_BOX_PATTERNS = [
  /\bopen[\s-]?box\b/i,
  /\bbox[\s-]?opened\b/i,
  /\bdamaged[\s-]?box\b/i,
  /\bمفتوح(?:ة)?\b/i,
  /\bمفتوح الكرتون\b/i,
  /\bمفتوحه الكرتون\b/i,
  /\bبدون كرتون\b/i,
];

const EXPLICIT_NEW_PATTERNS = [
  /\bbrand[\s-]?new\b/i,
  /\bnew arrival\b/i,
  /\bsealed\b/i,
  /\bunopened\b/i,
  /\bجديد\b/i,
  /\bجديد اصلي\b/i,
  /\bغير مستعمل\b/i,
];

function clamp01(value: number | null | undefined, fallback: number): number {
  const n = Number(value ?? fallback);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

function normalizePolicy(value: unknown): 'new_only' | 'mixed' | 'unknown' {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'new_only' || normalized === 'new-only' || normalized === 'new') return 'new_only';
  if (normalized === 'mixed') return 'mixed';
  return 'unknown';
}

function isMixedSource(source: SourceConditionProfile, policy: 'new_only' | 'mixed' | 'unknown'): boolean {
  if (policy === 'mixed') return true;
  const kind = String(source.sourceKind ?? '').toLowerCase();
  const channel = String(source.sourceChannel ?? '').toLowerCase();
  return kind === 'marketplace' || channel === 'marketplace' || channel === 'social_commerce';
}

function normalizeSectionUrl(sectionUrl: string | null | undefined): string | null {
  const raw = String(sectionUrl ?? '').trim();
  if (!raw) return null;
  try {
    const parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://section.local${raw}`);
    return parsed.pathname.replace(/\/+$/, '') || '/';
  } catch {
    return raw.replace(/[?#].*$/, '').replace(/\/+$/, '') || '/';
  }
}

function extractPath(urlValue: string | null | undefined): string {
  const raw = String(urlValue ?? '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    return `${parsed.pathname}${parsed.search}`.toLowerCase();
  } catch {
    return raw.toLowerCase();
  }
}

function extractSignals(texts: Array<string | null | undefined>) {
  const combined = normalizeCatalogText(texts.filter(Boolean).join(' '));
  const raw = texts.filter(Boolean).join(' ').toLowerCase();
  const matches = {
    used: USED_PATTERNS.some((pattern) => pattern.test(raw) || pattern.test(combined)),
    refurbished: REFURBISHED_PATTERNS.some((pattern) => pattern.test(raw) || pattern.test(combined)),
    openBox: OPEN_BOX_PATTERNS.some((pattern) => pattern.test(raw) || pattern.test(combined)),
    explicitNew: EXPLICIT_NEW_PATTERNS.some((pattern) => pattern.test(raw) || pattern.test(combined)),
  };
  return { combined, matches };
}

function matchSectionPolicy(
  policies: SourceSectionPolicy[],
  input: {
    sourceUrl?: string | null;
    canonicalUrl?: string | null;
    siteCategory?: string | null;
    categoryHint?: string | null;
    taxonomyHint?: string | null;
  },
): SourceSectionPolicy | null {
  if (!policies.length) return null;
  const path = extractPath(input.canonicalUrl ?? input.sourceUrl ?? null);
  const normalizedSite = normalizeCatalogText(input.siteCategory ?? '');
  const normalizedCategory = normalizeCatalogText(input.categoryHint ?? '');
  const normalizedTaxonomy = normalizeCatalogText(input.taxonomyHint ?? '');

  const ranked = [...policies]
    .filter((policy) => policy.isActive !== false)
    .sort((a, b) => Number(a.priority ?? 100) - Number(b.priority ?? 100));

  for (const policy of ranked) {
    const sectionPath = normalizeSectionUrl(policy.sectionUrl);
    if (sectionPath && path.startsWith(sectionPath.toLowerCase())) return policy;

    const sectionKey = normalizeCatalogText(policy.sectionKey ?? '');
    if (sectionKey) {
      if (normalizedSite.includes(sectionKey) || normalizedCategory.includes(sectionKey) || normalizedTaxonomy.includes(sectionKey)) {
        return policy;
      }
      const compactKey = sectionKey.replace(/\s+/g, '_');
      if (path.includes(compactKey) || path.includes(sectionKey.replace(/\s+/g, '-'))) return policy;
    }
  }

  return null;
}

export function assessListingCondition(input: {
  source: SourceConditionProfile;
  sectionPolicies?: SourceSectionPolicy[];
  sourceUrl?: string | null;
  canonicalUrl?: string | null;
  productName?: string | null;
  description?: string | null;
  siteCategory?: string | null;
  categoryHint?: string | null;
  taxonomyHint?: string | null;
}): ListingConditionDecision {
  const sourcePolicy = normalizePolicy(input.source.catalogConditionPolicy);
  const signals = extractSignals([
    input.productName,
    input.description,
    input.sourceUrl,
    input.canonicalUrl,
    input.siteCategory,
    input.categoryHint,
    input.taxonomyHint,
  ]);
  const matchedSectionPolicy = matchSectionPolicy(input.sectionPolicies ?? [], input);
  const matchedSectionPolicyId = matchedSectionPolicy?.id ? String(matchedSectionPolicy.id) : null;
  const matchedSectionPolicyKey = matchedSectionPolicy?.sectionKey ? String(matchedSectionPolicy.sectionKey) : null;
  const matchedSectionPolicyScope = matchedSectionPolicy?.policyScope ?? null;
  const matchedPolicyCondition = normalizePolicy(matchedSectionPolicy?.conditionPolicy ?? null);

  let normalizedCondition: ListingCondition = 'unknown';
  const reasons: string[] = [];
  let publishable = false;
  let confidence = 0.5;
  let reason = 'listing_condition_unknown';

  if (signals.matches.refurbished) {
    normalizedCondition = 'refurbished';
    reasons.push('listing_condition_refurbished');
    confidence = 0.99;
    reason = 'listing_condition_refurbished';
  } else if (signals.matches.openBox) {
    normalizedCondition = 'open_box';
    reasons.push('listing_condition_open_box');
    confidence = 0.98;
    reason = 'listing_condition_open_box';
  } else if (signals.matches.used) {
    normalizedCondition = 'used';
    reasons.push('listing_condition_used');
    confidence = 0.99;
    reason = 'listing_condition_used';
  } else {
    normalizedCondition = 'new';
  }

  if (normalizedCondition !== 'new') {
    publishable = false;
  } else if (matchedSectionPolicyScope === 'block') {
    normalizedCondition = 'unknown';
    publishable = false;
    confidence = 0.9;
    reason = 'source_section_blocked';
    reasons.push('source_section_blocked');
  } else if (matchedSectionPolicy && matchedPolicyCondition === 'new_only') {
    publishable = true;
    confidence = Math.max(0.86, clamp01(input.source.conditionConfidence, 0.78));
    reason = 'section_allowlist_new_only';
    reasons.push('section_allowlist_new_only');
  } else if (isMixedSource(input.source, sourcePolicy)) {
    normalizedCondition = 'unknown';
    publishable = false;
    confidence = matchedSectionPolicy ? 0.78 : 0.88;
    reason = matchedSectionPolicy ? 'section_policy_not_new_only' : 'mixed_source_requires_section_allowlist';
    reasons.push(reason);
  } else if (sourcePolicy === 'new_only') {
    publishable = true;
    confidence = Math.max(0.84, clamp01(input.source.conditionConfidence, 0.8));
    reason = 'source_policy_new_only';
    reasons.push('source_policy_new_only');
  } else if (String(input.source.sourceKind ?? '').toLowerCase() === 'official' || String(input.source.sourceKind ?? '').toLowerCase() === 'retailer') {
    publishable = true;
    confidence = signals.matches.explicitNew ? 0.84 : Math.max(0.72, clamp01(input.source.conditionConfidence, 0.72));
    reason = signals.matches.explicitNew ? 'explicit_new_signal' : 'retailer_default_new_policy';
    reasons.push(reason);
  } else if (signals.matches.explicitNew) {
    publishable = true;
    confidence = 0.74;
    reason = 'explicit_new_signal';
    reasons.push('explicit_new_signal');
  } else {
    normalizedCondition = 'unknown';
    publishable = false;
    confidence = 0.55;
    reason = 'listing_condition_unknown';
    reasons.push('listing_condition_unknown');
  }

  return {
    normalizedCondition,
    publishable,
    confidence: Number(confidence.toFixed(4)),
    reason,
    reasons,
    sourcePolicy,
    matchedSectionPolicyId,
    matchedSectionPolicyKey,
    matchedSectionPolicyScope,
    evidence: {
      signals: signals.matches,
      source_kind: input.source.sourceKind ?? null,
      source_channel: input.source.sourceChannel ?? null,
      source_policy: sourcePolicy,
      matched_section_policy_key: matchedSectionPolicyKey,
      matched_section_policy_scope: matchedSectionPolicyScope,
      matched_section_policy_condition: matchedPolicyCondition,
    },
  };
}

export async function loadSourceConditionContext(db: any, sourceId: string): Promise<SourceConditionContext> {
  const sourceRes = await db.execute(sql`
    select
      id,
      domain,
      source_kind,
      source_channel,
      catalog_condition_policy,
      condition_confidence
    from public.price_sources
    where id = ${sourceId}::uuid
    limit 1
  `).catch(() => ({ rows: [] as any[] }));
  const sourceRow = (sourceRes.rows as any[])[0] ?? null;
  if (!sourceRow) {
    return {
      source: {
        sourceId,
        domain: '',
        sourceKind: 'retailer',
        sourceChannel: 'website',
        catalogConditionPolicy: 'unknown',
        conditionConfidence: 0.5,
      },
      sectionPolicies: [],
    };
  }

  const policiesRes = await db.execute(sql`
    select
      id,
      section_key,
      section_label,
      section_url,
      policy_scope,
      condition_policy,
      priority,
      is_active
    from public.source_section_policies
    where source_id = ${sourceId}::uuid
      and is_active = true
    order by priority asc, created_at asc
  `).catch(() => ({ rows: [] as any[] }));

  return {
    source: {
      sourceId: String(sourceRow.id),
      domain: String(sourceRow.domain ?? ''),
      sourceKind: sourceRow.source_kind ? String(sourceRow.source_kind) : null,
      sourceChannel: sourceRow.source_channel ? String(sourceRow.source_channel) : null,
      catalogConditionPolicy: sourceRow.catalog_condition_policy ? String(sourceRow.catalog_condition_policy) : null,
      conditionConfidence: sourceRow.condition_confidence == null ? null : Number(sourceRow.condition_confidence),
    },
    sectionPolicies: ((policiesRes.rows as any[]) ?? []).map((row) => ({
      id: row.id ? String(row.id) : null,
      sectionKey: String(row.section_key ?? ''),
      sectionLabel: row.section_label ? String(row.section_label) : null,
      sectionUrl: row.section_url ? String(row.section_url) : null,
      policyScope: String(row.policy_scope ?? 'allow').toLowerCase() === 'block' ? 'block' : 'allow',
      conditionPolicy: String(row.condition_policy ?? 'new_only'),
      priority: Number(row.priority ?? 100),
      isActive: Boolean(row.is_active ?? true),
    })),
  };
}
