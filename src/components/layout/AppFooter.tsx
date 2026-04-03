/**
 * Shkad Aadel — Shared App Footer
 * 
 * RTL-friendly, dark/light semantic tokens only.
 * Renders consistently across all pages using RTLLayout.
 */

import { Link } from 'react-router-dom';
import { Send, Instagram, Facebook } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getSocialLinks } from '@/lib/socialLinks';
import type { SocialKey } from '@/lib/socialLinks';

/** TikTok icon — not available in lucide-react */
function TikTokIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M9 12a4 4 0 1 0 4 4V4a5 5 0 0 0 5 5" />
    </svg>
  );
}

const SOCIAL_ICONS: Record<SocialKey, React.ComponentType<{ className?: string }>> = {
  telegram: (props) => <Send {...props} aria-hidden="true" />,
  instagram: (props) => <Instagram {...props} aria-hidden="true" />,
  facebook: (props) => <Facebook {...props} aria-hidden="true" />,
  tiktok: TikTokIcon,
};

const FOOTER_LINKS = [
  { label: 'الرئيسية', href: '/', testId: 'footer-link-home' },
  { label: 'الأسعار الموثّقة', href: '/prices', testId: 'footer-link-prices' },
  { label: 'لوحة التحكم', href: '/dashboard', testId: 'footer-link-dashboard' },
] as const;

export default function AppFooter() {
  const SOCIAL_LINKS = getSocialLinks();
  return (
    <footer
      className="border-t border-border bg-card mt-auto"
      data-testid="app-footer"
    >
      <div className="container mx-auto px-4 md:px-6 lg:px-8 py-6">
        <div className="flex flex-col items-center gap-4 md:flex-row md:justify-between">
          {/* Brand */}
          <div className="font-display text-lg font-bold text-foreground">
            شكد عادل
          </div>

          {/* Nav links */}
          <nav aria-label="تذييل الصفحة" className="flex flex-wrap items-center justify-center gap-3 sm:gap-4">
            {FOOTER_LINKS.map((link) => (
              <Link
                key={link.href}
                to={link.href}
                data-testid={link.testId}
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                {link.label}
              </Link>
            ))}
          </nav>

          {/* Social links */}
          <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-3" data-testid="footer-social-links">
            {SOCIAL_LINKS.map((s) => {
              const Icon = SOCIAL_ICONS[s.key];
              const disabled = s.href === '#';
              return (
                <a
                  key={s.key}
                  href={s.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`حساب ${s.label}`}
                  aria-disabled={disabled || undefined}
                  tabIndex={disabled ? -1 : 0}
                  data-testid={s.testId}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted-foreground",
                    "transition-all duration-200 ease-out",
                    "hover:text-primary hover:scale-110 hover:-translate-y-0.5",
                    "active:scale-95",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                    "motion-reduce:transform-none motion-reduce:transition-none",
                    disabled && "pointer-events-none opacity-50"
                  )}
                >
                  {Icon && <Icon className="h-4 w-4" />}
                  {s.label}
                </a>
              );
            })}
          </div>

          {/* Copyright */}
          <p className="text-muted-foreground text-xs text-center">
            © {new Date().getFullYear()} شكد عادل — ذكاء الأسعار العادلة في العراق
          </p>
        </div>
      </div>
    </footer>
  );
}
