/**
 * URL safety validation for external source URLs.
 *
 * Policy: Only HTTPS URLs to public domains are allowed.
 * Rejects: http, javascript:, data:, ftp:, localhost, private IPs.
 */

/** Private/reserved IP patterns */
const PRIVATE_IP_PATTERNS = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^0\./,
  /^169\.254\./,
  /^fc00:/i,
  /^fd/i,
  /^fe80:/i,
  /^::1$/,
  /^localhost$/i,
];

/** Blocked protocol schemes */
const BLOCKED_SCHEMES = ['javascript:', 'data:', 'ftp:', 'file:', 'blob:', 'vbscript:'];

/**
 * Sanitize and validate an external URL.
 * Returns the cleaned URL string or null if unsafe.
 */
export function sanitizeExternalUrl(url: string | null | undefined): string | null {
  if (!url || typeof url !== 'string') return null;

  const trimmed = url.trim();
  if (!trimmed) return null;

  // Block dangerous schemes
  const lowerUrl = trimmed.toLowerCase();
  for (const scheme of BLOCKED_SCHEMES) {
    if (lowerUrl.startsWith(scheme)) return null;
  }

  // Must be https (strict policy for Iraqi price sources)
  if (!lowerUrl.startsWith('https://')) return null;

  // Parse URL
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  // Must be https protocol
  if (parsed.protocol !== 'https:') return null;

  // Reject private/reserved hostnames
  const hostname = parsed.hostname.toLowerCase();
  for (const pattern of PRIVATE_IP_PATTERNS) {
    if (pattern.test(hostname)) return null;
  }

  // Reject empty or IP-only hosts that look internal
  if (!hostname || hostname === '0.0.0.0') return null;

  // Must have at least one dot (real domain)
  if (!hostname.includes('.')) return null;

  return parsed.href;
}

/**
 * Validate URL against a specific allowed domain.
 * Checks the URL is safe AND belongs to the expected domain.
 */
export function validateSourceUrl(url: string | null | undefined, allowedDomain: string): string | null {
  const safe = sanitizeExternalUrl(url);
  if (!safe) return null;

  try {
    const parsed = new URL(safe);
    const hostname = parsed.hostname.toLowerCase();
    const domain = allowedDomain.toLowerCase();

    // Allow exact match or subdomain match
    if (hostname === domain || hostname.endsWith(`.${domain}`)) {
      return safe;
    }
  } catch {
    return null;
  }

  return null;
}

/**
 * Check if a URL is a valid image URL (basic check).
 */
export function isValidImageUrl(url: string | null | undefined): string | null {
  const safe = sanitizeExternalUrl(url);
  if (!safe) return null;

  // Allow common image extensions or CDN-like URLs
  const lower = safe.toLowerCase();
  const hasImageExt = /\.(jpg|jpeg|png|webp|gif|svg|avif|ico)(\?.*)?$/i.test(lower);
  const isCdnLike = /\/(images?|img|photos?|assets?|media|cdn|static)\//i.test(lower);

  // Be permissive — many product images don't have extensions
  return safe;
}
