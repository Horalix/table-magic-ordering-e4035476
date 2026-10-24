import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __analyticsInternals, __resetAnalyticsForTests, track } from '@/lib/analytics';

const { sanitize } = __analyticsInternals;

/**
 * The client-side half of the privacy guarantee. The database enforces the
 * same rules again (see supabase/tests/merchandising-analytics.test.ts) — this
 * layer exists so nothing sensitive ever leaves the device in the first place.
 */
describe('analytics property sanitisation', () => {
  it('keeps ids, counts and flags', () => {
    expect(sanitize({ item_id: 'abc', quantity: 2, accepted: true, reason: null }))
      .toEqual({ item_id: 'abc', quantity: 2, accepted: true, reason: null });
  });

  it('drops free text a guest wrote', () => {
    const clean = sanitize({ item_id: 'abc', notes: 'no onions, allergic to peanuts' } as never);
    expect(clean).not.toHaveProperty('notes');
    expect(clean).toHaveProperty('item_id');
  });

  it('drops anything that identifies a person', () => {
    const clean = sanitize({ guest_name: 'Amina', email: 'a@b.c', phone: '+387...' } as never);
    expect(Object.keys(clean)).toHaveLength(0);
  });

  it('drops payment and session credentials', () => {
    const clean = sanitize({
      card: '4111111111111111',
      pan: '4111111111111111',
      cvv: '123',
      client_secret: 'cs_live_xyz',
      session_token: 'tok',
      qr_token: 'qr',
      order_code: '047',
    } as never);
    expect(clean).toEqual({ order_code: '047' });
  });

  it('is case-insensitive about blocked keys', () => {
    expect(sanitize({ Notes: 'x', GUEST_NAME: 'y' } as never)).toEqual({});
  });

  it('truncates long strings rather than shipping an essay', () => {
    const long = 'x'.repeat(500);
    const clean = sanitize({ reason: long });
    expect((clean.reason as string).length).toBe(__analyticsInternals.MAX_STRING);
  });

  it('drops values that are not scalars', () => {
    const clean = sanitize({ nested: { a: 1 }, list: [1, 2], fn: (() => 1) } as never);
    expect(clean).toEqual({});
  });
});

/**
 * Delivery. The guarantees that matter: the last events of a visit survive the
 * page going away, a flaky connection loses nothing, and an old database
 * without the RPC is not hammered forever.
 */
describe('analytics delivery', () => {
  const ok = () => new Response('1', { status: 200 });

  beforeEach(() => {
    __resetAnalyticsForTests();
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co/');
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'eyJ.test.key');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    __resetAnalyticsForTests();
  });

  it('posts with keepalive to the RPC endpoint, so it outlives the page', async () => {
    const fetchMock = vi.fn(async () => ok());
    vi.stubGlobal('fetch', fetchMock);

    track('order_placed', { order_code: '047' });
    await __analyticsInternals.flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://example.supabase.co/rest/v1/rpc/record_analytics_events');
    expect(init.keepalive).toBe(true);
    expect((init.headers as Record<string, string>).apikey).toBe('eyJ.test.key');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer eyJ.test.key');
    expect(JSON.parse(String(init.body))._events[0].event).toBe('order_placed');
  });

  it('puts a failed batch back and sends it with the next one', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue(ok());
    vi.stubGlobal('fetch', fetchMock);

    track('item_added', { item_id: 'a' });
    await __analyticsInternals.flush();
    expect(__analyticsInternals.pending()).toBe(1);

    track('cart_viewed');
    await __analyticsInternals.flush();
    expect(__analyticsInternals.pending()).toBe(0);
    const body = JSON.parse(String((fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1].body));
    expect(body._events.map((e: { event: string }) => e.event)).toEqual(['item_added', 'cart_viewed']);
  });

  it('never sends a batch the server would refuse for size', async () => {
    // A backlog built up while offline is larger than one batch.
    const fetchMock = vi.fn<() => Promise<Response>>(async () => { throw new TypeError('offline'); });
    vi.stubGlobal('fetch', fetchMock);
    for (let i = 0; i < 40; i += 1) track('item_viewed', { item_id: String(i) });
    // Reaching the buffer size flushes on its own; wait for those to fail back.
    await vi.waitFor(() => expect(__analyticsInternals.pending()).toBe(40));

    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => ok());
    await __analyticsInternals.flush();
    const sizes = fetchMock.mock.calls.map((call) =>
      JSON.parse(String((call as unknown as [string, RequestInit])[1].body))._events.length);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(__analyticsInternals.MAX_BATCH);
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(40);
  });

  it('holds at most a bounded backlog while offline', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    for (let i = 0; i < 300; i += 1) track('item_viewed', { item_id: String(i) });
    await __analyticsInternals.flush();
    expect(__analyticsInternals.pending()).toBeLessThanOrEqual(__analyticsInternals.MAX_QUEUED);
  });

  it('switches itself off when the database has no such function', async () => {
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ code: 'PGRST202', message: 'Could not find the function public.record_analytics_events' }),
      { status: 404 },
    ));
    vi.stubGlobal('fetch', fetchMock);

    track('menu_viewed');
    await __analyticsInternals.flush();
    expect(__analyticsInternals.isEnabled()).toBe(false);

    track('menu_viewed');
    await __analyticsInternals.flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('recognises the older "does not exist" wording too', () => {
    expect(__analyticsInternals.isMissingFunction({ message: 'function public.x(text) does not exist' })).toBe(true);
    expect(__analyticsInternals.isMissingFunction({ code: 'PGRST202' })).toBe(true);
    expect(__analyticsInternals.isMissingFunction({ code: '42501', message: 'permission denied' })).toBe(false);
  });
});
