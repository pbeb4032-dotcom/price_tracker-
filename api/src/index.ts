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
import { swaggerUI } from '@hono/swagger-ui';
import { getSystemMetrics } from './lib/monitoring';
import { getMetrics } from './lib/metrics';

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

app.get('/health', async (c) => {
  try {
    const metrics = await getSystemMetrics(c.env);
    return c.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: '0.2.0',
      environment: process.env.NODE_ENV || 'development',
      uptime: metrics.uptime,
      memory: metrics.memory,
      database: metrics.database,
    });
  } catch (error) {
    return c.json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Unknown error',
    }, 503);
  }
});

app.get('/metrics', async (c) => {
  try {
    const metricsData = await getMetrics();
    c.header('Content-Type', 'text/plain; charset=utf-8');
    return c.text(metricsData);
  } catch (error) {
    return c.json({
      status: 'error',
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});

app.route('/auth', authRoutes);
app.route('/rpc', rpcRoutes);
app.route('/views', viewRoutes);
app.route('/tables', tableRoutes);
app.route('/offers', offerRoutes);
app.route('/admin', adminRoutes);

// API Documentation
app.get('/docs', swaggerUI({
  url: '/openapi.json',
}));

app.get('/openapi.json', (c) => {
  return c.json({
    openapi: '3.0.0',
    info: {
      title: 'Price Tracker Iraq API',
      version: '0.2.0',
      description: 'API for tracking product prices across Iraqi e-commerce platforms',
    },
    servers: [
      {
        url: 'http://localhost:8787',
        description: 'Development server',
      },
      {
        url: 'https://api.price-tracker-iraq.com',
        description: 'Production server',
      },
    ],
    paths: {
      '/health': {
        get: {
          summary: 'Health check',
          responses: {
            200: {
              description: 'API is healthy',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      status: { type: 'string' },
                      timestamp: { type: 'string' },
                      version: { type: 'string' },
                      environment: { type: 'string' },
                      uptime: { type: 'number' },
                      memory: { type: 'object' },
                      database: { type: 'object' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/metrics': {
        get: {
          summary: 'Prometheus metrics',
          responses: {
            200: {
              description: 'Metrics in Prometheus format',
              content: {
                'text/plain': {
                  schema: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
  });
});

export default app;
