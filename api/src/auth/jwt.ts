import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import type { Env } from '../db';

function getAuthHeader(req: Request) {
  const h = req.headers.get('Authorization') || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m?.[1] ?? null;
}

export type AppJwtContext = {
  userId: string; // internal uuid
  claims: JWTPayload;
};

export async function verifyAppJwt(req: Request, env: Env): Promise<AppJwtContext | null> {
  const token = getAuthHeader(req);
  if (!token) return null;

  const secret = env.APP_JWT_SECRET;
  if (!secret) throw new Error('Missing APP_JWT_SECRET');

  const key = new TextEncoder().encode(secret);
  const { payload } = await jwtVerify(token, key, { issuer: 'price-tracker-iraq' });

  const sub = payload.sub as string | undefined;
  if (!sub) return null;

  return { userId: sub, claims: payload };
}

export async function signAppJwt(env: Env, userId: string, extra?: Record<string, any>) {
  const secret = env.APP_JWT_SECRET;
  if (!secret) throw new Error('Missing APP_JWT_SECRET');
  const key = new TextEncoder().encode(secret);

  const now = Math.floor(Date.now() / 1000);
  const jwt = await new SignJWT({ ...(extra ?? {}) })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer('price-tracker-iraq')
    .setSubject(userId)
    .setIssuedAt(now)
    .setExpirationTime(now + 60 * 60 * 24 * 7) // 7 days
    .sign(key);

  return jwt;
}
