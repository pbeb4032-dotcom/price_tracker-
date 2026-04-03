import type { Env } from '../db';
import { patchGovernedFxSchema } from './patchGovernedFxSchema';
import { runGovernedFxUpdate, type FxOpts } from '../fx/governedFx';

/**
 * Backward-compatible job wrapper.
 * Sprint 5 makes governed FX publication the authoritative path.
 */
export async function fxUpdateDaily(env: Env, opts?: FxOpts): Promise<any> {
  await patchGovernedFxSchema(env).catch(() => {});
  return runGovernedFxUpdate(env, opts);
}
