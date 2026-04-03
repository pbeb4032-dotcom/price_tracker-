import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { requireAdminOrInternal } from "../_shared/auth.ts";
import { extractProductFromHtml } from "../_shared/productExtract.ts";
import { normalizeDomain } from "../_shared/sanity.ts";
import { getServiceKey, getSupabaseUrl } from "../_shared/keys.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FETCH_TIMEOUT_MS = 15_000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const gate = await requireAdminOrInternal(req, corsHeaders);
  if (!gate.ok) return gate.res;

  const sb = createClient(getSupabaseUrl(), getServiceKey());

  try {
    const body = await req.json().catch(() => ({}));
    const url = String(body.url ?? "").trim();
    if (!/^https?:\/\//i.test(url)) return json({ success: false, error: "url_required" }, 400);

    const domain = normalizeDomain(body.domain ?? new URL(url).hostname);

    const { data: source } = await sb
      .from("price_sources")
      .select("id, domain")
      .eq("domain", domain)
      .maybeSingle();
    if (!source) return json({ success: false, error: "domain_not_found" }, 404);

    const { data: adapters } = await sb
      .from("source_adapters")
      .select("adapter_type, selectors, priority")
      .eq("source_id", source.id)
      .eq("is_active", true)
      .order("priority", { ascending: true });

    const html = await fetchHtml(url);
    if (!html) return json({ success: false, error: "fetch_failed" }, 502);

    const extracted = extractProductFromHtml(html, url, adapters as any);
    if (!extracted) return json({ success: true, domain, extracted: null });

    return json({ success: true, domain, extracted });
  } catch (err) {
    return json({ success: false, error: String(err) }, 500);
  }
});

async function fetchHtml(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "PriceTrackerIraq/1.0",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ar,en;q=0.9",
        "Accept-Encoding": "identity",
      },
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("html")) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
