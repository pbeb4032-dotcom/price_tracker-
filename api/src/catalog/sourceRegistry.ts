import { sql } from 'drizzle-orm';

export const DEFAULT_PRODUCT_REGEX = String.raw`\/(product|products|p|item|dp)\/`;
export const DEFAULT_CATEGORY_REGEX = String.raw`\/(category|categories|collections|shop|store|department|c|offers)\/`;

export type SourceKind = 'retailer' | 'marketplace' | 'official';
export type SourceChannel =
  | 'website'
  | 'marketplace'
  | 'grocery_app'
  | 'mobile_app'
  | 'social_commerce'
  | 'brand_store'
  | 'aggregator'
  | 'api_feed'
  | 'other';
export type AdapterStrategy =
  | 'html_sitemap'
  | 'rendered_html'
  | 'structured_api'
  | 'mobile_api'
  | 'hybrid'
  | 'social_intake';
export type CatalogConditionPolicy = 'new_only' | 'mixed' | 'unknown';

export type GovernedSourceUpsertInput = {
  nameAr: string;
  domain: string;
  baseUrl?: string | null;
  sourceKind?: SourceKind;
  trustWeight?: number | null;
  logoUrl?: string | null;
  sourceChannel?: SourceChannel | null;
  adapterStrategy?: AdapterStrategy | null;
  catalogConditionPolicy?: CatalogConditionPolicy | null;
  conditionConfidence?: number | null;
  onboardingOrigin?: string | null;
  sourcePriority?: number | null;
  sectors?: string[];
  provinces?: string[];
  onboardingMeta?: Record<string, unknown> | null;
};

type ExistingSourceRow = {
  id: string;
  is_active?: boolean | null;
  lifecycle_status?: string | null;
  validation_state?: string | null;
  discovery_tags?: Record<string, unknown> | null;
  onboarding_meta?: Record<string, unknown> | null;
};

const SOURCE_KIND_SET = new Set<SourceKind>(['retailer', 'marketplace', 'official']);
const SOURCE_CHANNEL_SET = new Set<SourceChannel>([
  'website',
  'marketplace',
  'grocery_app',
  'mobile_app',
  'social_commerce',
  'brand_store',
  'aggregator',
  'api_feed',
  'other',
]);
const ADAPTER_STRATEGY_SET = new Set<AdapterStrategy>([
  'html_sitemap',
  'rendered_html',
  'structured_api',
  'mobile_api',
  'hybrid',
  'social_intake',
]);
const CONDITION_POLICY_SET = new Set<CatalogConditionPolicy>(['new_only', 'mixed', 'unknown']);

const clamp = (value: number | null | undefined, min: number, max: number, fallback: number): number => {
  const n = Number(value ?? fallback);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
};

export function normalizeSourceDomain(input: string): string {
  return String(input ?? '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '')
    .replace(/\/$/, '');
}

export function normalizeSourceBaseUrl(input: string | null | undefined, domain?: string | null): string {
  const raw = String(input ?? '').trim();
  if (raw) {
    try {
      const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
      return url.origin.replace(/\/$/, '');
    } catch {
      // fall through to domain-based default
    }
  }
  const safeDomain = normalizeSourceDomain(String(domain ?? ''));
  return safeDomain ? `https://${safeDomain}` : '';
}

export function normalizeSourceKind(input: unknown): SourceKind {
  const normalized = String(input ?? '').trim().toLowerCase();
  return SOURCE_KIND_SET.has(normalized as SourceKind) ? (normalized as SourceKind) : 'retailer';
}

export function normalizeSourceChannel(input: unknown, sourceKind: SourceKind): SourceChannel {
  const normalized = String(input ?? '').trim().toLowerCase();
  if (SOURCE_CHANNEL_SET.has(normalized as SourceChannel)) return normalized as SourceChannel;
  if (sourceKind === 'marketplace') return 'marketplace';
  return 'website';
}

export function normalizeAdapterStrategy(input: unknown): AdapterStrategy {
  const normalized = String(input ?? '').trim().toLowerCase();
  const mapped = (() => {
    if (normalized === 'html' || normalized === 'sitemap' || normalized === 'website') return 'html_sitemap';
    if (normalized === 'js' || normalized === 'rendered' || normalized === 'spa') return 'rendered_html';
    if (normalized === 'api' || normalized === 'feed') return 'structured_api';
    if (normalized === 'app') return 'mobile_api';
    if (normalized === 'social') return 'social_intake';
    return normalized;
  })();
  return ADAPTER_STRATEGY_SET.has(mapped as AdapterStrategy) ? (mapped as AdapterStrategy) : 'html_sitemap';
}

export function normalizeCatalogConditionPolicy(input: unknown): CatalogConditionPolicy {
  const normalized = String(input ?? '').trim().toLowerCase();
  const mapped = (() => {
    if (normalized === 'new' || normalized === 'new-only' || normalized === 'new_only_only') return 'new_only';
    if (normalized === 'new_only' || normalized === 'newonly') return 'new_only';
    if (normalized === 'mixed_marketplace' || normalized === 'mixed_source') return 'mixed';
    if (normalized === 'mixed') return 'mixed';
    return normalized;
  })();
  return CONDITION_POLICY_SET.has(mapped as CatalogConditionPolicy) ? (mapped as CatalogConditionPolicy) : 'unknown';
}

export function normalizeTagList(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of input) {
    const normalized = String(item ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function mergeStringArray(existing: unknown, next: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of [...normalizeTagList(existing), ...next]) {
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

export function mergeDiscoveryTags(
  existing: Record<string, unknown> | null | undefined,
  input: {
    sectors?: string[];
    provinces?: string[];
    sourceChannel: SourceChannel;
    adapterStrategy: AdapterStrategy;
    catalogConditionPolicy: CatalogConditionPolicy;
    onboardingOrigin: string;
  },
): Record<string, unknown> {
  const current = existing && typeof existing === 'object' ? { ...existing } : {};
  const sectors = mergeStringArray((current as any).sectors, input.sectors ?? []);
  const provinces = mergeStringArray((current as any).provinces, input.provinces ?? []);
  return {
    ...current,
    sectors,
    provinces,
    source_channel: input.sourceChannel,
    adapter_strategy: input.adapterStrategy,
    catalog_condition_policy: input.catalogConditionPolicy,
    onboarding_origin: input.onboardingOrigin,
  };
}

export function mergeOnboardingMeta(
  existing: Record<string, unknown> | null | undefined,
  next: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  return {
    ...(existing && typeof existing === 'object' ? existing : {}),
    ...(next && typeof next === 'object' ? next : {}),
    updated_at: new Date().toISOString(),
  };
}

export async function ensureSourceScaffold(db: any, domain: string, baseUrl?: string | null) {
  const base = normalizeSourceBaseUrl(baseUrl, domain).replace(/\/$/, '');
  await db.execute(sql`
    insert into public.domain_url_patterns(domain, product_regex, category_regex)
    values (${domain}, ${DEFAULT_PRODUCT_REGEX}, ${DEFAULT_CATEGORY_REGEX})
    on conflict (domain) do update set
      product_regex = excluded.product_regex,
      category_regex = excluded.category_regex,
      updated_at = now()
  `);

  await db.execute(sql`
    insert into public.source_entrypoints(domain, url, page_type, priority, is_active)
    values (${domain}, ${base}, 'unknown', 200, true)
    on conflict (domain, url) do nothing
  `);

  await db.execute(sql`
    insert into public.domain_bootstrap_paths(source_domain, path, page_type, priority, is_active)
    values (${domain}, '/', 'unknown', 200, true)
    on conflict (source_domain, path) do nothing
  `);
}

export async function ensureBaselineSourceAdapter(db: any, sourceId: string) {
  const existing = await db.execute(sql`
    select id
    from public.source_adapters
    where source_id = ${sourceId}::uuid and adapter_type = 'jsonld'
    limit 1
  `).catch(() => ({ rows: [] as any[] }));

  if ((existing.rows as any[])?.[0]?.id) return;

  await db.execute(sql`
    insert into public.source_adapters (source_id, adapter_type, priority, is_active, selectors)
    values (
      ${sourceId}::uuid,
      'jsonld',
      10,
      true,
      ${JSON.stringify({
        productName: ['jsonld.name', 'meta:og:title'],
        description: ['jsonld.description', 'jsonld.offers.description'],
        price: ['jsonld.offers.price', 'jsonld.offers.lowPrice', 'meta:product:price:amount'],
        currency: ['jsonld.offers.priceCurrency', 'meta:product:price:currency'],
        image: ['jsonld.image', 'meta:og:image'],
        inStock: ['jsonld.offers.availability'],
      })}::jsonb
    )
  `).catch(() => {});
}

export async function ensureSourceRegistryArtifacts(
  db: any,
  input: { sourceId: string; domain: string; baseUrl?: string | null },
) {
  await ensureSourceScaffold(db, input.domain, input.baseUrl);
  await ensureBaselineSourceAdapter(db, input.sourceId);
}

export async function upsertGovernedSourceProfile(
  db: any,
  input: GovernedSourceUpsertInput,
): Promise<{ sourceId: string; action: 'inserted' | 'updated' }> {
  const domain = normalizeSourceDomain(input.domain);
  const baseUrl = normalizeSourceBaseUrl(input.baseUrl, domain);
  const sourceKind = normalizeSourceKind(input.sourceKind);
  const sourceChannel = normalizeSourceChannel(input.sourceChannel, sourceKind);
  const adapterStrategy = normalizeAdapterStrategy(input.adapterStrategy);
  const catalogConditionPolicy = normalizeCatalogConditionPolicy(input.catalogConditionPolicy);
  const conditionConfidence = clamp(input.conditionConfidence, 0, 1, catalogConditionPolicy === 'new_only' ? 0.9 : catalogConditionPolicy === 'mixed' ? 0.75 : 0.5);
  const onboardingOrigin = String(input.onboardingOrigin ?? 'manual_seed').trim() || 'manual_seed';
  const sourcePriority = Math.max(1, Math.min(1000, Math.trunc(Number(input.sourcePriority ?? 100))));
  const trustWeight = clamp(input.trustWeight, 0, 1, 0.55);
  const sectors = normalizeTagList(input.sectors);
  const provinces = normalizeTagList(input.provinces);
  const nameAr = String(input.nameAr ?? '').trim() || domain;
  const logoUrl = input.logoUrl ? String(input.logoUrl).trim() : null;

  const existingRes = await db.execute(sql`
    select id, is_active, lifecycle_status, validation_state, discovery_tags, onboarding_meta
    from public.price_sources
    where domain = ${domain}
    limit 1
  `).catch(() => ({ rows: [] as any[] }));
  const existing = ((existingRes.rows as any[])[0] as ExistingSourceRow | undefined) ?? null;

  const discoveryTags = mergeDiscoveryTags(existing?.discovery_tags, {
    sectors,
    provinces,
    sourceChannel,
    adapterStrategy,
    catalogConditionPolicy,
    onboardingOrigin,
  });
  const onboardingMeta = mergeOnboardingMeta(existing?.onboarding_meta, input.onboardingMeta ?? {});

  if (existing?.id) {
    await db.execute(sql`
      update public.price_sources
      set
        name_ar = ${nameAr},
        source_kind = ${sourceKind},
        trust_weight = ${trustWeight}::numeric,
        base_url = ${baseUrl},
        logo_url = ${logoUrl},
        source_channel = ${sourceChannel},
        adapter_strategy = ${adapterStrategy},
        catalog_condition_policy = ${catalogConditionPolicy},
        condition_confidence = ${conditionConfidence}::numeric,
        onboarding_origin = ${onboardingOrigin},
        source_priority = ${sourcePriority},
        discovery_tags = ${JSON.stringify(discoveryTags)}::jsonb,
        onboarding_meta = ${JSON.stringify(onboardingMeta)}::jsonb,
        validation_state = coalesce(nullif(validation_state, ''), 'unvalidated'),
        discovered_via = coalesce(nullif(discovered_via, ''), ${onboardingOrigin}),
        updated_at = now()
      where id = ${existing.id}::uuid
    `);
    await ensureSourceRegistryArtifacts(db, { sourceId: existing.id, domain, baseUrl });
    return { sourceId: existing.id, action: 'updated' };
  }

  const inserted = await db.execute(sql`
    insert into public.price_sources (
      name_ar,
      domain,
      source_kind,
      trust_weight,
      base_url,
      logo_url,
      is_active,
      country_code,
      lifecycle_status,
      crawl_enabled,
      validation_state,
      discovered_via,
      discovery_tags,
      source_channel,
      adapter_strategy,
      catalog_condition_policy,
      condition_confidence,
      onboarding_origin,
      source_priority,
      onboarding_meta,
      certification_tier,
      certification_status,
      catalog_publish_enabled,
      quality_score,
      quality_updated_at
    )
    values (
      ${nameAr},
      ${domain},
      ${sourceKind},
      ${trustWeight}::numeric,
      ${baseUrl},
      ${logoUrl},
      false,
      'IQ',
      'candidate',
      true,
      'unvalidated',
      ${onboardingOrigin},
      ${JSON.stringify(discoveryTags)}::jsonb,
      ${sourceChannel},
      ${adapterStrategy},
      ${catalogConditionPolicy},
      ${conditionConfidence}::numeric,
      ${onboardingOrigin},
      ${sourcePriority},
      ${JSON.stringify(onboardingMeta)}::jsonb,
      'sandbox',
      'pending',
      false,
      ${trustWeight}::numeric,
      now()
    )
    returning id
  `);

  const sourceId = String((inserted.rows as any[])[0]?.id ?? '');
  await ensureSourceRegistryArtifacts(db, { sourceId, domain, baseUrl });
  return { sourceId, action: 'inserted' };
}
