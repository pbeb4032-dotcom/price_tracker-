/**
 * productExtract.ts
 * Deterministic extraction using per-site adapters (jsonld/meta/dom) + safe fallbacks.
 */

import { validateImageUrl, extractNumberLike } from "./sanity.ts";

export interface SourceAdapter {
  adapter_type: string;
  selectors: Record<string, string[]>;
  priority: number;
}

export interface ExtractedProduct {
  name: string;
  nameEn: string | null;
  description: string | null;
  price: number;
  currency: string | null;
  image: string | null;
  inStock: boolean;
  evidenceType: string;
  canonicalUrl: string | null;
  debug?: {
    matched?: Record<string, string>;
  };
}

export function extractProductFromHtml(
  html: string,
  pageUrl: string,
  adapters: SourceAdapter[]
): ExtractedProduct | null {
  const canonicalUrl = extractCanonical(html);

  const sorted = [...(adapters ?? [])].sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
  const jsonLdRaw = extractJsonLdRawProduct(html);
  const nextData = extractNextData(html);
  const nuxtData = extractNuxtData(html);
  const deepNext = nextData ? deepFindProduct(nextData) : null;
  const deepNuxt = nuxtData ? deepFindProduct(nuxtData) : null;

  const debugMatched: Record<string, string> = {};

  const ctx = {
    html,
    pageUrl,
    canonicalUrl,
    jsonLdRaw,
    deepNext,
    deepNuxt,
  };

  // 1) Adapter-driven extraction
  for (const adapter of sorted) {
    const selectors = adapter.selectors ?? {};

    const name = pickFirstString(selectors.productName ?? selectors.name ?? [], ctx, debugMatched, "name");
    const description = pickFirstString(
      selectors.description ?? selectors.productDescription ?? selectors.desc ?? [],
      ctx,
      debugMatched,
      "description",
    );
    const priceVal = pickFirstNumber(selectors.price ?? [], ctx, debugMatched, "price");
    const currency = pickFirstString(selectors.currency ?? [], ctx, debugMatched, "currency");
    const imageRaw = pickFirstString(selectors.image ?? [], ctx, debugMatched, "image");
    const inStock = pickFirstInStock(selectors.inStock ?? [], ctx, debugMatched, "inStock");

    if (name && priceVal && priceVal > 0) {
      const resolvedImage = resolveUrl(imageRaw, pageUrl);
      const safeImage = validateImageUrl(resolvedImage);

      const imgWaterfall = safeImage
        ?? validateImageUrl(resolveUrl(extractMeta(html, "og:image"), pageUrl))
        ?? validateImageUrl(extractFirstProductImage(html, pageUrl));

      return {
        name,
        nameEn: null,
        description: cleanDescription(description)
          ?? cleanDescription(jsonLdRaw?.description)
          ?? cleanDescription(extractMeta(html, "description"))
          ?? cleanDescription(extractMeta(html, "og:description")),
        price: priceVal,
        currency: currency ? currency.toUpperCase() : null,
        image: imgWaterfall,
        inStock,
        evidenceType: adapter.adapter_type || "adapter",
        canonicalUrl,
        debug: { matched: { ...debugMatched } },
      };
    }
  }

  // 2) Strong deterministic fallbacks
  const jsonLd = jsonLdRaw ? simplifyJsonLd(jsonLdRaw, html, pageUrl) : null;
  if (jsonLd?.name && jsonLd.price && jsonLd.price > 0) {
    return {
      name: jsonLd.name,
      nameEn: null,
      description: cleanDescription(jsonLd.description)
        ?? cleanDescription(extractMeta(html, "description"))
        ?? cleanDescription(extractMeta(html, "og:description")),
      price: jsonLd.price,
      currency: jsonLd.currency ?? null,
      image: jsonLd.image ?? null,
      inStock: jsonLd.inStock,
      evidenceType: "jsonld",
      canonicalUrl,
    };
  }

  const deep = deepNext ?? deepNuxt;
  if (deep?.name && deep.price && deep.price > 0) {
    const image = validateImageUrl(resolveUrl(deep.image ?? null, pageUrl))
      ?? validateImageUrl(resolveUrl(extractMeta(html, "og:image"), pageUrl))
      ?? validateImageUrl(extractFirstProductImage(html, pageUrl));
    return {
      name: deep.name,
      nameEn: null,
      description: cleanDescription(deep.description)
        ?? cleanDescription(extractMeta(html, "description"))
        ?? cleanDescription(extractMeta(html, "og:description")),
      price: deep.price,
      currency: deep.currency ?? null,
      image,
      inStock: true,
      evidenceType: "embedded_json",
      canonicalUrl,
    };
  }

  const ogName = extractMeta(html, "og:title") ?? extractMeta(html, "title");
  const ogPrice = extractMeta(html, "product:price:amount");
  const ogCurrency = extractMeta(html, "product:price:currency");
  const ogDesc = extractMeta(html, "og:description") ?? extractMeta(html, "description");
  const price = extractNumberLike(ogPrice);
  if (ogName && price && price > 0) {
    const image = validateImageUrl(resolveUrl(extractMeta(html, "og:image"), pageUrl))
      ?? validateImageUrl(extractFirstProductImage(html, pageUrl));
    return {
      name: ogName,
      nameEn: null,
      description: cleanDescription(ogDesc),
      price,
      currency: ogCurrency ? ogCurrency.toUpperCase() : null,
      image,
      inStock: true,
      evidenceType: "meta",
      canonicalUrl,
    };
  }

  return null;
}

// ────────────────────────────────────────────────────────────
// Selector evaluation
// ────────────────────────────────────────────────────────────

type Ctx = {
  html: string;
  pageUrl: string;
  canonicalUrl: string | null;
  jsonLdRaw: any | null;
  deepNext: any | null;
  deepNuxt: any | null;
};

function pickFirstString(selectors: string[], ctx: Ctx, dbg: Record<string, string>, dbgKey: string): string | null {
  for (const sel of selectors ?? []) {
    const v = readSelector(sel, ctx);
    if (typeof v === "string") {
      const s = cleanText(v);
      if (s) {
        dbg[dbgKey] = sel;
        return s;
      }
    }
  }
  return null;
}

function pickFirstNumber(selectors: string[], ctx: Ctx, dbg: Record<string, string>, dbgKey: string): number | null {
  for (const sel of selectors ?? []) {
    const v = readSelector(sel, ctx);
    const n = extractNumberLike(v);
    if (n != null && n > 0) {
      dbg[dbgKey] = sel;
      return n;
    }
  }
  return null;
}

function pickFirstInStock(selectors: string[], ctx: Ctx, dbg: Record<string, string>, dbgKey: string): boolean {
  for (const sel of selectors ?? []) {
    const v = readSelector(sel, ctx);
    if (typeof v === "boolean") {
      dbg[dbgKey] = sel;
      return v;
    }
    if (typeof v === "string") {
      const s = v.toLowerCase();
      if (s.includes("outofstock") || s.includes("out of stock") || s.includes("غير متوفر") || s.includes("نفدت")) {
        dbg[dbgKey] = sel;
        return false;
      }
      if (s.includes("instock") || s.includes("in stock") || s.includes("متوفر") || s.includes("available")) {
        dbg[dbgKey] = sel;
        return true;
      }
    }
  }
  return true;
}

function readSelector(selector: string, ctx: Ctx): unknown {
  const sel = String(selector || "").trim();
  if (!sel) return null;

  // jsonld.path
  if (sel.startsWith("jsonld.")) {
    return getByPath(ctx.jsonLdRaw, sel.replace(/^jsonld\./, ""));
  }

  // nextdata.path / nuxtdata.path
  if (sel.startsWith("nextdata.")) {
    return getByPath(ctx.deepNext, sel.replace(/^nextdata\./, ""));
  }
  if (sel.startsWith("nuxtdata.")) {
    return getByPath(ctx.deepNuxt, sel.replace(/^nuxtdata\./, ""));
  }

  // meta:property
  if (sel.startsWith("meta:")) {
    return extractMeta(ctx.html, sel.replace(/^meta:/, ""));
  }

  // css:selector@attr
  if (sel.startsWith("css:")) {
    const payload = sel.replace(/^css:/, "");
    const [cssSel, attr] = payload.split("@").map((s) => s.trim());
    return extractByCss(ctx.html, cssSel, attr || null);
  }

  // regex:/.../
  if (sel.startsWith("regex:")) {
    const pattern = sel.replace(/^regex:/, "");
    try {
      const re = new RegExp(pattern, "i");
      const m = ctx.html.match(re);
      return m?.[1] ?? null;
    } catch {
      return null;
    }
  }

  // plain fallback: treat as meta property if looks like og:
  if (sel.startsWith("og:")) return extractMeta(ctx.html, sel);

  return null;
}

function getByPath(obj: any, path: string): unknown {
  if (!obj || !path) return null;
  const parts = path.split(".").filter(Boolean);
  let cur: any = obj;
  for (const p of parts) {
    if (cur == null) return null;
    if (Array.isArray(cur)) {
      const idx = Number(p);
      cur = Number.isFinite(idx) ? cur[idx] : cur[0];
      continue;
    }
    cur = cur[p];
  }
  return cur ?? null;
}

// ────────────────────────────────────────────────────────────
// Deterministic parsers
// ────────────────────────────────────────────────────────────

function extractCanonical(html: string): string | null {
  const m = html.match(/<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i);
  return m?.[1]?.trim() || null;
}

function extractMeta(html: string, property: string): string | null {
  const regex = new RegExp(
    `<meta[^>]*(?:property|name)\\s*=\\s*["']${escapeRegExp(property)}["'][^>]*content\\s*=\\s*["']([^"']*)["']`,
    "i",
  );
  const match = html.match(regex);
  if (match) return match[1].trim();
  const regex2 = new RegExp(
    `<meta[^>]*content\\s*=\\s*["']([^"']*)["'][^>]*(?:property|name)\\s*=\\s*["']${escapeRegExp(property)}["']`,
    "i",
  );
  const match2 = html.match(regex2);
  return match2 ? match2[1].trim() : null;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function resolveUrl(url: string | null | undefined, base: string): string | null {
  if (!url) return null;
  const u = String(url).trim();
  if (!u) return null;
  if (u.startsWith("http://") || u.startsWith("https://")) return u;
  if (u.startsWith("//")) return `https:${u}`;
  try {
    return new URL(u, base).toString();
  } catch {
    return null;
  }
}

function cleanText(s: string): string {
  return String(s)
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractByCss(html: string, selector: string, attr: string | null): string | null {
  if (!selector) return null;

  // Support simple selectors; for complex ones, use the last segment.
  const last = selector.trim().split(/\s+/).pop() || "";
  if (!last) return null;

  let tag = "";
  let id: string | null = null;
  let cls: string | null = null;

  const idMatch = last.match(/#([A-Za-z0-9_-]+)/);
  if (idMatch) id = idMatch[1];
  const classMatch = last.match(/\.([A-Za-z0-9_-]+)/);
  if (classMatch) cls = classMatch[1];

  tag = last.replace(/[#.].*$/, "");
  if (!tag) tag = "*";

  const openTagRe = new RegExp(
    `<${tag === "*" ? "[a-zA-Z0-9]+" : escapeRegExp(tag)}\\b[^>]*>`,
    "ig",
  );

  let m: RegExpExecArray | null;
  while ((m = openTagRe.exec(html)) !== null) {
    const open = m[0];
    if (id && !new RegExp(`\\bid\\s*=\\s*["']${escapeRegExp(id)}["']`, "i").test(open)) continue;
    if (cls && !new RegExp(`\\bclass\\s*=\\s*["'][^"']*\\b${escapeRegExp(cls)}\\b[^"']*["']`, "i").test(open)) continue;

    // Attribute value
    if (attr) {
      const am = open.match(new RegExp(`\\b${escapeRegExp(attr)}\\s*=\\s*["']([^"']+)["']`, "i"));
      if (am?.[1]) return am[1].trim();
      continue;
    }

    // Text content
    const startIdx = m.index + open.length;
    const closeTag = tag === "*" ? null : `</${tag}>`;
    if (!closeTag) return null;
    const endIdx = html.toLowerCase().indexOf(closeTag, startIdx);
    if (endIdx === -1) continue;
    const inner = html.slice(startIdx, endIdx);
    const text = cleanText(inner);
    if (text) return text;
  }

  return null;
}

function extractFirstProductImage(html: string, pageUrl: string): string | null {
  const imgRegex = /<img[^>]+(?:src|data-src|srcset)\s*=\s*["']([^"']+)["'][^>]*>/gi;
  let match;
  while ((match = imgRegex.exec(html)) !== null) {
    let src = match[1].trim();
    if (src.includes(",")) src = src.split(",")[0].trim().split(/\s+/)[0];
    if (src.startsWith("data:")) continue;
    const abs = resolveUrl(src, pageUrl) ?? src;
    const lower = abs.toLowerCase();
    if (
      lower.includes("logo") || lower.includes("icon") || lower.includes("favicon") ||
      lower.includes("sprite") || lower.includes("placeholder") || lower.includes("placehold") ||
      lower.includes("picsum") || lower.includes("dummyimage") || lower.includes("badge") ||
      lower.includes("banner") || lower.includes("social") || lower.includes("payment") ||
      lower.includes("play-store") || lower.includes("app-store") || lower.includes("1x1")
    ) continue;
    if (
      lower.includes("product") || lower.includes("media") || lower.includes("cdn") ||
      lower.includes("image") || lower.includes("photo") || lower.includes("upload")
    ) {
      return abs;
    }
  }
  return null;
}

// ────────────────────────────────────────────────────────────
// JSON-LD + embedded data
// ────────────────────────────────────────────────────────────

function extractJsonLdRawProduct(html: string): any | null {
  const scriptRegex = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = scriptRegex.exec(html)) !== null) {
    try {
      const data = JSON.parse(match[1]);
      const product = findProductInJsonLd(data);
      if (product) return product;
    } catch {
      // ignore
    }
  }
  return null;
}

function findProductInJsonLd(data: any): any | null {
  if (!data) return null;
  if (data["@graph"] && Array.isArray(data["@graph"])) {
    for (const item of data["@graph"]) {
      const r = findProductInJsonLd(item);
      if (r) return r;
    }
    return null;
  }
  if (Array.isArray(data)) {
    for (const item of data) {
      const r = findProductInJsonLd(item);
      if (r) return r;
    }
    return null;
  }
  const type = data?.["@type"];
  if (type !== "Product" && type !== "IndividualProduct" && type !== "ProductModel") return null;
  if (!data?.name) return null;
  return data;
}

function simplifyJsonLd(
  raw: any,
  html: string,
  pageUrl: string,
): { name: string; description: string | null; price: number; currency: string | null; image: string | null; inStock: boolean } | null {
  if (!raw?.name || typeof raw.name !== "string") return null;
  const name = raw.name;
  const description = typeof raw.description === "string" ? raw.description : null;
  const offers = raw.offers;
  const offer = Array.isArray(offers) ? offers[0] : offers;
  const price = extractNumberLike(offer?.price ?? offer?.lowPrice);
  if (!price || price <= 0) return null;
  const currency = typeof offer?.priceCurrency === "string" ? offer.priceCurrency : null;
  let inStock = true;
  const availability = String(offer?.availability ?? "").toLowerCase();
  if (availability.includes("outofstock")) inStock = false;

  let image: string | null = null;
  if (raw.image) {
    if (typeof raw.image === "string") image = resolveUrl(raw.image, pageUrl);
    else if (Array.isArray(raw.image) && typeof raw.image[0] === "string") image = resolveUrl(raw.image[0], pageUrl);
    else if (raw.image?.url) image = resolveUrl(raw.image.url, pageUrl);
  }
  image = validateImageUrl(image)
    ?? validateImageUrl(resolveUrl(extractMeta(html, "og:image"), pageUrl))
    ?? validateImageUrl(extractFirstProductImage(html, pageUrl));

  return { name, description, price, currency: currency ? currency.toUpperCase() : null, image, inStock };
}

function extractNextData(html: string): any | null {
  const m = html.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

function extractNuxtData(html: string): any | null {
  const m = html.match(/window\.__NUXT__\s*=\s*(\{[\s\S]*?\});?\s*<\/script>/i);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

function deepFindProduct(node: any, depth = 0): { name?: string; description?: string | null; price?: number; currency?: string; image?: string } | null {
  if (!node || typeof node !== "object" || depth > 10) return null;
  const n = node.name || node.title || node.productName || node.product_name;
  const d = node.description || node.shortDescription || node.short_description || node.body || node.body_html || node.content;
  const rawPrice = node.price ?? node.finalPrice ?? node.salePrice ?? node.amount ?? node.current_price;
  const price = extractNumberLike(rawPrice) ?? 0;
  const currency = node.currency || node.priceCurrency || node.currency_code || "IQD";
  const img = typeof node.image === "string" ? node.image
    : Array.isArray(node.image) ? node.image[0]
    : node.image?.url ?? node.thumbnail ?? node.imageUrl ?? node.photo;

  if (n && typeof n === "string" && price > 0) {
    return {
      name: n,
      description: typeof d === "string" ? d : null,
      price,
      currency: String(currency),
      image: img ? String(img) : undefined,
    };
  }

  for (const k of Object.keys(node)) {
    if (k.startsWith("_")) continue;
    const v = node[k];
    if (v && typeof v === "object") {
      const found = deepFindProduct(v, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function cleanDescription(v: any): string | null {
  if (v == null) return null;
  const s = cleanText(String(v));
  if (!s) return null;
  // Trim very long descriptions to keep DB + UI fast.
  return s.length > 2000 ? s.slice(0, 2000).trim() : s;
}
