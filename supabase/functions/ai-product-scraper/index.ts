/**
 * ai-product-scraper — DEPRECATED (Free-only build)
 *
 * This repo intentionally ships without paid scraping / AI extraction.
 *
 * Use the free pipeline instead:
 *   1) seed-crawl-frontier
 *   2) ingest-product-pages
 *   3) recrawl-product-images (optional)
 *
 * Keeping this function as a stub avoids breaking existing cron references.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  return new Response(
    JSON.stringify({
      success: false,
      deprecated: true,
      message:
        "ai-product-scraper is disabled in the free build. Use seed-crawl-frontier + ingest-product-pages instead.",
    }),
    {
      status: 410,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
});
