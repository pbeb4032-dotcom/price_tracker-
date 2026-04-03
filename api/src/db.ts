import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';

export type DbClient = ReturnType<typeof drizzle>;

export type Env = {
  DATABASE_URL: string;
  APP_JWT_SECRET: string;

  // Optional: internal secret for running jobs without login (cron/CI)
  INTERNAL_JOB_SECRET?: string;

  // Optional: allow a one-click local dev login (disabled if not set)
  DEV_LOGIN_SECRET?: string;
};

let pool: Pool | null = null;

export function getDb(env: Env) {
  if (!env.DATABASE_URL) throw new Error('Missing DATABASE_URL');
  if (!pool) {
    pool = new Pool({
      connectionString: env.DATABASE_URL,
      max: Number(process.env.DB_POOL_MAX || 20),
    });
  }
  return drizzle(pool);
}

export function resetDbPoolForTests() {
  pool = null;
}
