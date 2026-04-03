/**
 * direct-scraper (P4.0 — Firecrawl-free)
 * Multi-adapter scraper: Shopify JSON, WooCommerce REST API, JSON-LD+OG, AI fallback.
 * Image waterfall: JSON-LD → OG:image → DOM product images.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { requireAdminOrInternal } from "../_shared/auth.ts";
import { isSaneIqdPrice, normalizeToIqd } from "../_shared/sanity.ts";
import { getServiceKey, getSupabaseUrl } from "../_shared/keys.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ExtractedProduct {
  name_ar: string;
  name_en: string | null;
  price: number;
  currency: string;
  image_url: string | null;
  source_url: string;
  in_stock: boolean;
  category: string;
  brand: string | null;
}

// ─── Domain configuration with engine type ──────────

type EngineType = "shopify_json" | "woo_api" | "html_jsonld";

// DB constraint: source_price_observations.evidence_type must be one of:
//   url | screenshot | api | ai_scrape
type EvidenceType = "url" | "screenshot" | "api" | "ai_scrape";

interface ScrapeTarget {
  domain: string;
  engine: EngineType;
  urls: string[];
}

// Targets are built dynamically from DB table source_api_endpoints.

const VALID_CATEGORIES = [
  "electronics", "groceries", "beauty", "home", "clothing", "general",
  "beverages", "dairy", "meat", "grains", "vegetables", "essentials",
  "automotive", "sports", "toys",
];

const DEFAULT_FALLBACK_FX = 1470;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // 🔒 Admin-only (or internal secret for cron)
  const gate = await requireAdminOrInternal(req, corsHeaders);
  if (!gate.ok) return gate.res;

  const sb = createClient(getSupabaseUrl(), getServiceKey());

  const runId = crypto.randomUUID();
  const startedAt = new Date().toISOString();

  await sb.from("ingestion_runs").insert({
    run_id: runId,
    function_name: "direct-scraper",
    started_at: startedAt,
    status: "running",
  });

  try {
    const body = await req.json().catch(() => ({}));
    const targetDomain: string | undefined = body.domain;
    const maxPerDomain: number = body.max_per_domain ?? 100;
    const batchIndex: number = body.batch_index ?? 0;
    const batchSize: number = body.batch_size ?? 3;
    const urlOffset: number = body.url_offset ?? 0;
    const maxUrls: number = body.max_urls ?? 2;
    const maxPages: number = body.max_pages ?? 5;

    // Get sources
    const { data: sources } = await sb
      .from("price_sources")
      .select("id, domain, name_ar")
      .eq("is_active", true);
    const sourceMap = new Map((sources ?? []).map((s: any) => [s.domain, s]));

    // Get Baghdad region
    const { data: region } = await sb
      .from("regions")
      .select("id")
      .eq("name_ar", "بغداد")
      .single();
    if (!region) {
      await finalizeRun(sb, runId, "failed", 0, 0, 0, "No Baghdad region");
      return json({ success: false, error: "No Baghdad region" });
    }

    // Get latest FX rate
    const { data: fxRow } = await sb
      .from("exchange_rates")
      .select("mid_iqd_per_usd")
      .eq("source_type", "market")
      .eq("is_active", true)
      .order("rate_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    const fxRate = fxRow?.mid_iqd_per_usd ?? DEFAULT_FALLBACK_FX;

    // Build targets from DB endpoints
    const { data: endpoints } = await sb
      .from("source_api_endpoints")
      .select("domain,url,endpoint_type,priority")
      .eq("is_active", true)
      .order("priority", { ascending: true });

    const byKey = new Map<string, ScrapeTarget>();
    for (const ep of (endpoints ?? []) as any[]) {
      const domain = String(ep.domain ?? "");
      const endpointType = String(ep.endpoint_type ?? "");
      const url = String(ep.url ?? "");
      const engine: EngineType | null = endpointType === "shopify_products_json"
        ? "shopify_json"
        : endpointType === "woocommerce_store_api"
        ? "woo_api"
        : null;
      if (!domain || !engine || !url) continue;
      const key = `${domain}::${engine}`;
      const t = byKey.get(key) ?? { domain, engine, urls: [] };
      t.urls.push(url);
      byKey.set(key, t);
    }

    const targetsAll = Array.from(byKey.values());
    if (!targetsAll.length) {
      await finalizeRun(sb, runId, "success", 0, 0, 0, "No API endpoints configured");
      return json({ success: true, run_id: runId, totalInserted: 0, results: {}, message: "No API endpoints configured" });
    }

    // Select targets
    let targets = targetsAll;
    if (targetDomain) {
      targets = targets.filter(t => t.domain === targetDomain || t.domain.includes(targetDomain));
    } else {
      targets = targets.slice(batchIndex * batchSize, (batchIndex + 1) * batchSize);
    }

    const results: Record<string, { fetched: number; extracted: number; inserted: number; engine: string; errors: string[] }> = {};
    let totalInserted = 0;
    let totalProcessed = 0;
    let totalFailed = 0;

    for (const target of targets) {
      let source = sourceMap.get(target.domain);
      if (!source) {
        for (const [d, s] of sourceMap) {
          if (d.includes(target.domain) || target.domain.includes(d)) {
            source = s;
            break;
          }
        }
      }
      if (!source) {
        results[target.domain] = { fetched: 0, extracted: 0, inserted: 0, engine: target.engine, errors: [`No source entry for ${target.domain}`] };
        totalFailed++;
        continue;
      }

      results[target.domain] = { fetched: 0, extracted: 0, inserted: 0, engine: target.engine, errors: [] };
      const urlsToProcess = target.urls.slice(urlOffset, urlOffset + maxUrls);

      for (const url of urlsToProcess) {
        totalProcessed++;
        try {
          const pageLoop = (target.engine === "shopify_json" || target.engine === "woo_api")
            ? Math.max(1, Math.min(20, Number(maxPages)))
            : 1;

          for (let page = 1; page <= pageLoop; page++) {
            const pageUrl = pageLoop === 1 ? url : setQueryParam(url, "page", String(page));
            console.log(`[${target.engine.toUpperCase()}] ${pageUrl}`);
            const content = await fetchPage(pageUrl);
            if (!content || content.length < 20) {
              if (page === 1) {
                results[target.domain].errors.push(`${pageUrl}: empty response`);
                totalFailed++;
              }
              break;
            }
            results[target.domain].fetched++;

            let products: ExtractedProduct[];
            switch (target.engine) {
              case "shopify_json":
                products = parseShopifyJson(content, pageUrl);
                break;
              case "woo_api":
                products = parseWooCommerceJson(content, pageUrl);
                break;
              case "html_jsonld":
                products = extractJsonLdProducts(content, pageUrl, target.domain);
                if (!products.length) {
                  products = extractFromEmbeddedJson(content, pageUrl, target.domain);
                }
                break;
              default:
                products = [];
            }

            if (!products.length) {
              if (page === 1) results[target.domain].errors.push(`${pageUrl}: no products found`);
              break;
            }

            results[target.domain].extracted += products.length;
            const inserted = await upsertProducts(sb, products.slice(0, maxPerDomain), source.id, region.id, fxRate, target.engine);
            results[target.domain].inserted += inserted;
            totalInserted += inserted;

            if (pageLoop > 1 && products.length < 5) break;
          }
        } catch (err) {
          results[target.domain].errors.push(`${url}: ${String(err).slice(0, 200)}`);
          totalFailed++;
        }
      }
    }

    const status = totalFailed === 0 ? "success" : totalInserted > 0 ? "partial" : "failed";
    await finalizeRun(sb, runId, status, totalProcessed, totalInserted, totalFailed, JSON.stringify(results).slice(0, 1000));

    return json({
      success: true,
      run_id: runId,
      totalInserted,
      results,
      pagination: { batchIndex, batchSize, totalDomains: targetsAll.length, urlOffset, maxUrls, nextUrlOffset: urlOffset + maxUrls },
    });
  } catch (err) {
    console.error("direct-scraper error:", err);
    await finalizeRun(sb, runId, "failed", 0, 0, 0, String(err));
    return json({ success: false, error: String(err) }, 500);
  }
});

// ─── Run tracking ───

async function finalizeRun(
  sb: any, runId: string, status: string,
  processed: number, succeeded: number, failed: number, notes?: string
) {
  await sb.from("ingestion_runs").update({
    status, processed, succeeded, failed,
    ended_at: new Date().toISOString(),
    notes: notes?.slice(0, 1000) ?? null,
  }).eq("run_id", runId);
}

// ─── Direct HTTP fetch ───

async function fetchPage(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7",
        "Accept-Language": "ar,en;q=0.9",
        "Accept-Encoding": "identity",
      },
    });
    clearTimeout(timeout);
    if (!res.ok) {
      console.error(`[FETCH] ${url} → ${res.status}`);
      return null;
    }
    return await res.text();
  } catch (e) {
    console.error(`[FETCH] ${url} failed:`, e);
    return null;
  }
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

// ─── Parse Shopify products.json ───

function parseShopifyJson(raw: string, sourceUrl: string): ExtractedProduct[] {
  try {
    const data = JSON.parse(raw);
    const products = data.products ?? [];
    return products.map((p: any) => {
      const variant = p.variants?.[0];
      const price = parseFloat(variant?.price || p.price || "0");
      const imageUrl = p.images?.[0]?.src || p.image?.src || null;
      return {
        name_ar: p.title || p.name || "",
        name_en: p.title || null,
        price: price > 0 ? price : 0,
        currency: price > 500 ? "IQD" : "USD",
        image_url: imageUrl,
        source_url: sourceUrl,
        in_stock: variant?.available ?? true,
        category: mapCategory(p.product_type || p.tags?.join(" ") || "general"),
        brand: p.vendor || null,
      };
    }).filter((p: ExtractedProduct) => p.name_ar && p.price > 0);
  } catch {
    return [];
  }
}

// ─── Parse WooCommerce Store API ───

function parseWooCommerceJson(raw: string, sourceUrl: string): ExtractedProduct[] {
  try {
    const products = JSON.parse(raw);
    if (!Array.isArray(products)) return [];
    return products.map((p: any) => {
      const priceStr = p.prices?.price ?? p.prices?.regular_price ?? "0";
      // WC Store API returns prices in minor units (cents), divide by 100
      const rawPrice = parseInt(priceStr, 10);
      const price = p.prices?.currency_minor_unit != null
        ? rawPrice / Math.pow(10, p.prices.currency_minor_unit)
        : rawPrice;
      const currency = (p.prices?.currency_code ?? "IQD").toUpperCase();
      const rawImg = p.images?.[0]?.src ?? p.images?.[0]?.thumbnail ?? null;
      const imageUrl = extractPlainUrl(rawImg);
      const inStock = p.is_purchasable !== false && (p.is_in_stock ?? true);
      return {
        name_ar: p.name ?? "",
        name_en: p.name ?? null,
        price: price > 0 ? price : 0,
        currency,
        image_url: imageUrl,
        source_url: sourceUrl,
        in_stock: inStock,
        category: mapCategory(p.categories?.[0]?.name ?? "general"),
        brand: null,
      };
    }).filter((p: ExtractedProduct) => p.name_ar && p.price > 0);
  } catch {
    return [];
  }
}

// ─── Deterministic JSON-LD + OG extraction from HTML ───

function extractJsonLdProducts(html: string, pageUrl: string, domain: string): ExtractedProduct[] {
  const products: ExtractedProduct[] = [];

  // 1. Extract JSON-LD products
  const scriptRegex = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = scriptRegex.exec(html)) !== null) {
    try {
      const data = JSON.parse(match[1]);
      const found = findAllJsonLdProducts(data);
      for (const p of found) {
        if (p.name && p.price && p.price > 0) {
          // Unified image waterfall: JSON-LD → og:image → DOM image
          let imageUrl = resolveUrl(p.image, domain);
          if (!imageUrl) imageUrl = resolveUrl(extractMeta(html, "og:image"), domain);
          if (!imageUrl) imageUrl = extractFirstProductImage(html, pageUrl);

          products.push({
            name_ar: p.name,
            name_en: p.name,
            price: p.price,
            currency: p.currency ?? "IQD",
            image_url: imageUrl,
            source_url: pageUrl,
            in_stock: p.inStock,
            category: mapCategory(p.category ?? "general"),
            brand: p.brand ?? null,
          });
        }
      }
    } catch { /* skip invalid JSON-LD */ }
  }

  // 2. If no JSON-LD products, try OG meta for single product page
  if (products.length === 0) {
    const ogTitle = extractMeta(html, "og:title");
    const ogPrice = extractMeta(html, "product:price:amount");
    const ogCurrency = extractMeta(html, "product:price:currency");
    // Unified image waterfall: og:image → DOM image
    let ogImage = resolveUrl(extractMeta(html, "og:image"), domain);
    if (!ogImage) ogImage = extractFirstProductImage(html, pageUrl);

    if (ogTitle && ogPrice) {
      const price = parseFloat(ogPrice.replace(/[^\d.]/g, ""));
      if (price > 0) {
        products.push({
          name_ar: ogTitle,
          name_en: ogTitle,
          price,
          currency: (ogCurrency ?? "IQD").toUpperCase(),
          image_url: ogImage,
          source_url: pageUrl,
          in_stock: true,
          category: "general",
          brand: null,
        });
      }
    }
  }

  return products;
}

// ─── Deterministic Next.js / Nuxt.js / embedded JSON extraction ───

function extractFromEmbeddedJson(html: string, pageUrl: string, domain: string): ExtractedProduct[] {
  const products: ExtractedProduct[] = [];

  // 1. __NEXT_DATA__
  const nextMatch = html.match(/<script[^>]*id\s*=\s*["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (nextMatch?.[1]) {
    try {
      const nextData = JSON.parse(nextMatch[1]);
      const nextProducts = extractProductsFromDeepJson(nextData, pageUrl, domain);
      products.push(...nextProducts);
      if (nextProducts.length) console.log(`[NEXT_DATA] ${pageUrl}: ${nextProducts.length} products`);
    } catch { /* invalid JSON */ }
  }

  // 2. window.__NUXT__
  const nuxtMatch = html.match(/window\.__NUXT__\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/i);
  if (nuxtMatch?.[1] && !products.length) {
    try {
      const nuxtData = JSON.parse(nuxtMatch[1]);
      const nuxtProducts = extractProductsFromDeepJson(nuxtData, pageUrl, domain);
      products.push(...nuxtProducts);
      if (nuxtProducts.length) console.log(`[NUXT] ${pageUrl}: ${nuxtProducts.length} products`);
    } catch { /* invalid JSON */ }
  }

  // 3. Generic embedded JSON blobs
  if (!products.length) {
    const jsonBlobRegex = /<script[^>]*type\s*=\s*["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let match;
    while ((match = jsonBlobRegex.exec(html)) !== null && products.length === 0) {
      try {
        const blob = JSON.parse(match[1]);
        const found = extractProductsFromDeepJson(blob, pageUrl, domain);
        products.push(...found);
      } catch { /* skip */ }
    }
  }

  return products;
}

/**
 * Recursively walk a JSON tree to find product-like objects.
 */
function extractProductsFromDeepJson(data: unknown, pageUrl: string, domain: string, depth = 0): ExtractedProduct[] {
  if (depth > 12 || !data) return [];
  const results: ExtractedProduct[] = [];

  if (Array.isArray(data)) {
    for (const item of data) {
      results.push(...extractProductsFromDeepJson(item, pageUrl, domain, depth + 1));
      if (results.length >= 200) break;
    }
    return results;
  }

  if (typeof data !== "object" || data === null) return results;
  const obj = data as Record<string, unknown>;

  const name = obj.name ?? obj.title ?? obj.product_name ?? obj.name_ar;
  const priceRaw = obj.price ?? obj.regular_price ?? obj.sale_price ?? obj.current_price;

  if (typeof name === "string" && name.length > 1 && priceRaw != null) {
    const price = typeof priceRaw === "number" ? priceRaw : parseFloat(String(priceRaw).replace(/[^\d.]/g, ""));
    if (price > 0) {
      const rawImg = obj.image ?? obj.image_url ?? obj.thumbnail ?? obj.featured_image ?? obj.photo;
      let imageUrl: string | null = null;
      if (typeof rawImg === "string") imageUrl = resolveUrl(rawImg, `https://${domain}`);
      else if (Array.isArray(rawImg) && typeof rawImg[0] === "string") imageUrl = resolveUrl(rawImg[0], `https://${domain}`);
      else if (rawImg && typeof rawImg === "object") {
        const imgObj = rawImg as Record<string, unknown>;
        imageUrl = resolveUrl((imgObj.src ?? imgObj.url ?? imgObj.original) as string, `https://${domain}`);
      }

      const currency = typeof obj.currency === "string" ? obj.currency.toUpperCase()
        : typeof obj.currency_code === "string" ? obj.currency_code.toUpperCase()
        : (price > 500 ? "IQD" : "USD");

      const inStock = obj.in_stock !== false && obj.is_in_stock !== false
        && obj.availability !== "OutOfStock" && obj.stock_status !== "outofstock";

      const cat = typeof obj.category === "string" ? obj.category
        : typeof obj.product_type === "string" ? obj.product_type : "general";

      const brand = typeof obj.brand === "string" ? obj.brand
        : (obj.brand && typeof obj.brand === "object" && (obj.brand as any).name) ? (obj.brand as any).name
        : null;

      results.push({
        name_ar: String(name),
        name_en: typeof obj.name_en === "string" ? obj.name_en : (typeof name === "string" ? name : null),
        price,
        currency,
        image_url: validateImageUrl(imageUrl),
        source_url: pageUrl,
        in_stock: inStock as boolean,
        category: mapCategory(cat),
        brand,
      });
      return results;
    }
  }

  const priorityKeys = ["products", "items", "data", "results", "nodes", "edges", "props", "pageProps", "state", "payload", "catalog", "listing"];
  const visited = new Set<string>();
  for (const key of priorityKeys) {
    if (key in obj) {
      visited.add(key);
      results.push(...extractProductsFromDeepJson(obj[key], pageUrl, domain, depth + 1));
      if (results.length >= 200) return results;
    }
  }
  for (const [key, val] of Object.entries(obj)) {
    if (visited.has(key)) continue;
    if (typeof val === "object" && val !== null) {
      results.push(...extractProductsFromDeepJson(val, pageUrl, domain, depth + 1));
      if (results.length >= 200) return results;
    }
  }

  return results;
}

interface JsonLdProduct {
  name: string;
  price: number;
  currency: string | null;
  image: string | null;
  inStock: boolean;
  category: string | null;
  brand: string | null;
}

function findAllJsonLdProducts(data: any): JsonLdProduct[] {
  const results: JsonLdProduct[] = [];
  if (!data) return results;
  if (Array.isArray(data)) {
    for (const item of data) results.push(...findAllJsonLdProducts(item));
    return results;
  }
  if (data["@graph"]) return findAllJsonLdProducts(data["@graph"]);

  const type = data["@type"];
  if (type === "Product" || type === "IndividualProduct" || type === "ProductModel") {
    const name = data.name;
    if (!name) return results;

    const offers = data.offers;
    let price = 0;
    let currency: string | null = null;
    let inStock = true;
    if (offers) {
      const offer = Array.isArray(offers) ? offers[0] : offers;
      price = parseFloat(offer?.price ?? offer?.lowPrice ?? "0") || 0;
      currency = offer?.priceCurrency ?? null;
      if (offer?.availability) inStock = !String(offer.availability).includes("OutOfStock");
    }

    let image: string | null = null;
    if (data.image) {
      if (typeof data.image === "string") image = data.image;
      else if (Array.isArray(data.image)) image = data.image[0];
      else if (data.image?.url) image = data.image.url;
    }

    const brand = data.brand?.name ?? (typeof data.brand === "string" ? data.brand : null);
    const category = data.category ?? null;

    results.push({ name, price, currency, image, inStock, category, brand });
  }

  // Recurse into ItemList etc
  if (data.itemListElement && Array.isArray(data.itemListElement)) {
    for (const item of data.itemListElement) {
      if (item.item) results.push(...findAllJsonLdProducts(item.item));
      else results.push(...findAllJsonLdProducts(item));
    }
  }

  return results;
}

function extractMeta(html: string, property: string): string | null {
  const regex = new RegExp(
    `<meta[^>]*(?:property|name)\\s*=\\s*["']${property}["'][^>]*content\\s*=\\s*["']([^"']*)["']`, "i"
  );
  const match = html.match(regex);
  if (match) return match[1].trim();
  const regex2 = new RegExp(
    `<meta[^>]*content\\s*=\\s*["']([^"']*)["'][^>]*(?:property|name)\\s*=\\s*["']${property}["']`, "i"
  );
  const match2 = html.match(regex2);
  return match2 ? match2[1].trim() : null;
}

// ─── Category mapping ───

function mapCategory(raw: string): string {
  const lower = raw.toLowerCase();
  const mapping: Record<string, string> = {
    phone: "electronics", laptop: "electronics", computer: "electronics", tablet: "electronics",
    tv: "electronics", camera: "electronics", headphone: "electronics", speaker: "electronics",
    food: "groceries", snack: "groceries", rice: "grains", flour: "grains",
    coffee: "beverages", tea: "beverages", juice: "beverages", water: "beverages",
    milk: "dairy", cheese: "dairy", yogurt: "dairy",
    chicken: "meat", beef: "meat", fish: "meat",
    tomato: "vegetables", potato: "vegetables", onion: "vegetables",
    shampoo: "beauty", perfume: "beauty", skincare: "beauty", makeup: "beauty", cosmetic: "beauty",
    furniture: "home", kitchen: "home", cleaning: "essentials", detergent: "essentials",
    shirt: "clothing", dress: "clothing", shoes: "clothing", fashion: "clothing",
    car: "automotive", tire: "automotive",
    sport: "sports", fitness: "sports", gym: "sports",
    toy: "toys", game: "toys", baby: "toys",
  };
  for (const [key, cat] of Object.entries(mapping)) {
    if (lower.includes(key)) return cat;
  }
  return "general";
}

// ─── AI Extraction from HTML (fallback only) ───

async function aiExtractFromHtml(
  apiKey: string, html: string, domain: string, pageUrl: string,
): Promise<ExtractedProduct[]> {
  const cleaned = stripHtml(html);
  const content = cleaned.slice(0, 25000);
  if (content.length < 50) return [];

  const systemPrompt = `You are an expert product data extractor for Iraqi e-commerce sites.
Extract EVERY product from the page content. Be thorough and extract ALL visible products.
For each product extract: name (Arabic preferred), English name, price (number only), currency (IQD/USD), image URL, stock status, category, and brand.

Rules:
- Convert prices: 125,000 → 125000. Remove currency symbols.
- Default currency: IQD for Iraqi sites unless clearly USD
- Category MUST be one of: ${VALID_CATEGORIES.join(", ")}
- Map: coffee/tea→beverages, snacks→groceries, phones/laptops→electronics, perfume→beauty, clothes→clothing, cleaning→essentials
- Extract from product grids, lists, JSON-LD, __NEXT_DATA__, __NUXT__ embedded data
- Look for <script type="application/ld+json"> for structured data
- Image URLs should be absolute (add domain if relative)
Return products using the extract_products tool.`;

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Extract ALL products from this ${domain} page (${pageUrl}):\n\n${content}` },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "extract_products",
            description: "Extract structured product data",
            parameters: {
              type: "object",
              properties: {
                products: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      name_ar: { type: "string" },
                      name_en: { type: "string" },
                      price: { type: "number" },
                      currency: { type: "string", enum: ["IQD", "USD"] },
                      image_url: { type: "string" },
                      in_stock: { type: "boolean" },
                      category: { type: "string", enum: VALID_CATEGORIES },
                      brand: { type: "string" },
                    },
                    required: ["name_ar", "price", "currency", "category"],
                  },
                },
              },
              required: ["products"],
            },
          },
        },
      ],
      tool_choice: { type: "function", function: { name: "extract_products" } },
    }),
  });

  if (!res.ok) {
    console.error(`AI error ${res.status}: ${await res.text()}`);
    return [];
  }

  const data = await res.json();
  const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
  if (!toolCall?.function?.arguments) return [];

  try {
    const args = typeof toolCall.function.arguments === "string"
      ? JSON.parse(toolCall.function.arguments)
      : toolCall.function.arguments;

    return (args.products ?? [])
      .filter((p: any) => p.name_ar && p.price > 0)
      .map((p: any) => ({
        name_ar: String(p.name_ar),
        name_en: p.name_en ? String(p.name_en) : null,
        price: Number(p.price),
        currency: p.currency || "IQD",
        image_url: resolveUrl(p.image_url, `https://${domain}`),
        source_url: pageUrl,
        in_stock: p.in_stock ?? true,
        category: VALID_CATEGORIES.includes(p.category) ? p.category : "general",
        brand: p.brand || null,
      }));
  } catch (e) {
    console.error("AI parse error:", e);
    return [];
  }
}

// ─── URL helpers ───

/** Extract a plain URL string from values that might be ImageObject or JSON string */
function extractPlainUrl(val: unknown): string | null {
  if (!val) return null;
  if (typeof val === "string") {
    const trimmed = val.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try { const obj = JSON.parse(trimmed); return obj.url ?? obj.src ?? null; } catch { return null; }
    }
    return trimmed || null;
  }
  if (typeof val === "object" && val !== null) {
    return (val as any).url ?? (val as any).src ?? null;
  }
  return null;
}

/**
 * Strict image URL validator.
 * Accepts only absolute http/https URLs.
 * Rejects JSON/object-like strings, data: URIs, and non-http schemes.
 */
function validateImageUrl(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  // Reject JSON-like or object-like strings
  if (trimmed.startsWith("{") || trimmed.startsWith("[") || trimmed.startsWith("data:")) return null;
  // Must be absolute http/https
  if (!/^https?:\/\/.+/i.test(trimmed)) return null;
  // Try parsing
  try {
    const u = new URL(trimmed);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    // Reject known placeholder hosts/paths
    const h = u.hostname.toLowerCase();
    const p = (u.pathname + u.search).toLowerCase();
    if (/picsum|placehold|placeholder|dummyimage|fakeimg|lorempixel|unsplash/i.test(h)) return null;
    if (/no[-_ ]?image|default[-_ ]?image|image[-_ ]?not[-_ ]?available|\blogo\b|\bicon\b|favicon|sprite|1x1|pixel\.gif/i.test(p)) return null;
    return u.href;
  } catch {
    return null;
  }
}

function resolveUrl(url: string | null | undefined, domainOrBase: string): string | null {
  if (!url) return null;
  const plain = extractPlainUrl(url) ?? url;
  if (plain.startsWith("http")) return plain;
  if (plain.startsWith("//")) return `https:${plain}`;
  if (plain.startsWith("/")) {
    try {
      return new URL(plain, domainOrBase.startsWith("http") ? domainOrBase : `https://${domainOrBase}`).href;
    } catch { return null; }
  }
  return null;
}

// ─── DOM image waterfall fallback ───

function extractFirstProductImage(html: string, pageUrl: string): string | null {
  // Try srcset first, then data-src, then src
  const imgRegex = /<img[^>]+(?:src|data-src|srcset)\s*=\s*["']([^"']+)["'][^>]*/gi;
  let match;
  while ((match = imgRegex.exec(html)) !== null) {
    let src = match[1].trim();
    // Handle srcset: take first URL
    if (src.includes(",")) src = src.split(",")[0].trim().split(/\s+/)[0];
    if (src.startsWith("data:")) continue;
    src = resolveUrl(src, pageUrl) ?? src;
    if (!src.startsWith("http")) continue;
    const lower = src.toLowerCase();
    // Skip non-product images
    if (
      lower.includes("logo") || lower.includes("icon") || lower.includes("favicon") ||
      lower.includes("sprite") || lower.includes("placeholder") || lower.includes("placehold") ||
      lower.includes("picsum") || lower.includes("dummyimage") || lower.includes("badge") ||
      lower.includes("banner") || lower.includes("social") || lower.includes("payment") ||
      lower.includes("play-store") || lower.includes("app-store") || lower.includes("1x1") ||
      lower.includes("tracking") || lower.includes("pixel") || lower.includes("spacer")
    ) continue;
    // Prefer product-related paths
    if (
      lower.includes("product") || lower.includes("media") || lower.includes("cdn") ||
      lower.includes("image") || lower.includes("photo") || lower.includes("upload")
    ) {
      return src;
    }
  }
  return null;
}

function stripHtml(html: string): string {
  const jsonLdMatches = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi) ?? [];
  const jsonLd = jsonLdMatches.map(m => m.replace(/<\/?script[^>]*>/gi, "")).join("\n");

  const nextDataMatch = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
  const nextData = nextDataMatch?.[1] ?? "";

  const nuxtMatch = html.match(/window\.__NUXT__\s*=\s*(\{[\s\S]*?\});?\s*<\/script>/i);
  const nuxtData = nuxtMatch?.[1]?.slice(0, 5000) ?? "";

  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const parts: string[] = [];
  if (jsonLd) parts.push("=== JSON-LD DATA ===\n" + jsonLd);
  if (nextData) parts.push("=== NEXT.JS DATA ===\n" + nextData.slice(0, 8000));
  if (nuxtData) parts.push("=== NUXT DATA ===\n" + nuxtData);
  parts.push("=== PAGE TEXT ===\n" + text.slice(0, 15000));

  return parts.join("\n\n");
}

// ─── DB Upsert with currency normalization ───

function engineEvidence(engine: EngineType): { evidence_type: EvidenceType; evidence_ref: string } {
  switch (engine) {
    case "shopify_json":
    case "woo_api":
      return { evidence_type: "api", evidence_ref: engine };
    case "html_jsonld":
      return { evidence_type: "url", evidence_ref: engine };
    default:
      return { evidence_type: "url", evidence_ref: "unknown" };
  }
}

async function upsertProducts(
  sb: any, products: ExtractedProduct[], sourceId: string, regionId: string, fxRate: number, engine: EngineType,
): Promise<number> {
  let inserted = 0;

  for (const p of products) {
    try {
      // Find or create product
      const { data: existing } = await sb
        .from("products").select("id")
        .eq("name_ar", p.name_ar).limit(1);

      let productId: string;
      const safeImageUrl = validateImageUrl(extractPlainUrl(p.image_url));

      if (existing?.length) {
        productId = existing[0].id;
        // Backfill image_url if missing on existing product
        if (safeImageUrl) {
          const { data: prodRow } = await sb.from("products").select("image_url").eq("id", productId).single();
          if (prodRow && !prodRow.image_url) {
            await sb.from("products").update({ image_url: safeImageUrl }).eq("id", productId);
          }
        }
      } else {
        const { data: newProd } = await sb
          .from("products")
          .insert({
            name_ar: p.name_ar, name_en: p.name_en,
            category: p.category, brand_ar: p.brand,
            image_url: safeImageUrl,
            unit: "pcs", is_active: true, condition: "new",
          })
          .select("id").single();
        if (!newProd) continue;
        productId = newProd.id;
      }

      // Currency normalization (store ALL prices as IQD; keep original in parsed_currency/raw_price_text)
      const originalPrice = p.price;
      const { priceIqd, normalizationFactor, parsedCurrency: originalCurrency } = normalizeToIqd(
        Number(originalPrice),
        p.currency || "IQD",
        fxRate,
      );

      const sanity = isSaneIqdPrice(priceIqd);
      if (!sanity.ok) continue;

      const normalizedIqd = priceIqd;

      // ── Image persistence (runs even on duplicate observations) ──
      if (safeImageUrl) {
        let confidence = 0.5;
        try {
          const imgHost = new URL(safeImageUrl).hostname;
          const srcHost = new URL(p.source_url).hostname;
          if (imgHost === srcHost || imgHost.endsWith(`.${srcHost}`)) confidence += 0.3;
        } catch { /* skip */ }

        const { error: imgErr } = await sb.from("product_images").upsert({
          product_id: productId, image_url: safeImageUrl,
          source_site: new URL(p.source_url).hostname,
          source_page_url: p.source_url,
          is_primary: true, is_verified: confidence >= 0.7,
          confidence_score: confidence, position: 0,
        }, { onConflict: "product_id,image_url", ignoreDuplicates: true });

        if (imgErr) {
          console.error(`[IMG] product=${productId} err:`, JSON.stringify(imgErr));
        }
      }

      // Duplicate check: same product+source+url today
      const today = new Date().toISOString().split("T")[0];
      const { data: dupCheck } = await sb
        .from("source_price_observations").select("id")
        .eq("product_id", productId).eq("source_id", sourceId)
        .eq("source_url", p.source_url)
        .gte("observed_at", `${today}T00:00:00Z`).limit(1);

      if (dupCheck?.length) continue;

      // Insert observation
      const { evidence_type, evidence_ref } = engineEvidence(engine);
      const priceConfidence = evidence_type === "api" ? 0.9 : 0.8;

      const { error: obsError } = await sb.from("source_price_observations").insert({
        product_id: productId, source_id: sourceId,
        source_url: p.source_url,
        price: priceIqd,
        normalized_price_iqd: normalizedIqd,
        currency: "IQD",
        parsed_currency: originalCurrency,
        raw_price_text: `${originalPrice} ${originalCurrency}`,
        normalization_factor: normalizationFactor,
        unit: "pcs",
        region_id: regionId,
        evidence_type,
        evidence_ref,
        price_confidence: priceConfidence,
        in_stock: p.in_stock,
        is_synthetic: false,
        is_verified: true,
        observed_at: new Date().toISOString(),
      });
      if (obsError) {
        console.error(`Obs error "${p.name_ar}":`, JSON.stringify(obsError));
        continue;
      }
      inserted++;
    } catch (itemErr) {
      console.error(`[UPSERT] "${p.name_ar}" err:`, String(itemErr).slice(0, 200));
    }
  }
  return inserted;
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
