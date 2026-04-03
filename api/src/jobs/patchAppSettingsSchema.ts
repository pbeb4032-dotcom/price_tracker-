import { getDb, type Env } from '../db';
import { patchAppSettingsSchema } from '../lib/appSettings';

/**
 * Schema: create public.app_settings (JSONB KV store for cursors/scheduler state).
 * Safe + idempotent.
 */
export async function patchAppSettingsSchemaJob(env: Env): Promise<any> {
  return patchAppSettingsSchema(env, getDb);
}
