import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { verifyAppJwt } from './auth/jwt';
import { ensureAuthUser, type AppAuthContext } from './auth/appUser';
import type { Env } from './db';
import { rpcRoutes } from './routes/rpc';
import { viewRoutes } from './routes/views';
import { tableRoutes } from './routes/tables';
import { authRoutes } from './routes/auth';
import { adminRoutes } from './routes/admin';
import { offerRoutes } from './routes/offers';

const app = new Hono<{ Bindings: Env; Variables: { auth: AppAuthContext | null } }>();

app.use('*', cors({
  origin: '*',
  allowHeaders: ['Content-Type', 'Authorization'],
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
}));

// Auth middleware: verifies our app JWT and ensures the user exists in DB.
app.use('*', async (c, next) => {
  try {
    const raw = await verifyAppJwt(c.req.raw, c.env).catch(() => null);
    if (raw?.userId) {
      await ensureAuthUser(c.env, raw.userId, {
        email: (raw.claims as any)?.email ?? null,
        displayName: (raw.claims as any)?.name ?? null,
      });
      c.set('auth', { ...raw, appUserId: raw.userId });
    } else {
      c.set('auth', null);
    }
  } catch {
    c.set('auth', null);
  }
  await next();
});

app.get('/health', (c) => c.json({ ok: true }));

app.route('/auth', authRoutes);
app.route('/rpc', rpcRoutes);
app.route('/views', viewRoutes);
app.route('/tables', tableRoutes);
app.route('/offers', offerRoutes);
app.route('/admin', adminRoutes);

export default app;
