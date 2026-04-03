import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/lib/auth/AuthProvider', () => ({
  useAuth: () => ({
    user: { id: 'u1', email: 'u1@test.com' },
    profile: { display_name: 'User 1' },
    signOut: vi.fn(),
    loading: false,
    session: null,
  }),
}));

vi.mock('@/hooks/offers/useNotificationsRealtime', () => ({
  useNotificationsRealtime: vi.fn(),
}));

vi.mock('@/hooks/offers/useNotifications', () => ({
  useUnreadNotificationsCount: () => ({ data: 2 }),
  useNotifications: () => ({
    data: [
      {
        id: 'n1',
        title_ar: 'تنبيه سعر',
        body_ar: 'انخفض سعر المنتج',
        is_read: false,
        payload: { product_id: 'p1' },
        created_at: new Date().toISOString(),
      },
      {
        id: 'n2',
        title_ar: 'تنبيه ثاني',
        body_ar: 'سعر مناسب',
        is_read: true,
        payload: { product_id: 'p2' },
        created_at: new Date().toISOString(),
      },
    ],
  }),
  useMarkNotificationRead: () => ({ mutate: vi.fn() }),
}));

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: any) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children, asChild }: any) =>
    asChild ? children : <button>{children}</button>,
  DropdownMenuContent: ({ children }: any) => <div>{children}</div>,
  DropdownMenuLabel: ({ children }: any) => <div>{children}</div>,
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuItem: ({ children, onClick, asChild }: any) =>
    asChild ? children : <div role="menuitem" onClick={onClick}>{children}</div>,
}));

describe('Navbar Notifications Dropdown', () => {
  it('renders unread badge + latest notifications + "all notifications" link', async () => {
    const { default: AppNavbar } = await import('@/components/AppNavbar');

    render(
      <MemoryRouter>
        <AppNavbar />
      </MemoryRouter>,
    );

    expect(screen.getByTestId('navbar-notifications-button')).toBeInTheDocument();
    expect(screen.getByTestId('navbar-notifications-badge')).toHaveTextContent('2');

    expect(screen.getByText('تنبيه سعر')).toBeInTheDocument();
    expect(screen.getByText('تنبيه ثاني')).toBeInTheDocument();

    const allLink = screen.getByRole('link', { name: 'عرض كل الإشعارات' });
    expect(allLink).toHaveAttribute('href', '/notifications');
  });
});
