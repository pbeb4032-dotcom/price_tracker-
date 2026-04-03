import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getPublicKeyFromReq, getSupabaseUrl } from "./keys.ts";

/**
 * Require either:
 *  - An internal secret header (for cron / server-to-server), OR
 *  - A valid Supabase JWT for a user that has the admin role.
 */
export async function requireAdminOrInternal(
  req: Request,
  corsHeaders: Record<string, string>,
): Promise<{ ok: true } | { ok: false; res: Response }> {
  // 0) Internal secret (cron/server)
  const internalSecret =
    Deno.env.get("INGEST_INTERNAL_SECRET") || Deno.env.get("JOB_SECRET") || "";
  const providedSecret =
    req.headers.get("x-internal-secret") || req.headers.get("x-job-secret") || "";
  if (internalSecret && providedSecret && providedSecret === internalSecret) {
    return { ok: true };
  }

  // 1) Env
  let supabaseUrl = "";
  try {
    supabaseUrl = getSupabaseUrl();
  } catch (e) {
    return {
      ok: false,
      res: json(
        { success: false, error: "UNAUTHORIZED", reason: (e as Error).message },
        500,
        corsHeaders,
      ),
    };
  }

  // Prefer new hosted secret key, fallback to legacy service_role JWT key.
  const serviceKey =
    Deno.env.get("SB_SECRET_KEY") ||
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
    "";

  // 2) Read Bearer token
  const authHeader = req.headers.get("authorization") ?? req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return {
      ok: false,
      res: json({ success: false, error: "UNAUTHORIZED", reason: "Missing Bearer token" }, 401, corsHeaders),
    };
  }

  const token = authHeader.slice("Bearer ".length).trim();
  if (!token) {
    return {
      ok: false,
      res: json({ success: false, error: "UNAUTHORIZED", reason: "Empty Bearer token" }, 401, corsHeaders),
    };
  }

  // 3) Validate token (prefer admin key, fallback to request apikey / env public)
  const fallbackPublicKey = getPublicKeyFromReq(req);
  if (!serviceKey && !fallbackPublicKey) {
    return {
      ok: false,
      res: json(
        {
          success: false,
          error: "UNAUTHORIZED",
          reason: "Missing apikey header and no public key available in function env",
          hint: "Send apikey header, or set SB_PUBLISHABLE_KEY / SUPABASE_ANON_KEY as a function secret.",
        },
        401,
        corsHeaders,
      ),
    };
  }

  // Helper: get user with a key
  async function getUserWithKey(key: string) {
    if (!key) return { user: null as any, error: new Error("Missing key") as any };

    const client = createClient(supabaseUrl, key, {
      auth: { persistSession: false },
    });

    const { data, error } = await client.auth.getUser(token);
    return { user: data?.user ?? null, error };
  }

  // Try admin key first (best)
  let user: any = null;
  let lastErr: any = null;

  if (serviceKey) {
    const r1 = await getUserWithKey(serviceKey);
    user = r1.user;
    lastErr = r1.error;
  }

  // Fallback to public key (from request or env)
  if (!user) {
    const r2 = await getUserWithKey(fallbackPublicKey);
    user = r2.user;
    lastErr = r2.error;
  }

  if (!user) {
    return {
      ok: false,
      res: json(
        {
          success: false,
          error: "UNAUTHORIZED",
          reason: "Invalid token (getUser failed)",
          detail: lastErr?.message ?? String(lastErr ?? ""),
        },
        401,
        corsHeaders,
      ),
    };
  }

  // 4) Admin role check via RPC (use admin key if available so ما يتأثر بـ RLS)
  const roleClientKey = serviceKey || fallbackPublicKey;
  const roleClient = createClient(supabaseUrl, roleClientKey, {
    auth: { persistSession: false },
  });

  const { data: isAdmin, error: roleErr } = await roleClient.rpc("has_role" as any, {
    _role: "admin",
    _user_id: user.id,
  });

  if (roleErr) {
    return {
      ok: false,
      res: json(
        { success: false, error: "UNAUTHORIZED", reason: "Role check failed", detail: roleErr.message },
        500,
        corsHeaders,
      ),
    };
  }

  if (!isAdmin) {
    return {
      ok: false,
      res: json({ success: false, error: "FORBIDDEN", reason: "Admin only" }, 403, corsHeaders),
    };
  }

  return { ok: true };
}

function json(data: unknown, status = 200, corsHeaders: Record<string, string>) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}