import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { getDb, type Env } from '../src/db';
import { patchAdminHealthSchema } from '../src/jobs/patchAdminHealthSchema';
import { patchTaxonomyV2Schema } from '../src/jobs/patchTaxonomyV2Schema';
import { patchCategoryConflictSchema } from '../src/jobs/patchCategoryConflictSchema';
import { seedTaxonomyV2 } from '../src/jobs/seedTaxonomyV2';
import { backfillTaxonomyV2 } from '../src/jobs/backfillTaxonomyV2';
import { reclassifyCategoriesSmart } from '../src/jobs/reclassifyCategoriesSmart';

function needEnv(name: string): string {
  const v = String(process.env[name] ?? '').trim();
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

async function readSnapshot(env: Env) {
  const db = getDb(env);
  const products = await db.execute(sql`
    select
      count(*)::int as total,
      count(*) filter (where coalesce(category,'general')='general')::int as general,
      count(*) filter (where coalesce(category,'general')<>'general')::int as categorized
    from public.products
  `).catch(() => ({ rows: [] as any[] }));

  const conflicts = await db.execute(sql`
    select
      count(*) filter (where status='open')::int as open,
      count(*) filter (where status='resolved')::int as resolved,
      count(*) filter (where status='ignored')::int as ignored
    from public.category_conflict_quarantine
  `).catch(() => ({ rows: [] as any[] }));

  const tq = await db.execute(sql`
    select
      count(*) filter (where status='pending')::int as pending,
      count(*) filter (where status='approved')::int as approved,
      count(*) filter (where status='rejected')::int as rejected
    from public.taxonomy_quarantine
  `).catch(() => ({ rows: [] as any[] }));

  return {
    products: (products.rows as any[])[0] ?? { total: 0, general: 0, categorized: 0 },
    conflicts: (conflicts.rows as any[])[0] ?? { open: 0, resolved: 0, ignored: 0 },
    taxonomy_quarantine: (tq.rows as any[])[0] ?? { pending: 0, approved: 0, rejected: 0 },
  };
}

async function main() {
  const env: Env = {
    DATABASE_URL: needEnv('DATABASE_URL'),
    APP_JWT_SECRET: String(process.env.APP_JWT_SECRET ?? 'local-dev-secret'),
    INTERNAL_JOB_SECRET: process.env.INTERNAL_JOB_SECRET,
    DEV_LOGIN_SECRET: process.env.DEV_LOGIN_SECRET,
  };

  const limit = Math.max(1, Math.min(200000, Number(process.env.DB_PROOF_LIMIT ?? 50000)));
  const runJobs = String(process.env.DB_PROOF_RUN_JOBS ?? '1') !== '0';

  await patchAdminHealthSchema(env);
  await patchTaxonomyV2Schema(env);
  await patchCategoryConflictSchema(env);
  await seedTaxonomyV2(env).catch(() => ({ ok: false }));

  const before = await readSnapshot(env);

  let backfill: any = null;
  let smart: any = null;
  if (runJobs) {
    backfill = await backfillTaxonomyV2(env, { limit }).catch((e: any) => ({ ok: false, error: String(e?.message ?? e) }));
    smart = await reclassifyCategoriesSmart(env, { limit, force: false }).catch((e: any) => ({ ok: false, error: String(e?.message ?? e) }));
  }

  const after = await readSnapshot(env);
  const summary = {
    ok: true,
    mode: runJobs ? 'patch+jobs' : 'patch-only',
    limit,
    before,
    backfill,
    smart,
    after,
    deltas: {
      categorized: Number(after.products.categorized ?? 0) - Number(before.products.categorized ?? 0),
      general: Number(after.products.general ?? 0) - Number(before.products.general ?? 0),
      open_conflicts: Number(after.conflicts.open ?? 0) - Number(before.conflicts.open ?? 0),
      pending_taxonomy_quarantine: Number(after.taxonomy_quarantine.pending ?? 0) - Number(before.taxonomy_quarantine.pending ?? 0),
    },
  };

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error('live db governance proof failed');
  console.error(err?.stack || String(err));
  process.exit(1);
});
