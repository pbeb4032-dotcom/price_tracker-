/**
 * refresh-prices
 * Hourly cron job to refresh prices from all active sources
 * and update exchange rates.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { requireAdminOrInternal } from "../_shared/auth.ts";
import { getServiceKey, getSupabaseUrl } from "../_shared/keys.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // 🔒 Admin-only (or internal secret for cron)
  const gate = await requireAdminOrInternal(req, corsHeaders);
  if (!gate.ok) return gate.res;

  const supabaseUrl = getSupabaseUrl();
  const internalSecret = Deno.env.get("INGEST_INTERNAL_SECRET");
  const sb = createClient(supabaseUrl, getServiceKey());

  if (!internalSecret) {
    return json({ success: false, error: "INGEST_INTERNAL_SECRET not configured" }, 500);
  }

  const results: Record<string, any> = {};

  try {
    // 1. Trigger ingest-product-pages to refresh prices from crawled sources
    try {
      const ingestRes = await fetch(`${supabaseUrl}/functions/v1/ingest-product-pages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-secret": internalSecret,
        },
        body: JSON.stringify({ limit: 50 }),
      });
      results.ingest = { status: ingestRes.status, ok: ingestRes.ok };
    } catch (err) {
      results.ingest = { error: String(err) };
    }

    // 2. Trigger discover-product-apis for API-based sources
    try {
      const apiRes = await fetch(`${supabaseUrl}/functions/v1/discover-product-apis`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-secret": internalSecret,
        },
        body: JSON.stringify({}),
      });
      results.apis = { status: apiRes.status, ok: apiRes.ok };
    } catch (err) {
      results.apis = { error: String(err) };
    }

    // 3. Trigger price alerts check
    try {
      const alertsRes = await fetch(`${supabaseUrl}/functions/v1/dispatch-price-alerts`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-secret": internalSecret,
        },
        body: JSON.stringify({}),
      });
      results.alerts = { status: alertsRes.status, ok: alertsRes.ok };
    } catch (err) {
      results.alerts = { error: String(err) };
    }

    // 4. Refresh exchange rates
    try {
      // Check if we have today's rate
      const today = new Date().toISOString().split("T")[0];
      const { data: todayRate } = await sb
        .from("exchange_rates")
        .select("id")
        .eq("rate_date", today)
        .eq("source_type", "market")
        .limit(1);

      if (!todayRate?.length) {
        // Insert today's market rate (using last known rate as baseline)
        const { data: lastRate } = await sb
          .from("exchange_rates")
          .select("mid_iqd_per_usd, buy_iqd_per_usd, sell_iqd_per_usd")
          .eq("source_type", "market")
          .eq("is_active", true)
          .order("rate_date", { ascending: false })
          .limit(1);

        if (lastRate?.length) {
          await sb.from("exchange_rates").insert({
            rate_date: today,
            source_type: "market",
            source_name: "سعر السوق",
            mid_iqd_per_usd: lastRate[0].mid_iqd_per_usd,
            buy_iqd_per_usd: lastRate[0].buy_iqd_per_usd,
            sell_iqd_per_usd: lastRate[0].sell_iqd_per_usd,
            is_active: true,
          });
          results.exchange = { refreshed: true };
        }
      } else {
        results.exchange = { already_current: true };
      }
    } catch (err) {
      results.exchange = { error: String(err) };
    }

    return json({ success: true, results, timestamp: new Date().toISOString() });
  } catch (err) {
    console.error("refresh-prices error:", err);
    return json({ success: false, error: String(err) }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
