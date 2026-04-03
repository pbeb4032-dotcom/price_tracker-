/**
 * smart-image-discovery — DEPRECATED (Free-only build)
 *
 * This function previously relied on paid search/scrape services.
 * The production (free) path is:
 *   - Extract images from real source pages during ingestion
 *   - Then verify/recrawl via recrawl-product-images
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
        "smart-image-discovery is disabled in the free build. Use recrawl-product-images instead.",
    }),
    {
      status: 410,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
});
