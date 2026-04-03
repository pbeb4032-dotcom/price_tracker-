/**
 * ReportPrice SEO integration test.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

vi.mock('@/lib/auth/AuthProvider', () => ({
  useAuth: () => ({
    user: { id: 'u1', email: 'test@test.com' },
    session: null,
    profile: { display_name: 'Test' },
    loading: false,
    initialized: true,
    signUp: vi.fn(),
    signIn: vi.fn(),
    signOut: vi.fn(),
  }),
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

const chainable = () => {
  const obj: Record<string, unknown> = { data: [], error: null };
  const proxy = new Proxy(obj, {
    get(target, prop) {
      if (prop === 'then') return undefined;
      if (prop in target) return target[prop as string];
      return () => proxy;
    },
  });
  return proxy;
};

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => chainable(),
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }),
      getSession: () => Promise.resolve({ data: { session: null }, error: null }),
    },
    channel: () => ({
      on: () => ({ subscribe: () => ({ unsubscribe: vi.fn() }) }),
    }),
    removeChannel: vi.fn(),
  },
}));

vi.mock('next-themes', () => ({
  useTheme: () => ({ theme: 'light', setTheme: vi.fn() }),
  ThemeProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

import ReportPrice from '@/pages/ReportPrice';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const renderWithProviders = (ui: ReactNode) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
};

describe('ReportPrice SEO metadata', () => {
  afterEach(() => {
    cleanup();
    document.title = '';
    document.querySelectorAll('meta[name="robots"]').forEach((el) => el.remove());
    document.querySelectorAll('meta[name="description"]').forEach((el) => el.remove());
  });

  it('sets correct Arabic title', () => {
    renderWithProviders(<ReportPrice />);
    expect(document.title).toContain('الإبلاغ عن سعر جديد');
  });

  it('sets description meta', () => {
    renderWithProviders(<ReportPrice />);
    const meta = document.querySelector('meta[name="description"]');
    expect(meta).toBeTruthy();
    expect(meta?.getAttribute('content')).toContain('سعر منتج موثّق');
  });

  it('sets noindex for private form', () => {
    renderWithProviders(<ReportPrice />);
    const robots = document.querySelector('meta[name="robots"]');
    expect(robots).toBeTruthy();
    expect(robots?.getAttribute('content')).toContain('noindex');
  });
});
