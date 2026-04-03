import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { getDb, type Env } from '../src/db';
import { patchCategoryConflictSchema } from '../src/jobs/patchCategoryConflictSchema';

function needEnv(name: string): string {
  const v = String(process.env[name] ?? '').trim();
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

async function main() {
  const env: Env = {
    DATABASE_URL: needEnv('DATABASE_URL'),
    APP_JWT_SECRET: String(process.env.APP_JWT_SECRET ?? 'local-dev-secret'),
    INTERNAL_JOB_SECRET: process.env.INTERNAL_JOB_SECRET,
    DEV_LOGIN_SECRET: process.env.DEV_LOGIN_SECRET,
  };

  await patchCategoryConflictSchema(env);
  const db = getDb(env);

  const name = `fixture conflict ${Date.now()}`;
  const evidence = {
    siteCategory: 'fashion/wallets',
    inferredCategory: 'electronics',
    reason: 'fixture proof',
    signals: ['digital-card', 'wallet-keyword-conflict'],
  };

  let productId = '';
  let conflictId = '';

  try {
    const created = await db.execute(sql`
      insert into public.products (name_ar, name_en, category, unit, description_ar, image_url, is_active)
      values (${name}, null, 'clothing', 'pcs', 'fixture proof product', null, true)
      returning id::text as id
    `);
    productId = String((created.rows as any[])[0]?.id ?? '');
    assert(productId, 'fixture product was not created');

    const inserted = await db.execute(sql`
      insert into public.category_conflict_quarantine (
        status, review_note, decided_category, product_id, evidence
      )
      values ('open', 'fixture inserted', null, ${productId}::uuid, ${JSON.stringify(evidence)}::jsonb)
      returning id::text as id
    `);
    conflictId = String((inserted.rows as any[])[0]?.id ?? '');
    assert(conflictId, 'fixture conflict was not created');

    const openCount = await db.execute(sql`
      select count(*)::int as c
      from public.category_conflict_quarantine
      where product_id = ${productId}::uuid and status = 'open'
    `);
    assert(Number((openCount.rows as any[])[0]?.c ?? 0) === 1, 'expected exactly one open conflict');

    await db.execute(sql`
      update public.category_conflict_quarantine
      set status = 'resolved', decided_category = 'electronics', review_note = 'fixture resolved', updated_at = now()
      where id = ${conflictId}::uuid
    `);

    const resolvedCount = await db.execute(sql`
      select count(*)::int as c
      from public.category_conflict_quarantine
      where product_id = ${productId}::uuid and status = 'resolved'
    `);
    assert(Number((resolvedCount.rows as any[])[0]?.c ?? 0) === 1, 'expected exactly one resolved conflict');

    console.log(JSON.stringify({
      ok: true,
      productId,
      conflictId,
      checks: {
        inserted_open: true,
        resolved: true,
      },
    }, null, 2));
  } finally {
    if (conflictId) {
      await db.execute(sql`delete from public.category_conflict_quarantine where id = ${conflictId}::uuid`).catch(() => {});
    }
    if (productId) {
      await db.execute(sql`delete from public.products where id = ${productId}::uuid`).catch(() => {});
    }
  }
}

main().catch((err) => {
  console.error('live db fixture conflict proof failed');
  console.error(err?.stack || String(err));
  process.exit(1);
});
