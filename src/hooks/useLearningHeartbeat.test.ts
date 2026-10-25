import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

/**
 * A staff screen keeps the engine learning: it offers a refresh shortly after
 * it opens and every five minutes after that (the server decides whether one
 * is due), stops when it closes, and shrugs off a failure.
 */

const rpc = vi.fn();
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: (...args: unknown[]) => rpc(...args) } }));

const { useLearningHeartbeat } = await import('@/hooks/useLearningHeartbeat');

beforeEach(() => {
  vi.useFakeTimers();
  rpc.mockReset();
  rpc.mockResolvedValue({ data: { ran: false, reason: 'fresh' }, error: null });
});
afterEach(() => { vi.useRealTimers(); });

describe('useLearningHeartbeat', () => {
  it('asks once the screen has settled, then every five minutes', () => {
    renderHook(() => useLearningHeartbeat());
    expect(rpc).not.toHaveBeenCalled();
    vi.advanceTimersByTime(20_000);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('maybe_refresh_menu_intelligence');
    vi.advanceTimersByTime(5 * 60_000);
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('stops asking when the screen closes', () => {
    const { unmount } = renderHook(() => useLearningHeartbeat());
    unmount();
    vi.advanceTimersByTime(30 * 60_000);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('ignores a failed request; the next tick asks again', async () => {
    rpc.mockRejectedValueOnce(new Error('offline'));
    renderHook(() => useLearningHeartbeat());
    vi.advanceTimersByTime(20_000);
    await Promise.resolve();
    vi.advanceTimersByTime(5 * 60_000);
    expect(rpc).toHaveBeenCalledTimes(2);
  });
});
