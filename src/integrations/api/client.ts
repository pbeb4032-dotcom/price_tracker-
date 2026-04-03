import { getApiToken } from './token';

const env = (import.meta as any).env ?? {};
const API_BASE = (env.VITE_API_BASE_URL || env.VITE_API_URL) as string | undefined;

function requireBase() {
  if (!API_BASE) {
    throw new Error('Missing VITE_API_BASE_URL or VITE_API_URL');
  }
}

export async function apiGet<T>(path: string, init?: RequestInit): Promise<T> {
  requireBase();
  const token = await getApiToken();
  const res = await fetch(`${API_BASE!.replace(/\/$/, '')}${path}`, {
    ...(init ?? {}),
    method: 'GET',
    headers: {
      ...(init?.headers ?? {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });

  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) {
    const msg = (data && typeof data === 'object' && (data.error || data.message)) || text || `HTTP ${res.status}`;
    throw new Error(String(msg));
  }
  return data as T;
}

export async function apiPost<T>(path: string, body?: unknown, init?: RequestInit): Promise<T> {
  requireBase();
  const token = await getApiToken();
  const res = await fetch(`${API_BASE!.replace(/\/$/, '')}${path}`, {
    ...(init ?? {}),
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body ?? {}),
  });

  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) {
    const msg = (data && typeof data === 'object' && (data.error || data.message)) || text || `HTTP ${res.status}`;
    throw new Error(String(msg));
  }
  return data as T;
}

export async function apiPatch<T>(path: string, body?: unknown): Promise<T> {
  requireBase();
  const token = await getApiToken();
  const res = await fetch(`${API_BASE!.replace(/\/$/, '')}${path}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) {
    const msg = (data && typeof data === 'object' && (data.error || data.message)) || text || `HTTP ${res.status}`;
    throw new Error(String(msg));
  }
  return data as T;
}

export async function apiDelete<T>(path: string): Promise<T> {
  requireBase();
  const token = await getApiToken();
  const res = await fetch(`${API_BASE!.replace(/\/$/, '')}${path}`, {
    method: 'DELETE',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) {
    const msg = (data && typeof data === 'object' && (data.error || data.message)) || text || `HTTP ${res.status}`;
    throw new Error(String(msg));
  }
  return data as T;
}

function safeJson(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
