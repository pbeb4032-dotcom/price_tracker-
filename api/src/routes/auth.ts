import { Hono } from 'hono';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { randomBytes, pbkdf2Sync, timingSafeEqual } from 'node:crypto';
import { getDb, type Env } from '../db';
import { signAppJwt } from '../auth/jwt';
import { ensureAuthUser } from '../auth/appUser';
import type { AppAuthContext } from '../auth/appUser';

type Ctx = { Bindings: Env; Variables: { auth: AppAuthContext | null } };

export const authRoutes = new Hono<Ctx>();

const signUpSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6).max(200),
  display_name: z.string().min(1).max(80),
});

const signInSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(200),
});

async function parseBody<T>(c: any, schema: z.ZodType<T>) {
  const body = await c.req.json().catch(() => null);
  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    return {
      ok: false as const,
      response: c.json(
        {
          error: 'INVALID_REQUEST',
          details: parsed.error.flatten(),
        },
        400
      ),
    };
  }

  return {
    ok: true as const,
    data: parsed.data,
  };
}

function encodePassword(password: string) {
  const iterations = 120_000;
  const salt = randomBytes(16).toString('base64');
  const hash = pbkdf2Sync(password, salt, iterations, 32, 'sha256').toString('base64');
  return `pbkdf2$sha256$${iterations}$${salt}$${hash}`;
}

function verifyPassword(password: string, stored: string) {
  const parts = stored.split('$');
  if (parts.length !== 5) return false;
  const [kind, alg, iterStr, salt, hash] = parts;
  if (kind !== 'pbkdf2' || alg !== 'sha256') return false;
  const iterations = Number(iterStr);
  if (!Number.isFinite(iterations) || iterations < 50_000) return false;

  const computed = pbkdf2Sync(password, salt, iterations, 32, 'sha256').toString('base64');

  // constant-time compare
  const a = Buffer.from(computed);
  const b = Buffer.from(hash);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

async function ensurePasswordRow(db: any, userId: string, password: string) {
  const encoded = encodePassword(password);
  await db.execute(sql`
    insert into auth.password_auth (user_id, password_hash)
    values (${userId}::uuid, ${encoded})
    on conflict (user_id) do update set
      password_hash = excluded.password_hash,
      updated_at = now()
  `);
}

authRoutes.post('/signup', async (c) => {
  const parsed = await parseBody(c, signUpSchema);
  if (!parsed.ok) return parsed.response;

  const body = parsed.data;
  const db = getDb(c.env);

  // If email already exists, reject.
  const exists = await db.execute(sql`select id from auth.users where email = ${body.email} limit 1`);
  if ((exists.rows as any[])[0]?.id) return c.json({ error: 'EMAIL_EXISTS' }, 409);

  // Create user
  const created = await db.execute(sql`
    insert into auth.users (email, raw_user_meta_data)
    values (${body.email}, ${JSON.stringify({ display_name: body.display_name })}::jsonb)
    returning id
  `);
  const userId = (created.rows as any[])[0]?.id as string | undefined;
  if (!userId) return c.json({ error: 'CREATE_USER_FAILED' }, 500);

  await ensureAuthUser(c.env, userId, { email: body.email, displayName: body.display_name });
  await ensurePasswordRow(db, userId, body.password);

  const token = await signAppJwt(c.env, userId, { email: body.email, name: body.display_name });
  return c.json({ token, user: { id: userId, email: body.email } });
});

authRoutes.post('/login', async (c) => {
  const parsed = await parseBody(c, signInSchema);
  if (!parsed.ok) return parsed.response;

  const body = parsed.data;
  const db = getDb(c.env);

  const r = await db.execute(sql`
    select u.id, u.email, coalesce(u.raw_user_meta_data->>'display_name','') as display_name,
           p.password_hash
    from auth.users u
    left join auth.password_auth p on p.user_id = u.id
    where u.email = ${body.email}
    limit 1
  `);

  const row = (r.rows as any[])[0];
  if (!row?.id) return c.json({ error: 'INVALID_CREDENTIALS' }, 401);

  // Bootstrap: if password_auth missing for the seeded local admin user, allow first login to set it.
  if (!row.password_hash && String(row.email) === 'admin@local' && body.password === 'admin123') {
    await ensurePasswordRow(db, row.id, body.password);
    row.password_hash = (await db.execute(sql`select password_hash from auth.password_auth where user_id=${row.id}::uuid`)).rows?.[0]?.password_hash;
  }

  if (!row.password_hash || !verifyPassword(body.password, String(row.password_hash))) {
    return c.json({ error: 'INVALID_CREDENTIALS' }, 401);
  }

  const token = await signAppJwt(c.env, row.id, { email: row.email, name: row.display_name });
  return c.json({ token, user: { id: row.id, email: row.email } });
});

authRoutes.get('/session', async (c) => {
  const auth = c.get('auth');
  if (!auth) return c.json({ error: 'UNAUTHORIZED' }, 401);

  const db = getDb(c.env);
  const prof = await db.execute(sql`
    select * from public.profiles where user_id = ${auth.appUserId}::uuid limit 1
  `);

  const user = await db.execute(sql`
    select id, email, coalesce(raw_user_meta_data->>'display_name','') as display_name
    from auth.users where id = ${auth.appUserId}::uuid limit 1
  `);

  return c.json({
    user: (user.rows as any[])[0] ?? null,
    profile: (prof.rows as any[])[0] ?? null,
  });
});

// One-click local dev login (optional).
authRoutes.post('/dev-login', async (c) => {
  const secret = String((await c.req.json().catch(() => ({})) as any).secret ?? '');
  const expected = c.env.DEV_LOGIN_SECRET;
  if (!expected) return c.json({ error: 'DISABLED' }, 404);
  if (!secret || secret !== expected) return c.json({ error: 'UNAUTHORIZED' }, 401);

  const devUserId = '00000000-0000-4000-8000-000000000001';

  await ensureAuthUser(c.env, devUserId, { email: 'admin@local', displayName: 'Admin' });

  // Ensure admin role
  const db = getDb(c.env);
  await db.execute(sql`
    insert into public.user_roles (user_id, role)
    values (${devUserId}::uuid, 'admin'::public.app_role)
    on conflict (user_id, role) do nothing
  `);

  const token = await signAppJwt(c.env, devUserId, { email: 'admin@local', name: 'Admin' });
  return c.json({ token, user: { id: devUserId, email: 'admin@local' } });
});
