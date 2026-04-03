/**
 * Shkad Aadel — Route Guard Integration Tests
 *
 * Uses MemoryRouter to test ProtectedRoute and GuestRoute
 * redirect behavior with mocked auth context.
 */

import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { ReactNode } from 'react';

// ---- Mock auth module ----

const mockAuthValue = {
  user: null as { id: string; email: string } | null,
  session: null,
  profile: null,
  loading: false,
  initialized: true,
  signUp: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
};

vi.mock('@/lib/auth/AuthProvider', () => ({
  useAuth: () => mockAuthValue,
  AuthProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

// Import AFTER mock setup
import { ProtectedRoute, GuestRoute } from '@/lib/auth/RouteGuards';

// ---- Helpers ----

function renderWithRouter(initialRoute: string, routes: ReactNode) {
  return render(
    <MemoryRouter initialEntries={[initialRoute]}>
      <Routes>{routes}</Routes>
    </MemoryRouter>,
  );
}

function getByText(container: HTMLElement, text: string): HTMLElement | null {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    if (walker.currentNode.textContent?.includes(text)) {
      return walker.currentNode.parentElement;
    }
  }
  return null;
}

function queryByRole(container: HTMLElement, role: string): HTMLElement | null {
  return container.querySelector(`[role="${role}"]`);
}

// ---- ProtectedRoute Tests ----

describe('ProtectedRoute (integration)', () => {
  it('redirects unauthenticated users to /sign-in', () => {
    mockAuthValue.user = null;
    mockAuthValue.initialized = true;
    mockAuthValue.loading = false;

    const { container } = renderWithRouter('/dashboard', (
      <>
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <div>Dashboard Content</div>
            </ProtectedRoute>
          }
        />
        <Route path="/sign-in" element={<div>Sign In Page</div>} />
      </>
    ));

    expect(getByText(container, 'Sign In Page')).toBeTruthy();
    expect(getByText(container, 'Dashboard Content')).toBeNull();
  });

  it('renders children for authenticated users', () => {
    mockAuthValue.user = { id: 'u1', email: 'test@test.com' };
    mockAuthValue.initialized = true;
    mockAuthValue.loading = false;

    const { container } = renderWithRouter('/dashboard', (
      <>
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <div>Dashboard Content</div>
            </ProtectedRoute>
          }
        />
        <Route path="/sign-in" element={<div>Sign In Page</div>} />
      </>
    ));

    expect(getByText(container, 'Dashboard Content')).toBeTruthy();
    expect(getByText(container, 'Sign In Page')).toBeNull();
  });

  it('shows loading spinner while initializing', () => {
    mockAuthValue.user = null;
    mockAuthValue.initialized = false;
    mockAuthValue.loading = true;

    const { container } = renderWithRouter('/dashboard', (
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <div>Dashboard Content</div>
          </ProtectedRoute>
        }
      />
    ));

    expect(queryByRole(container, 'status')).toBeTruthy();
    expect(getByText(container, 'Dashboard Content')).toBeNull();
  });
});

// ---- GuestRoute Tests ----

describe('GuestRoute (integration)', () => {
  it('redirects authenticated users away from /sign-in', () => {
    mockAuthValue.user = { id: 'u1', email: 'test@test.com' };
    mockAuthValue.initialized = true;
    mockAuthValue.loading = false;

    const { container } = renderWithRouter('/sign-in', (
      <>
        <Route
          path="/sign-in"
          element={
            <GuestRoute>
              <div>Sign In Form</div>
            </GuestRoute>
          }
        />
        <Route path="/" element={<div>Home Page</div>} />
      </>
    ));

    expect(getByText(container, 'Home Page')).toBeTruthy();
    expect(getByText(container, 'Sign In Form')).toBeNull();
  });

  it('redirects authenticated users away from /sign-up', () => {
    mockAuthValue.user = { id: 'u1', email: 'test@test.com' };
    mockAuthValue.initialized = true;
    mockAuthValue.loading = false;

    const { container } = renderWithRouter('/sign-up', (
      <>
        <Route
          path="/sign-up"
          element={
            <GuestRoute>
              <div>Sign Up Form</div>
            </GuestRoute>
          }
        />
        <Route path="/" element={<div>Home Page</div>} />
      </>
    ));

    expect(getByText(container, 'Home Page')).toBeTruthy();
    expect(getByText(container, 'Sign Up Form')).toBeNull();
  });

  it('renders children for unauthenticated users', () => {
    mockAuthValue.user = null;
    mockAuthValue.initialized = true;
    mockAuthValue.loading = false;

    const { container } = renderWithRouter('/sign-in', (
      <Route
        path="/sign-in"
        element={
          <GuestRoute>
            <div>Sign In Form</div>
          </GuestRoute>
        }
      />
    ));

    expect(getByText(container, 'Sign In Form')).toBeTruthy();
  });

  it('shows loading while initializing', () => {
    mockAuthValue.user = null;
    mockAuthValue.initialized = false;
    mockAuthValue.loading = false;

    const { container } = renderWithRouter('/sign-in', (
      <Route
        path="/sign-in"
        element={
          <GuestRoute>
            <div>Sign In Form</div>
          </GuestRoute>
        }
      />
    ));

    expect(queryByRole(container, 'status')).toBeTruthy();
    expect(getByText(container, 'Sign In Form')).toBeNull();
  });
});
