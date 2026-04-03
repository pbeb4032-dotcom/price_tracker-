import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { requireAdminOrInternal } from "../_shared/auth.ts";
import { normalizeDomain } from "../_shared/sanity.ts";
import { getServiceKey, getSupabaseUrl } from "../_shared/keys.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const gate = await requireAdminOrInternal(req, corsHeaders);
  if (!gate.ok) return gate.res;

  const sb = createClient(getSupabaseUrl(), getServiceKey());

  try {
    const body = await req.json().catch(() => ({}));
    const domain = normalizeDomain(body.domain ?? "");
    if (!domain) return json({ success: false, error: "domain_required" }, 400);

    const { data: source } = await sb
      .from("price_sources")
      .select("id, domain, name_ar, source_kind, trust_weight, is_active, base_url, logo_url")
      .eq("domain", domain)
      .maybeSingle();
    if (!source) return json({ success: false, error: "domain_not_found" }, 404);

    const { data: patterns } = await sb
      .from("domain_url_patterns")
      .select("domain, product_regex, category_regex")
      .eq("domain", domain)
      .maybeSingle();

    const { data: entrypoints } = await sb
      .from("source_entrypoints")
      .select("url, page_type, priority, is_active")
      .eq("domain", domain)
      .order("priority", { ascending: true });

    const { data: adapters } = await sb
      .from("source_adapters")
      .select("adapter_type, selectors, priority, is_active")
      .eq("source_id", source.id)
      .order("priority", { ascending: true });

    const { data: apiEndpoints } = await sb
      .from("source_api_endpoints")
      .select("url, endpoint_type, priority, is_active")
      .eq("domain", domain)
      .order("priority", { ascending: true });

    const { data: bootstrap } = await sb
      .from("domain_bootstrap_paths")
      .select("path, page_type, priority, is_active")
      .eq("source_domain", domain)
      .order("priority", { ascending: true });

    const plugin = {
      version: "1.0",
      exported_at: new Date().toISOString(),
      source,
      patterns: patterns ?? {
        domain,
        product_regex: String.raw`\/(product|products|p|item|dp)\/`,
        category_regex: String.raw`\/(category|categories|collections|shop|store|department|c|offers)\/`,
      },
      entrypoints: entrypoints ?? [],
      adapters: adapters ?? [],
      api_endpoints: apiEndpoints ?? [],
      bootstrap_paths: bootstrap ?? [],
    };

    return json({ success: true, plugin });
  } catch (err) {
    return json({ success: false, error: String(err) }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
