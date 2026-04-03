import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { pbkdf2Sync } from 'node:crypto';
import { authRoutes } from '../routes/auth';
import { getDb } from '../db';
import { signAppJwt } from '../auth/jwt';
import { ensureAuthUser } from '../auth/appUser';

vi.mock('../db', () => ({
  getDb: vi.fn(),
}));

vi.mock('../auth/jwt', () => ({
  signAppJwt: vi.fn(),
}));

vi.mock('../auth/appUser', () => ({
  ensureAuthUser: vi.fn(),
}));

function makePasswordHash(password: string) {
  const iterations = 120_000;
  const salt = 'test-salt';
  const hash = pbkdf2Sync(password, salt, iterations, 32, 'sha256').toString('base64');
  return `pbkdf2$sha256$${iterations}$${salt}$${hash}`;
}

describe('authRoutes', () => {
  let app: Hono;
  const mockEnv = {
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test_db',
    APP_JWT_SECRET: 'test-secret',
  };
  const mockDb = {
    execute: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    app = new Hono();
    app.route('/auth', authRoutes);
    vi.mocked(getDb).mockReturnValue(mockDb as any);
  });

  it('creates a new user on POST /auth/signup', async () => {
    mockDb.execute
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'user-id-123' }] })
      .mockResolvedValueOnce({ rows: [] });

    vi.mocked(signAppJwt).mockResolvedValue('jwt-token');
    vi.mocked(ensureAuthUser).mockResolvedValue(undefined);

    const response = await app.request('/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'test@example.com',
        password: 'password123',
        display_name: 'Test User',
      }),
    }, mockEnv as any);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      token: 'jwt-token',
      user: {
        id: 'user-id-123',
        email: 'test@example.com',
      },
    });
    expect(ensureAuthUser).toHaveBeenCalledWith(expect.anything(), 'user-id-123', {
      email: 'test@example.com',
      displayName: 'Test User',
    });
  });

  it('returns 400 for invalid signup payloads', async () => {
    const response = await app.request('/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'invalid-email',
        password: '123',
        display_name: '',
      }),
    }, mockEnv as any);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: 'INVALID_REQUEST',
    });
  });

  it('returns 409 when signup email already exists', async () => {
    mockDb.execute.mockResolvedValueOnce({ rows: [{ id: 'existing-id' }] });

    const response = await app.request('/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'existing@example.com',
        password: 'password123',
        display_name: 'Existing User',
      }),
    }, mockEnv as any);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: 'EMAIL_EXISTS' });
  });

  it('signs in a user on POST /auth/login', async () => {
    mockDb.execute.mockResolvedValueOnce({
      rows: [
        {
          id: 'user-id-123',
          email: 'test@example.com',
          display_name: 'Test User',
          password_hash: makePasswordHash('password123'),
        },
      ],
    });
    vi.mocked(signAppJwt).mockResolvedValue('jwt-token');

    const response = await app.request('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'test@example.com',
        password: 'password123',
      }),
    }, mockEnv as any);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      token: 'jwt-token',
      user: {
        id: 'user-id-123',
        email: 'test@example.com',
      },
    });
  });

  it('returns 401 for invalid login credentials', async () => {
    mockDb.execute.mockResolvedValueOnce({
      rows: [
        {
          id: 'user-id-123',
          email: 'test@example.com',
          display_name: 'Test User',
          password_hash: makePasswordHash('password123'),
        },
      ],
    });

    const response = await app.request('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'test@example.com',
        password: 'wrong-password',
      }),
    }, mockEnv as any);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'INVALID_CREDENTIALS' });
  });

  it('returns 401 when the login user does not exist', async () => {
    mockDb.execute.mockResolvedValueOnce({ rows: [] });

    const response = await app.request('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'missing@example.com',
        password: 'password123',
      }),
    }, mockEnv as any);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'INVALID_CREDENTIALS' });
  });
});
