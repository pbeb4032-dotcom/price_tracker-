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

    const { limit = 200 } = await req.json().catch(() => ({}));

    const supabase = createClient(getSupabaseUrl(), getServiceKey());

    const vapidPublic = Deno.env.get("VAPID_PUBLIC_KEY")!;
    const vapidPrivate = Deno.env.get("VAPID_PRIVATE_KEY")!;
    const vapidSubject = Deno.env.get("VAPID_SUBJECT") || "mailto:support@example.com";

    // Dynamic import for web-push
    const webpush = await import("npm:web-push@3.6.7");
    webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);

    const { data: pending, error } = await supabase.rpc("get_pending_push_notifications", {
      p_limit: limit,
    });
    if (error) throw error;

    let processed = 0;

    for (const row of (pending ?? [])) {
      try {
        await webpush.sendNotification(
          {
            endpoint: row.endpoint,
            keys: { p256dh: row.p256dh, auth: row.auth },
          },
          JSON.stringify({
            title: row.title_ar || "تنبيه سعر",
            body: row.body_ar || "عندك إشعار جديد",
            url: row.payload?.product_id ? `/explore/${row.payload.product_id}` : "/notifications",
            payload: row.payload ?? {},
          }),
        );

        await supabase.rpc("mark_push_delivery", {
          p_notification_id: row.notification_id,
          p_subscription_id: row.subscription_id,
          p_status_code: 201,
          p_error_text: null,
        });

        processed += 1;
      } catch (err: unknown) {
        const statusCode = Number((err as any)?.statusCode ?? 500);
        await supabase.rpc("mark_push_delivery", {
          p_notification_id: row.notification_id,
          p_subscription_id: row.subscription_id,
          p_status_code: statusCode,
          p_error_text: String((err as any)?.message ?? "push failed"),
        });
      }
    }

    return new Response(JSON.stringify({ ok: true, processed }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: unknown) {
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
