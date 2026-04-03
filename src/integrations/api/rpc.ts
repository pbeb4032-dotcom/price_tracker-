import { apiPost } from './client';

export async function apiRpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  return apiPost<T>(`/rpc/${encodeURIComponent(name)}`, args);
}
