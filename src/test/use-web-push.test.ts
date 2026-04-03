import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const upsertFn = vi.fn().mockResolvedValue({ error: null });

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => ({
      upsert: upsertFn,
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
      }),
    }),
  },
}));

vi.mock('@/lib/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'u1' } }),
}));

describe('useWebPush', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reports unsupported when PushManager missing', async () => {
    // In JSDOM there's no PushManager
    const { useWebPush } = await import('@/hooks/offers/useWebPush');
    const { result } = renderHook(() => useWebPush());
    expect(result.current.supported).toBe(false);
  });

  it('subscribe throws when not supported', async () => {
    const { useWebPush } = await import('@/hooks/offers/useWebPush');
    const { result } = renderHook(() => useWebPush());
    await expect(result.current.subscribe()).rejects.toThrow('Push not supported');
  });

  it('unsubscribe gracefully no-ops when not supported', async () => {
    const { useWebPush } = await import('@/hooks/offers/useWebPush');
    const { result } = renderHook(() => useWebPush());
    // Should not throw
    await result.current.unsubscribe();
  });
});
