/**
 * Integration tests: Dark Mode rendering + SEO hook behavior.
 * Renders actual page components with mocked providers.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

// ---- Mock providers ----

const mockAuth = {
  user: null as { id: string; email: string } | null,
  session: null,
  profile: null,
  loading: false,
  initialized: true,
  signUp: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
};

vi.mock('@/lib/auth/AuthProvider', () => ({
  useAuth: () => mockAuth,
  AuthProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('@/lib/telemetry', () => ({
  useTelemetry: () => ({
    trackEvent: vi.fn(),
    trackError: vi.fn(),
    setUser: vi.fn(),
  }),
  TelemetryProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        order: () => ({ data: [], error: null }),
        eq: () => ({
          data: [],
          error: null,
          maybeSingle: () => ({ data: null, error: null }),
        }),
        in: () => ({ data: [], error: null }),
      }),
    }),
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }),
      getSession: () => Promise.resolve({ data: { session: null }, error: null }),
    },
  },
}));

vi.mock('next-themes', () => ({
  useTheme: () => ({ theme: 'dark', setTheme: vi.fn() }),
  ThemeProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

// ---- Imports (after mocks) ----
import Index from '@/pages/Index';
import NotFound from '@/pages/NotFound';
import SignIn from '@/pages/SignIn';
import SignUp from '@/pages/SignUp';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ---- Helpers ----

function renderPage(component: ReactNode, route = '/') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[route]}>
        {component}
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ---- PATCH 1A: Dark mode rendering tests ----

describe('Dark mode integration — pages render with semantic tokens', () => {
  beforeEach(() => {
    document.documentElement.classList.add('dark');
    mockAuth.user = null;
    mockAuth.initialized = true;
    mockAuth.loading = false;
  });

  afterEach(() => {
    document.documentElement.classList.remove('dark');
    cleanup();
  });

  it('Index page renders key content in dark mode', () => {
    const { container } = renderPage(<Index />);
    // Hero text visible
    expect(container.textContent).toContain('شكد عادل');
    expect(container.textContent).toContain('ذكاء الأسعار العادلة في العراق');
    // No hardcoded bg-white or text-black classes
    const allElements = container.querySelectorAll('*');
    allElements.forEach((el) => {
      const cls = el.className;
      if (typeof cls === 'string') {
        expect(cls).not.toMatch(/\bbg-white\b/);
        expect(cls).not.toMatch(/\btext-black\b/);
      }
    });
  });

  it('NotFound page renders key content in dark mode', () => {
    const { container } = renderPage(<NotFound />);
    expect(container.textContent).toContain('٤٠٤');
    expect(container.textContent).toContain('عذراً، الصفحة غير موجودة');
    expect(container.textContent).toContain('العودة للرئيسية');
  });

  it('SignIn page renders form controls in dark mode', () => {
    const { container } = renderPage(<SignIn />, '/sign-in');
    expect(container.textContent).toContain('تسجيل الدخول');
    // Form should have input elements
    const inputs = container.querySelectorAll('input');
    expect(inputs.length).toBeGreaterThanOrEqual(2);
  });

  it('SignUp page renders form controls in dark mode', () => {
    const { container } = renderPage(<SignUp />, '/sign-up');
    expect(container.textContent).toContain('إنشاء حساب جديد');
    const inputs = container.querySelectorAll('input');
    expect(inputs.length).toBeGreaterThanOrEqual(3);
  });
});

// ---- PATCH 1B: SEO hook integration tests ----

describe('SEO metadata integration', () => {
  afterEach(() => {
    cleanup();
    // Reset title
    document.title = '';
    document.querySelectorAll('meta[name="robots"]').forEach((el) => el.remove());
    document.querySelectorAll('meta[name="description"]').forEach((el) => el.remove());
    document.querySelectorAll('meta[property="og:title"]').forEach((el) => el.remove());
    document.querySelectorAll('meta[property="og:description"]').forEach((el) => el.remove());
  });

  it('Index page sets correct title', () => {
    renderPage(<Index />);
    expect(document.title).toBe('شكد عادل');
  });

  it('Index page sets description meta', () => {
    renderPage(<Index />);
    const meta = document.querySelector('meta[name="description"]');
    expect(meta).toBeTruthy();
    expect(meta?.getAttribute('content')).toContain('منصة مجتمعية');
  });

  it('Index page does NOT set noindex', () => {
    renderPage(<Index />);
    const robots = document.querySelector('meta[name="robots"]');
    expect(robots).toBeNull();
  });

  it('SignIn page sets noindex', () => {
    renderPage(<SignIn />, '/sign-in');
    const robots = document.querySelector('meta[name="robots"]');
    expect(robots).toBeTruthy();
    expect(robots?.getAttribute('content')).toContain('noindex');
  });

  it('SignUp page sets noindex', () => {
    renderPage(<SignUp />, '/sign-up');
    const robots = document.querySelector('meta[name="robots"]');
    expect(robots).toBeTruthy();
    expect(robots?.getAttribute('content')).toContain('noindex');
  });

  it('NotFound page sets noindex', () => {
    renderPage(<NotFound />);
    const robots = document.querySelector('meta[name="robots"]');
    expect(robots).toBeTruthy();
    expect(robots?.getAttribute('content')).toContain('noindex');
  });

  it('NotFound page sets correct title', () => {
    renderPage(<NotFound />);
    expect(document.title).toContain('الصفحة غير موجودة');
  });

  it('SEO cleanup resets title on unmount', () => {
    const { unmount } = renderPage(<NotFound />);
    expect(document.title).toContain('الصفحة غير موجودة');
    unmount();
    expect(document.title).toBe('شكد عادل — ذكاء الأسعار العادلة في العراق');
  });
});
