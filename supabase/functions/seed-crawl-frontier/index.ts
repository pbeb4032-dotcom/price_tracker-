/**
 * seed-crawl-frontier (P3.11)
 * Reads domain_bootstrap_paths + source_entrypoints + domain_url_patterns,
 * constructs absolute URLs, and inserts into crawl_frontier.
 * Also discovers via sitemaps. Returns detailed stats.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { requireAdminOrInternal } from "../_shared/auth.ts";
import { getServiceKey, getSupabaseUrl } from "../_shared/keys.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-internal-secret, x-job-secret",
};

const MAX_URLS_PER_RUN = 500;
const FETCH_TIMEOUT_MS = 12_000;

const DEFAULT_PRODUCT_RE = /\/(product|products|p|item|dp)\//i;
const DEFAULT_CATEGORY_RE =
  /\/(category|categories|collections|shop|store|department|c|offers)\//i;

interface DomainRule {
  product: RegExp;
  category: RegExp;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // 🔒 Admin-only (or internal secret for cron)
  const gate = await requireAdminOrInternal(req, corsHeaders);
  if (!gate.ok) return gate.res;

  const sb = createClient(getSupabaseUrl(), getServiceKey(), { auth: { persistSession: false } });

  try {
    // 1) Load domain URL patterns
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
      } catch {
        /* invalid regex, skip */
      }
    }

    // 2) Load active sources
    const { data: sources } = await sb
      .from("price_sources")
      .select("domain")
      .eq("is_active", true);

    const activeDomains = (sources ?? []).map((s) => s.domain);
    if (!activeDomains.length) {
      return json({ seeded_total: 0, message: "No active sources" });
    }

    let totalInserted = 0;
    const seededByDomain: Record<string, number> = {};
    let skippedDuplicates = 0;

    // 3) Bootstrap paths → crawl_frontier
    const { data: bootstrapPaths } = await sb
      .from("domain_bootstrap_paths")
      .select("source_domain, path, page_type, priority")
      .eq("is_active", true)
      .order("priority", { ascending: true });

    if (bootstrapPaths?.length) {
      const bootstrapRows = bootstrapPaths
        .filter((bp) => activeDomains.includes(bp.source_domain))
        .map((bp) => ({
          source_domain: bp.source_domain,
          url: `https://${bp.source_domain}${bp.path}`,
          page_type: bp.page_type,
          depth: 0,
          status: "pending",
          discovered_from: "bootstrap",
        }));

      if (bootstrapRows.length > 0) {
        const { data: inserted, error: insErr } = await sb
          .from("crawl_frontier")
          .upsert(bootstrapRows, { onConflict: "url_hash", ignoreDuplicates: true })
          .select("id, source_domain");

        if (!insErr && inserted) {
          for (const r of inserted) {
            seededByDomain[r.source_domain] =
              (seededByDomain[r.source_domain] ?? 0) + 1;
          }
          totalInserted += inserted.length;
          skippedDuplicates += bootstrapRows.length - inserted.length;
        }
      }
    }

    // 4) Source entrypoints
    const { data: entrypoints } = await sb
      .from("source_entrypoints")
      .select("domain, url, page_type, priority")
      .eq("is_active", true)
      .order("priority", { ascending: true });

    for (const entry of entrypoints ?? []) {
      if (totalInserted >= MAX_URLS_PER_RUN) break;
      try {
        const html = await fetchPage(entry.url);
        if (!html) continue;

        const links = extractInternalLinks(html, entry.domain);
        if (!links.length) continue;

        const remaining = MAX_URLS_PER_RUN - totalInserted;
        const rows = links
          .map((u) => ({
            source_domain: entry.domain,
            url: u,
            page_type: classifyUrl(u, entry.domain, rulesMap),
            depth: 1,
            parent_url: entry.url,
            status: "pending",
            discovered_from: entry.url,
          }))
          .filter((r) => r.page_type !== "unknown")
          .slice(0, remaining);

        if (!rows.length) continue;

        const { data: inserted, error: insErr } = await sb
          .from("crawl_frontier")
          .upsert(rows, { onConflict: "url_hash", ignoreDuplicates: true })
          .select("id, source_domain");

        if (!insErr && inserted) {
          for (const r of inserted) {
            seededByDomain[r.source_domain] =
              (seededByDomain[r.source_domain] ?? 0) + 1;
          }
          totalInserted += inserted.length;
          skippedDuplicates += rows.length - inserted.length;
        }
      } catch (err) {
        console.warn(`Failed to seed ${entry.domain}:`, err);
      }
    }

    // 5) Sitemap discovery for all active domains
    for (const domain of activeDomains) {
      if (totalInserted >= MAX_URLS_PER_RUN) break;
      try {
        let sitemapUrls = await discoverFromSitemap(domain);
        if (!sitemapUrls.length) continue;

        // ✅ shuffle so each run takes a different slice
        shuffleInPlace(sitemapUrls);

        const remaining = MAX_URLS_PER_RUN - totalInserted;
        const rows = sitemapUrls
          .map((u) => ({
            source_domain: domain,
            url: u,
            page_type: classifyUrl(u, domain, rulesMap),
            depth: 0,
            status: "pending",
            discovered_from: "sitemap",
          }))
          .slice(0, remaining);

        if (!rows.length) continue;

        const { data: inserted, error: insErr } = await sb
          .from("crawl_frontier")
          .upsert(rows, { onConflict: "url_hash", ignoreDuplicates: true })
          .select("id, source_domain");

        if (!insErr && inserted) {
          for (const r of inserted) {
            seededByDomain[r.source_domain] =
              (seededByDomain[r.source_domain] ?? 0) + 1;
          }
          totalInserted += inserted.length;
          skippedDuplicates += rows.length - inserted.length;
        }
      } catch {
        // sitemap failed, skip
      }
    }

    return json({
      seeded_total: totalInserted,
      seeded_by_domain: seededByDomain,
      skipped_duplicates: skippedDuplicates,
      active_domains: activeDomains.length,
    });
  } catch (err) {
    console.error("seed-crawl-frontier error:", err);
    return json({ error: String(err) }, 500);
  }
});

// ─── Helpers ─────────────────────────────────────────

function classifyUrl(
  url: string,
  domain: string,
  rulesMap: Map<string, DomainRule>,
): "product" | "category" | "unknown" {
  const r = rulesMap.get(domain);
  const prodRe = r?.product ?? DEFAULT_PRODUCT_RE;
  const catRe = r?.category ?? DEFAULT_CATEGORY_RE;
  if (prodRe.test(url)) return "product";
  if (catRe.test(url)) return "category";
  return "unknown";
}

function extractInternalLinks(html: string, domain: string): string[] {
  const links: string[] = [];
  const hrefRegex = /href\s*=\s*["'](https?:\/\/[^"']+|\/[^"']+)["']/gi;
  let match;
  while ((match = hrefRegex.exec(html)) !== null) {
    let url = match[1].trim();
    if (url.startsWith("/")) {
      url = `https://${domain}${url}`;
    }
    try {
      const parsed = new URL(url);
      if (parsed.hostname === domain || parsed.hostname.endsWith(`.${domain}`)) {
        parsed.hash = "";
        links.push(parsed.toString());
      }
    } catch {
      // Invalid URL, skip
    }
  }
  return [...new Set(links)];
}

async function fetchPage(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ar,en;q=0.9",
      },
      redirect: "follow",
    });
    clearTimeout(timeout);
    if (!res.ok) return null;

    const ct = res.headers.get("content-type") ?? "";
    if (
      !ct.includes("text/html") &&
      !ct.includes("application/xhtml") &&
      !ct.includes("text/xml") &&
      !ct.includes("application/xml")
    ) return null;

    return await res.text();
  } catch {
    clearTimeout(timeout);
    return null;
  }
}

async function discoverFromSitemap(domain: string): Promise<string[]> {
  const base = `https://${domain}`;

  // ✅ more common sitemap endpoints (+ gz)
  const sitemapPaths = [
    "/sitemap.xml",
    "/sitemap.xml.gz",
    "/sitemap_index.xml",
    "/sitemap_index.xml.gz",
    "/sitemap_products.xml",
    "/sitemap_products.xml.gz",
    // Shopify/Avada HTML sitemaps (common in Iraq stores)
    "/pages/avada-sitemap-products",
    "/pages/avada-sitemap-collections",
    "/pages/avada-sitemap",
    "/sitemap",
    "/sitemap.html",
  ];

  const allUrls = new Set<string>();

  // 0) robots.txt declared sitemaps
  try {
    const robotsSitemaps = await discoverSitemapsFromRobots(domain);
    for (const u of robotsSitemaps) {
      const urls = await fetchSitemapUrlsAny(u, domain);
      for (const x of urls) allUrls.add(x);
    }
  } catch {
    // ignore robots failures
  }

  for (const path of sitemapPaths) {
    try {
      const urls = await fetchSitemapUrlsAny(base + path, domain);
      for (const u of urls) {
        if (u.endsWith(".xml") || u.endsWith(".xml.gz")) {
          const nested = await fetchSitemapUrlsAny(u, domain);
          for (const nu of nested) allUrls.add(nu);
        } else {
          allUrls.add(u);
        }
      }
    } catch {
      // ignore
    }
  }

  return Array.from(allUrls);
}

async function discoverSitemapsFromRobots(domain: string): Promise<string[]> {
  const url = `https://${domain}/robots.txt`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "ShkadAdil-SitemapBot/1.0", Accept: "text/plain,*/*" },
    });
    clearTimeout(timeout);
    if (!res.ok) return [];
    const txt = await res.text();
    const out: string[] = [];
    for (const line of txt.split(/\r?\n/)) {
      const m = line.match(/^\s*Sitemap:\s*(\S+)\s*$/i);
      if (m?.[1] && m[1].startsWith("http")) out.push(m[1]);
    }
    return out;
  } catch {
    clearTimeout(timeout);
    return [];
  }
}

async function fetchSitemapUrlsAny(url: string, domain: string): Promise<string[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  const res = await fetch(url, {
    signal: controller.signal,
    headers: {
      "User-Agent": "ShkadAdil-SitemapBot/1.0",
      Accept: "application/xml, text/xml, text/html, application/octet-stream;q=0.9, */*;q=0.8",
    },
  });
  clearTimeout(timeout);
  if (!res.ok) return [];

  const ct = (res.headers.get("content-type") ?? "").toLowerCase();
  // HTML sitemap pages
  if (ct.includes("text/html")) {
    const html = await res.text();
    return extractInternalLinks(html, domain);
  }

  // XML / gz
  const xml = await readPossiblyGzippedText(res, url);

  const locs: string[] = [];
  const locRegex = /<loc>\s*(.*?)\s*<\/loc>/gi;
  let match;
  while ((match = locRegex.exec(xml)) !== null) {
    const loc = match[1].trim();
    if (loc.startsWith("http")) locs.push(loc);
  }

  return locs;
}

async function readPossiblyGzippedText(res: Response, url: string): Promise<string> {
  const enc = (res.headers.get("content-encoding") ?? "").toLowerCase();
  const isGz = url.endsWith(".gz") || enc.includes("gzip");

  // Deno يدعم DecompressionStream عادةً
  if (isGz && typeof (globalThis as any).DecompressionStream !== "undefined" && res.body) {
    const ds = new DecompressionStream("gzip");
    const decompressed = res.body.pipeThrough(ds);
    return await new Response(decompressed).text();
  }

  return await res.text();
}

function shuffleInPlace<T>(arr: T[]) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}