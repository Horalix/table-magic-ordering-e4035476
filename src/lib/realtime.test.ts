import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient } from '@tanstack/react-query';

/**
 * The coalescing layer.
 *
 * A guest placing a six-item order emits one `orders` INSERT and six
 * `order_items` INSERTs. Every staff screen used to run a full refetch on each
 * of those, so one order caused seven refetches per open device — and the floor
 * monitor ran seven QUERIES per refetch. Cost scaled with activity multiplied
 * by devices, which is backwards: the busier the restaurant, the slower its
 * screens got.
 *
 * Two properties fix it, and these tests pin both:
 *   - a burst of events becomes one invalidation per affected key
 *   - an event only invalidates keys that actually depend on that table
 */

type Handler = (payload: { eventType: string }) => void;

const handlers = new Map<string, Handler>();
let subscribeCallback: ((status: string) => void) | null = null;
let channelCount = 0;
let removed = 0;

const fakeChannel = {
  on(_event: string, filter: { table: string }, handler: Handler) {
    handlers.set(filter.table, handler);
    return this;
  },
  subscribe(cb: (status: string) => void) {
    subscribeCallback = cb;
    return this;
  },
};

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    channel: () => { channelCount += 1; return fakeChannel; },
    removeChannel: () => { removed += 1; return Promise.resolve('ok'); },
  },
}));

const emit = (table: string, eventType = 'INSERT') => handlers.get(table)?.({ eventType });

let realtime: typeof import('@/lib/realtime').__realtimeForTests;
let staffKeys: typeof import('@/lib/realtime').staffKeys;

beforeEach(async () => {
  vi.resetModules();
  handlers.clear();
  subscribeCallback = null;
  channelCount = 0;
  removed = 0;
  vi.useFakeTimers();

  const mod = await import('@/lib/realtime');
  realtime = mod.__realtimeForTests;
  staffKeys = mod.staffKeys;
});

afterEach(() => {
  vi.useRealTimers();
});

function setup() {
  const client = new QueryClient();
  const invalidate = vi.spyOn(client, 'invalidateQueries').mockResolvedValue();
  realtime.acquire(client);
  // Clear the catch-up invalidation that runs on SUBSCRIBED.
  subscribeCallback?.('SUBSCRIBED');
  invalidate.mockClear();
  return { client, invalidate };
}

const keysInvalidated = (spy: ReturnType<typeof vi.spyOn>) =>
  spy.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey.join('|'));

describe('event coalescing', () => {
  it('turns a six-item order into one refetch per key, not seven', () => {
    const { invalidate } = setup();

    emit('orders');
    for (let i = 0; i < 6; i += 1) emit('order_items');

    // Nothing yet — the debounce is trailing.
    expect(invalidate).not.toHaveBeenCalled();

    vi.advanceTimersByTime(300);
    const orderKeyCalls = keysInvalidated(invalidate).filter((k) => k === staffKeys.orders.join('|'));
    expect(orderKeyCalls.length).toBe(1);
  });

  it('debounces the all-day summary more slowly than the board', () => {
    const { invalidate } = setup();
    emit('order_items');

    vi.advanceTimersByTime(300);
    expect(keysInvalidated(invalidate)).toContain(staffKeys.orders.join('|'));
    expect(keysInvalidated(invalidate)).not.toContain(staffKeys.allDay.join('|'));

    vi.advanceTimersByTime(600);
    expect(keysInvalidated(invalidate)).toContain(staffKeys.allDay.join('|'));
  });

  it('restarts the window on each event so a long burst still collapses', () => {
    const { invalidate } = setup();

    for (let i = 0; i < 10; i += 1) {
      emit('orders');
      vi.advanceTimersByTime(100);
    }
    vi.advanceTimersByTime(300);

    expect(keysInvalidated(invalidate).filter((k) => k === staffKeys.orders.join('|')).length).toBe(1);
  });
});

describe('targeted invalidation', () => {
  it('does not refetch the kitchen board when a table row changes', () => {
    const { invalidate } = setup();

    emit('tables');
    vi.advanceTimersByTime(1000);

    const keys = keysInvalidated(invalidate);
    expect(keys).toContain(staffKeys.tables.join('|'));
    expect(keys).not.toContain(staffKeys.orders.join('|'));
  });

  it('maps each table only to what depends on it', () => {
    const { invalidate } = setup();

    emit('waiter_calls');
    vi.advanceTimersByTime(1000);

    expect(keysInvalidated(invalidate)).toEqual([staffKeys.waiterCalls.join('|')]);
  });

  it('ignores tables it does not watch', () => {
    const { invalidate } = setup();
    expect(handlers.has('audit_log')).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(invalidate).not.toHaveBeenCalled();
  });
});

describe('alerting is not held up by data', () => {
  it('notifies event listeners synchronously, before any debounce', () => {
    const seen: string[] = [];
    const off = realtime.onEvent((table) => seen.push(table));
    setup();

    emit('orders');
    // No timer advance: the chime must not wait on a refetch.
    expect(seen).toEqual(['orders']);
    off();
  });
});

describe('connection state', () => {
  it('reports live only when actually subscribed', () => {
    setup();
    expect(realtime.getState()).toBe('live');

    subscribeCallback?.('CHANNEL_ERROR');
    expect(realtime.getState()).toBe('reconnecting');

    subscribeCallback?.('SUBSCRIBED');
    expect(realtime.getState()).toBe('live');
  });

  it('catches up on everything when the socket comes back', () => {
    const { invalidate } = setup();
    subscribeCallback?.('CHANNEL_ERROR');
    invalidate.mockClear();

    subscribeCallback?.('SUBSCRIBED');
    expect(invalidate.mock.calls.length).toBeGreaterThan(1);
  });

  it('polls while disconnected, and not while live', () => {
    const { invalidate } = setup();

    vi.advanceTimersByTime(16_000);
    expect(invalidate).not.toHaveBeenCalled();

    subscribeCallback?.('TIMED_OUT');
    invalidate.mockClear();
    vi.advanceTimersByTime(16_000);
    expect(invalidate.mock.calls.length).toBeGreaterThan(0);
  });
});

describe('one channel per tab', () => {
  it('shares a single channel across screens and tears down on the last release', () => {
    const client = new QueryClient();
    vi.spyOn(client, 'invalidateQueries').mockResolvedValue();

    realtime.acquire(client);
    realtime.acquire(client);
    expect(channelCount).toBe(1);

    realtime.release();
    expect(removed).toBe(0);

    realtime.release();
    expect(removed).toBe(1);
  });
});
