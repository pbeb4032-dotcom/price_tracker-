export function clampInt(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

/**
 * Compute a stable render queue priority for a URL.
 *
 * Goals:
 * - Prefer product detail pages over listings/home.
 * - Deprioritize obvious non-HTML assets and cart/checkout/account flows.
 * - Keep within [0,100] and remain cheap (no network, no DB).
 */
export function computeRenderPriority(url: string, basePriority: number = 10): number {
  const u = String(url || '').trim().toLowerCase();
  let p = Number(basePriority ?? 10);

  if (!u) return clampInt(p, 0, 100);

  // Non-HTML assets rarely need Playwright render.
  if (/(\.(png|jpe?g|webp|gif|svg|ico|css|js|mjs|map|json|xml|pdf|zip|rar|7z))(\?|#|$)/i.test(u)) {
    return clampInt(Math.min(p, 5), 0, 100);
  }

  // Avoid wasting render budget on auth/checkout flows.
  if (
    /(\/cart\b|\/checkout\b|\/account\b|\/login\b|\/register\b|\/wp-admin\b)/.test(u) ||
    /add-to-cart/.test(u)
  ) {
    return 0;
  }

  // Product detail patterns (multi-platform): /product, /p/, /item/, sku=, dp/product, etc.
  const isProduct =
    /(\/product\b|\/products\b|\/p\/|\/item\/|\/sku\/|\bproduct_id=|\bsku=|\bprod=|\/dp\/|\/gp\/product\b|\/itm\/)/.test(u) ||
    /\b(product|details|detail)\b/.test(u);

  // Category/listing/search patterns.
  const isListing =
    /(\/category\b|\/categories\b|\/cat\/|\/shop\b|\/store\b|\/collections\b|\/search\b|\bcategory=|\bcat=|\bs=|[?&]page=\d+|[?&]p=\d+)/.test(u);

  if (isProduct) p += 50;
  else if (isListing) p += 20;

  // Often product pages have an ID-ish tail.
  if (/\/(\d{4,})(\.html)?(\?|#|$)/.test(u)) p += 8;

  return clampInt(p, 0, 100);
}
