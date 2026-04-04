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
