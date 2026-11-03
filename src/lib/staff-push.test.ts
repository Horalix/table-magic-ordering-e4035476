/**
 * @vitest-environment node
 *
 * Whose phone rings when a guest orders, calls or asks for the bill
 * (supabase/functions/_shared/staff-push.ts), and what it says.
 *
 * The table's waiter, or — for a table nobody has — the waiters on shift at
 * that restaurant. Two restaurants share one database, so every case here
 * also hands the function the other restaurant's waiters, rota and phones,
 * and none of them may ring.
 */
import { describe, expect, it } from 'vitest';
import {
  chooseRecipients, describeEvent, orderLines, skipReason,
  type PushEventRow, type PushSubscriptionRow, type PushWaiterRow, type RecipientInput,
} from '../../supabase/functions/_shared/staff-push.ts';

const L = 'a5000000-0000-4000-8000-000000000001'; // La Soul
const V = 'a5000000-0000-4000-8000-000000000002'; // Vera Italia

const NOW = Date.parse('2026-11-03T20:00:00Z');
const DAY_START = '2026-11-03T04:00:00Z'; // 05:00 in Sarajevo
const today = '2026-11-03T17:30:00Z';
const yesterday = '2026-11-02T21:00:00Z';

const waiter = (id: string, venue: string, over: Partial<PushWaiterRow> = {}): PushWaiterRow =>
  ({ id: `w-${id}`, user_id: `u-${id}`, venue_id: venue, is_active: true, ...over });
const phone = (who: string, venue: string, seen = today, n = 1): PushSubscriptionRow => ({
  id: `sub-${who}-${venue === L ? 'l' : 'v'}-${n}`, user_id: `u-${who}`, venue_id: venue,
  endpoint: `https://fcm.googleapis.com/fcm/send/${who}-${venue === L ? 'l' : 'v'}-${n}`,
  keys: { p256dh: 'p', auth: 'a' }, last_seen_at: seen,
});

// La Soul: Amar has table 7 today, Lejla is on the rota, Edin opened the
// waiter screen this afternoon, Selma is off (last seen yesterday).
// Vera Italia: Giulia and Marco, both working tonight.
const amar = waiter('amar', L);
const lejla = waiter('lejla', L);
const edin = waiter('edin', L);
const selma = waiter('selma', L);
const giulia = waiter('giulia', V);
const marco = waiter('marco', V);

const everyone = [amar, lejla, edin, selma, giulia, marco];
const allPhones = [
  phone('amar', L), phone('lejla', L, yesterday), phone('edin', L), phone('selma', L, yesterday),
  phone('giulia', V), phone('marco', V),
];

const laSoul = (over: Partial<RecipientInput> = {}): RecipientInput => ({
  venueId: L,
  session: { id: 'session-7', venue_id: L, assigned_waiter_id: amar.id, table_number: 7 },
  waiters: everyone,
  // Rotas of both restaurants handed in on purpose: only La Soul's may count.
  rota: [amar.id, lejla.id, giulia.id],
  dayStart: DAY_START,
  subscriptions: allPhones,
  ...over,
});

const users = (input: RecipientInput) => chooseRecipients(input).subscriptions.map((s) => s.user_id).sort();

describe('the table\'s waiter', () => {
  it('rings the waiter who has the table, and nobody else', () => {
    const r = chooseRecipients(laSoul());
    expect(r.who).toBe('assigned');
    expect(r.userIds).toEqual(['u-amar']);
    expect(r.subscriptions.map((s) => s.endpoint)).toEqual(['https://fcm.googleapis.com/fcm/send/amar-l-1']);
  });

  it('rings every phone that waiter turned alerts on for, once each', () => {
    const second = phone('amar', L, yesterday, 2);
    expect(users(laSoul({ subscriptions: [...allPhones, second, { ...second, id: 'dup' }] }))).toEqual(['u-amar', 'u-amar']);
  });

  it('is silent when that waiter has no phone with alerts on: the table is still theirs', () => {
    expect(chooseRecipients(laSoul({ subscriptions: allPhones.filter((s) => s.user_id !== 'u-amar') })))
      .toMatchObject({ who: 'assigned', userIds: ['u-amar'], subscriptions: [] });
  });

  it('treats a waiter who no longer works there as nobody: the waiters on shift hear it', () => {
    const r = chooseRecipients(laSoul({ waiters: everyone.map((w) => (w === amar ? { ...w, is_active: false } : w)) }));
    expect(r.who).toBe('on_shift');
    expect(r.userIds.sort()).toEqual(['u-edin', 'u-lejla']);
  });
});

describe('a table nobody has', () => {
  const nobodys = laSoul({ session: { id: 'session-9', venue_id: L, assigned_waiter_id: null, table_number: 9 } });

  it('rings everyone on the day\'s rota and everyone who opened the waiter screen today', () => {
    const r = chooseRecipients(nobodys);
    expect(r.who).toBe('on_shift');
    // Amar and Lejla: on the rota. Edin: not on it, but working (opened the
    // screen this afternoon). Lejla's phone was last opened yesterday — the
    // rota is what counts for her.
    expect(r.userIds.sort()).toEqual(['u-amar', 'u-edin', 'u-lejla']);
    expect(users(nobodys)).toEqual(['u-amar', 'u-edin', 'u-lejla']);
  });

  it('lets someone off today sleep: not on the rota and not seen since the day began', () => {
    expect(chooseRecipients(nobodys).userIds).not.toContain('u-selma');
    // Seen at 04:59 Sarajevo time is yesterday's trading day.
    const late = { ...phone('selma', L), last_seen_at: '2026-11-03T03:59:00Z' };
    expect(users({ ...nobodys, subscriptions: [...allPhones.filter((s) => s.user_id !== 'u-selma'), late] })).not.toContain('u-selma');
  });

  it('rings nobody when nobody is working: no rota and no phone opened today', () => {
    expect(chooseRecipients({ ...nobodys, rota: [], subscriptions: allPhones.map((s) => ({ ...s, last_seen_at: yesterday })) }))
      .toMatchObject({ who: 'on_shift', userIds: [], subscriptions: [] });
  });
});

describe('two restaurants, one database: nothing crosses', () => {
  it('a La Soul order never rings Vera Italia\'s waiters, rota or phones', () => {
    const nobodys = laSoul({ session: { id: 's', venue_id: L, assigned_waiter_id: null, table_number: 9 } });
    const r = chooseRecipients(nobodys);
    // Giulia is on the rota list handed in, and both Vera phones were opened today.
    expect(r.userIds).not.toContain('u-giulia');
    expect(r.userIds).not.toContain('u-marco');
    expect(r.subscriptions.every((s) => s.venue_id === L)).toBe(true);
  });

  it('a Vera Italia call rings Vera Italia\'s waiter only', () => {
    const r = chooseRecipients({
      venueId: V,
      session: { id: 'session-v7', venue_id: V, assigned_waiter_id: giulia.id, table_number: 7 },
      waiters: everyone, rota: [amar.id, lejla.id, giulia.id], dayStart: DAY_START, subscriptions: allPhones,
    });
    expect(r).toMatchObject({ who: 'assigned', userIds: ['u-giulia'] });
    expect(r.subscriptions.map((s) => s.id)).toEqual(['sub-giulia-v-1']);
  });

  it('a table whose waiter id belongs to the other restaurant is treated as nobody\'s, at its own restaurant', () => {
    const r = chooseRecipients({
      venueId: V,
      session: { id: 'session-v7', venue_id: V, assigned_waiter_id: amar.id, table_number: 7 },
      waiters: everyone, rota: [amar.id, giulia.id], dayStart: DAY_START, subscriptions: allPhones,
    });
    expect(r.who).toBe('on_shift');
    expect(r.userIds.sort()).toEqual(['u-giulia', 'u-marco']);
    expect(r.subscriptions.map((s) => s.venue_id)).toEqual([V, V]);
  });

  it('someone who works at both rings only for the restaurant they turned alerts on at', () => {
    // Amar also waits tables at Vera Italia, but turned alerts on only on La Soul's screen.
    const amarAtVera = waiter('amar', V, { id: 'w-amar-v' });
    const r = chooseRecipients({
      venueId: V,
      session: { id: 'session-v7', venue_id: V, assigned_waiter_id: amarAtVera.id, table_number: 7 },
      waiters: [...everyone, amarAtVera], rota: [], dayStart: DAY_START, subscriptions: allPhones,
    });
    expect(r).toMatchObject({ who: 'assigned', userIds: ['u-amar'], subscriptions: [] });
  });

  it('sends nothing at all when the event and its table disagree about the restaurant', () => {
    expect(chooseRecipients(laSoul({ venueId: V }))).toEqual({ who: 'none', userIds: [], subscriptions: [] });
    expect(chooseRecipients(laSoul({ session: null }))).toEqual({ who: 'none', userIds: [], subscriptions: [] });
    expect(chooseRecipients(laSoul({ venueId: '' }))).toEqual({ who: 'none', userIds: [], subscriptions: [] });
  });
});

const event = (over: Partial<PushEventRow> = {}): PushEventRow => ({
  id: 'e1', venue_id: L, table_session_id: 'session-7', created_at: new Date(NOW - 5_000).toISOString(), status: 'pending', ...over,
});

describe('what is worth waking someone for', () => {
  it('a placed order, a call or a bill request, just now', () => {
    for (const source of ['orders', 'waiter_calls', 'bill_requests'] as const) {
      expect(skipReason(source, event(), NOW)).toBeNull();
    }
  });

  it('not a card order before it is paid; yes once it is, even if it was started a while ago', () => {
    expect(skipReason('orders', event({ status: 'awaiting_payment' }), NOW)).toBe('not_placed');
    expect(skipReason('orders', event({ status: 'payment_failed' }), NOW)).toBe('not_placed');
    expect(skipReason('orders', event({ status: 'cancelled' }), NOW)).toBe('not_placed');
    const paidLate = event({ status: 'pending', created_at: new Date(NOW - 20 * 60_000).toISOString(), paid_at: new Date(NOW - 3_000).toISOString() });
    expect(skipReason('orders', paidLate, NOW)).toBeNull();
  });

  it('not something already dealt with, and not old news', () => {
    expect(skipReason('waiter_calls', event({ status: 'resolved' }), NOW)).toBe('resolved');
    expect(skipReason('bill_requests', event({ created_at: new Date(NOW - 16 * 60_000).toISOString() }), NOW))
      .toBe('stale');
    expect(skipReason('bill_requests', event({ created_at: 'garbage' }), NOW)).toBe('stale');
  });
});

describe('what the lock screen says', () => {
  const lines = [
    { quantity: 2, name: 'Ćevapi' }, { quantity: 1, name: 'Espresso' }, { quantity: 1, name: 'Baklava' },
    { quantity: 3, name: 'Water' }, { quantity: 1, name: 'Tufahija' }, { quantity: 1, name: 'Lemonade' },
  ];

  it('a new order: the table first, then what and how much, then the restaurant', () => {
    const m = describeEvent('orders', event({ total: 38 }), { tableNumber: 7, venueName: 'La Soul', lines: lines.slice(0, 2), now: NOW });
    expect(m).toEqual({
      kind: 'order', title: 'New order · Table 7', body: '2× Ćevapi, 1× Espresso · 38.00 KM · La Soul',
      tag: 'orders:e1', url: '/waiter', venue: 'La Soul', at: new Date(NOW).toISOString(),
    });
  });

  it('a long order is cut to four lines and a count', () => {
    expect(orderLines(lines)).toBe('2× Ćevapi, 1× Espresso, 1× Baklava, 3× Water +2 more');
  });

  it('a held order asks to be confirmed', () => {
    const m = describeEvent('orders', event({ held_reason: 'large_first_order', total: 72 }), { tableNumber: 9, venueName: 'Vera Italia', lines: lines.slice(0, 1) });
    expect(m.kind).toBe('held');
    expect(m.title).toBe('Order to confirm · Table 9');
    expect(m.body).toBe('Held until you confirm it — 2× Ćevapi · 72.00 KM · Vera Italia');
  });

  it('a call, a call to pay, and the bill', () => {
    const ctx = { tableNumber: 3, venueName: 'La Soul' };
    expect(describeEvent('waiter_calls', event({ reason: 'assist' }), ctx)).toMatchObject({ kind: 'call', title: 'Calling you · Table 3', tag: 'waiter_calls:e1' });
    expect(describeEvent('waiter_calls', event({ reason: 'pay' }), ctx)).toMatchObject({ kind: 'pay', title: 'Wants to pay · Table 3' });
    expect(describeEvent('bill_requests', event(), ctx)).toMatchObject({ kind: 'bill', title: 'Wants the bill · Table 3', body: 'Bring the bill · La Soul' });
    expect(describeEvent('bill_requests', event(), { tableNumber: null, venueName: 'La Soul' }).title).toBe('Wants the bill · A table');
  });
});
