/**
 * discover-product-apis (P4.1)
 * Free, deterministic discovery of e-commerce APIs (Shopify/Woo) and optional ingestion.
 * - Detects endpoints
 * - Stores them in source_api_endpoints
 * - Optionally ingests a few pages immediately
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { requireAdminOrInternal } from "../_shared/auth.ts";
import { isSaneIqdPrice, normalizeToIqd, validateImageUrl } from "../_shared/sanity.ts";
import { getServiceKey, getSupabaseUrl } from "../_shared/keys.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DEFAULT_FALLBACK_FX = 1470;
const FETCH_TIMEOUT_MS = 15_000;

type EndpointType = "shopify_products_json" | "woocommerce_store_api" | "generic_json";

interface ExtractedApiProduct {
  name: string;
  nameEn: string | null;
  description: string | null;
  price: number;
  currency: string;
  image: string | null;
  sourceUrl: string;
  inStock: boolean;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const gate = await requireAdminOrInternal(req, corsHeaders);
  if (!gate.ok) return gate.res;

  const sb = createClient(getSupabaseUrl(), getServiceKey());

  try {
    const body = await req.json().catch(() => ({}));
    const targetDomain: string | undefined = body.domain;
    const ingestNow: boolean = body.ingest_now !== false; // default true
    const maxPages: number = Math.max(1, Math.min(10, Number(body.max_pages ?? 3)));

    // Get active sources
    const { data: sources } = await sb
      .from("price_sources")
      .select("id, domain")
      .eq("is_active", true);
    const domains = (sources ?? []).map((s: any) => s.domain);
    const runDomains = targetDomain ? domains.filter((d) => d === targetDomain) : domains;

    // Baghdad region
    const { data: region } = await sb
      .from("regions")
      .select("id")
      .eq("name_ar", "بغداد")
      .single();
    if (!region) return json({ success: false, error: "No Baghdad region found" }, 500);

    // FX rate
    const { data: fxRow } = await sb
      .from("exchange_rates")
      .select("mid_iqd_per_usd")
      .eq("source_type", "market")
      .eq("is_active", true)
      .order("rate_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    const fxRate = (fxRow as any)?.mid_iqd_per_usd ?? DEFAULT_FALLBACK_FX;

    const results: Record<string, any> = {};
    let totalDiscovered = 0;
    let totalInserted = 0;

    for (const domain of runDomains) {
      const source = (sources ?? []).find((s: any) => s.domain === domain);
      if (!source) continue;
      results[domain] = { endpoints: [], discovered: 0, inserted: 0, errors: [] };

      const detected = await detectEndpoints(domain);
      if (!detected.length) {
        results[domain].errors.push("no_endpoints_detected");
        continue;
      }

      // Save endpoints
      for (const ep of detected) {
        results[domain].endpoints.push(ep);
        await sb.from("source_api_endpoints").upsert(
          {
            domain,
            url: ep.url,
            endpoint_type: ep.endpoint_type,
            priority: ep.priority ?? 100,
            is_active: true,
          },
          { onConflict: "domain,url" },
        );
      }

      if (!ingestNow) continue;

      // Ingest a few pages
      for (const ep of detected) {
        try {
          const { discovered, inserted } = await ingestEndpoint(sb, {
            domain,
            sourceId: source.id,
            regionId: region.id,
            fxRate,
            endpoint: ep,
            maxPages,
          });
          results[domain].discovered += discovered;
          results[domain].inserted += inserted;
          totalDiscovered += discovered;
          totalInserted += inserted;
        } catch (err) {
          results[domain].errors.push(`${ep.url}: ${String(err).slice(0, 160)}`);
        }
      }
    }

    return json({ success: true, totalDiscovered, totalInserted, results });
  } catch (err) {
    return json({ success: false, error: String(err) }, 500);
  }
});

async function detectEndpoints(domain: string): Promise<Array<{ url: string; endpoint_type: EndpointType; priority: number }>> {
  const out: Array<{ url: string; endpoint_type: EndpointType; priority: number }> = [];

  // Shopify
  const shopifyCandidates = [
    `https://${domain}/products.json?limit=1&page=1`,
    `https://${domain}/collections/all/products.json?limit=1&page=1`,
  ];
  for (const url of shopifyCandidates) {
    const j = await fetchJson(url);
    if (j && typeof j === "object" && Array.isArray((j as any).products)) {
      out.push({
        url: url.replace("limit=1", "limit=250"),
        endpoint_type: "shopify_products_json",
        priority: 10,
      });
      break;
    }
  }

  // WooCommerce Store API
  const wooCandidates = [
    `https://${domain}/wp-json/wc/store/v1/products?per_page=1&page=1`,
    `https://${domain}/wp-json/wc/store/v1/products?per_page=1`,
  ];
  for (const url of wooCandidates) {
    const j = await fetchJson(url);
    if (Array.isArray(j) && j.length && (j[0] as any)?.name && ((j[0] as any)?.prices || (j[0] as any)?.price)) {
      out.push({
        url: url.includes("per_page=") ? url.replace("per_page=1", "per_page=100") : `${url}&per_page=100`,
        endpoint_type: "woocommerce_store_api",
        priority: 20,
      });
      break;
    }
  }

  return out;
}

async function ingestEndpoint(
  sb: any,
  args: {
    domain: string;
    sourceId: string;
    regionId: string;
    fxRate: number;
    endpoint: { url: string; endpoint_type: EndpointType };
    maxPages: number;
  },
): Promise<{ discovered: number; inserted: number }> {
  const { endpoint, maxPages } = args;
  let discovered = 0;
  let inserted = 0;

  for (let page = 1; page <= maxPages; page++) {
    const url = setQueryParam(endpoint.url, "page", String(page));
    const raw = await fetchText(url);
    if (!raw) break;
    let products: ExtractedApiProduct[] = [];
    if (endpoint.endpoint_type === "shopify_products_json") {
      products = parseShopify(raw, url);
    } else if (endpoint.endpoint_type === "woocommerce_store_api") {
      products = parseWoo(raw, url);
    } else {
      products = [];
    }
    if (!products.length) break;
    discovered += products.length;
    const ins = await upsertProducts(sb, products, args.sourceId, args.regionId, args.fxRate);
    inserted += ins;
  }

  return { discovered, inserted };
}

async function upsertProducts(
  sb: any,
  products: ExtractedApiProduct[],
  sourceId: string,
  regionId: string,
  fxRate: number,
): Promise<number> {
  let inserted = 0;

  for (const p of products) {
    // Find or create product
    const { data: existing } = await sb
      .from("products")
      .select("id,image_url,description_ar")
      .eq("name_ar", p.name)
      .limit(1);

    let productId: string;
    const safeImage = validateImageUrl(p.image);

    if (existing?.length) {
      productId = existing[0].id;
      if (safeImage && !existing[0].image_url) {
        await sb.from("products").update({ image_url: safeImage }).eq("id", productId);
      }

      const hasDbDesc = typeof (existing[0] as any).description_ar === "string" && (existing[0] as any).description_ar.trim().length >= 20;
      const desc = typeof p.description === "string" ? p.description.trim() : "";
      if (desc && desc.length >= 20 && !hasDbDesc) {
        await sb.from("products").update({ description_ar: desc.slice(0, 2000) }).eq("id", productId);
      }
    } else {
      const { data: newProd } = await sb
        .from("products")
        .insert({
          name_ar: p.name,
          name_en: p.nameEn,
          category: "general",
          unit: "pcs",
          description_ar: typeof p.description === "string" ? p.description.trim().slice(0, 2000) : null,
          image_url: safeImage,
          is_active: true,
          condition: "new",
        })
        .select("id")
        .single();
      if (!newProd) continue;
      productId = newProd.id;
    }

    const { priceIqd, normalizationFactor, parsedCurrency } = normalizeToIqd(p.price, p.currency, fxRate);
    const sanity = isSaneIqdPrice(priceIqd);
    if (!sanity.ok) continue;

    // Duplicate check: same product+source+url today
    const today = new Date().toISOString().split("T")[0];
    const { data: dup } = await sb
      .from("source_price_observations")
      .select("id")
      .eq("product_id", productId)
      .eq("source_id", sourceId)
      .eq("source_url", p.sourceUrl)
      .gte("observed_at", `${today}T00:00:00Z`)
      .limit(1);
    if (dup?.length) continue;

    const { error } = await sb.from("source_price_observations").insert({
      product_id: productId,
      source_id: sourceId,
      source_url: p.sourceUrl,
      price: priceIqd,
      normalized_price_iqd: priceIqd,
      currency: "IQD",
      parsed_currency: parsedCurrency,
      raw_price_text: `${p.price} ${parsedCurrency}`,
      normalization_factor: normalizationFactor,
      unit: "pcs",
      region_id: regionId,
      evidence_type: "api",
      evidence_ref: "auto_discovered_api",
      price_confidence: 0.9,
      in_stock: p.inStock,
      is_synthetic: false,
      is_verified: true,
      observed_at: new Date().toISOString(),
    });
    if (!error) inserted++;
  }

  return inserted;
}

function parseShopify(raw: string, sourceUrl: string): ExtractedApiProduct[] {
  try {
    const data = JSON.parse(raw);
    const products = data.products ?? [];
    return products
      .map((p: any) => {
        const variant = p.variants?.[0];
        const price = Number(variant?.price ?? p.price ?? 0);
        const image = p.images?.[0]?.src || p.image?.src || null;
        const desc = typeof p.body_html === "string" ? stripHtml(p.body_html) : (typeof p.body === "string" ? stripHtml(p.body) : null);
        return {
          name: String(p.title ?? p.name ?? "").trim(),
          nameEn: null,
          description: desc,
          price,
          currency: price > 500 ? "IQD" : "USD",
          image: image ? String(image) : null,
          sourceUrl,
          inStock: variant?.available ?? true,
        };
      })
      .filter((p: any) => p.name && p.price > 0);
  } catch {
    return [];
  }
}

function parseWoo(raw: string, sourceUrl: string): ExtractedApiProduct[] {
  try {
    const products = JSON.parse(raw);
    if (!Array.isArray(products)) return [];
    return products
      .map((p: any) => {
        const priceStr = p.prices?.price ?? p.prices?.regular_price ?? "0";
        const rawPrice = parseInt(String(priceStr), 10);
        const price = p.prices?.currency_minor_unit != null
          ? rawPrice / Math.pow(10, p.prices.currency_minor_unit)
          : rawPrice;
        const currency = String(p.prices?.currency_code ?? "IQD").toUpperCase();
        const image = p.images?.[0]?.src ?? p.images?.[0]?.thumbnail ?? null;
        const inStock = p.is_purchasable !== false && (p.is_in_stock ?? true);
        const desc = typeof p.short_description === "string"
          ? stripHtml(p.short_description)
          : (typeof p.description === "string" ? stripHtml(p.description) : null);
        return {
          name: String(p.name ?? "").trim(),
          nameEn: null,
          description: desc,
          price: Number(price),
          currency,
          image: image ? String(image) : null,
          sourceUrl,
          inStock: Boolean(inStock),
        };
      })
      .filter((p: any) => p.name && p.price > 0);
  } catch {
    return [];
  }
}

function stripHtml(v: string): string | null {
  const s = String(v)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return null;
  return s.length > 2000 ? s.slice(0, 2000).trim() : s;
}

function setQueryParam(url: string, key: string, value: string): string {
  try {
    const u = new URL(url);
    u.searchParams.set(key, value);
    return u.toString();
  } catch {
    return url;
  }
}

async function fetchJson(url: string): Promise<any | null> {
  const raw = await fetchText(url);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function fetchText(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "PriceTrackerIraq/1.0",
        Accept: "application/json,text/html,*/*;q=0.8",
        "Accept-Language": "ar,en;q=0.9",
        "Accept-Encoding": "identity",
      },
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
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
