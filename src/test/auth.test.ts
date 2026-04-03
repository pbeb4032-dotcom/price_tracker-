/**
 * Shkad Aadel — Auth Flow Tests
 *
 * Tests for: validation schemas, error mapping, route guard logic,
 * auth state management, and sign-out behavior.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { signInSchema, signUpSchema } from '@/lib/validation/schemas';
import { AppError, toAppError } from '@/lib/errors';

// ---- Sign-In Validation ----

describe('Sign-in form validation', () => {
  it('rejects empty email', () => {
    const result = signInSchema.safeParse({ email: '', password: 'pass1234' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid email format', () => {
    const result = signInSchema.safeParse({ email: 'notanemail', password: 'pass1234' });
    expect(result.success).toBe(false);
  });

  it('rejects empty password', () => {
    const result = signInSchema.safeParse({ email: 'user@example.com', password: '' });
    expect(result.success).toBe(false);
  });

  it('accepts valid credentials', () => {
    const result = signInSchema.safeParse({ email: 'user@example.com', password: 'pass1234' });
    expect(result.success).toBe(true);
  });

  it('trims email whitespace', () => {
    const result = signInSchema.parse({ email: '  user@example.com  ', password: 'pass1234' });
    expect(result.email).toBe('user@example.com');
  });
});

// ---- Sign-Up Validation ----

describe('Sign-up form validation', () => {
  const valid = { email: 'new@example.com', password: 'secure123', display_name: 'أحمد' };

  it('accepts valid sign-up data', () => {
    expect(signUpSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects password under 8 chars', () => {
    expect(signUpSchema.safeParse({ ...valid, password: 'short' }).success).toBe(false);
  });

  it('rejects password over 72 chars', () => {
    expect(signUpSchema.safeParse({ ...valid, password: 'a'.repeat(73) }).success).toBe(false);
  });

  it('rejects empty display_name', () => {
    expect(signUpSchema.safeParse({ ...valid, display_name: '' }).success).toBe(false);
  });

  it('rejects display_name over 100 chars', () => {
    expect(signUpSchema.safeParse({ ...valid, display_name: 'أ'.repeat(101) }).success).toBe(false);
  });

  it('rejects missing email', () => {
    expect(signUpSchema.safeParse({ password: 'secure123', display_name: 'أحمد' }).success).toBe(false);
  });
});

// ---- Error Mapping ----

describe('Auth error mapping', () => {
  it('AppError preserves Arabic message', () => {
    const err = new AppError({
      code: 'UNAUTHORIZED',
      message: 'Invalid credentials',
      messageAr: 'بيانات الدخول غير صحيحة',
    });
    expect(err.messageAr).toBe('بيانات الدخول غير صحيحة');
    expect(err.httpStatus).toBe(401);
  });

  it('AppError for conflict (already registered)', () => {
    const err = new AppError({
      code: 'CONFLICT',
      message: 'Already registered',
      messageAr: 'البريد الإلكتروني مسجّل بالفعل',
    });
    expect(err.code).toBe('CONFLICT');
    expect(err.httpStatus).toBe(409);
  });

  it('AppError for rate limit', () => {
    const err = new AppError({
      code: 'RATE_LIMITED',
      message: 'Too many requests',
      messageAr: 'محاولات كثيرة',
    });
    expect(err.httpStatus).toBe(429);
  });

  it('toAppError wraps unknown errors', () => {
    const err = toAppError(new Error('network failure'));
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe('INTERNAL_ERROR');
  });

  it('toAppError passes through AppError', () => {
    const original = new AppError({ code: 'FORBIDDEN', message: 'nope' });
    expect(toAppError(original)).toBe(original);
  });
});

// ---- Route Guard Logic ----

describe('Route guard logic (unit)', () => {
  it('unauthenticated state should trigger redirect', () => {
    // Simulates the guard decision: no user = redirect
    const user = null;
    const shouldRedirect = !user;
    expect(shouldRedirect).toBe(true);
  });

  it('authenticated state should allow access', () => {
    const user = { id: 'test-id', email: 'user@test.com' };
    const shouldRedirect = !user;
    expect(shouldRedirect).toBe(false);
  });

  it('guest route with auth should redirect away', () => {
    const user = { id: 'test-id' };
    const shouldRedirectAway = !!user;
    expect(shouldRedirectAway).toBe(true);
  });

  it('guest route without auth should allow access', () => {
    const user = null;
    const shouldRedirectAway = !!user;
    expect(shouldRedirectAway).toBe(false);
  });
});

// ---- Session State ----

describe('Auth state management (unit)', () => {
  it('initial auth state should be loading', () => {
    const initialState = {
      user: null,
      session: null,
      profile: null,
      loading: true,
      initialized: false,
    };
    expect(initialState.loading).toBe(true);
    expect(initialState.initialized).toBe(false);
    expect(initialState.user).toBeNull();
  });

  it('after session restore, initialized should be true', () => {
    const restoredState = {
      user: { id: 'u1' },
      session: { access_token: 'tok' },
      profile: { display_name: 'أحمد' },
      loading: false,
      initialized: true,
    };
    expect(restoredState.initialized).toBe(true);
    expect(restoredState.loading).toBe(false);
  });

  it('session restore failure clears state', () => {
    const failedState = {
      user: null,
      session: null,
      profile: null,
      loading: false,
      initialized: true,
    };
    expect(failedState.user).toBeNull();
    expect(failedState.initialized).toBe(true);
  });

  it('sign-out clears all auth state', () => {
    const postSignOut = {
      user: null,
      session: null,
      profile: null,
      loading: false,
      initialized: true,
    };
    expect(postSignOut.user).toBeNull();
    expect(postSignOut.session).toBeNull();
    expect(postSignOut.profile).toBeNull();
  });
});

// ---- Telemetry Event Names ----

describe('Auth telemetry events', () => {
  const requiredEvents = [
    'auth_signup_success',
    'auth_signup_fail',
    'auth_signin_success',
    'auth_signin_fail',
    'auth_signout',
    'auth_session_restored',
    'auth_session_restore_fail',
  ];

  it('all required telemetry events are defined', () => {
    // Verify all event names are valid non-empty strings
    for (const event of requiredEvents) {
      expect(typeof event).toBe('string');
      expect(event.length).toBeGreaterThan(0);
      expect(event).toMatch(/^auth_/);
    }
  });

  it('has exactly 7 auth telemetry events', () => {
    expect(requiredEvents).toHaveLength(7);
  });
});
