/**
 * firecrawl-scrape — DEPRECATED (P4.0)
 * This function is no longer used. All scraping is handled by direct-scraper
 * and ingest-product-pages using direct HTTP fetch + deterministic extraction.
 * Kept as a stub to avoid deployment errors from existing cron references.
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
      message: "firecrawl-scrape is deprecated. Use direct-scraper instead.",
    }),
    {
      status: 410,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    }
  );
});
