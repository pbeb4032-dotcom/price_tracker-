import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdminOrInternal } from "../_shared/auth.ts";
import { getServiceKey, getSupabaseUrl } from "../_shared/keys.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // 🔒 Admin-only (or internal secret for cron)
  const gate = await requireAdminOrInternal(req, corsHeaders);
  if (!gate.ok) return gate.res;

  try {
    const { limit = 200, cooldown_minutes = 180 } = await req.json().catch(() => ({}));

    const supabase = createClient(getSupabaseUrl(), getServiceKey());

    const { data, error } = await supabase.rpc(
      "enqueue_triggered_price_alert_notifications",
      { p_limit: limit, p_cooldown_minutes: cooldown_minutes },
    );

    if (error) throw error;

    const processed = data?.length ?? 0;
    console.log(`Processed ${processed} triggered alerts, notifications enqueued`);

    return new Response(
      JSON.stringify({ ok: true, processed }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("dispatch-price-alerts error:", (e as Error).message);
    return new Response(
      JSON.stringify({ ok: false, error: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
