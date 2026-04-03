/**
 * keys.ts
 *
 * Supabase is transitioning from legacy JWT-based keys (anon/service_role)
 * to new API keys (sb_publishable / sb_secret).
 *
 * Edge Functions don't automatically expose the new keys unless you add them
 * as secrets (recommended env names below).
 *
 * This helper lets the project run on either setup without scattered changes.
 */

export function getSupabaseUrl(): string {
  const url = Deno.env.get("SUPABASE_URL") || "";
  if (!url) throw new Error("SUPABASE_URL is not configured");
  return url;
}

/**
 * Admin (server) key for DB writes.
 * - New hosted key: SB_SECRET_KEY (sb_secret_...)
 * - Legacy hosted key: SUPABASE_SERVICE_ROLE_KEY (service_role JWT)
 */
export function getServiceKey(): string {
  const k =
    Deno.env.get("SB_SECRET_KEY") ||
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
    "";
  if (!k) {
    throw new Error(
      "Missing admin key. Set SB_SECRET_KEY (preferred) or SUPABASE_SERVICE_ROLE_KEY as an Edge Function secret.",
    );
  }
  return k;
}

/**
 * Public key for read operations / user validation.
 * - Request apikey header wins.
 * - Else: SB_PUBLISHABLE_KEY (sb_publishable_...) if you exposed it.
 * - Else: SUPABASE_ANON_KEY (legacy anon JWT)
 */
export function getPublicKeyFromReq(req: Request): string {
  const requestApiKey = req.headers.get("apikey") || req.headers.get("x-api-key") || "";
  const envPublishable = Deno.env.get("SB_PUBLISHABLE_KEY") || "";
  const envAnon = Deno.env.get("SUPABASE_ANON_KEY") || "";
  return requestApiKey || envPublishable || envAnon;
}
