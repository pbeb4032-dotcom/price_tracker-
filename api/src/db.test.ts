import { describe, it, expect, vi } from 'vitest';

const mockEnv = {
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test_db',
  APP_JWT_SECRET: 'test-secret',
  INTERNAL_JOB_SECRET: 'internal-secret',
  DEV_LOGIN_SECRET: 'dev-secret',
};

async function loadDbModule() {
  vi.resetModules();

  const mockPool = { connect: vi.fn(), end: vi.fn() };
  const mockDrizzle = { test: 'drizzle-instance' };
  const Pool = vi.fn().mockImplementation(() => mockPool);
  const drizzle = vi.fn().mockReturnValue(mockDrizzle);

  vi.doMock('pg', () => ({ Pool }));
  vi.doMock('drizzle-orm/node-postgres', () => ({ drizzle }));

  const dbModule = await import('./db');
  return { ...dbModule, Pool, drizzle, mockPool, mockDrizzle };
}

describe('Database', () => {
  it('creates a new database connection pool', async () => {
    const { getDb, Pool, drizzle, mockPool, mockDrizzle } = await loadDbModule();

    const db = getDb(mockEnv);

    expect(Pool).toHaveBeenCalledWith({
      connectionString: mockEnv.DATABASE_URL,
      max: 20,
    });
    expect(drizzle).toHaveBeenCalledWith(mockPool);
    expect(db).toBe(mockDrizzle);
  });

  it('reuses the existing pool on subsequent calls', async () => {
    const { getDb, Pool, drizzle } = await loadDbModule();

    getDb(mockEnv);
    getDb(mockEnv);

    expect(Pool).toHaveBeenCalledTimes(1);
    expect(drizzle).toHaveBeenCalledTimes(2);
  });

  it('throws when DATABASE_URL is missing', async () => {
    const { getDb } = await loadDbModule();
    const invalidEnv = { ...mockEnv, DATABASE_URL: '' };

    expect(() => getDb(invalidEnv)).toThrow('Missing DATABASE_URL');
  });

  it('uses custom pool max from environment', async () => {
    const originalMax = process.env.DB_POOL_MAX;
    process.env.DB_POOL_MAX = '10';

    const { getDb, Pool } = await loadDbModule();
    getDb(mockEnv);

    expect(Pool).toHaveBeenCalledWith({
      connectionString: mockEnv.DATABASE_URL,
      max: 10,
    });

    if (originalMax == null) delete process.env.DB_POOL_MAX;
    else process.env.DB_POOL_MAX = originalMax;
  });
});
