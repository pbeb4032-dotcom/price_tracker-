import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/lib/auth/AuthProvider', () => ({
  useAuth: () => ({
    user: { id: 'u1', email: 'test@test.com' },
    profile: { display_name: 'تست' },
    session: null,
    loading: false,
    signOut: vi.fn(),
  }),
}));

vi.mock('@/hooks/offers/useNotificationsRealtime', () => ({
  useNotificationsRealtime: vi.fn(),
}));

vi.mock('@/hooks/offers/useNotifications', () => ({
  useUnreadNotificationsCount: () => ({ data: 3 }),
  useNotifications: () => ({
    data: [
      {
        id: 'n1',
        title_ar: 'تنبيه سعر',
        body_ar: 'انخفض السعر',
        is_read: false,
        payload: { product_id: 'p1' },
        created_at: new Date().toISOString(),
      },
    ],
  }),
  useMarkNotificationRead: () => ({ mutate: vi.fn() }),
}));

describe('AppNavbar notifications', () => {
  it('shows notifications bell with unread badge', async () => {
    const { default: AppNavbar } = await import('@/components/AppNavbar');
    render(
      <MemoryRouter>
        <AppNavbar />
      </MemoryRouter>,
    );

    const bellButton = screen.getByTestId('navbar-notifications-button');
    expect(bellButton).toBeInTheDocument();

    const badge = screen.getByTestId('navbar-notifications-badge');
    expect(badge).toHaveTextContent('3');
  });

  it('uses useNotificationsRealtime hook', async () => {
    const { useNotificationsRealtime } = await import('@/hooks/offers/useNotificationsRealtime');
    const { default: AppNavbar } = await import('@/components/AppNavbar');
    render(
      <MemoryRouter>
        <AppNavbar />
      </MemoryRouter>,
    );

    expect(useNotificationsRealtime).toHaveBeenCalledWith('u1');
  });
});
