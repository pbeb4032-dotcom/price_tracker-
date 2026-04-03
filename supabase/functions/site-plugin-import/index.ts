import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { requireAdminOrInternal } from "../_shared/auth.ts";
import { normalizeDomain } from "../_shared/sanity.ts";
import { getServiceKey, getSupabaseUrl } from "../_shared/keys.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Mode = "replace" | "merge";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const gate = await requireAdminOrInternal(req, corsHeaders);
  if (!gate.ok) return gate.res;

  const sb = createClient(getSupabaseUrl(), getServiceKey());

  try {
    const body = await req.json().catch(() => ({}));
    const plugin = body.plugin ?? null;
    const mode: Mode = (body.mode === "merge" ? "merge" : "replace");

    if (!plugin || typeof plugin !== "object") return json({ success: false, error: "plugin_required" }, 400);
    const domain = normalizeDomain(plugin?.source?.domain ?? plugin?.patterns?.domain ?? "");
    if (!domain) return json({ success: false, error: "domain_required" }, 400);

    const src = plugin.source ?? {};
    const sourceKind = ["retailer", "marketplace", "official"].includes(String(src.source_kind ?? "").toLowerCase())
      ? String(src.source_kind).toLowerCase()
      : "retailer";
    const sourcePayload = {
      name_ar: String(src.name_ar ?? domain),
      domain,
      source_kind: sourceKind,
      trust_weight: Math.max(0, Math.min(1, Number(src.trust_weight ?? 0.6))),
      is_active: src.is_active !== false,
      country_code: "IQ",
      base_url: (src.base_url ? String(src.base_url) : `https://${domain}`).replace(/\/$/, ""),
      logo_url: src.logo_url ? String(src.logo_url) : null,
    };

    const { data: existing } = await sb
      .from("price_sources")
      .select("id")
      .eq("domain", domain)
      .maybeSingle();

    let sourceId: string;
    if (existing?.id) {
      sourceId = existing.id;
      await sb.from("price_sources").update(sourcePayload).eq("id", sourceId);
    } else {
      const { data: inserted, error } = await sb
        .from("price_sources")
        .insert(sourcePayload)
        .select("id")
        .single();
      if (error || !inserted) return json({ success: false, error: error?.message ?? "insert_failed" }, 500);
      sourceId = inserted.id;
    }

    // Patterns
    const pat = plugin.patterns ?? {};
    await sb
      .from("domain_url_patterns")
      .upsert(
        {
          domain,
          product_regex: String(pat.product_regex ?? String.raw`\/(product|products|p|item|dp)\/`),
          category_regex: String(pat.category_regex ?? String.raw`\/(category|categories|collections|shop|store|department|c|offers)\/`),
        },
        { onConflict: "domain" },
      );

    // Replace-mode deletes
    if (mode === "replace") {
      await sb.from("source_entrypoints").delete().eq("domain", domain);
      await sb.from("source_adapters").delete().eq("source_id", sourceId);
      await sb.from("source_api_endpoints").delete().eq("domain", domain);
      await sb.from("domain_bootstrap_paths").delete().eq("source_domain", domain);
    }

    // Entrypoints
    const entrypoints = Array.isArray(plugin.entrypoints) ? plugin.entrypoints : [];
    if (entrypoints.length) {
      const rows = entrypoints
        .map((e: any) => ({
          domain,
          url: String(e.url ?? "").trim(),
          page_type: String(e.page_type ?? "category"),
          priority: Number(e.priority ?? 100),
          is_active: e.is_active !== false,
        }))
        .filter((r: any) => /^https?:\/\//i.test(r.url));
      if (rows.length) {
        await sb.from("source_entrypoints").upsert(rows, { onConflict: "domain,url" });
      }
    }

    // Adapters
    const adapters = Array.isArray(plugin.adapters) ? plugin.adapters : [];
    if (adapters.length) {
      const rows = adapters
        .map((a: any) => ({
          source_id: sourceId,
          adapter_type: String(a.adapter_type ?? "jsonld"),
          priority: Number(a.priority ?? 100),
          is_active: a.is_active !== false,
          selectors: a.selectors ?? {},
        }))
        .filter((r: any) => ["jsonld", "meta", "dom", "api"].includes(r.adapter_type));

      for (const r of rows) {
        // De-duplicate per type (keep latest payload)
        const { data: ex } = await sb
          .from("source_adapters")
          .select("id")
          .eq("source_id", sourceId)
          .eq("adapter_type", r.adapter_type)
          .maybeSingle();
        if (ex?.id) {
          await sb.from("source_adapters").update({
            selectors: r.selectors,
            priority: r.priority,
            is_active: r.is_active,
          }).eq("id", ex.id);
        } else {
          await sb.from("source_adapters").insert(r);
        }
      }
    }

    // API endpoints
    const apiEndpoints = Array.isArray(plugin.api_endpoints) ? plugin.api_endpoints : [];
    if (apiEndpoints.length) {
      const rows = apiEndpoints
        .map((e: any) => ({
          domain,
          url: String(e.url ?? "").trim(),
          endpoint_type: String(e.endpoint_type ?? "generic_json"),
          priority: Number(e.priority ?? 100),
          is_active: e.is_active !== false,
        }))
        .filter((r: any) => /^https?:\/\//i.test(r.url));
      if (rows.length) {
        await sb.from("source_api_endpoints").upsert(rows, { onConflict: "domain,url" });
      }
    }

    // Bootstrap paths
    const bootstrap = Array.isArray(plugin.bootstrap_paths) ? plugin.bootstrap_paths : [];
    if (bootstrap.length) {
      const rows = bootstrap
        .map((b: any) => ({
          source_domain: domain,
          path: String(b.path ?? "").trim(),
          page_type: String(b.page_type ?? "category"),
          priority: Number(b.priority ?? 100),
          is_active: b.is_active !== false,
        }))
        .filter((r: any) => r.path.startsWith("/"));
      if (rows.length) {
        await sb.from("domain_bootstrap_paths").upsert(rows, { onConflict: "source_domain,path" });
      }
    }

    return json({ success: true, domain, source_id: sourceId, mode });
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
