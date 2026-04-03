/**
 * prewarm-search-cache (P3.6)
 * Refreshes top search queries cache entries.
 * Triggered by cron every 30-60 min.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
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

  const sb = createClient(getSupabaseUrl(), getServiceKey());

  try {
    const body = await req.json().catch(() => ({}));
    const limit = body.limit ?? 20;

    // Get top queries by hits_count that are still active
    const { data: topQueries, error } = await sb
      .from("search_queries")
      .select("id, query_text, normalized_query, filters, query_key, avg_latency_ms")
      .order("hits_count", { ascending: false })
      .limit(limit);

    if (error) throw error;
    if (!topQueries?.length) {
      return json({ success: true, refreshed: 0, message: "No queries to prewarm" });
    }

    let refreshed = 0;
    let errors = 0;

    for (const q of topQueries) {
      try {
        const filters = q.filters as any;
        const startMs = Date.now();

        // Re-execute the cached search RPC to refresh
        const { error: rpcErr } = await sb.rpc("search_offers_cached" as any, {
          p_query: q.query_text,
          p_category: filters?.category ?? null,
          p_region_id: filters?.region_id ?? null,
          p_limit: filters?.limit ?? 24,
        });

        const latencyMs = Date.now() - startMs;

        if (rpcErr) {
          console.warn(`Prewarm failed for "${q.query_text}":`, rpcErr);
          errors++;
          continue;
        }

        // Update latency tracking (exponential moving average: 70% old + 30% new)
        const oldAvg = (q as any).avg_latency_ms;
        const newAvg = oldAvg == null
          ? latencyMs
          : Math.round(oldAvg * 0.7 + latencyMs * 0.3);
        await sb
          .from("search_queries")
          .update({
            avg_latency_ms: newAvg,
            last_executed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", q.id);

        refreshed++;
      } catch (err) {
        console.warn(`Error prewarming "${q.query_text}":`, err);
        errors++;
      }
    }

    return json({ success: true, refreshed, errors, total: topQueries.length });
  } catch (err) {
    console.error("prewarm-search-cache error:", err);
    return json({ success: false, error: String(err) }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
