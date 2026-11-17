/**
 * The floor right now (demo mode only): tables that are sitting, with orders
 * at every stage — just in, cooking, ready to carry, eaten and unpaid.
 *
 * Unlike the history, these go through the app's real functions as a guest's
 * phone and a staff tablet would call them (guest_start_table_session,
 * guest_place_order, staff_update_order_status …), so codes, tickets, holds
 * and every rule in the migrations apply. Only afterwards are their clocks
 * turned back, so a ticket that "came in nine minutes ago" says so.
 *
 * The same functions drive the demo control's "new guests" button
 * (src/demo/ui/DemoControl.tsx).
 */
import type { DemoBackend } from '../backend/router';
import type { Identity } from '../backend/types';
import { ACCOUNTS, RESTAURANT, tableQrToken } from '../brand';
import { chooseLines } from './history';
import { COMBO, ITEM } from './menu';
import { TABLE_COUNT } from './restaurant';
import { Random } from './util';

const GUEST: Identity = { role: 'anon', sub: null, email: null };
const KITCHEN: Identity = { role: 'authenticated', sub: ACCOUNTS.kitchen.id, email: ACCOUNTS.kitchen.email };
const HEADERS = { 'x-venue': RESTAURANT.slug };

const LIVE_NAMES = ['Emina', 'Kenan', 'Sophie', 'Adnan', 'Lamija', 'Marco', 'Ajla', 'Yusuf', 'Nina', 'Vedad', 'Hana', 'Omar', 'Petra', 'Dino'];

export type Stage = 'held' | 'pending' | 'confirmed' | 'preparing' | 'ready' | 'served' | 'paid';

export interface OrderPlan {
  /** Minutes since it was placed. */
  ago: number;
  stage: Stage;
  /** Leave empty for a plausible order for the time of day. */
  items?: { id: string; quantity: number; notes?: string }[];
}

export interface TablePlan {
  table: number;
  guest: string;
  covers: number;
  orders: OrderPlan[];
  /** A waiter call or a bill request waiting, minutes old. */
  call?: number;
  bill?: number;
}

async function must<T>(backend: DemoBackend, name: string, args: Record<string, unknown>, who: Identity): Promise<T> {
  const { data, error } = await backend.rpc<T>(name, args, who, HEADERS);
  if (error) throw new Error(`${name}: ${error.message}${error.details ? ` (${error.details})` : ''}`);
  return data as T;
}

const STAGES: Stage[] = ['pending', 'confirmed', 'preparing', 'ready', 'served'];

/** Seats a table and places its orders; returns the session, or null when the table is taken. */
export async function seatTable(backend: DemoBackend, plan: TablePlan, rng: Random, now: Date): Promise<string | null> {
  const clientId = `demo-live-${rng.token(12)}`;
  const started = await must<{ status: string; session_id?: string; session_token?: string }>(backend, 'guest_start_table_session', {
    _table_number: plan.table, _qr_token: tableQrToken(plan.table), _client_id: clientId, _guest_name: plan.guest,
  }, GUEST);
  if (!started.session_id || !started.session_token) return null;
  const sessionId = started.session_id;
  const oldest = Math.max(0, ...plan.orders.map((o) => o.ago));
  const soldOut = new Set((await backend.db.query<{ id: string }>(`SELECT id FROM public.menu_items WHERE NOT is_available OR deleted_at IS NOT NULL`)).rows.map((r) => r.id));

  for (const order of plan.orders) {
    const at = new Date(now.getTime() - order.ago * 60_000);
    const lines = order.items
      ?? chooseLines(rng, at, plan.covers, order === plan.orders[0] ? 0 : 1, { until: now, historyStart: '2026-01-01', historyDays: 1, detail: false, tickets: false, policyVersion: '' })
        // A combo needs its choices; on the live floor the burger is ordered on its own.
        .map((l) => (l.item.id === COMBO.item
          ? { id: String(l.components?.[0]?.item_id ?? ITEM.casaBurger), quantity: l.quantity }
          : { id: l.item.id, quantity: Math.min(l.quantity, 6), notes: l.notes ?? undefined }))
        .filter((l) => !soldOut.has(l.id));
    if (!lines.length) lines.push({ id: ITEM.cappuccino, quantity: plan.covers });
    const placed = await must<{ order_id: string; held?: boolean }>(backend, 'guest_place_order', {
      _session_id: sessionId, _session_token: started.session_token, _guest_name: plan.guest,
      _payment_method: order.stage === 'paid' ? 'cash' : rng.pick(['cash', 'pos_terminal']),
      _items: lines.map((l) => ({ menu_item_id: l.id, quantity: l.quantity, notes: l.notes ?? null })),
      _tip: 0, _client_order_id: rng.uuid(),
    }, GUEST);
    const target = order.stage === 'paid' ? 'served' : order.stage;
    if (target !== 'held' && target !== 'pending') {
      if (placed.held) await must(backend, 'staff_release_held_order', { _order_id: placed.order_id }, KITCHEN);
      for (const stage of STAGES.slice(1, STAGES.indexOf(target) + 1)) {
        await must(backend, 'staff_update_order_status', { _order_id: placed.order_id, _status: stage }, KITCHEN);
      }
    }
    if (order.stage === 'paid') await must(backend, 'record_table_payment', { _order_id: placed.order_id, _method: 'cash' }, KITCHEN);
    await backdateOrder(backend, placed.order_id, order.ago);
  }
  if (plan.call !== undefined) {
    const call = await must<{ call_id: string }>(backend, 'guest_call_waiter', { _session_id: sessionId, _session_token: started.session_token, _reason: 'assist' }, GUEST);
    await backend.db.query(`UPDATE public.waiter_calls SET created_at = now() - make_interval(mins => $2::int) WHERE id = $1::text::uuid`, [call.call_id, plan.call]);
  }
  if (plan.bill !== undefined) {
    const bill = await must<{ bill_request_id: string }>(backend, 'guest_request_bill', { _session_id: sessionId, _session_token: started.session_token }, GUEST);
    await backend.db.query(`UPDATE public.bill_requests SET created_at = now() - make_interval(mins => $2::int) WHERE id = $1::text::uuid`, [bill.bill_request_id, plan.bill]);
  }
  await backend.db.query(
    `UPDATE public.table_sessions SET opened_at = now() - make_interval(mins => $2::int), covers = $3::int,
            first_order_at = (SELECT min(created_at) FROM public.orders WHERE table_session_id = $1::text::uuid)
      WHERE id = $1::text::uuid`,
    [sessionId, oldest + 4, plan.covers],
  );
  return sessionId;
}

/**
 * Turns an order's clock back: placed `ago` minutes ago, and each later stage
 * a believable while after that. The audit trigger on orders refuses edits to
 * these columns from the API, so this runs as the database's owner with
 * triggers off, exactly as a restore would.
 */
async function backdateOrder(backend: DemoBackend, orderId: string, ago: number): Promise<void> {
  if (ago <= 0) return;
  const { db } = backend;
  await db.exec('SET session_replication_role = replica');
  try {
    await db.query(
      `UPDATE public.orders o SET
         created_at = t.at, held_at = CASE WHEN o.held_at IS NULL THEN NULL ELSE t.at END,
         released_to_kitchen_at = CASE WHEN o.released_to_kitchen_at IS NULL THEN NULL ELSE t.at + interval '5 seconds' END,
         confirmed_at = CASE WHEN o.confirmed_at IS NULL THEN NULL ELSE t.at + t.span * 0.08 END,
         preparing_at = CASE WHEN o.preparing_at IS NULL THEN NULL ELSE t.at + t.span * 0.16 END,
         ready_at = CASE WHEN o.ready_at IS NULL THEN NULL ELSE t.at + t.span * 0.62 END,
         served_at = CASE WHEN o.served_at IS NULL THEN NULL ELSE t.at + t.span * 0.72 END,
         paid_at = CASE WHEN o.paid_at IS NULL THEN NULL ELSE t.at + t.span * 0.95 END,
         updated_at = now()
       FROM (SELECT now() - make_interval(mins => $2::int) AS at, LEAST(make_interval(mins => $2::int), interval '40 minutes') AS span) t
       WHERE o.id = $1::text::uuid`,
      [orderId, ago],
    );
    await db.query(
      `UPDATE public.order_items i SET
         created_at = o.created_at,
         started_at = CASE WHEN i.started_at IS NULL THEN NULL ELSE COALESCE(o.preparing_at, o.confirmed_at, o.created_at) END,
         ready_at = CASE WHEN i.ready_at IS NULL THEN NULL
                         WHEN i.station = 'bar' THEN LEAST(o.created_at + interval '4 minutes', COALESCE(o.ready_at, o.created_at))
                         ELSE COALESCE(o.ready_at, o.created_at) END,
         served_at = CASE WHEN i.served_at IS NULL THEN NULL ELSE o.served_at END
       FROM public.orders o WHERE o.id = i.order_id AND o.id = $1::text::uuid`,
      [orderId],
    );
    await db.query(
      `UPDATE public.order_ticket_events e SET created_at = o.created_at, updated_at = o.created_at + interval '8 seconds',
              printed_at = CASE WHEN e.printed_at IS NULL THEN NULL ELSE o.created_at + interval '8 seconds' END
         FROM public.orders o WHERE o.id = e.order_id AND o.id = $1::text::uuid`,
      [orderId],
    );
  } finally {
    await db.exec('SET session_replication_role = origin');
  }
}

/** The floor as the demo opens: a service in full swing, with the guest's own table left free. */
export async function seedLiveFloor(backend: DemoBackend, now: Date): Promise<void> {
  const rng = new Random(`casa-demo:live:${now.toISOString().slice(0, 13)}`);
  const names = [...LIVE_NAMES];
  const name = () => names.splice(rng.int(0, names.length - 1), 1)[0];
  const plans: TablePlan[] = [
    { table: 1, guest: name(), covers: 2, orders: [{ ago: 41, stage: 'served' }], bill: 3 },
    { table: 2, guest: name(), covers: 2, orders: [{ ago: 7, stage: 'preparing' }] },
    { table: 3, guest: name(), covers: 3, orders: [{ ago: 15, stage: 'ready' }] },
    { table: 4, guest: name(), covers: 2, orders: [{ ago: 26, stage: 'served' }], call: 2 },
    { table: 7, guest: name(), covers: 3, orders: [{ ago: 10, stage: 'preparing' }] },
    { table: 8, guest: name(), covers: 2, orders: [{ ago: 52, stage: 'served' }, { ago: 2, stage: 'pending' }] },
    { table: 9, guest: name(), covers: 2, orders: [{ ago: 1, stage: 'pending' }] },
    { table: 11, guest: name(), covers: 3, orders: [{ ago: 16, stage: 'preparing' }] },
    { table: 12, guest: name(), covers: 2, orders: [{ ago: 58, stage: 'paid' }] },
  ];
  for (const plan of plans) {
    try { await seatTable(backend, plan, rng, now); } catch (error) { console.warn('[demo] could not seat table', plan.table, error); }
  }
  // Orders already cooked had their tickets printed long ago; only the new ones are still to print.
  await backend.db.query(
    `UPDATE public.order_ticket_events e SET status = 'printed', attempts = 1, print_verified = true,
            printed_at = e.created_at + interval '8 seconds', original_printed_at = e.created_at + interval '8 seconds',
            claimed_by_device = CASE WHEN e.ticket_type = 'bar' THEN 'printer:Bar' ELSE 'printer:Kitchen pass' END
       FROM public.orders o
      WHERE o.id = e.order_id AND e.status = 'queued' AND o.status IN ('preparing', 'ready', 'served')`);
  // Who has which table: the waiter whose section it is in, as the floor plan says.
  await backend.db.query(
    `UPDATE public.table_sessions s SET assigned_waiter_id = (
        SELECT a.waiter_id FROM public.tables t JOIN public.section_assignments a ON a.section_id = t.section_id
         WHERE t.id = s.table_id AND a.shift_date = public.business_day() ORDER BY a.waiter_id LIMIT 1)
      WHERE s.is_active AND s.assigned_waiter_id IS NULL`);
}

/** One new table sits down and orders: the demo control's "new guests" button. Returns the table, or null when the room is full. */
export async function simulateArrival(backend: DemoBackend, now = new Date()): Promise<{ table: number; guest: string } | null> {
  const rng = new Random(`casa-demo:arrival:${now.getTime()}`);
  const { rows } = await backend.db.query<{ table_number: number }>(
    `SELECT t.table_number FROM public.tables t
      WHERE t.venue_id = $1::text::uuid AND t.table_number <> $2::int AND t.table_number <= $3::int
        AND NOT EXISTS (SELECT 1 FROM public.table_sessions s WHERE s.table_id = t.id AND s.is_active)
      ORDER BY t.table_number`,
    [RESTAURANT.dbId, RESTAURANT.guestTable, TABLE_COUNT],
  );
  if (!rows.length) return null;
  const table = rng.pick(rows).table_number;
  const guest = rng.pick(LIVE_NAMES);
  await seatTable(backend, { table, guest, covers: rng.int(1, 4), orders: [{ ago: 0, stage: 'pending' }] }, rng, now);
  return { table, guest };
}

/**
 * A party sits down and orders for the whole table at once. A first order
 * this large is held for a waiter to confirm before the kitchen sees it
 * (Admin → Service → "hold"): the demo control's "large first order" button.
 */
export async function simulateLargeOrder(backend: DemoBackend, now = new Date()): Promise<{ table: number; guest: string } | null> {
  const rng = new Random(`casa-demo:large:${now.getTime()}`);
  const { rows } = await backend.db.query<{ table_number: number }>(
    `SELECT t.table_number FROM public.tables t
      WHERE t.venue_id = $1::text::uuid AND t.table_number <> $2::int
        AND NOT EXISTS (SELECT 1 FROM public.table_sessions s WHERE s.table_id = t.id AND s.is_active)
      ORDER BY t.table_number DESC`,
    [RESTAURANT.dbId, RESTAURANT.guestTable],
  );
  if (!rows.length) return null;
  const table = rows[0].table_number;
  const guest = rng.pick(LIVE_NAMES);
  await seatTable(backend, {
    table, guest, covers: 8, orders: [{
      ago: 0, stage: 'held',
      items: [
        { id: ITEM.truffleRisotto, quantity: 4 }, { id: ITEM.casaBurger, quantity: 4 },
        { id: ITEM.chickenCaesar, quantity: 2 }, { id: ITEM.lemonMint, quantity: 8 },
      ],
    }],
  }, rng, now);
  return { table, guest };
}

/** A sitting table asks for something: a waiter, or the bill. */
export async function simulateCall(backend: DemoBackend): Promise<{ table: number; kind: 'waiter' | 'bill' } | null> {
  const { rows } = await backend.db.query<{ id: string; token: string; table_number: number; calls: number; bills: number }>(
    `SELECT s.id, s.token, t.table_number,
            (SELECT count(*) FROM public.waiter_calls c WHERE c.table_session_id = s.id AND c.status <> 'resolved')::int AS calls,
            (SELECT count(*) FROM public.bill_requests b WHERE b.table_session_id = s.id AND b.status IN ('pending', 'acknowledged'))::int AS bills
       FROM public.table_sessions s JOIN public.tables t ON t.id = s.table_id
      WHERE s.is_active AND s.venue_id = $1::text::uuid AND t.table_number <> $2::int
      ORDER BY random()`,
    [RESTAURANT.dbId, RESTAURANT.guestTable],
  );
  const quiet = rows.find((r) => r.calls === 0) ?? null;
  if (!quiet) return null;
  const kind = quiet.bills === 0 && Math.random() < 0.4 ? 'bill' : 'waiter';
  if (kind === 'bill') await must(backend, 'guest_request_bill', { _session_id: quiet.id, _session_token: quiet.token }, GUEST);
  else await must(backend, 'guest_call_waiter', { _session_id: quiet.id, _session_token: quiet.token, _reason: 'assist' }, GUEST);
  return { table: quiet.table_number, kind };
}

