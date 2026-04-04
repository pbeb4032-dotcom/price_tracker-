import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { getDb, type Env } from '../db';
import {
  normalizeAdapterStrategy,
  normalizeCatalogConditionPolicy,
  normalizeSourceBaseUrl,
  normalizeSourceChannel,
  normalizeSourceDomain,
  normalizeSourceKind,
  normalizeTagList,
  upsertGovernedSourceProfile,
  type AdapterStrategy,
  type CatalogConditionPolicy,
  type SourceChannel,
  type SourceKind,
} from './sourceRegistry';

export type SourceSeedSectionPolicyInput = {
  section_key?: string;
  section_label?: string | null;
  section_url?: string | null;
  policy_scope?: 'allow' | 'block' | null;
  condition_policy?: CatalogConditionPolicy | string | null;
  priority?: number | null;
};

export type SourceSeedRowInput = {
  name_ar?: string | null;
  domain?: string | null;
  base_url?: string | null;
  logo_url?: string | null;
  source_kind?: SourceKind | string | null;
  source_channel?: SourceChannel | string | null;
  adapter_strategy?: AdapterStrategy | string | null;
  condition_policy?: CatalogConditionPolicy | string | null;
  trust_weight?: number | null;
  condition_confidence?: number | null;
  source_priority?: number | null;
  sectors?: string[] | null;
  provinces?: string[] | null;
  notes?: string | null;
  section_allowlists?: SourceSeedSectionPolicyInput[] | null;
};

export type NormalizedSourceSeedRow = {
  nameAr: string;
  domain: string;
  baseUrl: string;
  logoUrl: string | null;
  sourceKind: SourceKind;
  sourceChannel: SourceChannel;
  adapterStrategy: AdapterStrategy;
  catalogConditionPolicy: CatalogConditionPolicy;
  trustWeight: number;
  conditionConfidence: number;
  sourcePriority: number;
  sectors: string[];
  provinces: string[];
  notes: string | null;
  sectionAllowlists: Array<{
    sectionKey: string;
    sectionLabel: string | null;
    sectionUrl: string | null;
    policyScope: 'allow' | 'block';
    conditionPolicy: CatalogConditionPolicy;
    priority: number;
  }>;
};

export type ImportSourceSeedOpts = {
  rows: SourceSeedRowInput[];
  dryRun?: boolean;
  importName?: string | null;
};

function clamp(value: number | null | undefined, min: number, max: number, fallback: number): number {
  const n = Number(value ?? fallback);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function deriveSectionKey(input: SourceSeedSectionPolicyInput, index: number): string {
  const rawKey = String(input.section_key ?? '').trim();
  if (rawKey) return rawKey.toLowerCase().replace(/\s+/g, '_');
  const url = String(input.section_url ?? '').trim();
  if (url) {
    try {
      const parsed = new URL(/^https?:\/\//i.test(url) ? url : `https://example.invalid${url}`);
      const key = `${parsed.hostname}${parsed.pathname}`.replace(/^example\.invalid/, '').trim();
      if (key) return key.toLowerCase().replace(/[^\p{L}\p{N}\/_-]+/gu, '_');
    } catch {
      // fall through
    }
  }
  const label = String(input.section_label ?? '').trim();
  if (label) return label.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '_');
  return `section_${index + 1}`;
}

function normalizeSectionAllowlists(input: unknown): NormalizedSourceSeedRow['sectionAllowlists'] {
  if (!Array.isArray(input)) return [];
  const result: NormalizedSourceSeedRow['sectionAllowlists'] = [];
  for (let i = 0; i < input.length; i += 1) {
    const row = (input[i] ?? {}) as SourceSeedSectionPolicyInput;
    const sectionKey = deriveSectionKey(row, i);
    const policyScope = String(row.policy_scope ?? 'allow').trim().toLowerCase() === 'block' ? 'block' : 'allow';
    const conditionPolicy = normalizeCatalogConditionPolicy(row.condition_policy ?? 'new_only');
    result.push({
      sectionKey,
      sectionLabel: row.section_label ? String(row.section_label).trim() : null,
      sectionUrl: row.section_url ? String(row.section_url).trim() : null,
      policyScope,
      conditionPolicy,
      priority: Math.max(1, Math.min(1000, Math.trunc(Number(row.priority ?? 100)))),
    });
  }
  return result;
}

export function normalizeSourceSeedRow(input: SourceSeedRowInput): { normalized: NormalizedSourceSeedRow | null; issues: string[] } {
  const issues: string[] = [];
  const domain = normalizeSourceDomain(String(input.domain ?? input.base_url ?? ''));
  if (!domain) issues.push('domain_required');

  const sourceKind = normalizeSourceKind(input.source_kind);
  const sourceChannel = normalizeSourceChannel(input.source_channel, sourceKind);
  const adapterStrategy = normalizeAdapterStrategy(input.adapter_strategy);
  const catalogConditionPolicy = normalizeCatalogConditionPolicy(input.condition_policy);
  const baseUrl = normalizeSourceBaseUrl(input.base_url, domain);
  if (!baseUrl) issues.push('base_url_required');

  const nameAr = String(input.name_ar ?? '').trim() || domain;
  if (!nameAr) issues.push('name_ar_required');

  const trustWeight = clamp(input.trust_weight, 0, 1, 0.55);
  const conditionConfidence = clamp(
    input.condition_confidence,
    0,
    1,
    catalogConditionPolicy === 'new_only' ? 0.92 : catalogConditionPolicy === 'mixed' ? 0.75 : 0.5,
  );
  const sourcePriority = Math.max(1, Math.min(1000, Math.trunc(Number(input.source_priority ?? 100))));
  const sectors = normalizeTagList(input.sectors);
  const provinces = normalizeTagList(input.provinces);
  const notes = input.notes ? String(input.notes).trim() : null;
  const sectionAllowlists = normalizeSectionAllowlists(input.section_allowlists);

  if (String(input.condition_policy ?? '').trim().toLowerCase() === 'used_only') {
    issues.push('used_only_sources_are_not_allowed');
  }

  if (!issues.length) {
    return {
      normalized: {
        nameAr,
        domain,
        baseUrl,
        logoUrl: input.logo_url ? String(input.logo_url).trim() : null,
        sourceKind,
        sourceChannel,
        adapterStrategy,
        catalogConditionPolicy,
        trustWeight,
        conditionConfidence,
        sourcePriority,
        sectors,
        provinces,
        notes,
        sectionAllowlists,
      },
      issues,
    };
  }

  return { normalized: null, issues };
}

async function recordSectionPolicies(
  db: any,
  sourceId: string,
  policies: NormalizedSourceSeedRow['sectionAllowlists'],
) {
  for (const policy of policies) {
    await db.execute(sql`
      insert into public.source_section_policies (
        source_id,
        section_key,
        section_label,
        section_url,
        policy_scope,
        condition_policy,
        priority,
        is_active,
        evidence
      )
      values (
        ${sourceId}::uuid,
        ${policy.sectionKey},
        ${policy.sectionLabel},
        ${policy.sectionUrl},
        ${policy.policyScope},
        ${policy.conditionPolicy},
        ${policy.priority},
        true,
        ${JSON.stringify({ imported_from_seed: true, imported_at: new Date().toISOString() })}::jsonb
      )
      on conflict (source_id, section_key) do update set
        section_label = excluded.section_label,
        section_url = excluded.section_url,
        policy_scope = excluded.policy_scope,
        condition_policy = excluded.condition_policy,
        priority = excluded.priority,
        is_active = true,
        evidence = coalesce(public.source_section_policies.evidence, '{}'::jsonb) || excluded.evidence,
        updated_at = now()
    `).catch(() => {});
  }
}

export async function importSourceSeeds(env: Env, opts: ImportSourceSeedOpts): Promise<any> {
  const db = getDb(env);
  const rows = Array.isArray(opts.rows) ? opts.rows : [];
  const dryRun = Boolean(opts.dryRun ?? false);
  const importName = String(opts.importName ?? 'iraq_source_seed').trim() || 'iraq_source_seed';
  const runId = randomUUID();

  await db.execute(sql`
    insert into public.source_seed_import_runs (
      id,
      import_name,
      mode,
      status,
      row_count,
      started_at
    )
    values (
      ${runId}::uuid,
      ${importName},
      ${dryRun ? 'dry_run' : 'apply'},
      'running',
      ${rows.length},
      now()
    )
  `).catch(() => {});

  let inserted = 0;
  let updated = 0;
  let invalid = 0;
  const preview: any[] = [];

  for (let index = 0; index < rows.length; index += 1) {
    const rawRow = rows[index] ?? {};
    const { normalized, issues } = normalizeSourceSeedRow(rawRow);
    const fallbackDomain = normalizeSourceDomain(String((rawRow as any).domain ?? (rawRow as any).base_url ?? ''));
    const recordedDomain = normalized?.domain ?? (fallbackDomain || null);
    let action = 'invalid';
    let sourceId: string | null = null;

    if (!normalized) {
      invalid += 1;
    } else if (dryRun) {
      action = 'would_import';
    } else {
      const upserted = await upsertGovernedSourceProfile(db, {
        nameAr: normalized.nameAr,
        domain: normalized.domain,
        baseUrl: normalized.baseUrl,
        logoUrl: normalized.logoUrl,
        sourceKind: normalized.sourceKind,
        sourceChannel: normalized.sourceChannel,
        adapterStrategy: normalized.adapterStrategy,
        catalogConditionPolicy: normalized.catalogConditionPolicy,
        conditionConfidence: normalized.conditionConfidence,
        trustWeight: normalized.trustWeight,
        sourcePriority: normalized.sourcePriority,
        sectors: normalized.sectors,
        provinces: normalized.provinces,
        onboardingOrigin: 'manual_seed',
        onboardingMeta: {
          notes: normalized.notes,
          import_name: importName,
          source_seed: true,
        },
      });
      sourceId = upserted.sourceId;
      action = upserted.action;
      if (action === 'inserted') inserted += 1;
      if (action === 'updated') updated += 1;
      if (normalized.sectionAllowlists.length) {
        await recordSectionPolicies(db, sourceId, normalized.sectionAllowlists);
      }
    }

    await db.execute(sql`
      insert into public.source_seed_import_rows (
        run_id,
        row_index,
        domain,
        action,
        source_id,
        issues,
        raw_row,
        normalized_row
      )
      values (
        ${runId}::uuid,
        ${index},
        ${recordedDomain},
        ${action},
        ${sourceId},
        ${JSON.stringify(issues)}::jsonb,
        ${JSON.stringify(rawRow ?? {})}::jsonb,
        ${JSON.stringify(normalized ?? {})}::jsonb
      )
    `).catch(() => {});

    if (preview.length < 50) {
      preview.push({
        row_index: index,
        domain: normalized?.domain ?? null,
        action,
        issues,
      });
    }
  }

  await db.execute(sql`
    update public.source_seed_import_runs
    set
      status = 'completed',
      inserted_count = ${inserted},
      updated_count = ${updated},
      invalid_count = ${invalid},
      notes = ${JSON.stringify({
        dry_run: dryRun,
        preview_count: preview.length,
      })}::jsonb,
      completed_at = now(),
      updated_at = now()
    where id = ${runId}::uuid
  `).catch(() => {});

  return {
    ok: true,
    run_id: runId,
    import_name: importName,
    mode: dryRun ? 'dry_run' : 'apply',
    processed: rows.length,
    inserted,
    updated,
    invalid,
    preview,
  };
}

export async function getRecentSourceSeedImportRuns(db: any, limit = 20): Promise<any[]> {
  const rows = await db.execute(sql`
    select
      id,
      import_name,
      mode,
      status,
      row_count,
      inserted_count,
      updated_count,
      invalid_count,
      notes,
      started_at,
      completed_at,
      created_at
    from public.source_seed_import_runs
    order by started_at desc
    limit ${Math.max(1, Math.min(100, Number(limit ?? 20)))}::int
  `).catch(() => ({ rows: [] as any[] }));
  return (rows.rows as any[]) ?? [];
}
