import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const invalidateQueries = vi.fn();
let handler: (() => void) | undefined;

const channelObj: Record<string, unknown> = {
  on: vi.fn((_event: unknown, _filter: unknown, cb: () => void) => {
    handler = cb;
    return channelObj;
  }),
  subscribe: vi.fn(() => channelObj),
};

const channel = vi.fn(() => channelObj);
const removeChannel = vi.fn();

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@tanstack/react-query');
  return {
    ...actual,
    useQueryClient: () => ({ invalidateQueries }),
  };
});

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { channel, removeChannel },
}));

describe('useNotificationsRealtime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    handler = undefined;
  });

  it('subscribes for user-specific notifications and invalidates caches', async () => {
    const { useNotificationsRealtime } = await import('@/hooks/offers/useNotificationsRealtime');

    renderHook(() => useNotificationsRealtime('u1'));
    expect(channel).toHaveBeenCalledWith('notifications:user:u1');

    handler?.();

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['notifications', 'u1'] });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['notifications-unread-count', 'u1'],
    });
  });

  it('cleans up subscription on unmount', async () => {
    const { useNotificationsRealtime } = await import('@/hooks/offers/useNotificationsRealtime');

    const { unmount } = renderHook(() => useNotificationsRealtime('u1'));
    unmount();

    expect(removeChannel).toHaveBeenCalled();
  });

  it('does nothing when userId is undefined', async () => {
    const { useNotificationsRealtime } = await import('@/hooks/offers/useNotificationsRealtime');

    renderHook(() => useNotificationsRealtime(undefined));
    expect(channel).not.toHaveBeenCalled();
  });
});
