/**
 * Shkad Aadel — Unified App Navbar
 *
 * Arabic RTL navbar with mobile hamburger support.
 * Active link highlighting via NavLink. Accessible.
 */

import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Menu, LogOut, User, Sun, Moon, Bell } from 'lucide-react';
import { useTheme } from 'next-themes';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/lib/auth/AuthProvider';
import { useIsAdmin } from '@/hooks/auth/useIsAdmin';
import {
  useNotifications,
  useUnreadNotificationsCount,
  useMarkNotificationRead,
} from '@/hooks/offers/useNotifications';
import { useNotificationsRealtime } from '@/hooks/offers/useNotificationsRealtime';

interface NavItem {
  label: string;
  href: string;
  routeKey: string;
  authRequired?: boolean;
  guestOnly?: boolean;
  adminOnly?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { label: 'الرئيسية', href: '/', routeKey: 'home' },
  { label: 'استكشاف الأسعار', href: '/explore', routeKey: 'explore' },
  { label: 'مقارنة المنتجات', href: '/explore/compare', routeKey: 'compare' },
  { label: 'مسح QR', href: '/scan', routeKey: 'scan' },
  { label: 'الأسعار الموثّقة', href: '/prices', routeKey: 'prices' },
  { label: 'لوحة التحكم', href: '/dashboard', routeKey: 'dashboard', authRequired: true },
  { label: 'قائمة المراقبة', href: '/watchlist', routeKey: 'watchlist', authRequired: true },
  { label: 'سجّل سعر', href: '/report-price', routeKey: 'report-price', authRequired: true },
  { label: 'الإعدادات', href: '/settings', routeKey: 'settings', authRequired: true },
  { label: 'الإدارة', href: '/admin', routeKey: 'admin', authRequired: true, adminOnly: true },
  { label: 'تسجيل الدخول', href: '/sign-in', routeKey: 'sign-in', guestOnly: true },
  { label: 'إنشاء حساب', href: '/sign-up', routeKey: 'sign-up', guestOnly: true },
];

export { NAV_ITEMS };
export type { NavItem };

export default function AppNavbar() {
  const { user, profile, signOut } = useAuth();
  const { data: isAdmin = false } = useIsAdmin(user?.id);
  const { theme, setTheme } = useTheme();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

  const { data: unreadCount = 0 } = useUnreadNotificationsCount(user?.id);
  const { data: latestNotifications = [] } = useNotifications({
    userId: user?.id,
    limit: 5,
    unreadOnly: false,
  });
  const markRead = useMarkNotificationRead();
  useNotificationsRealtime(user?.id);

  const toggleTheme = () => setTheme(theme === 'dark' ? 'light' : 'dark');

  const isActive = (href: string) => {
    if (href === '/') return location.pathname === '/';
    // Exact match for specific sub-routes to avoid parent highlighting
    if (href === '/explore') return location.pathname === '/explore';
    return location.pathname.startsWith(href);
  };

  const visibleItems = NAV_ITEMS.filter((item) => {
    if (item.authRequired && !user) return false;
    if (item.guestOnly && user) return false;
    if (item.adminOnly && !isAdmin) return false;
    return true;
  });

  const handleSignOut = async () => {
    await signOut();
    setMobileOpen(false);
  };

  const linkClasses = (href: string) =>
    cn(
      'px-3 py-2 rounded-md text-sm font-medium transition-colors',
      isActive(href)
        ? 'bg-primary/10 text-primary font-bold'
        : 'text-muted-foreground hover:text-foreground hover:bg-muted',
    );

  return (
    <nav
      data-testid="app-navbar"
      className="sticky top-0 z-40 border-b border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80"
    >
      <div className="container mx-auto px-4 md:px-6 lg:px-8">
        <div className="flex h-14 items-center justify-between">
          {/* Brand */}
          <Link
            to="/"
            className="font-display text-xl font-bold text-foreground hover:text-primary transition-colors"
          >
            شكد عادل
          </Link>

          {/* Desktop nav */}
          <div className="hidden md:flex items-center gap-1">
            {visibleItems.map((item) => (
              <Link
                key={item.href}
                to={item.href}
                data-testid={`navbar-link-${item.routeKey}`}
                className={linkClasses(item.href)}
              >
                {item.label}
              </Link>
            ))}

            {/* Theme toggle */}
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? 'تبديل إلى الوضع الفاتح' : 'تبديل إلى الوضع الداكن'}
              data-testid="theme-toggle"
              className="h-9 w-9"
            >
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>

            {/* Notifications bell */}
            {user && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-9 w-9 relative" aria-label="الإشعارات" data-testid="navbar-notifications-button">
                    <Bell className="h-4 w-4" />
                    {unreadCount > 0 && (
                      <Badge
                        variant="destructive"
                        data-testid="navbar-notifications-badge"
                        className="absolute -top-1 -end-1 h-4 min-w-4 px-1 text-[10px] flex items-center justify-center"
                      >
                        {unreadCount > 99 ? '99+' : unreadCount}
                      </Badge>
                    )}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-72">
                  <div className="px-3 py-2">
                    <p className="text-sm font-medium text-foreground">الإشعارات</p>
                  </div>
                  <DropdownMenuSeparator />
                  {latestNotifications.length === 0 ? (
                    <div className="px-3 py-4 text-center text-sm text-muted-foreground">
                      ماكو إشعارات حالياً
                    </div>
                  ) : (
                    latestNotifications.map((n) => (
                      <DropdownMenuItem
                        key={n.id}
                        className="flex flex-col items-start gap-1 cursor-pointer"
                        onClick={() => {
                          if (!n.is_read && user?.id) {
                            markRead.mutate({ id: n.id, userId: user.id });
                          }
                          const productId = n.payload?.product_id as string | undefined;
                          if (productId) navigate(`/explore/${productId}`);
                        }}
                      >
                        <span className={cn('text-xs', !n.is_read && 'font-bold')}>
                          {n.title_ar}
                        </span>
                        <span className="text-xs text-muted-foreground line-clamp-2">
                          {n.body_ar}
                        </span>
                      </DropdownMenuItem>
                    ))
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <Link to="/notifications" className="w-full text-center text-xs text-primary justify-center">
                      عرض كل الإشعارات
                    </Link>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {user && (
              <div className="flex items-center gap-2 ms-4 border-s border-border ps-4">
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <User className="h-3 w-3" />
                  {profile?.display_name || user.email}
                </span>
                <Button variant="ghost" size="sm" onClick={handleSignOut} className="gap-1 text-xs">
                  <LogOut className="h-3 w-3" />
                  خروج
                </Button>
              </div>
            )}
          </div>

          {/* Mobile hamburger */}
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="md:hidden"
                aria-label="فتح القائمة"
                data-testid="navbar-mobile-toggle"
              >
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-72" data-testid="navbar-mobile-sheet">
              <SheetHeader>
                <SheetTitle className="font-display text-lg text-start">شكد عادل</SheetTitle>
              </SheetHeader>

              <div className="flex flex-col gap-1 mt-6">
                {visibleItems.map((item) => (
                  <Link
                    key={item.href}
                    to={item.href}
                    data-testid={`navbar-link-${item.routeKey}`}
                    onClick={() => setMobileOpen(false)}
                    className={cn(
                      'px-4 py-3 rounded-md text-sm font-medium transition-colors',
                      isActive(item.href)
                        ? 'bg-primary/10 text-primary font-bold'
                        : 'text-foreground hover:bg-muted',
                    )}
                  >
                    {item.label}
                  </Link>
                ))}
                {/* Mobile theme toggle */}
                <button
                  onClick={toggleTheme}
                  data-testid="theme-toggle-mobile"
                  className="px-4 py-3 rounded-md text-sm font-medium text-foreground hover:bg-muted transition-colors flex items-center gap-2"
                >
                  {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                  {theme === 'dark' ? 'الوضع الفاتح' : 'الوضع الداكن'}
                </button>
              </div>

              {user && (
                <div className="mt-6 pt-4 border-t border-border">
                  <div className="flex items-center gap-2 px-4 mb-3">
                    <User className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground truncate">
                      {profile?.display_name || user.email}
                    </span>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleSignOut}
                    className="w-full gap-2"
                  >
                    <LogOut className="h-4 w-4" />
                    تسجيل الخروج
                  </Button>
                </div>
              )}
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </nav>
  );
}
