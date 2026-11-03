/**
 * @vitest-environment node
 *
 * notify-staff end to end (supabase/functions/_shared/notify-staff.ts), with
 * an in-memory database and phones that decrypt what reaches them: the call
 * the database makes when a guest orders, calls or asks for the bill, the key
 * the waiter screen subscribes with, and the test alert.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleNotifyStaff, type NotifyBackend, type NotifyDeps } from '../../supabase/functions/_shared/notify-staff.ts';
import type { PushEventRow, PushSubscriptionRow, StaffPushSource } from '../../supabase/functions/_shared/staff-push.ts';
import type { Vapid } from '../../supabase/functions/_shared/web-push.ts';
import { newPhone, p256, phoneReads, type TestPhone } from '@/test/push-phone';

const L = 'a5000000-0000-4000-8000-000000000001';
const V = 'a5000000-0000-4000-8000-000000000002';
const NOW = Date.parse('2026-11-03T20:00:00Z');
const just = new Date(NOW - 3_000).toISOString();
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const ORDER = id(1);
const CALL = id(2);
const VERA_BILL = id(3);
const CARD = id(4);

/** La Soul's table 7 is Amar's; Vera Italia's table 4 has nobody. */
async function world() {
  const phones: Record<string, TestPhone> = { amar: await newPhone(), lejla: await newPhone(), giulia: await newPhone() };
  const sub = (who: string, venue: string, n = 1): PushSubscriptionRow => ({
    id: `sub-${who}-${n}`, user_id: `u-${who}`, venue_id: venue, endpoint: `https://fcm.googleapis.com/fcm/send/${who}-${n}`,
    keys: { p256dh: phones[who].publicKey, auth: phones[who].auth }, last_seen_at: just,
  });
  const events: Record<string, PushEventRow & { source: StaffPushSource }> = {
    [ORDER]: { source: 'orders', id: ORDER, venue_id: L, table_session_id: 's-l7', created_at: just, status: 'pending', total: 38, held_reason: null, released_to_kitchen_at: just },
    [CALL]: { source: 'waiter_calls', id: CALL, venue_id: L, table_session_id: 's-l7', created_at: just, status: 'pending', reason: 'assist' },
    [VERA_BILL]: { source: 'bill_requests', id: VERA_BILL, venue_id: V, table_session_id: 's-v4', created_at: just, status: 'pending' },
    [CARD]: { source: 'orders', id: CARD, venue_id: L, table_session_id: 's-l7', created_at: just, status: 'awaiting_payment', total: 20 },
  };
  const state = {
    phones, events,
    subscriptions: [sub('amar', L), sub('lejla', L), sub('giulia', V)],
    claimed: new Set<string>(),
    forgotten: [] as string[],
    phonesAskedFor: [] as string[],
  };
  const backend: NotifyBackend = {
    loadEvent: async (source, eventId) => {
      const e = state.events[eventId];
      return e && e.source === source ? e : null;
    },
    claim: async (source, eventId) => {
      const key = `${source}:${eventId}`;
      if (state.claimed.has(key)) return false;
      state.claimed.add(key);
      return true;
    },
    loadContext: async (venueId, sessionId) => ({
      session: sessionId === 's-l7'
        ? { id: 's-l7', venue_id: L, assigned_waiter_id: 'w-amar', table_number: 7 }
        : { id: 's-v4', venue_id: V, assigned_waiter_id: null, table_number: 4 },
      venueName: venueId === L ? 'La Soul' : 'Vera Italia',
      waiters: [
        { id: 'w-amar', user_id: 'u-amar', venue_id: L, is_active: true },
        { id: 'w-lejla', user_id: 'u-lejla', venue_id: L, is_active: true },
        { id: 'w-giulia', user_id: 'u-giulia', venue_id: V, is_active: true },
      ],
      rota: ['w-amar', 'w-lejla', 'w-giulia'],
      dayStart: '2026-11-03T04:00:00Z',
    }),
    // Deliberately careless: every restaurant's phones, whatever was asked.
    // The choice must still keep to the event's own restaurant.
    loadPhones: async (venueId) => { state.phonesAskedFor.push(venueId); return state.subscriptions; },
    loadLines: async () => [{ quantity: 2, name: 'Ćevapi' }, { quantity: 1, name: 'Espresso' }],
    forgetPhones: async (ids) => {
      state.forgotten.push(...ids);
      state.subscriptions = state.subscriptions.filter((s) => !ids.includes(s.id));
    },
    userOf: async (token) => (token === 'amar-token' ? 'u-amar' : token === 'giulia-token' ? 'u-giulia' : null),
    phoneOf: async (userId, endpoint) => {
      const s = state.subscriptions.find((p) => p.user_id === userId && p.endpoint === endpoint);
      return s ? { ...s, venueName: s.venue_id === L ? 'La Soul' : 'Vera Italia' } : null;
    },
  };
  return { state, backend };
}

/** The push services: who got what, decrypted by the phone it was for. */
function pushServices(phones: Record<string, TestPhone>, status: Record<string, number> = {}) {
  const delivered: { who: string; message: Record<string, string>; headers: Record<string, string> }[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    const who = url.split('/').pop()!.replace(/-\d+$/, '');
    if (status[who] && status[who] >= 300) return new Response('gone', { status: status[who] });
    const message = JSON.parse(await phoneReads(new Uint8Array(init.body as ArrayBuffer), phones[who]));
    delivered.push({ who, message, headers: init.headers as Record<string, string> });
    return new Response(null, { status: 201 });
  }) as unknown as typeof fetch;
  return { delivered, fetcher };
}

let vapid: Vapid;
const deps = async (backend: NotifyBackend, fetcher: typeof fetch, extra: Partial<NotifyDeps> = {}): Promise<NotifyDeps> => {
  vapid ??= { ...(await p256('ECDSA')), subject: 'mailto:ops@lasoul.test' };
  return { backend, vapid, fetcher, ...extra };
};
const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('https://x.supabase.co/functions/v1/notify-staff', { method: 'POST', body: JSON.stringify(body), headers });

afterEach(() => { vi.useRealTimers(); });

describe('the database\'s call', () => {
  it('rings the table\'s waiter, with what was ordered, urgently', async () => {
    const { state, backend } = await world();
    const push = pushServices(state.phones);
    const reply = await handleNotifyStaff(post({ table: 'orders', id: ORDER }), await deps(backend, push.fetcher), NOW);
    expect(reply).toEqual({ status: 200, body: { who: 'assigned', waiters: 1, sent: 1, removed: 0, failed: 0 } });
    expect(push.delivered.map((d) => d.who)).toEqual(['amar']);
    expect(push.delivered[0].message).toMatchObject({
      kind: 'order', title: 'New order · Table 7', body: '2× Ćevapi, 1× Espresso · 38.00 KM · La Soul', url: '/waiter', tag: `orders:${ORDER}`,
    });
    expect(push.delivered[0].headers).toMatchObject({ Urgency: 'high', TTL: '600' });
  });

  it('sends each event once, however often it is called', async () => {
    const { state, backend } = await world();
    const push = pushServices(state.phones);
    const d = await deps(backend, push.fetcher);
    await handleNotifyStaff(post({ table: 'waiter_calls', id: CALL }), d, NOW);
    expect(await handleNotifyStaff(post({ table: 'waiter_calls', id: CALL }), d, NOW)).toEqual({ status: 200, body: { skipped: 'already_sent' } });
    expect(push.delivered).toHaveLength(1);
    expect(push.delivered[0].message.title).toBe('Calling you · Table 7');
  });

  it('a Vera Italia table nobody has rings Vera Italia\'s waiters on shift, never La Soul\'s', async () => {
    const { state, backend } = await world();
    const push = pushServices(state.phones);
    const reply = await handleNotifyStaff(post({ table: 'bill_requests', id: VERA_BILL }), await deps(backend, push.fetcher), NOW);
    expect(reply.body).toMatchObject({ who: 'on_shift', waiters: 1, sent: 1 });
    expect(state.phonesAskedFor).toEqual([V]);
    expect(push.delivered.map((d) => d.who)).toEqual(['giulia']);
    expect(push.delivered[0].message).toMatchObject({ title: 'Wants the bill · Table 4', body: 'Bring the bill · Vera Italia' });
  });

  it('forgets a phone its push service says is gone, and keeps one that failed for now', async () => {
    const { state, backend } = await world();
    state.subscriptions.push({ ...state.subscriptions[0], id: 'sub-amar-2', endpoint: 'https://fcm.googleapis.com/fcm/send/oldamar-2' });
    state.phones.oldamar = state.phones.amar;
    const push = pushServices(state.phones, { oldamar: 410, amar: 500 });
    const reply = await handleNotifyStaff(post({ table: 'orders', id: ORDER }), await deps(backend, push.fetcher, { log: () => undefined }), NOW);
    expect(reply.body).toMatchObject({ sent: 0, removed: 1, failed: 1 });
    expect(state.forgotten).toEqual(['sub-amar-2']);
  });

  it('sends nothing for an unknown row, a card order not yet paid, a bad call, or old news', async () => {
    const { state, backend } = await world();
    const push = pushServices(state.phones);
    const d = await deps(backend, push.fetcher);
    expect(await handleNotifyStaff(post({ table: 'orders', id: id(99) }), d, NOW)).toEqual({ status: 404, body: { skipped: 'not_found' } });
    expect(await handleNotifyStaff(post({ table: 'orders', id: CARD }), d, NOW)).toEqual({ status: 200, body: { skipped: 'not_placed' } });
    expect(await handleNotifyStaff(post({ table: 'orders', id: ORDER }), d, NOW + 20 * 60_000)).toEqual({ status: 200, body: { skipped: 'stale' } });
    expect((await handleNotifyStaff(post({ table: 'menu_items', id: ORDER }), d, NOW)).status).toBe(400);
    expect((await handleNotifyStaff(post({ table: 'orders', id: "1'; drop table orders" }), d, NOW)).status).toBe(400);
    expect(push.delivered).toEqual([]);
    expect(state.claimed.size).toBe(0);
  });

  it('claims nothing while the keys are not set up, so nothing is lost as "sent"', async () => {
    const { state, backend } = await world();
    const push = pushServices(state.phones);
    const d = { ...(await deps(backend, push.fetcher)), vapid: { publicKey: '', privateKey: '', subject: '' } };
    expect(await handleNotifyStaff(post({ table: 'orders', id: ORDER }), d, NOW)).toEqual({ status: 503, body: { skipped: 'not_configured' } });
    expect(state.claimed.size).toBe(0);
  });
});

describe('the waiter screen', () => {
  it('gets the public key to subscribe with, once the keys are set up', async () => {
    const { state, backend } = await world();
    const d = await deps(backend, pushServices(state.phones).fetcher);
    const get = new Request('https://x.supabase.co/functions/v1/notify-staff');
    expect(await handleNotifyStaff(get, d)).toEqual({ status: 200, body: { configured: true, publicKey: vapid.publicKey } });
    const other = await p256('ECDSA');
    expect(await handleNotifyStaff(get, { ...d, vapid: { ...vapid, privateKey: other.privateKey } }))
      .toEqual({ status: 200, body: { configured: false } });
  });

  it('a test alert reaches only the signed-in waiter\'s own phone', async () => {
    const { state, backend } = await world();
    const push = pushServices(state.phones);
    const d = await deps(backend, push.fetcher);
    const endpoint = 'https://fcm.googleapis.com/fcm/send/amar-1';
    expect((await handleNotifyStaff(post({ action: 'test', endpoint }), d, NOW)).status).toBe(401);
    expect((await handleNotifyStaff(post({ action: 'test', endpoint }, { Authorization: 'Bearer giulia-token' }), d, NOW)).status).toBe(404);
    const reply = await handleNotifyStaff(post({ action: 'test', endpoint }, { Authorization: 'Bearer amar-token' }), d, NOW);
    expect(reply).toEqual({ status: 200, body: { sent: 1, removed: 0, failed: 0 } });
    expect(push.delivered.map((x) => [x.who, x.message.title, x.message.body]))
      .toEqual([['amar', 'Test alert', 'This is how a new order reaches you · La Soul']]);
  });

  it('a delayed test answers at once and sends later, so the phone can be locked', async () => {
    vi.useFakeTimers();
    const { state, backend } = await world();
    const push = pushServices(state.phones);
    const later: Promise<unknown>[] = [];
    const d = await deps(backend, push.fetcher, { waitUntil: (work) => { later.push(work); } });
    const reply = await handleNotifyStaff(post({ action: 'test', endpoint: 'https://fcm.googleapis.com/fcm/send/amar-1', delay_seconds: 10 },
      { Authorization: 'Bearer amar-token' }), d, NOW);
    expect(reply).toEqual({ status: 202, body: { queued: true, delay_seconds: 10 } });
    expect(push.delivered).toEqual([]);
    await vi.advanceTimersByTimeAsync(10_000);
    vi.useRealTimers();
    await Promise.all(later);
    expect(push.delivered.map((x) => x.who)).toEqual(['amar']);
  });
});
