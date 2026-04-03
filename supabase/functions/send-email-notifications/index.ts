import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getServiceKey, getSupabaseUrl } from "../_shared/keys.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { limit = 100 } = await req.json().catch(() => ({}));

    const supabase = createClient(getSupabaseUrl(), getServiceKey());

    const postmarkToken = Deno.env.get("POSTMARK_SERVER_TOKEN")!;
    const emailFrom = Deno.env.get("EMAIL_FROM") || "noreply@example.com";

    const { data: pending, error } = await supabase.rpc("get_pending_email_notifications", {
      p_limit: limit,
    });
    if (error) throw error;

    let sent = 0;
    let failed = 0;

    for (const row of (pending ?? [])) {
      try {
        const res = await fetch("https://api.postmarkapp.com/email", {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "X-Postmark-Server-Token": postmarkToken,
          },
          body: JSON.stringify({
            From: emailFrom,
            To: row.email_to,
            Subject: row.subject_ar,
            TextBody: row.body_ar,
            MessageStream: "outbound",
          }),
        });

        const resBody = await res.json();

        await supabase.rpc("mark_email_delivery", {
          p_queue_id: row.queue_id,
          p_status_code: res.status,
          p_error_text: res.ok ? null : (resBody?.Message ?? "Unknown error"),
          p_provider_message_id: resBody?.MessageID ?? null,
        });

        if (res.ok) sent++;
        else failed++;
      } catch (err: unknown) {
        await supabase.rpc("mark_email_delivery", {
          p_queue_id: row.queue_id,
          p_status_code: 500,
          p_error_text: String((err as Error)?.message ?? "fetch failed"),
          p_provider_message_id: null,
        });
        failed++;
      }
    }

    return new Response(
      JSON.stringify({ ok: true, processed: (pending ?? []).length, sent, failed }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: unknown) {
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
