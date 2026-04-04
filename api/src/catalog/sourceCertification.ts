import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { getDb, type Env } from '../db';

export type SourceCertificationTier = 'sandbox' | 'observed' | 'published' | 'anchor' | 'suspended';
export type SourceCertificationStatus = 'pending' | 'certified' | 'needs_review' | 'rejected' | 'suspended';

export type SourceCertificationInput = {
  domain: string;
  lifecycleStatus?: string | null;
  validationState?: string | null;
  validationScore?: number | null;
  trustEffective?: number | null;
  errorRate?: number | null;
  anomalyRate?: number | null;
  observationsLookback?: number | null;
  lastSuccessAt?: string | null;
  lastObservedAt?: string | null;
  gateApproved?: number | null;
  gateQuarantined?: number | null;
  gateRejected?: number | null;
  autoDisabled?: boolean | null;
};

export type SourceCertificationDecision = {
  tier: SourceCertificationTier;
  status: SourceCertificationStatus;
  publishEnabled: boolean;
  qualityScore: number;
  confidence: number;
  reason: string;
  reviewPriority: number;
  evidence: Record<string, unknown>;
};

const clamp01 = (value: number | null | undefined, fallback = 0): number => {
  const n = Number(value ?? fallback);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
};

function freshnessScore(lastSeenAt: string | null | undefined): { score: number; ageHours: number | null } {
  if (!lastSeenAt) return { score: 0.35, ageHours: null };
  const ms = Date.parse(lastSeenAt);
  if (!Number.isFinite(ms)) return { score: 0.35, ageHours: null };
  const ageHours = Math.max(0, (Date.now() - ms) / 36e5);
  if (ageHours <= 6) return { score: 1, ageHours };
  if (ageHours <= 24) return { score: 0.92, ageHours };
  if (ageHours <= 72) return { score: 0.78, ageHours };
  if (ageHours <= 168) return { score: 0.58, ageHours };
  return { score: 0.32, ageHours };
}

function volumeScore(observations: number): number {
  if (observations >= 160) return 1;
  if (observations >= 80) return 0.92;
  if (observations >= 40) return 0.8;
  if (observations >= 20) return 0.68;
  if (observations >= 8) return 0.52;
  if (observations >= 3) return 0.32;
  return 0.08;
}

function validationScore(state: string | null | undefined, rawScore: number | null | undefined): number {
  const normalized = String(state ?? '').toLowerCase();
  const base = clamp01(rawScore, 0.5);
  if (normalized === 'passed') return Math.max(0.82, base);
  if (normalized === 'needs_review') return Math.max(0.52, base);
  if (normalized === 'unvalidated') return 0.38;
  if (normalized === 'failed') return 0.08;
  return base || 0.38;
}

function gateApprovalScore(approved: number, quarantined: number, rejected: number): number {
  const total = approved + quarantined + rejected;
  if (total <= 0) return 0.5;
  const raw = approved / total;
  return clamp01(raw, 0.5);
}

export function computeSourceCertificationDecision(input: SourceCertificationInput): SourceCertificationDecision {
  const lifecycleStatus = String(input.lifecycleStatus ?? '').toLowerCase();
  const validationState = String(input.validationState ?? '').toLowerCase();
  const observations = Math.max(0, Number(input.observationsLookback ?? 0));
  const approved = Math.max(0, Number(input.gateApproved ?? 0));
  const quarantined = Math.max(0, Number(input.gateQuarantined ?? 0));
  const rejected = Math.max(0, Number(input.gateRejected ?? 0));
  const trust = clamp01(input.trustEffective, 0.5);
  const err = input.errorRate == null ? null : clamp01(input.errorRate, 0);
  const anomaly = input.anomalyRate == null ? null : clamp01(input.anomalyRate, 0);
  const fresh = freshnessScore(input.lastSuccessAt ?? input.lastObservedAt ?? null);
  const validation = validationScore(validationState, input.validationScore);
  const gateScore = gateApprovalScore(approved, quarantined, rejected);
  const activity = volumeScore(observations);
  const health = err == null ? 0.52 : 1 - err;
  const anomalyHealth = anomaly == null ? 0.62 : Math.max(0, 1 - Math.min(1, anomaly * 2.2));

  const qualityScore = Number((
    validation * 0.19 +
    health * 0.18 +
    anomalyHealth * 0.15 +
    fresh.score * 0.14 +
    activity * 0.16 +
    gateScore * 0.11 +
    trust * 0.07
  ).toFixed(4));

  const confidence = Number(Math.min(
    0.99,
    0.42 +
      activity * 0.18 +
      validation * 0.12 +
      fresh.score * 0.1 +
      gateScore * 0.1 +
      trust * 0.08,
  ).toFixed(4));

  const evidence = {
    lifecycle_status: lifecycleStatus || null,
    validation_state: validationState || null,
    validation_score: Number(validation.toFixed(4)),
    trust_effective: Number(trust.toFixed(4)),
    error_rate: err == null ? null : Number(err.toFixed(4)),
    anomaly_rate: anomaly == null ? null : Number(anomaly.toFixed(4)),
    observations_lookback: observations,
    freshness_hours: fresh.ageHours == null ? null : Number(fresh.ageHours.toFixed(2)),
    gate: {
      approved,
      quarantined,
      rejected,
      approval_score: Number(gateScore.toFixed(4)),
    },
  };

  if (lifecycleStatus === 'candidate') {
    return {
      tier: 'sandbox',
      status: 'pending',
      publishEnabled: false,
      qualityScore,
      confidence,
      reason: 'candidate_sources_must_not_publish_before_certification',
      reviewPriority: 90,
      evidence,
    };
  }

  if (input.autoDisabled || ((err ?? 0) >= 0.85 && observations >= 5)) {
    return {
      tier: 'suspended',
      status: 'suspended',
      publishEnabled: false,
      qualityScore,
      confidence,
      reason: 'source_health_is_unsafe_for_public_ranking',
      reviewPriority: 10,
      evidence,
    };
  }

  if (validationState === 'failed') {
    return {
      tier: 'sandbox',
      status: 'rejected',
      publishEnabled: false,
      qualityScore,
      confidence,
      reason: 'validation_failed',
      reviewPriority: 20,
      evidence,
    };
  }

  if (
    qualityScore >= 0.9 &&
    observations >= 80 &&
    gateScore >= 0.88 &&
    (err == null || err <= 0.12) &&
    (anomaly == null || anomaly <= 0.06) &&
    (fresh.ageHours == null || fresh.ageHours <= 48)
  ) {
    return {
      tier: 'anchor',
      status: 'certified',
      publishEnabled: true,
      qualityScore,
      confidence,
      reason: 'anchor_quality_source',
      reviewPriority: 100,
      evidence,
    };
  }

  if (
    qualityScore >= 0.74 &&
    observations >= 20 &&
    gateScore >= 0.7 &&
    (err == null || err <= 0.35) &&
    (fresh.ageHours == null || fresh.ageHours <= 96)
  ) {
    return {
      tier: 'published',
      status: 'certified',
      publishEnabled: true,
      qualityScore,
      confidence,
      reason: 'meets_publication_gate',
      reviewPriority: 120,
      evidence,
    };
  }

  if (qualityScore >= 0.55 && observations >= 5 && validationState !== 'unvalidated') {
    return {
      tier: 'observed',
      status: 'needs_review',
      publishEnabled: false,
      qualityScore,
      confidence,
      reason: 'collect_more_evidence_before_publication',
      reviewPriority: 60,
      evidence,
    };
  }

  return {
    tier: 'sandbox',
    status: 'needs_review',
    publishEnabled: false,
    qualityScore,
    confidence,
    reason: 'insufficient_quality_for_publication',
    reviewPriority: 30,
    evidence,
  };
}

export type CertifySourcesOpts = {
  limit?: number;
  hours?: number;
  countryCode?: string;
  apply?: boolean;
  domains?: string[];
};

function normalizeScopedDomain(input: string): string {
  return String(input || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '')
    .replace(/\/$/, '');
}

function normalizeScopedDomains(input: unknown): string[] {
  const raw = Array.isArray(input)
    ? input
    : typeof input === 'string'
      ? input.split(/[,\n\r\t ]+/g)
      : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    const domain = normalizeScopedDomain(String(item ?? ''));
    if (!domain || seen.has(domain)) continue;
    seen.add(domain);
    out.push(domain);
  }
  return out;
}

export async function certifySources(env: Env, opts?: CertifySourcesOpts): Promise<any> {
  const db = getDb(env);
  const limit = Math.max(1, Math.min(5000, Number(opts?.limit ?? 500)));
  const hours = Math.max(24, Math.min(24 * 30, Number(opts?.hours ?? 72)));
  const countryCode = String(opts?.countryCode ?? 'IQ').toUpperCase();
  const mode = opts?.apply === false ? 'shadow' : 'apply';
  const runId = randomUUID();
  const requestedDomains = normalizeScopedDomains(opts?.domains ?? []);

  await db.execute(sql`
    insert into public.source_certification_runs (id, mode, status, country_code, window_hours, notes, started_at)
    values (
      ${runId}::uuid,
      ${mode},
      'running',
      ${countryCode},
      ${hours},
      ${JSON.stringify({ requested_domains: requestedDomains })}::jsonb,
      now()
    )
  `).catch(() => {});

  const result = await db.execute(sql`
    with latest_health as (
      select distinct on (sh.source_id)
        sh.source_id,
        sh.successes,
        sh.failures,
        sh.error_rate,
        sh.anomaly_rate,
        sh.last_success_at,
        sh.last_error_at
      from public.source_health_daily sh
      order by sh.source_id, sh.day desc, sh.created_at desc
    ),
    obs as (
      select
        spo.source_id,
        count(*)::int as observations_lookback,
        count(*) filter (where spo.created_at >= now() - interval '24 hours')::int as observations_24h,
        max(spo.created_at) as last_observed_at,
        sum(case when coalesce(spo.is_price_anomaly,false) then 1 else 0 end)::int as anomaly_rows
      from public.source_price_observations spo
      where spo.created_at >= now() - (${hours}::int * interval '1 hour')
      group by spo.source_id
    ),
    gate as (
      select
        source_id,
        count(*) filter (where publish_status = 'approved')::int as gate_approved,
        count(*) filter (where publish_status = 'quarantined')::int as gate_quarantined,
        count(*) filter (where publish_status = 'rejected')::int as gate_rejected
      from public.ingest_listing_candidates
      where created_at >= now() - (${hours}::int * interval '1 hour')
      group by source_id
    )
    select
      ps.id,
      ps.domain,
      ps.lifecycle_status,
      ps.validation_state,
      ps.validation_score,
      coalesce(ps.trust_weight_dynamic, ps.trust_weight, 0.50)::numeric as trust_effective,
      coalesce(ps.auto_disabled, false) as auto_disabled,
      ps.certification_tier,
      ps.certification_status,
      ps.catalog_publish_enabled,
      ps.quality_score,
      h.error_rate::numeric as error_rate,
      coalesce(h.anomaly_rate, case when coalesce(obs.observations_lookback,0) = 0 then null else obs.anomaly_rows::numeric / nullif(obs.observations_lookback,0) end)::numeric as anomaly_rate,
      h.last_success_at,
      obs.last_observed_at,
      coalesce(obs.observations_lookback, 0)::int as observations_lookback,
      coalesce(g.gate_approved, 0)::int as gate_approved,
      coalesce(g.gate_quarantined, 0)::int as gate_quarantined,
      coalesce(g.gate_rejected, 0)::int as gate_rejected
    from public.price_sources ps
    left join latest_health h on h.source_id = ps.id
    left join obs on obs.source_id = ps.id
    left join gate g on g.source_id = ps.id
    where ps.country_code = ${countryCode}
      and (${requestedDomains.length} = 0 or ps.domain = any(${requestedDomains}::text[]))
    order by coalesce(ps.activated_at, ps.created_at) asc, ps.domain asc
    limit ${limit}::int
  `);

  const rows = (result.rows as any[]) ?? [];
  let changedCount = 0;
  let publishedCount = 0;
  let sandboxedCount = 0;
  let suspendedCount = 0;
  const scopedDomains = [...new Set(rows.map((row: any) => String(row.domain ?? '')).filter(Boolean))];

  for (const row of rows) {
    const decision = computeSourceCertificationDecision({
      domain: String(row.domain ?? ''),
      lifecycleStatus: row.lifecycle_status,
      validationState: row.validation_state,
      validationScore: row.validation_score == null ? null : Number(row.validation_score),
      trustEffective: row.trust_effective == null ? null : Number(row.trust_effective),
      errorRate: row.error_rate == null ? null : Number(row.error_rate),
      anomalyRate: row.anomaly_rate == null ? null : Number(row.anomaly_rate),
      observationsLookback: row.observations_lookback == null ? null : Number(row.observations_lookback),
      lastSuccessAt: row.last_success_at ? String(row.last_success_at) : null,
      lastObservedAt: row.last_observed_at ? String(row.last_observed_at) : null,
      gateApproved: row.gate_approved == null ? null : Number(row.gate_approved),
      gateQuarantined: row.gate_quarantined == null ? null : Number(row.gate_quarantined),
      gateRejected: row.gate_rejected == null ? null : Number(row.gate_rejected),
      autoDisabled: Boolean(row.auto_disabled),
    });

    if (decision.tier === 'sandbox') sandboxedCount += 1;
    if (decision.tier === 'suspended') suspendedCount += 1;
    if (decision.publishEnabled) publishedCount += 1;

    await db.execute(sql`
      insert into public.source_certification_decisions (
        run_id,
        source_id,
        domain,
        previous_tier,
        decided_tier,
        previous_status,
        decided_status,
        publish_enabled,
        quality_score,
        confidence,
        review_priority,
        reason,
        evidence
      )
      values (
        ${runId}::uuid,
        ${String(row.id)}::uuid,
        ${String(row.domain ?? '')},
        ${row.certification_tier},
        ${decision.tier},
        ${row.certification_status},
        ${decision.status},
        ${decision.publishEnabled},
        ${decision.qualityScore},
        ${decision.confidence},
        ${decision.reviewPriority},
        ${decision.reason},
        ${JSON.stringify(decision.evidence)}::jsonb
      )
    `).catch(() => {});

    const changed =
      String(row.certification_tier ?? '') !== decision.tier ||
      String(row.certification_status ?? '') !== decision.status ||
      Boolean(row.catalog_publish_enabled) !== decision.publishEnabled ||
      Math.abs(Number(row.quality_score ?? 0) - decision.qualityScore) >= 0.001;

    if (changed) changedCount += 1;

    if (mode === 'apply') {
      await db.execute(sql`
        update public.price_sources
        set
          certification_tier = ${decision.tier},
          certification_status = ${decision.status},
          catalog_publish_enabled = ${decision.publishEnabled},
          quality_score = ${decision.qualityScore},
          quality_updated_at = now(),
          certification_reason = ${decision.reason},
          certification_meta = ${JSON.stringify(decision.evidence)}::jsonb
        where id = ${String(row.id)}::uuid
      `);
    }
  }

  await db.execute(sql`
    update public.source_certification_runs
    set
      status = 'completed',
      scanned_count = ${rows.length},
      changed_count = ${changedCount},
      published_count = ${publishedCount},
      sandboxed_count = ${sandboxedCount},
      suspended_count = ${suspendedCount},
      notes = coalesce(notes, '{}'::jsonb) || ${JSON.stringify({ requested_domains: requestedDomains, scoped_domains: scopedDomains })}::jsonb,
      completed_at = now(),
      updated_at = now()
    where id = ${runId}::uuid
  `).catch(() => {});

  return {
    ok: true,
    run_id: runId,
    mode,
    scanned: rows.length,
    changed: changedCount,
    published: publishedCount,
    sandboxed: sandboxedCount,
    suspended: suspendedCount,
    requested_domains: requestedDomains,
    scoped_domains: scopedDomains,
  };
}

export async function getRecentSourceCertificationRuns(db: any, limit = 20): Promise<any[]> {
  const safeLimit = Math.max(1, Math.min(200, Number(limit ?? 20)));
  const rows = await db.execute(sql`
    select *
    from public.source_certification_runs
    order by started_at desc
    limit ${safeLimit}::int
  `).catch(() => ({ rows: [] as any[] }));
  return (rows.rows as any[]) ?? [];
}
