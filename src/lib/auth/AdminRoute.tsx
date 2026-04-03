import { Navigate, useLocation } from 'react-router-dom';
import { Loader2, ShieldAlert } from 'lucide-react';
import { useAuth } from '@/lib/auth/AuthProvider';
import { useIsAdmin } from '@/hooks/auth/useIsAdmin';
import { Button } from '@/components/ui/button';
import { RTLLayout, PageContainer } from '@/components/layout';

export function AdminRoute({ children }: { children: React.ReactNode }) {
  const { user, loading, initialized } = useAuth();
  const location = useLocation();
  const { data: isAdmin, isLoading } = useIsAdmin(user?.id);

  if (!initialized || loading || isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background" role="status">
        <Loader2 className="h-8 w-8 animate-spin text-primary" aria-label="جاري التحميل" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/sign-in" state={{ from: location.pathname }} replace />;
  }

  if (!isAdmin) {
    return (
      <RTLLayout>
        <PageContainer className="py-16">
          <div className="max-w-xl mx-auto text-center">
            <ShieldAlert className="h-12 w-12 mx-auto text-destructive mb-4" />
            <h1 className="text-2xl font-bold text-foreground mb-2">ممنوع</h1>
            <p className="text-muted-foreground mb-6">
              هذه الصفحة مخصّصة للإدارة فقط.
            </p>
            <Button asChild>
              <a href="/">رجوع للرئيسية</a>
            </Button>
          </div>
        </PageContainer>
      </RTLLayout>
    );
  }

  return <>{children}</>;
}
