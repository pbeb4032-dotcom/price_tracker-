import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const upsertFn = vi.fn();
const subscribeFn = vi.fn();
const unsubscribeFn = vi.fn();

vi.mock('@/hooks/offers/useNotifications', () => ({
  useNotifications: () => ({ data: [], isLoading: false }),
  useUnreadNotificationsCount: () => ({ data: 0 }),
  useMarkNotificationRead: () => ({ mutate: vi.fn(), isPending: false }),
  useMarkAllNotificationsRead: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('@/hooks/offers/useNotificationsRealtime', () => ({
  useNotificationsRealtime: vi.fn(),
}));

describe('SettingsPage', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('shows guest hint when unauthenticated', async () => {
    vi.doMock('@/lib/auth/AuthProvider', () => ({
      useAuth: () => ({ user: null, session: null, loading: false, signOut: vi.fn() }),
    }));
    vi.doMock('@/hooks/offers/useUserSettings', () => ({
      useUserSettings: () => ({ data: null }),
      useUpsertUserSettings: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
    }));
    vi.doMock('@/hooks/offers/useWebPush', () => ({
      useWebPush: () => ({ supported: true, subscribe: vi.fn(), unsubscribe: vi.fn() }),
    }));

    const { default: SettingsPage } = await import('@/pages/Settings');
    render(<MemoryRouter><SettingsPage /></MemoryRouter>);

    expect(screen.getByText('سجّل دخولك حتى تعدّل الإعدادات.')).toBeInTheDocument();
  });

  it('renders controls for authenticated user', async () => {
    vi.doMock('@/lib/auth/AuthProvider', () => ({
      useAuth: () => ({ user: { id: 'u1' }, session: null, loading: false, signOut: vi.fn() }),
    }));
    vi.doMock('@/hooks/offers/useUserSettings', () => ({
      useUserSettings: () => ({
        data: { user_id: 'u1', push_enabled: false, email_enabled: true, notifications_unread_only: false, quiet_hours_start: null, quiet_hours_end: null, timezone: 'Asia/Baghdad' },
      }),
      useUpsertUserSettings: () => ({ mutate: upsertFn, mutateAsync: upsertFn, isPending: false }),
    }));
    vi.doMock('@/hooks/offers/useWebPush', () => ({
      useWebPush: () => ({ supported: true, subscribe: subscribeFn, unsubscribe: unsubscribeFn }),
    }));

    const { default: SettingsPage } = await import('@/pages/Settings');
    render(<MemoryRouter><SettingsPage /></MemoryRouter>);

    expect(screen.getByText('إعدادات الإشعارات')).toBeInTheDocument();
    expect(screen.getByLabelText('إشعارات Push للمتصفح')).toBeInTheDocument();
    expect(screen.getByLabelText('إشعارات البريد الإلكتروني')).toBeInTheDocument();
    expect(screen.getByLabelText('عرض غير المقروء فقط افتراضياً')).toBeInTheDocument();
    expect(screen.getByText('حفظ وقت الهدوء')).toBeInTheDocument();
  });

  it('toggling unread-only calls upsert', async () => {
    vi.doMock('@/lib/auth/AuthProvider', () => ({
      useAuth: () => ({ user: { id: 'u1' }, session: null, loading: false, signOut: vi.fn() }),
    }));
    vi.doMock('@/hooks/offers/useUserSettings', () => ({
      useUserSettings: () => ({
        data: { user_id: 'u1', push_enabled: false, email_enabled: true, notifications_unread_only: false, quiet_hours_start: null, quiet_hours_end: null, timezone: 'Asia/Baghdad' },
      }),
      useUpsertUserSettings: () => ({ mutate: upsertFn, mutateAsync: upsertFn, isPending: false }),
    }));
    vi.doMock('@/hooks/offers/useWebPush', () => ({
      useWebPush: () => ({ supported: true, subscribe: subscribeFn, unsubscribe: unsubscribeFn }),
    }));

    const { default: SettingsPage } = await import('@/pages/Settings');
    render(<MemoryRouter><SettingsPage /></MemoryRouter>);

    fireEvent.click(screen.getByLabelText('عرض غير المقروء فقط افتراضياً'));
    expect(upsertFn).toHaveBeenCalledWith({ notifications_unread_only: true });
  });
});
