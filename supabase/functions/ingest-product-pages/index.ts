/**
 * ingest-product-pages (P4.0 — Firecrawl-free)
 * Processes crawl_frontier items with:
 * - Adapter-based extraction (source_adapters selectors)
 * - Currency normalization (USD→IQD)
 * - Retry/backoff logic
 * - Duplicate observation protection
 * - Ingestion run observability
 * - Strict provenance (source_url, evidence_type, is_synthetic=false)
 * - Normalized error codes + error analytics
 * - NO Firecrawl dependency — direct fetch only
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { requireAdminOrInternal } from "../_shared/auth.ts";
import { extractProductFromHtml } from "../_shared/productExtract.ts";
import { isSaneIqdPrice, normalizeToIqd, validateImageUrl as validateImageUrlShared } from "../_shared/sanity.ts";
import { getServiceKey, getSupabaseUrl } from "../_shared/keys.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const BATCH_SIZE = 20;
const FETCH_TIMEOUT_MS = 15_000;
const STUCK_THRESHOLD_MS = 20 * 60_000;
const DEFAULT_FALLBACK_FX = 1470;
const SITEMAP_MAX_URLS_PER_DOMAIN = 300;
const SITEMAP_FETCH_TIMEOUT_MS = 10_000;
const DOMAIN_COOLDOWN_THRESHOLD = 100; // NO_PRODUCT_DATA count in last hour
const DOMAIN_COOLDOWN_HOURS = 6;
const MAX_NEW_URLS_PER_DOMAIN_PER_RUN = 500;
const CLAIM_PER_DOMAIN_LIMIT = 5;
const FAIRNESS_EVENT_MAX_PER_RUN = 20;
const LOCK_NAME = "ingest-product-pages";
const LOCK_TTL_SECONDS = 900; // 15 min

const DEFAULT_PRODUCT_RE = /\/(product|products|p|item|dp)\//i;
const DEFAULT_CATEGORY_RE = /\/(category|categories|collections|shop|store|department|c|offers)\//i;

// ─── Normalized error codes ─────────────────────────
type ErrorCode =
  | "HTTP_404" | "HTTP_403" | "HTTP_429"
  | "DNS_ERROR" | "TIMEOUT" | "EMPTY_RESPONSE"
  | "BOT_CHALLENGE" | "NOT_HTML" | "NO_PRODUCT_DATA"
  | "PRODUCT_UPSERT_FAILED" | "OBS_INSERT_FAILED"
  | "INVALID_IMAGE_URL"
  | "PRICE_SANITY_FAIL"
  | "DOMAIN_COOLDOWN"
  | "JS_RENDER_REQUIRED"
  | "CLAIM_FAIRNESS_BREACH"
  | "UNKNOWN";

// Hard-skip domains that are 100% JS-rendered (no SSR product data)
const JS_RENDER_DOMAINS = new Set<string>(["ubuy.iq"]);
const JS_RENDER_RETRY_HOURS = 24;

function classifyError(fetchResult: FetchResult | null, errorMsg?: string): ErrorCode {
  if (fetchResult) {
    if (fetchResult.status === 404) return "HTTP_404";
    if (fetchResult.status === 403) return "HTTP_403";
    if (fetchResult.status === 429) return "HTTP_429";
    if (fetchResult.blocked) return "BOT_CHALLENGE";
    if (fetchResult.contentType && !fetchResult.contentType.includes("html")) return "NOT_HTML";
    if (fetchResult.status && fetchResult.status >= 200 && !fetchResult.html) return "EMPTY_RESPONSE";
  }
  const msg = (errorMsg ?? "").toLowerCase();
  if (msg.includes("abort") || msg.includes("timeout")) return "TIMEOUT";
  if (msg.includes("dns") || msg.includes("getaddrinfo") || msg.includes("notfound")) return "DNS_ERROR";
  if (msg.includes("no product data")) return "NO_PRODUCT_DATA";
  if (msg.includes("product insert failed") || msg.includes("product upsert")) return "PRODUCT_UPSERT_FAILED";
  if (msg.includes("observation insert")) return "OBS_INSERT_FAILED";
  return "UNKNOWN";
}

interface DomainRule { product: RegExp; category: RegExp; }
interface SourceAdapter { source_id: string; adapter_type: string; selectors: Record<string, string[]>; priority: number; }

// DB constraint: source_price_observations.evidence_type must be one of:
//   url | screenshot | api | ai_scrape
type EvidenceType = "url" | "screenshot" | "api" | "ai_scrape";

function methodToConfidence(method: string): number {
  switch ((method || "").toLowerCase()) {
    case "jsonld":
      return 0.9;
    case "nextdata":
    case "nuxtdata":
      return 0.85;
    case "meta":
      return 0.7;
    default:
      return 0.6;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // 🔒 Admin-only (or internal secret for cron)
  const gate = await requireAdminOrInternal(req, corsHeaders);
  if (!gate.ok) return gate.res;

  const sb = createClient(getSupabaseUrl(), getServiceKey());

  // ── DB mutex lock: prevent concurrent runs (pooling-safe) ──
  const lockOwner = crypto.randomUUID();
  let haveLock = false;
  {
    const { data: got, error: lockErr } = await sb.rpc("acquire_ingest_mutex" as any, {
      p_name: LOCK_NAME,
      p_owner: lockOwner,
      p_ttl_seconds: LOCK_TTL_SECONDS,
    });
    if (lockErr) {
      console.error("acquire_ingest_mutex error:", lockErr);
      return json({ error: "Failed to acquire mutex" }, 500);
    }
    if (!got) {
      return json({ skipped: true, reason: "concurrent_run_in_progress" });
    }
    haveLock = true;
  }

  const runId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  let linksDiscovered = 0;
  let sitemapUrlsDiscovered = 0;
  let sitemapFetchFailures = 0;
  const sitemapSeededDomains = new Set<string>();
  const errorCounts: Record<string, number> = {};
  let cooldownDomainsCountInitial = 0;
  let cooldownDomainsCountRefill = 0;
  let cooldownItemsSkipped = 0;
  let cooldownEventsLogged = 0;
  const discoveredByDomain = new Map<string, number>();
  let domainCapDrops = 0;
  let refillAttempted = 0;
  let refillClaimed = 0;
  let refillProcessed = 0;
  let claimExcludedDomainsInitial = 0;
  let claimExcludedDomainsRefill = 0;
  let claimFairnessBreaches = 0;
  const fairnessLoggedDomains = new Set<string>();
  let jsRenderSkipped = 0;
  let jsRenderEventsLogged = 0;

  await sb.from("ingestion_runs").insert({
    run_id: runId,
    function_name: "ingest-product-pages",
    started_at: startedAt,
    status: "running",
  });

  // Helper: log error event
  async function logError(
    frontierId: string,
    sourceDomain: string,
    url: string,
    code: ErrorCode,
    httpStatus: number | null,
    blockedReason: string | null,
    message: string | null
  ) {
    errorCounts[code] = (errorCounts[code] ?? 0) + 1;
    try {
      await sb.from("ingestion_error_events").insert({
        run_id: runId,
        frontier_id: frontierId,
        source_domain: sourceDomain,
        url,
        http_status: httpStatus,
        blocked_reason: blockedReason,
        error_code: code,
        error_message: message?.slice(0, 500) ?? null,
      });
    } catch { /* non-critical */ }
  }

  try {
    // 0. Load domain URL patterns
    const { data: patterns } = await sb
      .from("domain_url_patterns")
      .select("domain, product_regex, category_regex");

    const rulesMap = new Map<string, DomainRule>();
    for (const p of patterns ?? []) {
      try {
        rulesMap.set(p.domain, {
          product: new RegExp(p.product_regex, "i"),
          category: new RegExp(p.category_regex, "i"),
        });
      } catch { /* invalid regex */ }
    }

    // 0b. Load source adapters
    const { data: adapters } = await sb
      .from("source_adapters")
      .select("source_id, adapter_type, selectors, priority")
      .eq("is_active", true)
      .order("priority", { ascending: true });

    const adapterMap = new Map<string, SourceAdapter[]>();
    for (const a of adapters ?? []) {
      const list = adapterMap.get(a.source_id) ?? [];
      list.push(a as SourceAdapter);
      adapterMap.set(a.source_id, list);
    }

    // 0c. Load latest market exchange rate for USD→IQD
    const { data: fxRow } = await sb
      .from("exchange_rates")
      .select("mid_iqd_per_usd")
      .eq("source_type", "market")
      .eq("is_active", true)
      .order("rate_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    const fxRate = fxRow?.mid_iqd_per_usd ?? DEFAULT_FALLBACK_FX;

    // 0d. Compute domain cooldown set (NO_PRODUCT_DATA density in last hour)
    let cooldownDomains = new Set<string>();
    async function loadCooldownDomains(): Promise<Set<string>> {
      const out = new Set<string>();
      const sinceIso = new Date(Date.now() - 60 * 60_000).toISOString();

      const { data: densityRows } = await sb
        .from("ingestion_error_events")
        .select("source_domain")
        .eq("error_code", "NO_PRODUCT_DATA")
        .gte("created_at", sinceIso);

      const domainCounts = new Map<string, number>();
      for (const r of densityRows ?? []) {
        const d = String((r as any)?.source_domain ?? "").trim();
        if (!d) continue;
        domainCounts.set(d, (domainCounts.get(d) ?? 0) + 1);
      }

      for (const [domain, count] of domainCounts) {
        if (count >= DOMAIN_COOLDOWN_THRESHOLD) out.add(domain);
      }
      return out;
    }

    cooldownDomains = await loadCooldownDomains();
    cooldownDomainsCountInitial = cooldownDomains.size;
    if (cooldownDomainsCountInitial > 0) {
      console.log(`[cooldown] Domains on cooldown (>=${DOMAIN_COOLDOWN_THRESHOLD} NO_PRODUCT_DATA/1h): ${[...cooldownDomains].join(", ")}`);
    }

    // ─── Fairness breach detector ────────────────────────
    async function checkClaimFairness(claimed: any[], phase: "initial" | "refill") {
      if (!claimed?.length) return;
      if (claimFairnessBreaches >= FAIRNESS_EVENT_MAX_PER_RUN) return;

      const domains = [...new Set(
        claimed.map((r: any) => String(r?.source_domain ?? "").trim()).filter(Boolean)
      )];
      if (!domains.length) return;

      const { data: processingRows, error: fairErr } = await sb
        .from("crawl_frontier")
        .select("source_domain")
        .eq("status", "processing")
        .in("source_domain", domains);
      if (fairErr) return;

      const byDomain = new Map<string, number>();
      for (const r of processingRows ?? []) {
        const d = String((r as any)?.source_domain ?? "").trim();
        if (!d) continue;
        byDomain.set(d, (byDomain.get(d) ?? 0) + 1);
      }

      for (const [domain, count] of byDomain) {
        if (count <= CLAIM_PER_DOMAIN_LIMIT) continue;
        const key = `${phase}:${domain}`;
        if (fairnessLoggedDomains.has(key)) continue;

        fairnessLoggedDomains.add(key);
        claimFairnessBreaches++;

        try {
          await sb.from("ingestion_error_events").insert({
            run_id: runId,
            frontier_id: null,
            source_domain: domain,
            url: `fairness:${phase}`,
            error_code: "CLAIM_FAIRNESS_BREACH",
            error_message: `phase=${phase} processing_now=${count} > per_domain_limit=${CLAIM_PER_DOMAIN_LIMIT}`,
            blocked_reason: "claim_fairness_breach",
            http_status: null,
          });
        } catch { /* non-fatal */ }

        if (claimFairnessBreaches >= FAIRNESS_EVENT_MAX_PER_RUN) break;
      }
    }

    const stuckThreshold = new Date(Date.now() - STUCK_THRESHOLD_MS).toISOString();
    const { data: stuckRows } = await sb
      .from("crawl_frontier")
      .select("id, retry_count")
      .eq("status", "processing")
      .lt("updated_at", stuckThreshold);

    for (const row of stuckRows ?? []) {
      const newRetry = (row.retry_count ?? 0) + 1;
      if (newRetry >= 3) {
        await sb.from("crawl_frontier").update({
          status: "failed", retry_count: newRetry,
          last_error: "Stuck in processing 3+ times",
          last_error_code: "TIMEOUT",
          updated_at: new Date().toISOString(),
        }).eq("id", row.id);
      } else {
        const backoffMin = newRetry === 1 ? 10 : 60;
        await sb.from("crawl_frontier").update({
          status: "pending", retry_count: newRetry,
          next_retry_at: new Date(Date.now() + backoffMin * 60_000).toISOString(),
          updated_at: new Date().toISOString(),
        }).eq("id", row.id);
      }
    }

    // ─── processBatch helper ───────────────────────────
    async function processBatch(pending: any[]) {
      let batchProcessed = 0, batchSucceeded = 0, batchFailed = 0, batchCooldownSkipped = 0;

      // Find source_id for each domain
      const domains = [...new Set(pending.map((b: any) => b.source_domain))];
      const { data: sources } = await sb
        .from("price_sources")
        .select("id, domain, name_ar, trust_weight")
        .in("domain", domains);
      const sourceMap = new Map(
        (sources ?? []).map((s) => [s.domain, { id: s.id, name_ar: s.name_ar, trust_weight: (s as any).trust_weight ?? 0.5 }])
      );

      for (const item of pending) {
        batchProcessed++;
        processed++;

        // Heartbeat: refresh mutex TTL every 10 items
        if (processed % 10 === 0 && haveLock) {
          try {
            await sb.rpc("refresh_ingest_mutex" as any, {
              p_name: LOCK_NAME,
              p_owner: lockOwner,
              p_ttl_seconds: LOCK_TTL_SECONDS,
            });
          } catch { /* heartbeat non-critical */ }
        }

        try {
          // ── Domain cooldown check ──
          if (cooldownDomains.has(item.source_domain)) {
            cooldownItemsSkipped++;
            batchCooldownSkipped++;
            await sb.from("crawl_frontier").update({
              status: "pending",
              next_retry_at: new Date(Date.now() + DOMAIN_COOLDOWN_HOURS * 3600_000).toISOString(),
              last_error_code: "DOMAIN_COOLDOWN",
              blocked_reason: "high_no_product_data_rate",
              updated_at: new Date().toISOString(),
            }).eq("id", item.id);
            try {
              await sb.from("ingestion_error_events").insert({
                run_id: runId,
                frontier_id: item.id,
                source_domain: item.source_domain,
                url: item.url,
                error_code: "DOMAIN_COOLDOWN",
                error_message: `Skipped due to high NO_PRODUCT_DATA density (>=${DOMAIN_COOLDOWN_THRESHOLD}/1h)`,
                blocked_reason: "high_no_product_data_rate",
                http_status: null,
              });
              cooldownEventsLogged++;
            } catch { /* non-fatal */ }
            continue;
          }

          // ── JS-render required hard skip (SPA domains with no SSR product data) ──
          {
            const d = String(item?.source_domain ?? "").trim().toLowerCase();
            // Strip www. and check subdomains: "www.ubuy.iq" → "ubuy.iq", "shop.ubuy.iq" → matches "ubuy.iq"
            const d0 = d.replace(/^www\./, "");
            const isJsRenderDomain = [...JS_RENDER_DOMAINS].some(
              (x) => d0 === x || d0.endsWith("." + x)
            );
            const pt = String(item?.page_type ?? "").trim().toLowerCase();
            if (isJsRenderDomain && pt === "product") {
              jsRenderSkipped++;
              // Defer 24h — avoid burning runs on SSR-empty SPA pages
              await sb.from("crawl_frontier").update({
                status: "pending",
                next_retry_at: new Date(Date.now() + JS_RENDER_RETRY_HOURS * 3600_000).toISOString(),
                last_error_code: "JS_RENDER_REQUIRED",
                blocked_reason: "js_render_required",
                updated_at: new Date().toISOString(),
              }).eq("id", item.id);
              try {
                await sb.from("ingestion_error_events").insert({
                  run_id: runId,
                  frontier_id: item.id,
                  source_domain: d0, // use canonical (www-stripped) domain for consistent analytics
                  url: item.url,
                  error_code: "JS_RENDER_REQUIRED",
                  error_message: "SSR HTML contains no product data; JS rendering required (SPA). Deferred 24h.",
                  blocked_reason: "js_render_required",
                  http_status: null,
                });
                jsRenderEventsLogged++;
              } catch { /* non-fatal */ }
              errorCounts["JS_RENDER_REQUIRED"] = (errorCounts["JS_RENDER_REQUIRED"] ?? 0) + 1;
              continue;
            }
          }

          const startMs = Date.now();
          const fetchResult = await fetchPageWithMeta(item.url);
          const fetchMs = Date.now() - startMs;

          if (!fetchResult.html) {
            const errCode = classifyError(fetchResult, fetchResult.error ?? undefined);
            await logError(item.id, item.source_domain, item.url, errCode,
              fetchResult.status, fetchResult.blocked ? "blocked_or_bot_check" : null,
              fetchResult.error);
            await handleFailure(sb, item.id, fetchResult.error ?? "Empty response", fetchMs, fetchResult, errCode);
            failed++;
            batchFailed++;
            continue;
          }

          const html = fetchResult.html;

          // Resolve source/adapters early so we can handle "unknown" URLs from sitemaps
          const source = sourceMap.get(item.source_domain);
          const sourceAdapters = source ? (adapterMap.get(source.id) ?? []) : [];

          // Heuristic: if URL was classified as category/unknown but HTML contains product data,
          // treat it as a product page. This massively increases coverage for sites where
          // product URLs don't contain keywords (e.g. /sku/123.html) but are present in sitemaps.
          let extracted: any | null = null;
          let treatAsProduct = item.page_type === "product";
          if (!treatAsProduct && source) {
            const maybe = extractProductFromHtml(html, item.url, sourceAdapters as any);
            if (maybe?.name && maybe?.price && Number(maybe.price) > 0) {
              extracted = maybe;
              treatAsProduct = true;
            }
          }

          // ── Category/unknown pages: extract links ──
          if (!treatAsProduct) {
            const links = extractInternalLinks(html, item.source_domain);
            const productLinks = links.filter((u: string) =>
              classifyUrl(u, item.source_domain, rulesMap) === "product"
            );
            const catLinks = (item.depth ?? 0) < 2
              ? links.filter((u: string) =>
                  classifyUrl(u, item.source_domain, rulesMap) === "category"
                )
              : [];

            const allRows = [
              ...productLinks.slice(0, 200).map((u: string) => ({
                source_domain: item.source_domain, url: u,
                page_type: "product" as const, depth: (item.depth ?? 0) + 1,
                parent_url: item.url, status: "pending", discovered_from: item.url,
              })),
              ...catLinks.slice(0, 50).map((u: string) => ({
                source_domain: item.source_domain, url: u,
                page_type: "category" as const, depth: (item.depth ?? 0) + 1,
                parent_url: item.url, status: "pending", discovered_from: item.url,
              })),
            ];

            if (allRows.length > 0) {
              const currentCount = discoveredByDomain.get(item.source_domain) ?? 0;
              const allowance = MAX_NEW_URLS_PER_DOMAIN_PER_RUN - currentCount;
              if (allowance <= 0) {
                domainCapDrops += allRows.length;
              } else {
                const rowsToInsert = allRows.slice(0, allowance);
                const dropped = allRows.length - rowsToInsert.length;
                if (dropped > 0) domainCapDrops += dropped;
                await sb.from("crawl_frontier")
                  .upsert(rowsToInsert, { onConflict: "url_hash", ignoreDuplicates: true });
                linksDiscovered += rowsToInsert.length;
                discoveredByDomain.set(item.source_domain, currentCount + rowsToInsert.length);
              }
            }

            // ── Sitemap fallback: if few product links found, try sitemaps ──
            if (productLinks.length < 5 && !sitemapSeededDomains.has(item.source_domain)) {
              sitemapSeededDomains.add(item.source_domain);
              try {
                const sitemapUrls = await discoverFromSitemap(item.source_domain);
                const sitemapProductRows = sitemapUrls
                  .filter((u: string) => classifyUrl(u, item.source_domain, rulesMap) === "product")
                  .slice(0, SITEMAP_MAX_URLS_PER_DOMAIN)
                  .map((u: string) => ({
                    source_domain: item.source_domain, url: u,
                    page_type: "product" as const, depth: 0,
                    status: "pending", discovered_from: "sitemap",
                  }));

                if (sitemapProductRows.length > 0) {
                  const smCurrentCount = discoveredByDomain.get(item.source_domain) ?? 0;
                  const smAllowance = MAX_NEW_URLS_PER_DOMAIN_PER_RUN - smCurrentCount;
                  if (smAllowance <= 0) {
                    domainCapDrops += sitemapProductRows.length;
                  } else {
                    const smToInsert = sitemapProductRows.slice(0, smAllowance);
                    const smDropped = sitemapProductRows.length - smToInsert.length;
                    if (smDropped > 0) domainCapDrops += smDropped;
                    await sb.from("crawl_frontier")
                      .upsert(smToInsert, { onConflict: "url_hash", ignoreDuplicates: true });
                    sitemapUrlsDiscovered += smToInsert.length;
                    discoveredByDomain.set(item.source_domain, smCurrentCount + smToInsert.length);
                  }
                  console.log(`[sitemap] ${item.source_domain}: seeded ${sitemapProductRows.length} product URLs from sitemap`);
                }
              } catch (err) {
                sitemapFetchFailures++;
                console.warn(`[sitemap] Failed for ${item.source_domain}:`, err);
              }
            }

            await sb.from("crawl_frontier").update({
              status: "done", last_crawled_at: new Date().toISOString(),
              http_status: fetchResult.status, content_type: fetchResult.contentType,
              fetch_ms: fetchMs, updated_at: new Date().toISOString(),
            }).eq("id", item.id);

            succeeded++;
            batchSucceeded++;
            continue;
          }

          // ── Product pages: extract data ──
          if (!source) {
            const code: ErrorCode = "UNKNOWN";
            await logError(item.id, item.source_domain, item.url, code, null, null,
              `No source for domain: ${item.source_domain}`);
            await handleFailure(sb, item.id, `No source for domain: ${item.source_domain}`, fetchMs, fetchResult, code);
            failed++;
            batchFailed++;
            continue;
          }

          if (!extracted) {
            extracted = extractProductFromHtml(html, item.url, sourceAdapters as any);
          }

          if (!extracted || !extracted.name || !extracted.price || (extracted.price ?? 0) <= 0) {
            const code: ErrorCode = "NO_PRODUCT_DATA";
            const detail = extracted
              ? `Missing name or price: name=${extracted.name}, price=${extracted.price}`
              : "No product data found";
            await logError(item.id, item.source_domain, item.url, code,
              fetchResult.status, null, detail);
            await handleFailure(sb, item.id, detail, fetchMs, fetchResult, code);
            failed++;
            batchFailed++;
            continue;
          }

          // Find or create product
          let productId: string | null = null;
          const { data: existingProducts } = await sb
            .from("products").select("id, description_ar, image_url")
            .eq("name_ar", extracted.name).eq("is_active", true).limit(1);

          if (existingProducts?.length) {
            productId = existingProducts[0].id;

            // Opportunistically backfill missing fields (keeps the catalog richer over time)
            const desc = typeof (extracted as any).description === "string" ? (extracted as any).description.trim() : "";
            const hasDesc = desc && desc.length >= 20;
            const hasDbDesc = typeof (existingProducts[0] as any).description_ar === "string" && (existingProducts[0] as any).description_ar.trim().length >= 20;

            const sanitizedProductImage = validateImageUrlShared(extractPlainUrl(extracted.image));
            const hasDbImg = Boolean((existingProducts[0] as any).image_url);

            if ((hasDesc && !hasDbDesc) || (sanitizedProductImage && !hasDbImg)) {
              await sb.from("products").update({
                description_ar: hasDesc && !hasDbDesc ? desc.slice(0, 2000) : undefined,
                image_url: sanitizedProductImage && !hasDbImg ? sanitizedProductImage : undefined,
              }).eq("id", productId);
            }
          } else {
            const sanitizedProductImage = validateImageUrlShared(extractPlainUrl(extracted.image));
            const { data: newProduct, error: prodErr } = await sb
              .from("products").insert({
                name_ar: extracted.name, name_en: extracted.nameEn ?? null,
                category: "general", unit: "pcs",
                description_ar: typeof (extracted as any).description === "string"
                  ? (extracted as any).description.trim().slice(0, 2000)
                  : null,
                image_url: sanitizedProductImage,
                is_active: true,
              }).select("id").single();

            if (prodErr || !newProduct) {
              const code: ErrorCode = "PRODUCT_UPSERT_FAILED";
              await logError(item.id, item.source_domain, item.url, code,
                null, null, `Product insert failed: ${prodErr?.message}`);
              await handleFailure(sb, item.id, `Product insert failed: ${prodErr?.message}`, fetchMs, fetchResult, code);
              failed++;
              batchFailed++;
              continue;
            }
            productId = newProduct.id;
          }

          if (!productId) {
            await handleFailure(sb, item.id, "No product ID resolved", fetchMs, fetchResult, "UNKNOWN");
            failed++;
            batchFailed++;
            continue;
          }

          // Get region (default Baghdad)
          const { data: region } = await sb
            .from("regions").select("id").eq("name_ar", "بغداد").single();
          const regionId = region?.id;
          if (!regionId) {
            await handleFailure(sb, item.id, "No default region found", fetchMs, fetchResult, "UNKNOWN");
            failed++;
            batchFailed++;
            continue;
          }

          // Currency normalization (store ALL prices as IQD; keep original in parsed_currency/raw_price_text)
          const originalPrice = extracted.price;
          const priceConfidenceBase = methodToConfidence(extracted.evidenceType);
          const { priceIqd: normalizedIqd, normalizationFactor, parsedCurrency: originalCurrency } = normalizeToIqd(
            Number(originalPrice),
            extracted.currency ?? "IQD",
            fxRate,
          );

          // Strong sanity check: reject silly prices early
          const sanity = isSaneIqdPrice(normalizedIqd);
          const isAnomaly = !sanity.ok;
          const anomalyReason: string | null = sanity.ok ? null : (sanity.reason ?? "price_sanity");
          if (!sanity.ok) {
            const code: ErrorCode = "PRICE_SANITY_FAIL";
            await logError(item.id, item.source_domain, item.url, code,
              fetchResult.status, null, `Rejected price: ${normalizedIqd} IQD (${anomalyReason})`);
            await handleFailure(sb, item.id, `Rejected price: ${anomalyReason}`, fetchMs, fetchResult, code);
            failed++;
            batchFailed++;
            continue;
          }

          // Final insert values
          const priceIqd = normalizedIqd;
          const currencyIqd = "IQD";
          const evidenceType: EvidenceType = "url";
          const evidenceRef = extracted.evidenceType;
          const priceConfidence = Math.min(
            1,
            priceConfidenceBase - (originalCurrency !== "IQD" ? 0.05 : 0) - (isAnomaly ? 0.25 : 0),
          );
          const autoVerified =
            !isAnomaly &&
            priceConfidence >= 0.75 &&
            (source.trust_weight ?? 0.5) >= 0.4;

          // Duplicate protection: same product+source+url+day
          const today = new Date().toISOString().split("T")[0];
          const { data: existingObs } = await sb
            .from("source_price_observations").select("id")
            .eq("product_id", productId).eq("source_id", source.id)
            .eq("source_url", item.url)
            .gte("observed_at", `${today}T00:00:00Z`).limit(1);

          if (!existingObs?.length) {
            const { error: obsErr } = await sb.from("source_price_observations").insert({
              product_id: productId,
              source_id: source.id,
              source_url: item.url,
              // Store normalized IQD price in "price" for consistent UI.
              price: priceIqd,
              normalized_price_iqd: normalizedIqd,
              currency: currencyIqd,
              parsed_currency: originalCurrency,
              raw_price_text: `${originalPrice} ${originalCurrency}`,
              normalization_factor: normalizationFactor,
              is_price_anomaly: isAnomaly,
              anomaly_reason: anomalyReason,
              price_confidence: priceConfidence,
              unit: "pcs",
              region_id: regionId,
              evidence_type: evidenceType,
              evidence_ref: evidenceRef,
              in_stock: extracted.inStock ?? true,
              is_synthetic: false,
              is_verified: autoVerified,
              observed_at: new Date().toISOString(),
              merchant_name: source.name_ar,
            });
            if (obsErr) {
              const isDuplicate = obsErr.message?.includes("duplicate key") ||
                obsErr.message?.includes("uq_obs_daily") ||
                obsErr.code === "23505";
              if (!isDuplicate) {
                const code: ErrorCode = "OBS_INSERT_FAILED";
                await logError(item.id, item.source_domain, item.url, code,
                  null, null, `Observation insert failed: ${obsErr.message}`);
              }
            }
          }

          // Insert image (with hygiene validation)
          const validatedImage = validateImageUrlShared(extractPlainUrl(extracted.image));
          if (validatedImage) {
            const confidence = calculateImageConfidence(
              validatedImage, item.source_domain, extracted.evidenceType
            );
            await sb.from("product_images").upsert(
              {
                product_id: productId, image_url: validatedImage,
                source_site: item.source_domain, source_page_url: item.url,
                is_primary: true, is_verified: confidence >= 0.7,
                confidence_score: confidence, position: 0,
              },
              { onConflict: "product_id,image_url", ignoreDuplicates: true }
            );
          } else if (extracted.image) {
            console.warn(`[hygiene] Rejected invalid image URL: ${String(extracted.image).slice(0, 120)}`);
            try {
              await sb.from("ingestion_error_events").insert({
                run_id: runId,
                frontier_id: item.id,
                source_domain: item.source_domain,
                url: item.url,
                error_code: "INVALID_IMAGE_URL",
                error_message: `Rejected image: ${String(extracted.image).slice(0, 200)}`,
                http_status: null,
                blocked_reason: null,
              });
            } catch { /* non-critical */ }
          }

          // Mark done
          await sb.from("crawl_frontier").update({
            status: "done", last_crawled_at: new Date().toISOString(),
            http_status: fetchResult.status, fetch_ms: fetchMs,
            canonical_url: extracted.canonicalUrl ?? null,
            last_error_code: null,
            updated_at: new Date().toISOString(),
          }).eq("id", item.id);

          succeeded++;
          batchSucceeded++;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          const code = classifyError(null, msg);
          await logError(item.id, item.source_domain, item.url, code, null, null, msg);
          await sb.from("crawl_frontier").update({
            status: "failed", last_error: msg.slice(0, 500),
            last_error_code: code,
            updated_at: new Date().toISOString(),
          }).eq("id", item.id);
          failed++;
          batchFailed++;
        }
      }

      return { batchProcessed, batchSucceeded, batchFailed, batchCooldownSkipped };
    }

    // 2. Claim first batch atomically
    let excludedDomains = Array.from(cooldownDomains);
    claimExcludedDomainsInitial = excludedDomains.length;
    const { data: pending, error: claimErr } = await sb.rpc(
      "claim_crawl_frontier_batch" as any,
      { p_limit: BATCH_SIZE, p_exclude_domains: excludedDomains, p_per_domain_limit: CLAIM_PER_DOMAIN_LIMIT }
    );
    if (claimErr) throw claimErr;
    if (!pending?.length) {
      await finalizeRun(sb, runId, "success", 0, 0, 0, "No pending pages");
      return json({ processed: 0, message: "No pending pages" });
    }

    // Fairness check on initial claim
    await checkClaimFairness(pending, "initial");

    // 3. Process first batch
    const firstResult = await processBatch(pending);

    // 4. Cooldown-aware refill: if entire first batch was cooldown-skipped, claim once more
    if (
      firstResult.batchCooldownSkipped === firstResult.batchProcessed &&
      firstResult.batchSucceeded === 0 &&
      firstResult.batchFailed === 0 &&
      firstResult.batchProcessed > 0
    ) {
      refillAttempted = 1;
      console.log(`[refill] First batch entirely cooldown (${firstResult.batchProcessed} items). Claiming refill batch...`);

      // Recompute cooldown snapshot BEFORE refill claim
      cooldownDomains = await loadCooldownDomains();
      cooldownDomainsCountRefill = cooldownDomains.size;
      excludedDomains = Array.from(cooldownDomains);
      claimExcludedDomainsRefill = excludedDomains.length;
      console.log(`[refill] recomputed cooldown domains=${cooldownDomainsCountRefill}`);

      const { data: refillPending, error: refillErr } = await sb.rpc(
        "claim_crawl_frontier_batch" as any,
        { p_limit: BATCH_SIZE, p_exclude_domains: excludedDomains, p_per_domain_limit: CLAIM_PER_DOMAIN_LIMIT }
      );
      if (!refillErr && refillPending?.length) {
        await checkClaimFairness(refillPending, "refill");
        refillClaimed = refillPending.length;
        const refillResult = await processBatch(refillPending);
        refillProcessed = refillResult.batchProcessed;
        console.log(`[refill] Refill done: claimed=${refillClaimed}, processed=${refillProcessed}, succeeded=${refillResult.batchSucceeded}, failed=${refillResult.batchFailed}, cooldown=${refillResult.batchCooldownSkipped}`);
      } else {
        console.log(`[refill] No items available for refill batch.`);
      }
    }

    // Refresh materialized view
    if (succeeded > 0) {
      try { await sb.rpc("refresh_price_snapshot" as any); } catch { /* non-critical */ }
    }

    // Build discovered_by_domain_top3
    const discTop3 = [...discoveredByDomain.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([d, c]) => `${d}:${c}`)
      .join(",") || "none";

    const notes = `links=${linksDiscovered},sitemap_discovered=${sitemapUrlsDiscovered},sitemap_failures=${sitemapFetchFailures},cooldown_domains_initial=${cooldownDomainsCountInitial},cooldown_domains_refill=${cooldownDomainsCountRefill},cooldown_skipped=${cooldownItemsSkipped},cooldown_logged=${cooldownEventsLogged},js_render_skipped=${jsRenderSkipped},js_render_logged=${jsRenderEventsLogged},domain_cap_drops=${domainCapDrops},refill_attempted=${refillAttempted},refill_claimed=${refillClaimed},refill_processed=${refillProcessed},claim_excluded_initial=${claimExcludedDomainsInitial},claim_excluded_refill=${claimExcludedDomainsRefill},claim_per_domain_limit=${CLAIM_PER_DOMAIN_LIMIT},claim_fairness_breach=${claimFairnessBreaches},disc_top3=${discTop3},errors=${JSON.stringify(errorCounts)}`;
    await finalizeRun(sb, runId,
      failed === 0 ? "success" : succeeded > 0 ? "partial" : "failed",
      processed, succeeded, failed, notes
    );

    return json({ run_id: runId, processed, succeeded, failed, linksDiscovered, sitemapUrlsDiscovered, sitemapFetchFailures, cooldownDomainsCountInitial, cooldownDomainsCountRefill, cooldownItemsSkipped, cooldownEventsLogged, jsRenderSkipped, jsRenderEventsLogged, domainCapDrops, refillAttempted, refillClaimed, refillProcessed, claimExcludedDomainsInitial, claimExcludedDomainsRefill, claimPerDomainLimit: CLAIM_PER_DOMAIN_LIMIT, claimFairnessBreaches, discoveredByDomainTop3: discTop3, error_codes: errorCounts });
  } catch (err) {
    console.error("ingest-product-pages error:", err);
    await finalizeRun(sb, runId, "failed", processed, succeeded, failed, String(err));
    return json({ error: String(err) }, 500);
  } finally {
    // Always release the DB mutex (owner-safe)
    if (haveLock) {
      try {
        await sb.rpc("release_ingest_mutex" as any, {
          p_name: LOCK_NAME,
          p_owner: lockOwner,
        });
      } catch { /* best-effort */ }
    }
  }
});

// ─── Run tracking ───────────────────────────────────

async function finalizeRun(
  sb: ReturnType<typeof createClient>, runId: string, status: string,
  processed: number, succeeded: number, failed: number, notes?: string
) {
  await sb.from("ingestion_runs").update({
    status, processed, succeeded, failed,
    ended_at: new Date().toISOString(),
    notes: notes?.slice(0, 1000) ?? null,
  }).eq("run_id", runId);
}

// ─── Image confidence scoring ──────────────────────

function calculateImageConfidence(
  imageUrl: string, sourceDomain: string, evidenceType: string
): number {
  let score = 0;
  try {
    const imgHost = new URL(imageUrl).hostname;
    if (imgHost === sourceDomain || imgHost.endsWith(`.${sourceDomain}`)) score += 0.4;
    const cdnPatterns = ["cdn.miswag", "img.quffastore", "media.carrefour", "images-na.ssl-images-amazon"];
    if (cdnPatterns.some(p => imgHost.includes(p))) score += 0.3;
  } catch { /* invalid URL */ }

  if (evidenceType.includes("jsonld")) score += 0.3;
  else if (evidenceType.includes("og")) score += 0.2;
  else if (evidenceType.includes("meta")) score += 0.15;

  if (!/[a-f0-9]{32,}/i.test(imageUrl) || /product/i.test(imageUrl)) score += 0.1;
  return Math.min(score, 1.0);
}

// ─── Adapter-based extraction ──────────────────────

interface ExtractedProduct {
  name: string;
  nameEn: string | null;
  price: number | null;
  currency: string | null;
  image: string | null;
  inStock: boolean;
  evidenceType: string;
  canonicalUrl: string | null;
}

function extractProductDataWithAdapters(
  html: string, pageUrl: string, adapters: SourceAdapter[]
): ExtractedProduct | null {
  const canonicalMatch = html.match(/<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i);
  const canonicalUrl = canonicalMatch?.[1] ?? null;

  // 1. JSON-LD
  const jsonLd = extractJsonLd(html);
  if (jsonLd?.name && jsonLd.price && jsonLd.price > 0) {
    // Image waterfall: JSON-LD image → OG image → DOM image
    if (!jsonLd.image) {
      jsonLd.image = extractMeta(html, "og:image") ?? extractFirstProductImage(html, pageUrl);
    }
    return { ...jsonLd, evidenceType: "jsonld", canonicalUrl };
  }

  // 2. __NEXT_DATA__
  const nextData = extractNextData(html);
  if (nextData) {
    const found = deepFindProduct(nextData);
    if (found?.name && found.price && found.price > 0) {
      const image = found.image
        ? resolveUrl(found.image, pageUrl)
        : (extractMeta(html, "og:image") ?? extractFirstProductImage(html, pageUrl));
      return {
        name: found.name, nameEn: null, price: found.price,
        currency: found.currency ?? "IQD", image,
        inStock: true, evidenceType: "nextdata", canonicalUrl,
      };
    }
  }

  // 3. __NUXT__
  const nuxtData = extractNuxtData(html);
  if (nuxtData) {
    const found = deepFindProduct(nuxtData);
    if (found?.name && found.price && found.price > 0) {
      const image = found.image
        ? resolveUrl(found.image, pageUrl)
        : (extractMeta(html, "og:image") ?? extractFirstProductImage(html, pageUrl));
      return {
        name: found.name, nameEn: null, price: found.price,
        currency: found.currency ?? "IQD", image,
        inStock: true, evidenceType: "nuxtdata", canonicalUrl,
      };
    }
  }

  // 4. OG/Meta fallback
  const ogName = extractMeta(html, "og:title") ?? extractMeta(html, "title");
  if (!ogName) return null;

  const ogImage = extractMeta(html, "og:image") ?? extractFirstProductImage(html, pageUrl);
  const ogPrice = extractMeta(html, "product:price:amount");
  const ogCurrency = extractMeta(html, "product:price:currency");

  const price = ogPrice ? parseFloat(ogPrice) : null;
  if (!price || price <= 0) return null;

  return {
    name: ogName, nameEn: null, price,
    currency: ogCurrency ?? null, image: ogImage ?? null,
    inStock: true, evidenceType: "meta", canonicalUrl,
  };
}

// ─── Image waterfall helper ─────────────────────────

function extractFirstProductImage(html: string, pageUrl: string): string | null {
  const domain = new URL(pageUrl).hostname;
  const imgRegex = /<img[^>]+(?:src|data-src)\s*=\s*["']([^"']+)["'][^>]*/gi;
  let match;
  while ((match = imgRegex.exec(html)) !== null) {
    let src = match[1].trim();
    if (src.startsWith("data:")) continue;
    src = resolveUrl(src, pageUrl) ?? src;
    const lower = src.toLowerCase();
    if (
      lower.includes("logo") || lower.includes("icon") || lower.includes("favicon") ||
      lower.includes("sprite") || lower.includes("placeholder") || lower.includes("placehold") ||
      lower.includes("picsum") || lower.includes("dummyimage") || lower.includes("badge") ||
      lower.includes("banner") || lower.includes("social") || lower.includes("payment") ||
      lower.includes("play-store") || lower.includes("app-store") || lower.includes("1x1")
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

function resolveUrl(url: string | null | undefined, base: string): string | null {
  if (!url) return null;
  if (url.startsWith("http")) return url;
  try { return new URL(url, base).href; } catch { return null; }
}

// ─── Fetch ──────────────────────────────────────────

interface FetchResult {
  html: string | null;
  status: number | null;
  contentType: string | null;
  error: string | null;
  blocked: boolean;
}

async function fetchPageWithMeta(url: string): Promise<FetchResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ar,en;q=0.9",
      },
      redirect: "follow",
    });
    clearTimeout(timeout);

    const ct = res.headers.get("content-type") ?? "";
    const isHtml = ct.includes("text/html") || ct.includes("application/xhtml");

    if (!res.ok) {
      return { html: null, status: res.status, contentType: ct, error: `HTTP ${res.status}`, blocked: res.status === 403 || res.status === 429 };
    }
    if (!isHtml) {
      await res.text();
      return { html: null, status: res.status, contentType: ct, error: "Not HTML", blocked: false };
    }

    const html = await res.text();
    const blocked = html.length < 2000 && /captcha|challenge|cloudflare|blocked/i.test(html);
    return { html: blocked ? null : html, status: res.status, contentType: ct, error: blocked ? "Bot check detected" : null, blocked };
  } catch (e) {
    clearTimeout(timeout);
    return { html: null, status: null, contentType: null, error: e instanceof Error ? e.message : String(e), blocked: false };
  }
}

// ─── URL Classification ─────────────────────────────

function classifyUrl(url: string, domain: string, rulesMap: Map<string, DomainRule>): "product" | "category" | "unknown" {
  const r = rulesMap.get(domain);
  const prodRe = r?.product ?? DEFAULT_PRODUCT_RE;
  const catRe = r?.category ?? DEFAULT_CATEGORY_RE;
  if (prodRe.test(url)) return "product";
  if (catRe.test(url)) return "category";
  return "unknown";
}

// ─── Link Extraction ────────────────────────────────

function extractInternalLinks(html: string, domain: string): string[] {
  const links: string[] = [];
  const hrefRegex = /href\s*=\s*["'](https?:\/\/[^"']+|\/[^"']+)["']/gi;
  let match;
  while ((match = hrefRegex.exec(html)) !== null) {
    let url = match[1].trim();
    if (url.startsWith("/")) url = `https://${domain}${url}`;
    try {
      const parsed = new URL(url);
      if (parsed.hostname === domain || parsed.hostname.endsWith(`.${domain}`)) {
        parsed.hash = "";
        links.push(parsed.toString());
      }
    } catch { /* skip */ }
  }
  return [...new Set(links)];
}

// ─── JSON-LD ────────────────────────────────────────

function extractJsonLd(html: string): Omit<ExtractedProduct, "evidenceType" | "canonicalUrl"> | null {
  const scriptRegex = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = scriptRegex.exec(html)) !== null) {
    try {
      const data = JSON.parse(match[1]);
      const product = findProductInJsonLd(data);
      if (product) return product;
    } catch { /* invalid JSON-LD */ }
  }
  return null;
}

function findProductInJsonLd(data: any): Omit<ExtractedProduct, "evidenceType" | "canonicalUrl"> | null {
  if (!data) return null;
  if (data["@graph"] && Array.isArray(data["@graph"])) {
    for (const item of data["@graph"]) { const r = findProductInJsonLd(item); if (r) return r; }
    return null;
  }
  if (Array.isArray(data)) {
    for (const item of data) { const r = findProductInJsonLd(item); if (r) return r; }
    return null;
  }
  const type = data["@type"];
  if (type !== "Product" && type !== "IndividualProduct" && type !== "ProductModel") return null;
  const name = data.name;
  if (!name || typeof name !== "string") return null;

  const offers = data.offers;
  let price: number | null = null;
  let currency: string | null = null;
  let inStock = true;
  if (offers) {
    const offer = Array.isArray(offers) ? offers[0] : offers;
    price = parseFloat(offer?.price ?? offer?.lowPrice ?? "0") || null;
    currency = offer?.priceCurrency ?? null;
    if (offer?.availability) inStock = !offer.availability.includes("OutOfStock");
  }

  let image: string | null = null;
  if (data.image) {
    if (typeof data.image === "string") image = data.image;
    else if (Array.isArray(data.image)) image = data.image[0];
    else if (data.image?.url) image = data.image.url;
  }

  return { name, nameEn: null, price, currency, image, inStock };
}

// ─── Next.js / Nuxt ────────────────────────────────

function extractNextData(html: string): any | null {
  const m = html.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

function extractNuxtData(html: string): any | null {
  const m = html.match(/window\.__NUXT__\s*=\s*(\{[\s\S]*?\});?\s*<\/script>/i);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

function deepFindProduct(node: any, depth = 0): { name?: string; price?: number; currency?: string; image?: string } | null {
  if (!node || typeof node !== "object" || depth > 8) return null;
  const n = node.name || node.title || node.productName;
  const p = Number(node.price ?? node.finalPrice ?? node.salePrice ?? node.amount ?? 0);
  const c = node.currency || node.priceCurrency || "IQD";
  const img = typeof node.image === "string" ? node.image
    : Array.isArray(node.image) ? node.image[0]
    : node.image?.url ?? node.thumbnail ?? node.imageUrl;

  if (n && typeof n === "string" && p > 0) {
    return { name: n, price: p, currency: String(c), image: img ? String(img) : undefined };
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

// ─── Meta Tags ──────────────────────────────────────

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

// ─── Utilities ──────────────────────────────────────

function isPlaceholderImage(url: string): boolean {
  return /picsum\.photos|placehold|placeholder|dummyimage|fakeimg|source\.unsplash\.com|lorempixel/i.test(url);
}

// ─── Image URL hygiene helpers (parity with direct-scraper) ────

/** Extract a plain URL string from values that may be JSON objects */
function extractPlainUrl(raw: unknown): string | null {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Reject JSON-like strings (e.g. WooCommerce ImageObject blobs)
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed === "object" && parsed !== null) {
        const url = parsed.url ?? parsed.src ?? parsed.source_url;
        if (typeof url === "string" && /^https?:\/\//i.test(url)) return url;
      }
      if (Array.isArray(parsed) && parsed.length > 0) {
        const first = typeof parsed[0] === "string" ? parsed[0] : parsed[0]?.url ?? parsed[0]?.src;
        if (typeof first === "string" && /^https?:\/\//i.test(first)) return first;
      }
    } catch { /* not JSON, fall through */ }
    return null;
  }
  return trimmed;
}

/** Validate that a URL is an absolute http/https link suitable for image storage */
function validateImageUrl(url: string | null): string | null {
  if (!url) return null;
  // Must be absolute http/https
  if (!/^https?:\/\//i.test(url)) return null;
  // Reject data URIs that somehow passed
  if (url.startsWith("data:")) return null;
  // Reject known placeholder hosts
  if (isPlaceholderImage(url)) return null;
  // Basic URL validity
  try { new URL(url); } catch { return null; }
  return url;
}

async function handleFailure(
  sb: ReturnType<typeof createClient>, id: string, error: string,
  fetchMs?: number, fetchResult?: FetchResult, errorCode?: ErrorCode
) {
  const { data: row } = await sb.from("crawl_frontier").select("retry_count").eq("id", id).single();
  let newRetry = ((row as any)?.retry_count ?? 0) + 1;
  let newStatus = "failed";
  let nextRetryAt = new Date().toISOString();

  // Price sanity failures are deterministic; don't waste retries.
  if (errorCode === "PRICE_SANITY_FAIL") {
    newStatus = "failed";
    newRetry = 3;
  }

  if (newRetry < 3 && errorCode !== "PRICE_SANITY_FAIL") {
    newStatus = "pending";
    const backoffMin = newRetry === 1 ? 10 : 60;
    nextRetryAt = new Date(Date.now() + backoffMin * 60_000).toISOString();
  }

  await sb.from("crawl_frontier").update({
    status: newStatus, retry_count: newRetry, next_retry_at: nextRetryAt,
    last_error: error.slice(0, 500),
    last_error_code: errorCode ?? null,
    http_status: fetchResult?.status ?? null,
    content_type: fetchResult?.contentType ?? null,
    fetch_ms: fetchMs ?? null,
    blocked_reason: fetchResult?.blocked ? "blocked_or_bot_check" : null,
    updated_at: new Date().toISOString(),
  }).eq("id", id);
}

// ─── Sitemap discovery helpers ──────────────────────

async function discoverFromSitemap(domain: string): Promise<string[]> {
  const base = `https://${domain}`;
  const sitemapPaths = ["/sitemap.xml", "/sitemap_index.xml", "/sitemap_products.xml", "/product-sitemap.xml"];
  const allUrls = new Set<string>();

  for (const path of sitemapPaths) {
    try {
      const urls = await fetchSitemapUrls(base + path);
      for (const u of urls) {
        if (u.endsWith(".xml") || u.endsWith(".xml.gz")) {
          // Prioritize product-like nested sitemaps
          if (/product|prod|item|shop/i.test(u)) {
            const nested = await fetchSitemapUrls(u);
            for (const nu of nested) allUrls.add(nu);
          }
        } else {
          allUrls.add(u);
        }
      }
    } catch { /* sitemap not found */ }
  }
  return Array.from(allUrls);
}

async function fetchSitemapUrls(url: string): Promise<string[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SITEMAP_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "PriceBot-SitemapCrawler/1.0",
        Accept: "application/xml, text/xml",
      },
    });
    clearTimeout(timeout);
    if (!res.ok) return [];
    const xml = await res.text();
    const locs: string[] = [];
    const locRegex = /<loc>\s*([^<]+)\s*<\/loc>/gi;
    let match;
    while ((match = locRegex.exec(xml)) !== null) {
      const loc = match[1].trim();
      if (loc.startsWith("http")) locs.push(loc);
    }
    return locs;
  } catch {
    clearTimeout(timeout);
    return [];
  }
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
