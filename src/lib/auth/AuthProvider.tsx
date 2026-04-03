/**
 * Shkad Aadel — Auth Context & Provider (Standalone/API mode)
 *
 * Local email/password auth backed by the app API:
 * - POST /auth/signup
 * - POST /auth/login
 * - GET  /auth/session
 */

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
  type ReactNode,
} from 'react';

import { apiGet, apiPost } from '@/integrations/api/client';
import { setApiTokenGetter } from '@/integrations/api/token';
import { AppError, toAppError } from '@/lib/errors';
import { useTelemetry } from '@/lib/telemetry';
import type { Profile } from '@/lib/types/domain';

type AppUser = {
  id: string;
  email: string | null;
  display_name?: string | null;
};

type AuthState = {
  user: AppUser | null;
  token: string | null;
  profile: Profile | null;
  loading: boolean;
  initialized: boolean;
};

interface AuthContextValue extends AuthState {
  signUp: (email: string, password: string, displayName: string) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const TOKEN_KEY = 'pt_iraq_jwt';

function getStoredToken(): string | null {
  try {
    const t = localStorage.getItem(TOKEN_KEY);
    return t && t.length > 10 ? t : null;
  } catch {
    return null;
  }
}

function setStoredToken(token: string | null) {
  try {
    if (!token) localStorage.removeItem(TOKEN_KEY);
    else localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // ignore
  }
}

function mapAuthError(err: unknown): AppError {
  const raw = toAppError(err);
  const msg = raw.message.toLowerCase();

  if (msg.includes('invalid_credentials') || msg.includes('invalid login credentials') || msg.includes('unauthorized')) {
    return new AppError({
      code: 'UNAUTHORIZED',
      message: 'Invalid login credentials',
      messageAr: 'البريد الإلكتروني أو كلمة المرور غير صحيحة',
    });
  }

  if (msg.includes('email_exists') || msg.includes('already') || msg.includes('conflict')) {
    return new AppError({
      code: 'CONFLICT',
      message: 'Email already registered',
      messageAr: 'البريد الإلكتروني مسجّل بالفعل',
    });
  }

  if (msg.includes('rate') || msg.includes('too many')) {
    return new AppError({
      code: 'RATE_LIMITED',
      message: 'Too many attempts, please try again later',
      messageAr: 'محاولات كثيرة، يرجى المحاولة لاحقاً',
    });
  }

  return new AppError({
    code: 'INTERNAL_ERROR',
    message: raw.message,
    messageAr: 'حدث خطأ غير متوقع، يرجى المحاولة لاحقاً',
    context: raw.context,
  });
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const telemetry = useTelemetry();
  const [state, setState] = useState<AuthState>({
    user: null,
    token: null,
    profile: null,
    loading: true,
    initialized: false,
  });

  // Always expose a token getter for API calls.
  useEffect(() => {
    setApiTokenGetter(async () => getStoredToken());
    return () => setApiTokenGetter(null);
  }, []);

  const restore = useCallback(async () => {
    const token = getStoredToken();
    if (!token) {
      setState({ user: null, token: null, profile: null, loading: false, initialized: true });
      return;
    }

    setState((p) => ({ ...p, loading: true }));
    try {
      const s = await apiGet<{ user: AppUser | null; profile: Profile | null }>('/auth/session');
      setState({
        user: s.user,
        token,
        profile: s.profile,
        loading: false,
        initialized: true,
      });
      telemetry.trackEvent('auth_session_restored');
    } catch {
      setStoredToken(null);
      setState({ user: null, token: null, profile: null, loading: false, initialized: true });
      telemetry.trackEvent('auth_session_restore_fail', { status: 'error' });
    }
  }, [telemetry]);

  useEffect(() => {
    void restore();
  }, [restore]);

  const signUp = useCallback(
    async (email: string, password: string, displayName: string) => {
      setState((p) => ({ ...p, loading: true }));
      try {
        const r = await apiPost<{ token: string; user: AppUser }>('/auth/signup', {
          email,
          password,
          display_name: displayName,
        });

        setStoredToken(r.token);
        telemetry.trackEvent('auth_signup_success', { method: 'email' });
        await restore();
      } catch (err) {
        const mapped = mapAuthError(err);
        telemetry.trackEvent('auth_signup_fail', { error_code: mapped.code });
        setState((p) => ({ ...p, loading: false }));
        throw mapped;
      }
    },
    [restore, telemetry],
  );

  const signIn = useCallback(
    async (email: string, password: string) => {
      setState((p) => ({ ...p, loading: true }));
      try {
        const r = await apiPost<{ token: string; user: AppUser }>('/auth/login', { email, password });
        setStoredToken(r.token);
        telemetry.trackEvent('auth_signin_success', { method: 'email' });
        await restore();
      } catch (err) {
        const mapped = mapAuthError(err);
        telemetry.trackEvent('auth_signin_fail', { error_code: mapped.code });
        setState((p) => ({ ...p, loading: false }));
        throw mapped;
      }
    },
    [restore, telemetry],
  );

  const signOut = useCallback(async () => {
    setStoredToken(null);
    telemetry.trackEvent('auth_signout');
    setState({ user: null, token: null, profile: null, loading: false, initialized: true });
  }, [telemetry]);

  const value = useMemo<AuthContextValue>(
    () => ({ ...state, signUp, signIn, signOut }),
    [state, signUp, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
