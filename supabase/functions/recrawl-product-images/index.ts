/**
 * recrawl-product-images
 * Fetches real product images from source pages and stores verified ones.
 * Triggered by cron every 10 minutes.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { requireAdminOrInternal } from "../_shared/auth.ts";
import { getServiceKey, getSupabaseUrl } from "../_shared/keys.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const BATCH_SIZE = 10;
const MAX_IMAGES_PER_PRODUCT = 4;
const MIN_IMAGE_SIZE = 20_000; // 20KB
const MIN_CONFIDENCE = 0.70;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // 🔒 Admin-only (or internal secret for cron)
  const gate = await requireAdminOrInternal(req, corsHeaders);
  if (!gate.ok) return gate.res;

  // Admin client for queue + writes
  const supabase = createClient(getSupabaseUrl(), getServiceKey());

  try {
    // 1. Get pending items from queue
    const { data: queueItems, error: queueErr } = await supabase
      .from("image_recrawl_queue")
      .select("id, product_id, attempts")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(BATCH_SIZE);

    if (queueErr) throw queueErr;
    if (!queueItems?.length) {
      return new Response(
        JSON.stringify({ processed: 0, message: "No pending items" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let totalInserted = 0;

    for (const item of queueItems) {
      try {
        // Mark as processing
        await supabase
          .from("image_recrawl_queue")
          .update({ status: "processing", updated_at: new Date().toISOString() })
          .eq("id", item.id);

        // 2. Get latest source page URLs for this product
        const { data: observations } = await supabase
          .from("source_price_observations")
          .select("source_url")
          .eq("product_id", item.product_id)
          .order("observed_at", { ascending: false })
          .limit(5);

        if (!observations?.length) {
          await markDone(supabase, item.id, "done");
          continue;
        }

        const imageUrls: Array<{ url: string; source: string; sourceDomain: string }> = [];
        const seenUrls = new Set<string>();

        // 3. Fetch each source page and extract images
        for (const obs of observations) {
          if (imageUrls.length >= MAX_IMAGES_PER_PRODUCT) break;

          try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 8000);

            const pageRes = await fetch(obs.source_url, {
              signal: controller.signal,
              headers: {
                "User-Agent": "ShkadAdil-ImageBot/1.0",
                Accept: "text/html",
              },
            });
            clearTimeout(timeout);

            if (!pageRes.ok) continue;

            const html = await pageRes.text();

            // Extract JSON-LD Product.image
            const jsonLdImages = extractJsonLdImages(html);
            // Extract og:image
            const ogImages = extractOgImages(html);
            // Extract gallery images
            const galleryImages = extractGalleryImages(html);

            const candidates = [...jsonLdImages, ...ogImages, ...galleryImages];

            for (const candidate of candidates) {
              if (imageUrls.length >= MAX_IMAGES_PER_PRODUCT) break;

              const normalized = normalizeUrl(candidate, obs.source_url);
              if (!normalized || seenUrls.has(normalized)) continue;

              // Same-site + CDN check (not strict same-domain)
              if (!isAllowedImageHost(normalized, obs.source_url)) continue;

              seenUrls.add(normalized);
              imageUrls.push({
                url: normalized,
                source: obs.source_url,
                sourceDomain: baseDomain(new URL(obs.source_url).hostname),
              });
            }
          } catch {
            // Skip failed fetches
            continue;
          }
        }

        // 4. Verify images via HEAD then GET-range fallback
        const verifiedImages: Array<{
          url: string;
          source: string;
        }> = [];

        for (const img of imageUrls) {
          if (verifiedImages.length >= MAX_IMAGES_PER_PRODUCT) break;
          const ok = await verifyImage(img.url);
          if (ok) {
            verifiedImages.push({ url: img.url, source: img.source });
          }
        }

        // 5. Insert verified images
        if (verifiedImages.length > 0) {
          const inserts = verifiedImages.map((img, idx) => ({
            product_id: item.product_id,
            image_url: img.url,
            source_page_url: img.source,
            source_site: new URL(img.url).hostname,
            position: idx,
            confidence_score: MIN_CONFIDENCE + (idx === 0 ? 0.1 : 0),
            is_primary: idx === 0,
            is_verified: true,
          }));

          const { error: insertErr } = await supabase
            .from("product_images")
            .upsert(inserts, { onConflict: "product_id,image_url", ignoreDuplicates: true });

          if (!insertErr) {
            totalInserted += inserts.length;
          }
        }

        await markDone(supabase, item.id, "done");
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        await supabase
          .from("image_recrawl_queue")
          .update({
            status: (item.attempts ?? 0) >= 2 ? "failed" : "pending",
            attempts: (item.attempts ?? 0) + 1,
            last_error: errorMsg,
            updated_at: new Date().toISOString(),
          })
          .eq("id", item.id);
      }
    }

    return new Response(
      JSON.stringify({
        processed: queueItems.length,
        images_inserted: totalInserted,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("recrawl-product-images error:", err);
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function markDone(supabase: any, queueId: string, status: string) {
  await supabase
    .from("image_recrawl_queue")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", queueId);
}

function normalizeUrl(url: string, baseUrl: string): string | null {
  try {
    let abs = url.trim();
    if (!abs) return null;
    if (abs.startsWith("//")) abs = "https:" + abs;
    if (abs.startsWith("/")) {
      const base = new URL(baseUrl);
      abs = base.origin + abs;
    }
    const parsed = new URL(abs);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function baseDomain(host: string): string {
  const parts = host.toLowerCase().split(".");
  return parts.slice(-2).join(".");
}

function isAllowedImageHost(imageUrl: string, pageUrl: string): boolean {
  try {
    const ih = new URL(imageUrl).hostname.toLowerCase();
    const ph = new URL(pageUrl).hostname.toLowerCase();

    // Block known placeholder hosts
    if (/(picsum\.photos|placehold|placeholder|dummyimage|fakeimg|source\.unsplash\.com|lorempixel|unsplash)/i.test(ih)) return false;
    if (/(no[-_ ]?image|default[-_ ]?image|image[-_ ]?not[-_ ]?available|\blogo\b|\bicon\b|favicon|sprite|1x1|pixel\.gif)/i.test(imageUrl)) return false;
    if (!/^https?:\/\//i.test(imageUrl)) return false;

    // Same site
    if (baseDomain(ih) === baseDomain(ph)) return true;

    // CDN/Media host allowed if from product page
    if (/(cdn|img|images|media|static)/i.test(ih)) return true;

    return false;
  } catch {
    return false;
  }
}

async function verifyImage(url: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    // Try HEAD first
    let res = await fetch(url, {
      method: "HEAD",
      signal: controller.signal,
      headers: { "User-Agent": "ShkadAdil-ImageBot/1.0" },
    });
    clearTimeout(timeout);

    if (res.ok) {
      const ct = res.headers.get("content-type") || "";
      const len = Number(res.headers.get("content-length") || "0");
      if (ct.startsWith("image/") && (len === 0 || len >= 8192)) return true;
    }

    // Fallback: GET with Range header
    const controller2 = new AbortController();
    const timeout2 = setTimeout(() => controller2.abort(), 5000);
    res = await fetch(url, {
      method: "GET",
      signal: controller2.signal,
      headers: { Range: "bytes=0-2048", "User-Agent": "ShkadAdil-ImageBot/1.0" },
    });
    clearTimeout(timeout2);

    // Consume body to prevent resource leak
    await res.arrayBuffer();

    const ct = res.headers.get("content-type") || "";
    return (res.ok || res.status === 206) && ct.startsWith("image/");
  } catch {
    return false;
  }
}

function extractJsonLdImages(html: string): string[] {
  const results: string[] = [];
  const regex = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    try {
      const data = JSON.parse(match[1]);
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        if (item["@type"] === "Product" || item["@type"] === "product") {
          const img = item.image;
          if (typeof img === "string") results.push(img);
          else if (Array.isArray(img)) {
            for (const i of img) {
              if (typeof i === "string") results.push(i);
              else if (i?.url) results.push(String(i.url));
            }
          } else if (img?.url) results.push(String(img.url));
        }
      }
    } catch {
      // Invalid JSON-LD
    }
  }
  return results;
}

function extractOgImages(html: string): string[] {
  const results: string[] = [];
  const regex = /<meta[^>]+property\s*=\s*["']og:image["'][^>]+content\s*=\s*["']([^"']+)["']/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    results.push(match[1]);
  }
  // Also try reverse attribute order
  const regex2 = /<meta[^>]+content\s*=\s*["']([^"']+)["'][^>]+property\s*=\s*["']og:image["']/gi;
  while ((match = regex2.exec(html)) !== null) {
    results.push(match[1]);
  }
  return results;
}

function extractGalleryImages(html: string): string[] {
  const results: string[] = [];
  // Look for common product image patterns
  const regex = /<img[^>]+(?:src|data-src)\s*=\s*["']([^"']+)["'][^>]*>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    const url = match[1];
    if (
      url &&
      /\.(jpe?g|png|webp|avif)/i.test(url) &&
      !/logo|icon|favicon|avatar|badge|spinner|loading|tracking|pixel|1x1/i.test(url) &&
      !/picsum\.photos|placehold|dummyimage|fakeimg|placeholder|no[-_ ]?image|default[-_ ]?image|\blogo\b|\bicon\b|favicon|sprite|1x1|pixel\.gif/i.test(url)
    ) {
      results.push(url);
    }
  }
  return results.slice(0, 10); // Cap gallery candidates
}
