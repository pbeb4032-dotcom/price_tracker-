/**
 * Footer component tests — structure, social links, data-testids, mobile viewports.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AppFooter from '@/components/layout/AppFooter';

function renderFooter() {
  return render(
    <MemoryRouter>
      <AppFooter />
    </MemoryRouter>,
  );
}

describe('AppFooter — structure and data-testids', () => {
  it('renders footer with data-testid="app-footer"', () => {
    renderFooter();
    expect(screen.getByTestId('app-footer')).toBeInTheDocument();
  });

  it('renders nav links with correct testids', () => {
    renderFooter();
    expect(screen.getByTestId('footer-link-home')).toBeInTheDocument();
    expect(screen.getByTestId('footer-link-prices')).toBeInTheDocument();
    expect(screen.getByTestId('footer-link-dashboard')).toBeInTheDocument();
  });

  it('nav links have correct hrefs', () => {
    renderFooter();
    expect(screen.getByTestId('footer-link-home')).toHaveAttribute('href', '/');
    expect(screen.getByTestId('footer-link-prices')).toHaveAttribute('href', '/prices');
    expect(screen.getByTestId('footer-link-dashboard')).toHaveAttribute('href', '/dashboard');
  });

  it('renders copyright text', () => {
    renderFooter();
    const year = new Date().getFullYear().toString();
    expect(screen.getByText(new RegExp(year))).toBeInTheDocument();
  });
});

describe('AppFooter — social links', () => {
  const SOCIAL_IDS = [
    'footer-social-telegram',
    'footer-social-instagram',
    'footer-social-facebook',
    'footer-social-tiktok',
  ] as const;

  it('renders all social link testids', () => {
    renderFooter();
    for (const id of SOCIAL_IDS) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
  });

  it('social links have target="_blank" and rel="noopener noreferrer"', () => {
    renderFooter();
    for (const id of SOCIAL_IDS) {
      const el = screen.getByTestId(id);
      expect(el).toHaveAttribute('target', '_blank');
      expect(el).toHaveAttribute('rel', 'noopener noreferrer');
    }
  });

  it('social links have Arabic aria-labels', () => {
    renderFooter();
    for (const id of SOCIAL_IDS) {
      const el = screen.getByTestId(id);
      expect(el.getAttribute('aria-label')).toMatch(/حساب/);
    }
  });

  it('social links fallback to "#" when env vars not set', () => {
    renderFooter();
    for (const id of SOCIAL_IDS) {
      const el = screen.getByTestId(id);
      // In test env, env vars are not set, so href should be '#'
      expect(el.getAttribute('href')).toBe('#');
    }
  });

  it('social links container has data-testid="footer-social-links"', () => {
    renderFooter();
    expect(screen.getByTestId('footer-social-links')).toBeInTheDocument();
  });
});

describe('AppFooter — mobile viewport simulation', () => {
  // These tests verify the footer DOM renders correctly at any viewport.
  // Actual CSS layout is not testable in jsdom, but we verify structure integrity.
  const VIEWPORTS = [320, 360, 375, 390, 412, 768];

  for (const width of VIEWPORTS) {
    it(`renders all elements at ${width}px viewport`, () => {
      // Simulate viewport width via matchMedia (already mocked in setup.ts)
      Object.defineProperty(window, 'innerWidth', { value: width, writable: true });
      window.dispatchEvent(new Event('resize'));

      renderFooter();
      expect(screen.getByTestId('app-footer')).toBeInTheDocument();
      expect(screen.getByTestId('footer-link-home')).toBeInTheDocument();
      expect(screen.getByTestId('footer-link-prices')).toBeInTheDocument();
      expect(screen.getByTestId('footer-social-telegram')).toBeInTheDocument();
      expect(screen.getByTestId('footer-social-tiktok')).toBeInTheDocument();
    });
  }
});

describe('AppFooter — semantic tokens (no hardcoded colors)', () => {
  it('footer uses bg-card and border-border classes', () => {
    renderFooter();
    const footer = screen.getByTestId('app-footer');
    expect(footer.className).toContain('bg-card');
    expect(footer.className).toContain('border-border');
  });

  it('links use text-muted-foreground class', () => {
    renderFooter();
    const link = screen.getByTestId('footer-link-home');
    expect(link.className).toContain('text-muted-foreground');
  });
});

describe('AppFooter — social link hover animations', () => {
  const HOVER_CLASSES = [
    'hover:text-primary',
    'hover:scale-110',
    'hover:-translate-y-0.5',
    'active:scale-95',
    'motion-reduce:transform-none',
  ];

  it('social links have hover animation classes', () => {
    renderFooter();
    const el = screen.getByTestId('footer-social-telegram');
    for (const cls of HOVER_CLASSES) {
      expect(el.className, `Missing class "${cls}"`).toContain(cls);
    }
  });

  it('social links have focus-visible ring', () => {
    renderFooter();
    const el = screen.getByTestId('footer-social-instagram');
    expect(el.className).toContain('focus-visible:ring-2');
    expect(el.className).toContain('focus-visible:ring-primary/40');
  });

  it('social links with "#" href are disabled (pointer-events-none + opacity-50)', () => {
    renderFooter();
    // In test env, env vars are not set → href="#" → disabled
    const el = screen.getByTestId('footer-social-telegram');
    expect(el.className).toContain('pointer-events-none');
    expect(el.className).toContain('opacity-50');
    expect(el.getAttribute('aria-disabled')).toBe('true');
    expect(el.getAttribute('tabindex')).toBe('-1');
  });
});
