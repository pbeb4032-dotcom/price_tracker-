import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./lib/monitoring', async () => {
  const actual = await vi.importActual<typeof import('./lib/monitoring')>('./lib/monitoring');
  return {
    ...actual,
    getSystemMetrics: vi.fn(),
  };
});

vi.mock('./lib/metrics', async () => {
  const actual = await vi.importActual<typeof import('./lib/metrics')>('./lib/metrics');
  return {
    ...actual,
    getMetrics: vi.fn(),
  };
});

import app from './index';
import { getSystemMetrics } from './lib/monitoring';
import { getMetrics } from './lib/metrics';

const mockEnv = {
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test_db',
  APP_JWT_SECRET: 'test-secret',
};

describe('app index', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a healthy response from /health', async () => {
    vi.mocked(getSystemMetrics).mockResolvedValue({
      timestamp: new Date().toISOString(),
      uptime: 123,
      memory: { used: 1, total: 2, external: 3, rss: 4 },
      cpu: { user: 1, system: 1 },
      database: { status: 'healthy', latency: 12 },
      redis: { status: 'healthy', latency: 3 },
      environment: { node_version: 'v20', platform: 'win32', arch: 'x64' },
    } as any);

    const response = await app.request('/health', undefined, mockEnv as any);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: 'healthy',
      uptime: 123,
      database: { status: 'healthy', latency: 12 },
    });
  });

  it('returns 503 from /health when metrics collection fails', async () => {
    vi.mocked(getSystemMetrics).mockRejectedValue(new Error('database unavailable'));

    const response = await app.request('/health', undefined, mockEnv as any);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      status: 'unhealthy',
      error: 'database unavailable',
    });
  });

  it('returns Prometheus text from /metrics', async () => {
    vi.mocked(getMetrics).mockResolvedValue('metric_name 1\n');

    const response = await app.request('/metrics', undefined, mockEnv as any);

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')?.toLowerCase()).toContain('text/plain');
    await expect(response.text()).resolves.toContain('metric_name 1');
  });

  it('returns 500 from /metrics when metrics export fails', async () => {
    vi.mocked(getMetrics).mockRejectedValue(new Error('metrics unavailable'));

    const response = await app.request('/metrics', undefined, mockEnv as any);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      status: 'error',
      error: 'metrics unavailable',
    });
  });
});
