import { sql } from 'drizzle-orm';
import { getDb, type Env } from '../db';
import type { AppJwtContext } from './jwt';

export type AppAuthContext = AppJwtContext & {
  appUserId: string; // uuid (same as userId)
};

export async function ensureAuthUser(env: Env, userId: string, opts?: { email?: string | null; displayName?: string | null }) {
  const db = getDb(env);

  // Ensure auth.users row exists (triggers will create profile + default role on first insert).
  await db.execute(sql`
    insert into auth.users (id, email, raw_user_meta_data)
    values (
      ${userId}::uuid,
      ${opts?.email ?? null},
      ${JSON.stringify({ display_name: opts?.displayName ?? '' })}::jsonb
    )
    on conflict (id) do update set
      email = coalesce(excluded.email, auth.users.email),
      raw_user_meta_data = case
        when excluded.raw_user_meta_data is null then auth.users.raw_user_meta_data
        else auth.users.raw_user_meta_data || excluded.raw_user_meta_data
      end,
      updated_at = now()
  `);

  // Ensure profile exists (in case triggers were disabled in some environments).
  await db.execute(sql`
    insert into public.profiles (user_id, email, display_name)
    values (${userId}::uuid, ${opts?.email ?? null}, ${opts?.displayName ?? ''})
    on conflict (user_id) do update set
      email = coalesce(excluded.email, profiles.email),
      display_name = coalesce(nullif(excluded.display_name, ''), profiles.display_name),
      updated_at = now()
  `);

  // Ensure baseline role exists.
  await db.execute(sql`
    insert into public.user_roles (user_id, role)
    values (${userId}::uuid, 'user'::public.app_role)
    on conflict (user_id, role) do nothing
  `);
}
