import { sql } from 'drizzle-orm';
import { type SourceAdapterPath, getSourceAdapterReadiness } from './sourceAdapterReadiness';

export type SourceAdapterBacklogStatus =
  | 'pending'
  | 'assigned'
  | 'in_progress'
  | 'completed'
  | 'postponed';

export type SourceAdapterBacklogAction =
  | 'open_task'
  | 'assign_api'
  | 'assign_html'
  | 'assign_mobile_adapter'
  | 'assign_render'
  | 'mark_in_progress'
  | 'mark_completed'
  | 'mark_postponed'
  | 'reopen';

export type SourceAdapterBacklogTransition = {
  status: SourceAdapterBacklogStatus;
  assignedPath: SourceAdapterPath | null;
};

export type SourceAdapterExecutionQueueItem = {
  source_id: string;
  domain: string;
  name_ar: string | null;
  queue_path: SourceAdapterPath;
  backlog_status: SourceAdapterBacklogStatus;
  execution_score: number;
  impact_score: number;
  health_score: number;
  readiness_class: string;
  recommended_path: SourceAdapterPath | null;
  assigned_path: SourceAdapterPath | null;
  source_priority: number;
  quality_score: number;
  trust_effective: number;
  error_rate: number;
  successes: number;
  failures: number;
  certification_tier: string | null;
  readiness_reasons: string[];
};

export type SourceAdapterExecutionQueue = {
  ok: true;
  requested_domains: string[];
  summary: {
    total_open: number;
    api: number;
    html: number;
    mobile_adapter: number;
    render: number;
    hold: number;
    pending: number;
    assigned: number;
    in_progress: number;
    completed: number;
    postponed: number;
    today_first_count: number;
  };
  today_first: SourceAdapterExecutionQueueItem[];
  lanes: Record<SourceAdapterPath, SourceAdapterExecutionQueueItem[]>;
};

type ComputeTransitionInput = {
  action: SourceAdapterBacklogAction;
  currentStatus?: string | null;
  currentAssignedPath?: string | null;
  recommendedPath?: SourceAdapterPath | null;
};

type ApplySourceAdapterBacklogActionOpts = {
  sourceId?: string | null;
  domain?: string | null;
  action: SourceAdapterBacklogAction;
  note?: string | null;
  actorType?: 'admin' | 'internal';
  actorId?: string | null;
};

const VALID_ACTIONS = new Set<SourceAdapterBacklogAction>([
  'open_task',
  'assign_api',
  'assign_html',
  'assign_mobile_adapter',
  'assign_render',
  'mark_in_progress',
  'mark_completed',
  'mark_postponed',
  'reopen',
]);

function normalizeDomain(input: string): string {
  return String(input || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '')
    .replace(/\/$/, '');
}

const clamp01 = (value: number | null | undefined, fallback = 0): number => {
  const n = Number(value ?? fallback);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
};

function certificationImpact(tier: string | null | undefined): number {
  switch (String(tier ?? '').toLowerCase()) {
    case 'anchor':
      return 1;
    case 'published':
      return 0.88;
    case 'observed':
      return 0.62;
    case 'sandbox':
      return 0.28;
    case 'suspended':
      return 0;
    default:
      return 0.35;
  }
}

function statusWeight(status: string | null | undefined): number {
  switch (String(status ?? '').toLowerCase()) {
    case 'in_progress':
      return 1;
    case 'assigned':
      return 0.82;
    case 'pending':
      return 0.62;
    case 'completed':
      return 0.1;
    case 'postponed':
      return 0;
    default:
      return 0.55;
  }
}

function laneWeight(path: SourceAdapterPath): number {
  switch (path) {
    case 'api':
      return 1;
    case 'html':
      return 0.82;
    case 'mobile_adapter':
      return 0.7;
    case 'render':
      return 0.66;
    case 'hold':
      return 0.1;
    default:
      return 0.4;
  }
}

function computePriorityFactor(sourcePriority: number | null | undefined): number {
  const priority = Math.max(1, Math.min(1000, Math.trunc(Number(sourcePriority ?? 100))));
  return Math.max(0.05, 1 - (priority - 1) / 999);
}

export function computeSourceAdapterExecutionScore(input: {
  queuePath: SourceAdapterPath;
  backlogStatus: string | null | undefined;
  sourcePriority?: number | null;
  qualityScore?: number | null;
  trustEffective?: number | null;
  errorRate?: number | null;
  successes?: number | null;
  certificationTier?: string | null;
}): { executionScore: number; impactScore: number; healthScore: number } {
  const quality = clamp01(input.qualityScore, 0.5);
  const trust = clamp01(input.trustEffective, 0.5);
  const errorRate = clamp01(input.errorRate, 0);
  const healthScore = Number((1 - errorRate).toFixed(4));
  const activity = Math.min(1, Math.max(0, Number(input.successes ?? 0)) / 80);
  const impactScore = Number((
    computePriorityFactor(input.sourcePriority) * 0.38 +
    quality * 0.28 +
    trust * 0.12 +
    certificationImpact(input.certificationTier) * 0.14 +
    activity * 0.08
  ).toFixed(4));

  const executionScore = Number((
    impactScore * 0.48 +
    healthScore * 0.2 +
    laneWeight(input.queuePath) * 0.2 +
    statusWeight(input.backlogStatus) * 0.12
  ).toFixed(4));

  return { executionScore, impactScore, healthScore };
}

export function computeSourceAdapterBacklogTransition(
  input: ComputeTransitionInput,
): SourceAdapterBacklogTransition {
  const currentStatus = String(input.currentStatus ?? '').toLowerCase() as SourceAdapterBacklogStatus | '';
  const currentAssignedPath = (String(input.currentAssignedPath ?? '').toLowerCase() || null) as SourceAdapterPath | null;
  const recommendedPath = (String(input.recommendedPath ?? '').toLowerCase() || null) as SourceAdapterPath | null;

  const carryPath = currentAssignedPath ?? recommendedPath ?? null;

  switch (input.action) {
    case 'open_task':
      return {
        status: currentStatus && currentStatus !== 'completed' && currentStatus !== 'postponed' ? currentStatus : 'pending',
        assignedPath: carryPath,
      };
    case 'assign_api':
      return { status: 'assigned', assignedPath: 'api' };
    case 'assign_html':
      return { status: 'assigned', assignedPath: 'html' };
    case 'assign_mobile_adapter':
      return { status: 'assigned', assignedPath: 'mobile_adapter' };
    case 'assign_render':
      return { status: 'assigned', assignedPath: 'render' };
    case 'mark_in_progress':
      return { status: 'in_progress', assignedPath: carryPath };
    case 'mark_completed':
      return { status: 'completed', assignedPath: carryPath };
    case 'mark_postponed':
      return { status: 'postponed', assignedPath: 'hold' };
    case 'reopen':
      return { status: 'pending', assignedPath: currentAssignedPath ?? recommendedPath ?? null };
    default:
      return { status: 'pending', assignedPath: carryPath };
  }
}

export async function applySourceAdapterBacklogAction(db: any, opts: ApplySourceAdapterBacklogActionOpts) {
  const action = String(opts.action ?? '').trim().toLowerCase() as SourceAdapterBacklogAction;
  if (!VALID_ACTIONS.has(action)) throw new Error('invalid_adapter_backlog_action');

  const sourceId = opts.sourceId ? String(opts.sourceId).trim() : '';
  const domain = opts.domain ? normalizeDomain(String(opts.domain)) : '';
  if (!sourceId && !domain) throw new Error('source_id_or_domain_required');

  const sourceRes = await db.execute(sql`
    select
      ps.id,
      ps.domain,
      ps.name_ar
    from public.price_sources ps
    where (${sourceId ? sql`ps.id = ${sourceId}::uuid` : sql`false`})
       or (${domain ? sql`ps.domain = ${domain}` : sql`false`})
    limit 1
  `);
  const source = (sourceRes.rows as any[])[0];
  if (!source?.id || !source?.domain) throw new Error('source_not_found');

  const readiness = await getSourceAdapterReadiness(db, { domains: [String(source.domain)], limit: 5 });
  const readinessItem = ((readiness.items ?? []) as any[]).find((item) => String(item.source_id) === String(source.id) || String(item.domain) === String(source.domain));
  if (!readinessItem) throw new Error('source_readiness_not_found');

  const currentRes = await db.execute(sql`
    select id, status, assigned_path, note
    from public.source_adapter_backlog_items
    where source_id = ${String(source.id)}::uuid
    limit 1
  `);
  const current = (currentRes.rows as any[])[0] ?? null;

  const transition = computeSourceAdapterBacklogTransition({
    action,
    currentStatus: current?.status,
    currentAssignedPath: current?.assigned_path,
    recommendedPath: readinessItem.recommended_path,
  });

  const note = opts.note ? String(opts.note).trim().slice(0, 500) : null;
  const priority = action === 'mark_postponed'
    ? 250
    : readinessItem.readiness_class === 'needs_mobile_adapter' || readinessItem.readiness_class === 'needs_render'
      ? 40
      : readinessItem.readiness_class === 'api_ready' || readinessItem.readiness_class === 'html_ready'
        ? 80
        : 160;

  const metadata = {
    source_name: source.name_ar ?? null,
    recommended_path: readinessItem.recommended_path ?? null,
    readiness_class: readinessItem.readiness_class ?? null,
    readiness_reasons: readinessItem.readiness_reasons ?? [],
    action,
    actor_type: opts.actorType ?? 'admin',
  };

  const upsert = await db.execute(sql`
    insert into public.source_adapter_backlog_items (
      source_id,
      domain,
      current_readiness_class,
      current_recommended_path,
      assigned_path,
      status,
      priority,
      note,
      last_action,
      metadata
    )
    values (
      ${String(source.id)}::uuid,
      ${String(source.domain)},
      ${String(readinessItem.readiness_class ?? '')},
      ${transition.assignedPath ? String(readinessItem.recommended_path ?? '') : String(readinessItem.recommended_path ?? '')},
      ${transition.assignedPath},
      ${transition.status},
      ${priority},
      ${note},
      ${action},
      ${JSON.stringify(metadata)}::jsonb
    )
    on conflict (source_id) do update set
      domain = excluded.domain,
      current_readiness_class = excluded.current_readiness_class,
      current_recommended_path = excluded.current_recommended_path,
      assigned_path = excluded.assigned_path,
      status = excluded.status,
      priority = excluded.priority,
      note = coalesce(excluded.note, public.source_adapter_backlog_items.note),
      last_action = excluded.last_action,
      metadata = coalesce(public.source_adapter_backlog_items.metadata, '{}'::jsonb) || excluded.metadata,
      updated_at = now()
    returning id, source_id, domain, current_readiness_class, current_recommended_path, assigned_path, status, priority, note, last_action, updated_at
  `);
  const item = (upsert.rows as any[])[0];

  await db.execute(sql`
    insert into public.source_adapter_backlog_actions (
      backlog_id,
      source_id,
      domain,
      action,
      previous_status,
      next_status,
      assigned_path,
      note,
      actor_type,
      actor_id,
      metadata
    )
    values (
      ${String(item.id)}::uuid,
      ${String(source.id)}::uuid,
      ${String(source.domain)},
      ${action},
      ${current?.status ?? null},
      ${transition.status},
      ${transition.assignedPath},
      ${note},
      ${opts.actorType ?? 'admin'},
      ${opts.actorId ? String(opts.actorId) : null}::uuid,
      ${JSON.stringify(metadata)}::jsonb
    )
  `);

  return {
    ok: true,
    item: {
      ...item,
      readiness_class: readinessItem.readiness_class,
      recommended_path: readinessItem.recommended_path,
      readiness_reasons: readinessItem.readiness_reasons,
    },
  };
}

export async function getSourceAdapterExecutionQueue(
  db: any,
  opts: { domains?: string[]; limit?: number } = {},
): Promise<SourceAdapterExecutionQueue> {
  const readiness = await getSourceAdapterReadiness(db, {
    domains: opts.domains ?? [],
    limit: Math.max(20, Math.min(500, Number(opts.limit ?? 250))),
  });

  const items = ((readiness.items ?? []) as any[])
    .map((item) => {
      const backlogStatus = (String(item.backlog_status ? item.backlog_status : 'pending').toLowerCase() || 'pending') as SourceAdapterBacklogStatus;
      const queuePath = ((item.backlog_assigned_path ?? item.recommended_path ?? 'hold') as SourceAdapterPath) || 'hold';
      const scoring = computeSourceAdapterExecutionScore({
        queuePath,
        backlogStatus,
        sourcePriority: item.source_priority,
        qualityScore: item.quality_score,
        trustEffective: item.trust_effective,
        errorRate: item.error_rate,
        successes: item.successes,
        certificationTier: item.certification_tier,
      });

      return {
        source_id: String(item.source_id),
        domain: String(item.domain),
        name_ar: item.name_ar ?? null,
        queue_path: queuePath,
        backlog_status: backlogStatus,
        execution_score: scoring.executionScore,
        impact_score: scoring.impactScore,
        health_score: scoring.healthScore,
        readiness_class: String(item.readiness_class ?? ''),
        recommended_path: (item.recommended_path ?? null) as SourceAdapterPath | null,
        assigned_path: (item.backlog_assigned_path ?? null) as SourceAdapterPath | null,
        source_priority: Math.max(1, Math.min(1000, Math.trunc(Number(item.source_priority ?? 100)))),
        quality_score: clamp01(item.quality_score, 0.5),
        trust_effective: clamp01(item.trust_effective, 0.5),
        error_rate: clamp01(item.error_rate, 0),
        successes: Math.max(0, Number(item.successes ?? 0)),
        failures: Math.max(0, Number(item.failures ?? 0)),
        certification_tier: item.certification_tier ?? null,
        readiness_reasons: Array.isArray(item.readiness_reasons) ? item.readiness_reasons : [],
      } satisfies SourceAdapterExecutionQueueItem;
    })
    .filter((item) => item.backlog_status !== 'completed' && item.backlog_status !== 'postponed')
    .sort((a, b) => {
      const scoreDiff = b.execution_score - a.execution_score;
      if (Math.abs(scoreDiff) > 0.0001) return scoreDiff;
      const impactDiff = b.impact_score - a.impact_score;
      if (Math.abs(impactDiff) > 0.0001) return impactDiff;
      return a.domain.localeCompare(b.domain);
    });

  const topLimit = Math.max(3, Math.min(25, Math.trunc(Number(opts.limit ?? 12))));
  const lanes: Record<SourceAdapterPath, SourceAdapterExecutionQueueItem[]> = {
    api: [],
    html: [],
    mobile_adapter: [],
    render: [],
    hold: [],
  };

  for (const item of items) {
    lanes[item.queue_path].push(item);
  }

  return {
    ok: true,
    requested_domains: readiness.requested_domains ?? [],
    summary: {
      total_open: items.length,
      api: lanes.api.length,
      html: lanes.html.length,
      mobile_adapter: lanes.mobile_adapter.length,
      render: lanes.render.length,
      hold: lanes.hold.length,
      pending: items.filter((item) => item.backlog_status === 'pending').length,
      assigned: items.filter((item) => item.backlog_status === 'assigned').length,
      in_progress: items.filter((item) => item.backlog_status === 'in_progress').length,
      completed: ((readiness.items ?? []) as any[]).filter((item) => item.backlog_status === 'completed').length,
      postponed: ((readiness.items ?? []) as any[]).filter((item) => item.backlog_status === 'postponed').length,
      today_first_count: items.filter((item) => item.execution_score >= 0.7).length,
    },
    today_first: items.slice(0, topLimit),
    lanes: {
      api: lanes.api.slice(0, 12),
      html: lanes.html.slice(0, 12),
      mobile_adapter: lanes.mobile_adapter.slice(0, 12),
      render: lanes.render.slice(0, 12),
      hold: lanes.hold.slice(0, 12),
    },
  };
}
