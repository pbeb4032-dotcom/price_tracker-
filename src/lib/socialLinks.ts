/**
 * Social media links — single source of truth.
 * 
 * Reads URLs from VITE_SOCIAL_* env vars with safe validation.
 * Only http/https absolute URLs are accepted; everything else falls back to '#'.
 */

export type SocialKey = 'telegram' | 'instagram' | 'facebook' | 'tiktok';

export interface SocialLinkDef {
  key: SocialKey;
  label: string;
  envKey:
    | 'VITE_SOCIAL_TELEGRAM_URL'
    | 'VITE_SOCIAL_INSTAGRAM_URL'
    | 'VITE_SOCIAL_FACEBOOK_URL'
    | 'VITE_SOCIAL_TIKTOK_URL';
}

export interface SocialLink {
  key: SocialKey;
  label: string;
  href: string;
  testId: string;
}

export const SOCIAL_LINK_DEFS: SocialLinkDef[] = [
  { key: 'telegram', label: 'تيليغرام', envKey: 'VITE_SOCIAL_TELEGRAM_URL' },
  { key: 'instagram', label: 'إنستغرام', envKey: 'VITE_SOCIAL_INSTAGRAM_URL' },
  { key: 'facebook', label: 'فيسبوك', envKey: 'VITE_SOCIAL_FACEBOOK_URL' },
  { key: 'tiktok', label: 'تيك توك', envKey: 'VITE_SOCIAL_TIKTOK_URL' },
];

/**
 * Validate a URL string: only http/https absolute URLs pass.
 * Returns the URL if valid, otherwise '#'.
 */
export function resolveSocialUrl(raw: string | undefined): string {
  if (!raw || typeof raw !== 'string') return '#';
  const trimmed = raw.trim();
  if (!trimmed) return '#';
  try {
    const url = new URL(trimmed);
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return trimmed;
    }
    return '#';
  } catch {
    return '#';
  }
}

/** Build the social links array from current env vars. */
export function getSocialLinks(): SocialLink[] {
  return SOCIAL_LINK_DEFS.map((d) => ({
    key: d.key,
    label: d.label,
    href: resolveSocialUrl(import.meta.env[d.envKey]),
    testId: `footer-social-${d.key}`,
  }));
}
