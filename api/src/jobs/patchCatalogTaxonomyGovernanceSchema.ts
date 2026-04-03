import { sql } from 'drizzle-orm';
import { getDb, type Env } from '../db';

export async function patchCatalogTaxonomyGovernanceSchema(env: Env): Promise<any> {
  const db = getDb(env);

  await db.execute(sql`
    create table if not exists public.catalog_taxonomy_shadow_runs (
      id uuid primary key default gen_random_uuid(),
      mode text not null default 'shadow'
        check (mode in ('shadow', 'apply')),
      status text not null default 'running'
        check (status in ('running', 'completed', 'failed')),
      scanned_count integer not null default 0,
      approved_count integer not null default 0,
      quarantined_count integer not null default 0,
      applied_count integer not null default 0,
      changed_count integer not null default 0,
      notes jsonb not null default '{}'::jsonb,
      started_at timestamptz not null default now(),
      completed_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `).catch(() => {});

  await db.execute(sql`
    create table if not exists public.catalog_taxonomy_decisions (
      id uuid primary key default gen_random_uuid(),
      run_id uuid null references public.catalog_taxonomy_shadow_runs(id) on delete set null,
      variant_id uuid not null references public.catalog_product_variants(id) on delete cascade,
      family_id uuid null references public.catalog_product_families(id) on delete set null,
      legacy_product_id uuid null references public.products(id) on delete set null,
      source_domain text,
      source_url text,
      site_category_raw text,
      decision_mode text not null default 'shadow'
        check (decision_mode in ('shadow', 'apply', 'ingest_html', 'ingest_api')),
      decided_taxonomy_key text,
      decided_category text not null default 'general',
      decided_subcategory text,
      confidence numeric(4,3) not null default 0,
      margin numeric(4,3) not null default 0,
      decision_status text not null
        check (decision_status in ('approved', 'quarantined', 'rejected')),
      review_priority integer not null default 100,
      reason text,
      conflict boolean not null default false,
      conflict_reasons jsonb not null default '[]'::jsonb,
      deny_rules text[] not null default '{}'::text[],
      evidence jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique(run_id, variant_id)
    )
  `).catch(() => {});
  await db.execute(sql`create index if not exists idx_catalog_taxonomy_decisions_variant on public.catalog_taxonomy_decisions(variant_id, created_at desc)`).catch(() => {});
  await db.execute(sql`create index if not exists idx_catalog_taxonomy_decisions_status on public.catalog_taxonomy_decisions(decision_status, created_at desc)`).catch(() => {});
  await db.execute(sql`create index if not exists idx_catalog_taxonomy_decisions_source on public.catalog_taxonomy_decisions(source_domain, created_at desc)`).catch(() => {});

  await db.execute(sql`
    create table if not exists public.catalog_taxonomy_quarantine (
      id uuid primary key default gen_random_uuid(),
      run_id uuid null references public.catalog_taxonomy_shadow_runs(id) on delete set null,
      latest_decision_id uuid null references public.catalog_taxonomy_decisions(id) on delete set null,
      variant_id uuid not null references public.catalog_product_variants(id) on delete cascade,
      family_id uuid null references public.catalog_product_families(id) on delete set null,
      legacy_product_id uuid null references public.products(id) on delete set null,
      source_domain text,
      source_url text,
      product_name text,
      current_taxonomy_key text,
      inferred_taxonomy_key text,
      inferred_category text not null default 'general',
      inferred_subcategory text,
      confidence numeric(4,3) not null default 0,
      margin numeric(4,3) not null default 0,
      review_priority integer not null default 100,
      deny_rules text[] not null default '{}'::text[],
      conflict boolean not null default false,
      conflict_reasons jsonb not null default '[]'::jsonb,
      evidence jsonb not null default '{}'::jsonb,
      status text not null default 'pending'
        check (status in ('pending', 'approved', 'rejected', 'ignored')),
      reviewer_note text,
      reviewed_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique(variant_id, status)
    )
  `).catch(() => {});
  await db.execute(sql`create index if not exists idx_catalog_taxonomy_quarantine_status on public.catalog_taxonomy_quarantine(status, review_priority asc, created_at desc)`).catch(() => {});

  await db.execute(sql`
    create table if not exists public.catalog_taxonomy_metrics_daily (
      day date not null,
      source_domain text not null,
      decided_category text not null,
      decided_taxonomy_key text,
      decision_status text not null,
      decisions_count integer not null default 0,
      conflict_count integer not null default 0,
      deny_rule_count integer not null default 0,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      primary key (day, source_domain, decided_category, decided_taxonomy_key, decision_status)
    )
  `).catch(() => {});

  return { ok: true };
}
