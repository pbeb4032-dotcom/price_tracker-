/**
 * Shkad Aadel — Protected Route Wrapper
 *
 * Redirects unauthenticated users to /sign-in.
 * Shows loading spinner during session restore.
 */

import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/lib/auth/AuthProvider';
import { Loader2 } from 'lucide-react';

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading, initialized } = useAuth();
  const location = useLocation();

  if (!initialized || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background" role="status">
        <Loader2 className="h-8 w-8 animate-spin text-primary" aria-label="جاري التحميل" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/sign-in" state={{ from: location.pathname }} replace />;
  }

  return <>{children}</>;
}

/**
 * Redirects authenticated users away from auth pages (sign-in/sign-up).
 */
export function GuestRoute({ children }: { children: React.ReactNode }) {
  const { user, initialized } = useAuth();

  if (!initialized) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background" role="status">
        <Loader2 className="h-8 w-8 animate-spin text-primary" aria-label="جاري التحميل" />
      </div>
    );
  }

  if (user) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
