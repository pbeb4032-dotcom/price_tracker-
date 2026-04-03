import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const markReadFn = vi.fn();
const markAllFn = vi.fn();

// Global mocks for AppNavbar (rendered inside RTLLayout)
vi.mock('@/hooks/offers/useNotifications', () => ({
  useNotifications: () => ({ data: [], isLoading: false }),
  useUnreadNotificationsCount: () => ({ data: 0 }),
  useMarkNotificationRead: () => ({ mutate: vi.fn(), isPending: false }),
  useMarkAllNotificationsRead: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('@/hooks/offers/useNotificationsRealtime', () => ({
  useNotificationsRealtime: vi.fn(),
}));

describe('NotificationsPage', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('shows guest hint when unauthenticated', async () => {
    vi.doMock('@/lib/auth/AuthProvider', () => ({
      useAuth: () => ({ user: null, session: null, loading: false, signOut: vi.fn() }),
    }));

    const { default: NotificationsPage } = await import('@/pages/Notifications');
    render(
      <MemoryRouter>
        <NotificationsPage />
      </MemoryRouter>,
    );

    expect(screen.getByText('سجّل دخولك حتى تشوف إشعاراتك.')).toBeInTheDocument();
  });

  it('renders notification list for authenticated user', async () => {
    vi.doMock('@/lib/auth/AuthProvider', () => ({
      useAuth: () => ({ user: { id: 'u1' }, session: null, loading: false, signOut: vi.fn() }),
    }));
    vi.doMock('@/hooks/offers/useNotifications', () => ({
      useNotifications: () => ({
        data: [
          {
            id: 'n1',
            user_id: 'u1',
            type: 'price_alert_triggered',
            title_ar: 'انخفض سعر منتج',
            body_ar: 'السعر وصل لهدفك',
            payload: { product_id: 'p1', matched_price: 8000, target_price: 8500 },
            is_read: false,
            read_at: null,
            created_at: new Date().toISOString(),
          },
        ],
        isLoading: false,
      }),
      useUnreadNotificationsCount: () => ({ data: 1 }),
      useMarkNotificationRead: () => ({ mutate: markReadFn, isPending: false }),
      useMarkAllNotificationsRead: () => ({ mutate: markAllFn, isPending: false }),
    }));

    const { default: NotificationsPage } = await import('@/pages/Notifications');
    render(
      <MemoryRouter>
        <NotificationsPage />
      </MemoryRouter>,
    );

    expect(screen.getByText('انخفض سعر منتج')).toBeInTheDocument();
    expect(screen.getByText('جديد')).toBeInTheDocument();

    fireEvent.click(screen.getByText('تحديد كمقروء'));
    expect(markReadFn).toHaveBeenCalled();

    fireEvent.click(screen.getByText('تحديد الكل كمقروء'));
    expect(markAllFn).toHaveBeenCalled();

    const openProductLink = screen.getByRole('link', { name: 'فتح المنتج' });
    expect(openProductLink).toHaveAttribute('href', '/explore/p1');
  });
});
