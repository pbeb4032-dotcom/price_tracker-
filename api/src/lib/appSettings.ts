import { sql } from 'drizzle-orm';

// Minimal JSONB KV store for small internal state/cursors.
// Safe, additive, and works on existing DB volumes.

export async function ensureAppSettingsSchema(db: any): Promise<void> {
  await db.execute(sql`
    create table if not exists public.app_settings (
      key text primary key,
      value jsonb not null default '{}'::jsonb,
      updated_at timestamptz not null default now()
    );
  `).catch(() => {});
}

export async function getAppSetting<T = any>(db: any, key: string): Promise<T | null> {
  const r = await db
    .execute(sql`select value from public.app_settings where key=${key} limit 1`)
    .catch(() => ({ rows: [] as any[] }));
  const v = (r.rows as any[])[0]?.value;
  return (v ?? null) as any;
}

export async function setAppSetting(db: any, key: string, value: any): Promise<void> {
  await db
    .execute(sql`
      insert into public.app_settings(key, value)
      values (${key}, ${JSON.stringify(value)}::jsonb)
      on conflict (key) do update
        set value = excluded.value,
            updated_at = now()
    `)
    .catch(() => {});
}

export async function patchAppSettingsSchema(env: any, getDb: (env: any) => any): Promise<any> {
  const db = getDb(env);
  await ensureAppSettingsSchema(db);
  return { ok: true };
}
