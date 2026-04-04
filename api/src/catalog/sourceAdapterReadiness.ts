import { sql } from 'drizzle-orm';

export type SourceAdapterReadinessClass =
  | 'api_ready'
  | 'html_ready'
  | 'needs_mobile_adapter'
  | 'needs_render'
  | 'postpone';

export type SourceAdapterPath =
  | 'api'
  | 'html'
  | 'mobile_adapter'
  | 'render'
  | 'hold';

export type SourceAdapterReadinessInput = {
  domain: string;
  sourceChannel?: string | null;
  adapterStrategy?: string | null;
  certificationTier?: string | null;
  autoDisabled?: boolean | null;
  jsOnly?: boolean | null;
  renderPausedUntil?: string | null;
  activeEntrypoints?: number | null;
  activeBootstrapPaths?: number | null;
  activeApiEndpoints?: number | null;
  activeAdapters?: number | null;
  errorRate?: number | null;
  failures?: number | null;
};

export type SourceAdapterReadinessDecision = {
  readinessClass: SourceAdapterReadinessClass;
  recommendedPath: SourceAdapterPath;
  reasons: string[];
};

export type SourceAdapterReadinessOpts = {
  domains?: string[];
  limit?: number;
};

const clampRate = (value: number | null | undefined): number | null => {
  if (value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(1, n));
};

const normalizeDomain = (input: string): string =>
  String(input || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '')
    .replace(/\/$/, '');

function normalizeScopedDomains(input: unknown): string[] {
  const raw = Array.isArray(input)
    ? input
    : typeof input === 'string'
      ? input.split(/[,\n\r\t ]+/g)
      : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    const domain = normalizeDomain(String(item ?? ''));
    if (!domain || seen.has(domain)) continue;
    seen.add(domain);
    out.push(domain);
  }
  return out;
}

function isFutureIso(value: string | null | undefined): boolean {
  if (!value) return false;
  const ts = Date.parse(value);
  return Number.isFinite(ts) && ts > Date.now();
}

export function computeSourceAdapterReadiness(
  input: SourceAdapterReadinessInput,
): SourceAdapterReadinessDecision {
  const adapterStrategy = String(input.adapterStrategy ?? '').toLowerCase();
  const sourceChannel = String(input.sourceChannel ?? '').toLowerCase();
  const certificationTier = String(input.certificationTier ?? '').toLowerCase();
  const errorRate = clampRate(input.errorRate);
  const failures = Math.max(0, Number(input.failures ?? 0));
  const activeEntrypoints = Math.max(0, Number(input.activeEntrypoints ?? 0));
  const activeBootstrapPaths = Math.max(0, Number(input.activeBootstrapPaths ?? 0));
  const activeApiEndpoints = Math.max(0, Number(input.activeApiEndpoints ?? 0));
  const activeAdapters = Math.max(0, Number(input.activeAdapters ?? 0));

  const isMobileSource =
    adapterStrategy === 'mobile_api' ||
    sourceChannel === 'mobile_app' ||
    sourceChannel === 'grocery_app';
  const needsRenderedPath = Boolean(input.jsOnly) || adapterStrategy === 'rendered_html';
  const renderPaused = isFutureIso(input.renderPausedUntil);
  const hasHtmlSignals = activeEntrypoints > 0 || activeBootstrapPaths > 0;
  const severeHealthRisk = Boolean(input.autoDisabled) || certificationTier === 'suspended' || ((errorRate ?? 0) >= 0.6 && failures >= 3);

  const reasons: string[] = [];
  if (input.autoDisabled) reasons.push('auto_disabled');
  if (certificationTier === 'suspended') reasons.push('source_suspended');
  if ((errorRate ?? 0) >= 0.45) reasons.push('high_error_rate');
  if (renderPaused) reasons.push('render_paused');

  if (severeHealthRisk) {
    return {
      readinessClass: 'postpone',
      recommendedPath: 'hold',
      reasons: reasons.length ? reasons : ['source_health_unstable'],
    };
  }

  if (isMobileSource) {
    if (activeApiEndpoints > 0) {
      return {
        readinessClass: 'api_ready',
        recommendedPath: 'api',
        reasons: [...reasons, 'mobile_api_endpoints_configured'],
      };
    }

    return {
      readinessClass: 'needs_mobile_adapter',
      recommendedPath: 'mobile_adapter',
      reasons: [...reasons, 'mobile_source_without_api_endpoints'],
    };
  }

  if (needsRenderedPath) {
    return {
      readinessClass: 'needs_render',
      recommendedPath: 'render',
      reasons: [...reasons, Boolean(input.jsOnly) ? 'js_only_detected' : 'rendered_strategy_selected'],
    };
  }

  if (activeApiEndpoints > 0 || (adapterStrategy === 'structured_api' && activeApiEndpoints > 0)) {
    return {
      readinessClass: 'api_ready',
      recommendedPath: 'api',
      reasons: [...reasons, 'active_api_endpoints_present'],
    };
  }

  if (hasHtmlSignals || adapterStrategy === 'html_sitemap' || (adapterStrategy === 'hybrid' && hasHtmlSignals)) {
    const htmlReasons = [...reasons];
    if (activeEntrypoints > 0) htmlReasons.push('html_entrypoints_present');
    if (activeBootstrapPaths > 0) htmlReasons.push('bootstrap_paths_present');
    if (htmlReasons.length === reasons.length && activeAdapters > 0) htmlReasons.push('adapter_rules_present');
    return {
      readinessClass: 'html_ready',
      recommendedPath: 'html',
      reasons: htmlReasons,
    };
  }

  if (adapterStrategy === 'structured_api') {
    return {
      readinessClass: 'postpone',
      recommendedPath: 'hold',
      reasons: [...reasons, 'structured_api_without_endpoints'],
    };
  }

  if (adapterStrategy === 'social_intake') {
    return {
      readinessClass: 'postpone',
      recommendedPath: 'hold',
      reasons: [...reasons, 'social_intake_requires_manual_pipeline'],
    };
  }

  return {
    readinessClass: 'postpone',
    recommendedPath: 'hold',
    reasons: [...reasons, 'insufficient_adapter_signals'],
  };
}

type RawSourceAdapterReadinessRow = {
  source_id: string;
  domain: string;
  name_ar: string | null;
  source_kind: string | null;
  source_channel: string | null;
  adapter_strategy: string | null;
  catalog_condition_policy: string | null;
  lifecycle_status: string | null;
  validation_state: string | null;
  certification_tier: string | null;
  certification_status: string | null;
  catalog_publish_enabled: boolean | null;
  auto_disabled: boolean | null;
  render_paused_until: string | null;
  js_only: boolean | null;
  js_only_reason: string | null;
  js_only_hits: number | null;
  active_entrypoints: number | null;
  active_bootstrap_paths: number | null;
  active_api_endpoints: number | null;
  active_adapters: number | null;
  successes: number | null;
  failures: number | null;
  error_rate: number | null;
  anomaly_rate: number | null;
  last_success_at: string | null;
  last_error_at: string | null;
};

const READINESS_ORDER: Record<SourceAdapterReadinessClass, number> = {
  postpone: 0,
  needs_mobile_adapter: 1,
  needs_render: 2,
  api_ready: 3,
  html_ready: 4,
};

export async function getSourceAdapterReadiness(db: any, opts: SourceAdapterReadinessOpts = {}) {
  const requestedDomains = normalizeScopedDomains(opts.domains ?? []);
  const limit = Math.max(1, Math.min(500, Math.trunc(Number(opts.limit ?? 200))));

  const result = await db.execute(sql`
    select
      ps.id as source_id,
      ps.domain,
      ps.name_ar,
      ps.source_kind,
      ps.source_channel,
      ps.adapter_strategy,
      ps.catalog_condition_policy,
      ps.lifecycle_status,
      ps.validation_state,
      ps.certification_tier,
      ps.certification_status,
      ps.catalog_publish_enabled,
      coalesce(ps.auto_disabled, false) as auto_disabled,
      ps.render_paused_until,
      coalesce(ps.js_only, false) as js_only,
      ps.js_only_reason,
      coalesce(ps.js_only_hits, 0)::int as js_only_hits,
      coalesce(ep.active_entrypoints, 0)::int as active_entrypoints,
      coalesce(bp.active_bootstrap_paths, 0)::int as active_bootstrap_paths,
      coalesce(api.active_api_endpoints, 0)::int as active_api_endpoints,
      coalesce(ad.active_adapters, 0)::int as active_adapters,
      coalesce(sh.successes, 0)::int as successes,
      coalesce(sh.failures, 0)::int as failures,
      sh.error_rate,
      sh.anomaly_rate,
      sh.last_success_at,
      sh.last_error_at
    from public.price_sources ps
    left join public.v_source_health_latest sh on sh.source_id = ps.id
    left join lateral (
      select count(*) filter (where is_active = true) as active_entrypoints
      from public.source_entrypoints
      where domain = ps.domain
    ) ep on true
    left join lateral (
      select count(*) filter (where is_active = true) as active_bootstrap_paths
      from public.domain_bootstrap_paths
      where source_domain = ps.domain
    ) bp on true
    left join lateral (
      select count(*) filter (where is_active = true) as active_api_endpoints
      from public.source_api_endpoints
      where domain = ps.domain
    ) api on true
    left join lateral (
      select count(*) filter (where is_active = true) as active_adapters
      from public.source_adapters
      where source_id = ps.id
    ) ad on true
    where ps.country_code = 'IQ'
      and (${requestedDomains.length} = 0 or ps.domain = any(${requestedDomains}::text[]))
    order by ps.domain asc
    limit ${limit}::int
  `).catch(() => ({ rows: [] as RawSourceAdapterReadinessRow[] }));

  const items = ((result.rows as RawSourceAdapterReadinessRow[]) ?? [])
    .map((row) => {
      const decision = computeSourceAdapterReadiness({
        domain: row.domain,
        sourceChannel: row.source_channel,
        adapterStrategy: row.adapter_strategy,
        certificationTier: row.certification_tier,
        autoDisabled: row.auto_disabled,
        jsOnly: row.js_only,
        renderPausedUntil: row.render_paused_until,
        activeEntrypoints: row.active_entrypoints,
        activeBootstrapPaths: row.active_bootstrap_paths,
        activeApiEndpoints: row.active_api_endpoints,
        activeAdapters: row.active_adapters,
        errorRate: row.error_rate,
        failures: row.failures,
      });

      return {
        ...row,
        readiness_class: decision.readinessClass,
        recommended_path: decision.recommendedPath,
        readiness_reasons: decision.reasons,
      };
    })
    .sort((a, b) => {
      const stateDiff = READINESS_ORDER[a.readiness_class] - READINESS_ORDER[b.readiness_class];
      if (stateDiff !== 0) return stateDiff;
      const errDiff = Number(b.error_rate ?? 0) - Number(a.error_rate ?? 0);
      if (Math.abs(errDiff) > 0.0001) return errDiff;
      return String(a.domain).localeCompare(String(b.domain));
    });

  const summary = items.reduce(
    (acc, item) => {
      acc.total_sources += 1;
      acc[item.readiness_class] += 1;
      if (Number(item.active_api_endpoints ?? 0) > 0) acc.with_api_endpoints += 1;
      if (Number(item.active_entrypoints ?? 0) > 0) acc.with_entrypoints += 1;
      if (Number(item.active_bootstrap_paths ?? 0) > 0) acc.with_bootstrap_paths += 1;
      if (item.js_only) acc.js_only_sources += 1;
      if (item.render_paused_until && isFutureIso(item.render_paused_until)) acc.render_paused_sources += 1;
      return acc;
    },
    {
      total_sources: 0,
      api_ready: 0,
      html_ready: 0,
      needs_mobile_adapter: 0,
      needs_render: 0,
      postpone: 0,
      with_api_endpoints: 0,
      with_entrypoints: 0,
      with_bootstrap_paths: 0,
      js_only_sources: 0,
      render_paused_sources: 0,
    },
  );

  return {
    ok: true,
    requested_domains: requestedDomains,
    summary,
    items,
  };
}
