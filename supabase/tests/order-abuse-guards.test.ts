/**
 * @vitest-environment node
 *
 * Fake orders from a photographed QR code.
 *
 * The venue QR never changes and anyone with a picture of it can open a table
 * from the tram stop. These tests lock down what happens then: ordinary
 * orders still print the moment they land, the suspicious ones wait for a
 * member of staff, and staff can confirm, reject or block from any screen.
 *
 * The load-bearing ones are `a confirmed order prints exactly once` (two
 * waiters tapping Confirm must not cook it twice) and `a blocked session is
 * dead to every guest call`.
 */
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error -- plain JS harness, no types needed
import { createTestDatabase, actAs } from '../../scripts/db-harness.mjs';

type Db = {
  query: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
  exec: (sql: string) => Promise<unknown>;
  close: () => Promise<void>;
};

let db: Db;

const STAFF = '22222222-2222-2222-2222-222222222222';
const BURGER = 'cccccccc-0000-0000-0000-000000000001'; // 18 KM
const WATER = 'cccccccc-0000-0000-0000-000000000002'; // 2 KM
const VENUE = 'venue-token-current';
const tableId = (n: number) => `dddddddd-0000-0000-0000-${String(n).padStart(12, '0')}`;

type Result = Record<string, unknown>;

async function seed() {
  await db.exec(`
    TRUNCATE public.audit_log, public.analytics_events, public.order_ticket_events,
             public.order_items, public.orders, public.waiter_calls, public.bill_requests,
             public.session_join_requests, public.table_sessions, public.tables,
             public.menu_items, public.subcategories, public.categories, public.order_code_counters
      RESTART IDENTITY CASCADE;
    DELETE FROM public.user_roles;
    DELETE FROM auth.users;

    UPDATE public.restaurant_settings
       SET ordering_enabled = true, online_card_enabled = false, pay_at_table_enabled = true,
           session_idle_timeout_minutes = 180,
           hold_first_order_km = 60, hold_first_order_items = 10, hold_unpaid_km = 150,
           hold_burst_sessions = 3, hold_auto_admitted = true, hold_second_session = true,
           service_open = NULL, service_close = NULL
     WHERE id = 1;

    SELECT set_config('lasoul.qr_ctx', 'on', true);
    UPDATE public.restaurant_settings SET venue_qr_token = '${VENUE}' WHERE id = 1;
    SELECT set_config('lasoul.qr_ctx', '', true);

    INSERT INTO auth.users(id) VALUES ('${STAFF}');
    INSERT INTO public.user_roles(user_id, role) VALUES ('${STAFF}', 'staff');

    INSERT INTO public.categories(id, name, sort_order)
      VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'Food', 1);
    INSERT INTO public.subcategories(id, category_id, name, sort_order)
      VALUES ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Mains', 1);
    INSERT INTO public.menu_items(id, subcategory_id, name, price, is_available, station) VALUES
      ('${BURGER}', 'bbbbbbbb-0000-0000-0000-000000000001', 'La Soul Burger', 18.00, true, 'kitchen'),
      ('${WATER}',  'bbbbbbbb-0000-0000-0000-000000000001', 'Water',           2.00, true, 'kitchen');

    INSERT INTO public.tables(id, table_number)
      SELECT ('dddddddd-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid, g
        FROM generate_series(1, 9) g;
  `);
  await actAs(db, null);
  opened = 0;
}

let opened = 0;

/**
 * A session inserted directly. Each one opens a different, well-separated
 * number of minutes ago so the venue-burst rule only fires in the tests that
 * ask for it.
 */
async function session(table: number, opts: { openedAgo?: number } = {}) {
  opened += 1;
  const ago = opts.openedAgo ?? 30 + opened * 11;
  const { rows } = await db.query<{ id: string; token: string }>(
    `INSERT INTO public.table_sessions(table_id, token, is_active, guest_name, opened_at, last_heartbeat_at)
     VALUES ($1, $2, true, 'Amina', now() - make_interval(mins => $3), now())
     RETURNING id, token`,
    [tableId(table), `tok-${table}-${opened}`, ago]);
  return rows[0];
}

type Session = { id: string; token: string };

const lines = (item: string, qty: number, n = 1) =>
  Array.from({ length: n }, () => ({ menu_item_id: item, quantity: qty }));

async function place(s: Session, items: unknown[], method = 'cash'): Promise<Result> {
  const { rows } = await db.query<{ r: Result }>(
    `SELECT public.guest_place_order($1, $2, 'Amina', $3, $4::jsonb, 0) AS r`,
    [s.id, s.token, method, JSON.stringify(items)]);
  return rows[0].r;
}

async function failure(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return (e as Error).message;
  }
  return '';
}

/** Run as a signed-in member of staff, then go back to being a guest. */
async function asStaff<T>(sql: string, params: unknown[] = []): Promise<T> {
  await actAs(db, STAFF);
  try {
    const { rows } = await db.query<{ r: T }>(sql, params);
    return rows[0]?.r;
  } finally {
    await actAs(db, null);
  }
}

const order = async (id: unknown) => {
  const { rows } = await db.query<{
    status: string; released_to_kitchen_at: string | null; held_reason: string | null; held_at: string | null;
  }>(`SELECT status, released_to_kitchen_at, held_reason, held_at FROM public.orders WHERE id = $1`, [id]);
  return rows[0];
};

const tickets = async (id: unknown) => {
  const { rows } = await db.query<{ n: string }>(
    `SELECT count(*) AS n FROM public.order_ticket_events WHERE order_id = $1 AND status <> 'cancelled'`, [id]);
  return Number(rows[0].n);
};

const seenAt = async (id: string) => {
  const { rows } = await db.query<{ staff_seen_at: string | null }>(
    `SELECT staff_seen_at FROM public.table_sessions WHERE id = $1`, [id]);
  return rows[0].staff_seen_at;
};

const settings = (sql: string) => db.exec(`UPDATE public.restaurant_settings SET ${sql} WHERE id = 1`);

beforeAll(async () => {
  db = (await createTestDatabase({ quiet: true })) as unknown as Db;
}, 120_000);
afterAll(async () => { await db?.close(); });
beforeEach(seed);

// ---------------------------------------------------------------------------

describe('an ordinary order', () => {
  it('prints the moment it lands, as before', async () => {
    const s = await session(1);
    const r = await place(s, lines(BURGER, 2));
    expect(r.held).toBe(false);
    expect(r.held_reason).toBeNull();
    const o = await order(r.order_id);
    expect(o.status).toBe('pending');
    expect(o.released_to_kitchen_at).not.toBeNull();
    expect(o.held_reason).toBeNull();
    expect(await tickets(r.order_id)).toBe(1);
  });

  it('a card order is never held — it is already waiting for money', async () => {
    await settings(`online_card_enabled = true`);
    const s = await session(1);
    const r = await place(s, lines(BURGER, 10), 'card');
    expect(r.held).toBe(false);
    expect(r.status).toBe('awaiting_payment');
  });
});

describe('a held order', () => {
  it('waits for staff when the first order is large, and does not print', async () => {
    const s = await session(1);
    const r = await place(s, lines(BURGER, 4)); // 72 KM
    expect(r.held).toBe(true);
    expect(r.held_reason).toBe('large_first_order');
    expect(r.ticket_id).toBeNull();
    const o = await order(r.order_id);
    expect(o.status).toBe('pending');
    expect(o.released_to_kitchen_at).toBeNull();
    expect(o.held_at).not.toBeNull();
    expect(await tickets(r.order_id)).toBe(0);
  });

  it('waits when the first order is many cheap portions', async () => {
    const s = await session(1);
    const r = await place(s, lines(WATER, 1, 11)); // 22 KM, 11 portions
    expect(r.held_reason).toBe('large_first_order');
  });

  it('only the first order is judged on size', async () => {
    const s = await session(1);
    expect((await place(s, lines(BURGER, 1))).held).toBe(false);
    expect((await place(s, lines(BURGER, 4))).held).toBe(false); // 90 KM so far
  });

  it('waits when the unpaid total would pass the limit, and says which limit', async () => {
    const s = await session(1);
    expect((await place(s, lines(BURGER, 3))).held).toBe(false); // 54
    expect((await place(s, lines(BURGER, 3))).held).toBe(false); // 108
    const third = await place(s, lines(BURGER, 3)); // 162
    expect(third.held).toBe(true);
    expect(third.held_reason).toBe('unpaid_exposure:150');
  });

  it('counts held orders as exposure too', async () => {
    const s = await session(1);
    await settings(`hold_first_order_km = 50`);
    expect((await place(s, lines(BURGER, 3))).held_reason).toBe('large_first_order'); // 54, held
    await settings(`hold_first_order_km = NULL`);
    expect((await place(s, lines(BURGER, 3))).held).toBe(false); // 108
    expect((await place(s, lines(BURGER, 3))).held_reason).toBe('unpaid_exposure:150');
  });

  it('waits when someone joined the table without approval', async () => {
    const s = await session(1);
    await db.query(`UPDATE public.table_sessions SET auto_admitted_at = now() WHERE id = $1`, [s.id]);
    expect((await place(s, lines(WATER, 1))).held_reason).toBe('auto_admitted');
  });

  it('waits when another live session is on the same table', async () => {
    await session(1);
    const second = await session(1);
    expect((await place(second, lines(WATER, 1))).held_reason).toBe('second_session');
  });

  it('waits when many tables open at once', async () => {
    const burst = [];
    for (let t = 1; t <= 4; t += 1) burst.push(await session(t, { openedAgo: 1 }));
    expect((await place(burst[0], lines(WATER, 1))).held_reason).toBe('venue_burst');
  });

  it('does not call three tables at once a burst, nor count tables staff have seen', async () => {
    const burst = [];
    for (let t = 1; t <= 4; t += 1) burst.push(await session(t, { openedAgo: 1 }));
    await asStaff(`SELECT public.staff_mark_session_seen($1) AS r`, [burst[3].id]);
    expect((await place(burst[0], lines(WATER, 1))).held).toBe(false);
  });

  it('catches a burst that waited five minutes before ordering', async () => {
    const burst = [];
    for (let t = 1; t <= 4; t += 1) burst.push(await session(t, { openedAgo: 7 }));
    expect((await place(burst[0], lines(WATER, 1))).held_reason).toBe('venue_burst');
  });

  it('waits on a table whose last session staff blocked', async () => {
    const bad = await session(1);
    await asStaff(`SELECT public.staff_block_session($1, 'fake') AS r`, [bad.id]);
    const again = await session(1);
    expect((await place(again, lines(WATER, 1))).held_reason).toBe('table_recently_blocked');
  });
});

describe('service hours', () => {
  const at = async (t: string, open: string | null, close: string | null) => {
    const { rows } = await db.query<{ ok: boolean }>(
      `SELECT public.in_service_hours($1::time, $2::time, $3::time) AS ok`, [t, open, close]);
    return rows[0].ok;
  };

  it('understand hours that cross midnight', async () => {
    expect(await at('23:30', '18:00', '02:00')).toBe(true);
    expect(await at('01:59', '18:00', '02:00')).toBe(true);
    expect(await at('02:00', '18:00', '02:00')).toBe(false);
    expect(await at('12:00', '18:00', '02:00')).toBe(false);
    expect(await at('12:00', '08:00', '23:00')).toBe(true);
    expect(await at('07:59', '08:00', '23:00')).toBe(false);
  });

  it('are no gate at all when either end is empty', async () => {
    expect(await at('04:00', null, '02:00')).toBe(true);
    expect(await at('04:00', '08:00', null)).toBe(true);
    expect(await at('04:00', '08:00', '08:00')).toBe(true);
  });

  it('hold an order placed while the venue is closed (Sarajevo time)', async () => {
    // Open from one to two hours from now: closed right now, whatever the hour.
    await db.exec(`
      UPDATE public.restaurant_settings
         SET service_open  = (now() AT TIME ZONE 'Europe/Sarajevo')::time + interval '1 hour',
             service_close = (now() AT TIME ZONE 'Europe/Sarajevo')::time + interval '2 hours'
       WHERE id = 1`);
    const s = await session(1);
    expect((await place(s, lines(WATER, 1))).held_reason).toBe('outside_hours');
  });

  it('let an order through while open, even when the hours wrap past midnight', async () => {
    // Opened an hour ago and closes in twenty-three: always wraps midnight.
    await db.exec(`
      UPDATE public.restaurant_settings
         SET service_open  = (now() AT TIME ZONE 'Europe/Sarajevo')::time - interval '1 hour',
             service_close = (now() AT TIME ZONE 'Europe/Sarajevo')::time - interval '2 hours'
       WHERE id = 1`);
    const s = await session(1);
    expect((await place(s, lines(WATER, 1))).held).toBe(false);
  });
});

describe('a table staff have seen', () => {
  it('is never held, whatever it orders', async () => {
    const s = await session(1);
    await asStaff(`SELECT public.staff_set_covers($1, 4) AS r`, [s.id]);
    expect(await seenAt(s.id)).not.toBeNull();
    expect((await place(s, lines(BURGER, 10))).held).toBe(false);
  });

  it('is marked by taking a call, a bill request, a payment or a bump', async () => {
    const call = await session(1);
    await db.query(`INSERT INTO public.waiter_calls(table_session_id) VALUES ($1)`, [call.id]);
    await asStaff(`SELECT public.staff_ack_waiter_call(id) AS r FROM public.waiter_calls`);
    expect(await seenAt(call.id)).not.toBeNull();

    const bill = await session(2);
    await db.query(`INSERT INTO public.bill_requests(table_session_id) VALUES ($1)`, [bill.id]);
    await asStaff(`SELECT public.staff_ack_bill_request(id) AS r FROM public.bill_requests`);
    expect(await seenAt(bill.id)).not.toBeNull();

    const paid = await session(3);
    const p = await place(paid, lines(WATER, 1));
    expect(await seenAt(paid.id)).toBeNull();
    await asStaff(`SELECT public.record_table_payment($1, 'cash', NULL) AS r`, [p.order_id]);
    expect(await seenAt(paid.id)).not.toBeNull();

    const bumped = await session(4);
    const b = await place(bumped, lines(WATER, 1));
    await asStaff(
      `SELECT public.staff_bump_order_item(id, 'preparing') AS r FROM public.order_items WHERE order_id = $1`,
      [b.order_id]);
    expect(await seenAt(bumped.id)).not.toBeNull();
  });

  it('is not marked by a guest doing things, nor by staff rejecting an order', async () => {
    const s = await session(1);
    const r = await place(s, lines(BURGER, 4));
    await asStaff(`SELECT public.cancel_order($1, 'Nobody at table 1') AS r`, [r.order_id]);
    expect(await seenAt(s.id)).toBeNull();
    // The next attempt from the same phone waits too.
    expect((await place(s, lines(BURGER, 4))).held).toBe(true);
  });
});

describe('a rule set to empty', () => {
  it('is switched off', async () => {
    await settings(`hold_first_order_km = NULL, hold_first_order_items = NULL, hold_unpaid_km = NULL,
                    hold_burst_sessions = NULL, hold_auto_admitted = false, hold_second_session = false`);
    const first = await session(1, { openedAgo: 1 });
    for (let t = 2; t <= 5; t += 1) await session(t, { openedAgo: 1 });
    await session(1);
    await db.query(`UPDATE public.table_sessions SET auto_admitted_at = now() WHERE id = $1`, [first.id]);
    expect((await place(first, lines(BURGER, 10, 2))).held).toBe(false); // 360 KM, 20 portions
  });

  it('is refused at zero rather than holding everything', async () => {
    expect(await failure(settings(`hold_first_order_km = 0`))).toMatch(/hold_thresholds_positive/);
  });
});

describe('staff deciding', () => {
  it('a confirmed order prints exactly once', async () => {
    const s = await session(1);
    const r = await place(s, lines(BURGER, 4));
    const first = await asStaff<Result>(`SELECT public.staff_release_held_order($1) AS r`, [r.order_id]);
    expect(first.status).toBe('released');
    expect(first.ticket_id).not.toBeNull();
    const again = await asStaff<Result>(`SELECT public.staff_release_held_order($1) AS r`, [r.order_id]);
    expect(again.status).toBe('already_released');

    expect(await tickets(r.order_id)).toBe(1);
    const o = await order(r.order_id);
    expect(o.released_to_kitchen_at).not.toBeNull();
    expect(o.held_reason).toBeNull();
    expect(o.held_at).not.toBeNull();
    expect(await seenAt(s.id)).not.toBeNull();
    const { rows } = await db.query<{ before_state: { held_reason: string } }>(
      `SELECT before_state FROM public.audit_log WHERE action = 'order.hold_released' AND entity_id = $1`, [r.order_id]);
    expect(rows[0].before_state.held_reason).toBe('large_first_order');
  });

  it('only staff can confirm, and only a held order', async () => {
    const s = await session(1);
    const held = await place(s, lines(BURGER, 4));
    expect(await failure(db.query(`SELECT public.staff_release_held_order($1)`, [held.order_id])))
      .toMatch(/Only staff/);

    await settings(`online_card_enabled = true`);
    const card = await place(await session(2), lines(WATER, 1), 'card');
    expect(await failure(asStaff(`SELECT public.staff_release_held_order($1) AS r`, [card.order_id])))
      .toMatch(/not waiting for confirmation/);

    await asStaff(`SELECT public.cancel_order($1, 'No one there') AS r`, [held.order_id]);
    expect(await failure(asStaff(`SELECT public.staff_release_held_order($1) AS r`, [held.order_id])))
      .toMatch(/already rejected/);
    expect(await tickets(held.order_id)).toBe(0);
  });

  it('rejecting is an ordinary cancel with a reason', async () => {
    const s = await session(1);
    const r = await place(s, lines(BURGER, 4));
    const out = await asStaff<Result>(`SELECT public.cancel_order($1, 'Table empty') AS r`, [r.order_id]);
    expect(out.status).toBe('cancelled');
    expect((await order(r.order_id)).status).toBe('cancelled');
  });

  it('a held order cannot be cooked around the decision', async () => {
    const s = await session(1);
    const r = await place(s, lines(BURGER, 4));
    expect(await failure(asStaff(`SELECT public.staff_update_order_status($1, 'confirmed') AS r`, [r.order_id])))
      .toMatch(/waiting for a member of staff/);
    await asStaff(
      `SELECT public.staff_bump_order_item(id, 'preparing') AS r FROM public.order_items WHERE order_id = $1`,
      [r.order_id]).catch(() => undefined);
    expect((await order(r.order_id)).status).toBe('pending');
    expect(await tickets(r.order_id)).toBe(0);
  });
});

describe('blocking a table', () => {
  const start = async (table: number, client: string) => {
    const { rows } = await db.query<{ r: Result }>(
      `SELECT public.guest_start_table_session($1, $2, $3, 'Amina') AS r`, [table, VENUE, client]);
    return rows[0].r;
  };

  it('voids what has not printed, keeps what has, and ends the session', async () => {
    const s = await session(1);
    const printed = await place(s, lines(WATER, 1));
    await db.query(
      `UPDATE public.order_ticket_events SET status = 'printed', printed_at = now() WHERE order_id = $1`,
      [printed.order_id]);
    const queued = await place(s, lines(WATER, 2));
    const held = await place(s, lines(BURGER, 10));
    expect(held.held).toBe(true);

    const r = await asStaff<Result>(`SELECT public.staff_block_session($1, 'Prank from outside') AS r`, [s.id]);
    expect(r.status).toBe('blocked');
    expect(r.cancelled_orders).toBe(2);
    expect(r.orders_left).toBe(1);

    expect((await order(printed.order_id)).status).toBe('pending');
    expect((await order(queued.order_id)).status).toBe('cancelled');
    expect((await order(held.order_id)).status).toBe('cancelled');
    expect(await tickets(queued.order_id)).toBe(0);

    const { rows } = await db.query<{ is_active: boolean; blocked_at: string | null }>(
      `SELECT is_active, blocked_at FROM public.table_sessions WHERE id = $1`, [s.id]);
    expect(rows[0].is_active).toBe(false);
    expect(rows[0].blocked_at).not.toBeNull();
    const audit = await db.query<{ reason: string }>(
      `SELECT reason FROM public.audit_log WHERE action = 'table_session.blocked' AND entity_id = $1`, [s.id]);
    expect(audit.rows[0].reason).toBe('Prank from outside');
  });

  it('a blocked session is dead to every guest call', async () => {
    const s = await session(1);
    await asStaff(`SELECT public.staff_block_session($1, NULL) AS r`, [s.id]);
    // Even if something flips it back to active, blocked stays blocked.
    await db.query(`UPDATE public.table_sessions SET is_active = true WHERE id = $1`, [s.id]);

    expect(await failure(place(s, lines(WATER, 1)))).toMatch(/Invalid or expired/);
    expect(await failure(db.query(`SELECT public.guest_get_tab($1, $2)`, [s.id, s.token])))
      .toMatch(/Invalid or expired/);
    expect(await failure(db.query(`SELECT public.guest_call_waiter($1, $2, NULL)`, [s.id, s.token])))
      .toMatch(/Invalid or expired/);
  });

  it('the blocked phone cannot simply scan again at that table', async () => {
    const created = await start(3, 'phone-prank');
    expect(created.status).toBe('created');
    await asStaff(`SELECT public.staff_block_session($1, 'fake') AS r`, [created.session_id]);
    expect((await start(3, 'phone-prank')).status).toBe('invalid');
    // Someone else sitting down at table 3 is not punished for it.
    expect((await start(3, 'phone-real')).status).toBe('created');
  });

  it('only staff can block', async () => {
    const s = await session(1);
    expect(await failure(db.query(`SELECT public.staff_block_session($1, 'x')`, [s.id]))).toMatch(/Only staff/);
  });
});

describe('order size and count caps', () => {
  it('counts cancelled orders toward the thirty per session', async () => {
    const s = await session(1);
    await db.query(
      `INSERT INTO public.orders(table_session_id, total, status, payment_method, payment_status, created_at)
       SELECT $1, 2, 'cancelled', 'cash', 'unpaid', now() - interval '1 hour' FROM generate_series(1, 30)`,
      [s.id]);
    expect(await failure(place(s, lines(WATER, 1)))).toMatch(/Maximum orders reached/);
  });

  it('caps an order at twenty lines', async () => {
    const s = await session(1);
    expect(await failure(place(s, lines(WATER, 1, 21)))).toMatch(/Invalid order size/);
    expect(await failure(place(s, lines(WATER, 1, 20)))).toBe('');
  });

  it('caps an order at sixty portions', async () => {
    const s = await session(1);
    expect(await failure(place(s, lines(WATER, 10, 7)))).toMatch(/Invalid order size/);
    expect(await failure(place(s, lines(WATER, 10, 6)))).toBe('');
  });

  it('refuses a sixth order inside a minute (the real trigger, not disabled)', async () => {
    const s = await session(1);
    for (let i = 0; i < 5; i += 1) {
      expect(await failure(place(s, lines(WATER, 1)))).toBe('');
    }
    expect(await failure(place(s, lines(WATER, 1)))).toMatch(/Too many orders/);
    // A minute later the table can order again.
    await db.query(`UPDATE public.orders SET created_at = created_at - interval '61 seconds' WHERE table_session_id = $1`, [s.id]);
    expect(await failure(place(s, lines(WATER, 1)))).toBe('');
  });
});

describe('starting a session', () => {
  const start = async (table: number, client: string) => {
    const { rows } = await db.query<{ r: Result }>(
      `SELECT public.guest_start_table_session($1, $2, $3, 'Amina') AS r`, [table, VENUE, client]);
    return rows[0].r;
  };

  it('is serialised per table, so two phones cannot both open one', async () => {
    // PGlite is a single connection, so a true race cannot be staged here.
    // What can be proven: the function takes the per-table lock, the second
    // phone is offered a join, and the database refuses a second live guest
    // session on the table even if something gets past the lock.
    const { rows } = await db.query<{ src: string }>(
      `SELECT prosrc AS src FROM pg_proc WHERE proname = 'guest_start_table_session'`);
    expect(rows[0].src).toContain('pg_advisory_xact_lock(hashtext(v_table.id::text))');

    expect((await start(5, 'phone-a')).status).toBe('created');
    expect((await start(5, 'phone-b')).status).toBe('join_required');

    expect(await failure(db.query(
      `INSERT INTO public.table_sessions(table_id, host_client_id) VALUES ($1, 'phone-c')`, [tableId(5)])))
      .toMatch(/table_sessions_one_active_per_table/);
  });
});

describe('joining a table', () => {
  const start = async (client: string) => {
    const { rows } = await db.query<{ r: Result }>(
      `SELECT public.guest_start_table_session(6, $1, $2, 'Host') AS r`, [VENUE, client]);
    return rows[0].r;
  };
  const request = async (client: string) => {
    const { rows } = await db.query<{ r: Result }>(
      `SELECT public.guest_request_join(6, $1, $2, 'Stranger') AS r`, [VENUE, client]);
    return rows[0].r;
  };
  const autoApprove = async (sessionId: unknown, requestId: unknown, client: string) => {
    const { rows } = await db.query<{ r: Result }>(
      `SELECT public.guest_auto_approve_join_request(6, $1, $2, $3, $4) AS r`,
      [VENUE, sessionId, requestId, client]);
    return rows[0].r;
  };

  it('is only auto-approved when nobody at the table has the menu open', async () => {
    const host = await start('host-phone');
    const req = await request('stranger');
    await db.query(`UPDATE public.session_join_requests SET created_at = now() - interval '31 seconds'`);

    // The host's phone pinged a moment ago: the request waits for them.
    expect((await autoApprove(host.session_id, req.request_id, 'stranger')).status).toBe('pending');

    await db.query(`UPDATE public.table_sessions SET last_heartbeat_at = now() - interval '3 minutes' WHERE id = $1`,
      [host.session_id]);
    const ok = await autoApprove(host.session_id, req.request_id, 'stranger');
    expect(ok.status).toBe('approved');

    // ... and the table's next order waits for staff.
    const s = { id: ok.session_id as string, token: ok.session_token as string };
    expect((await place(s, lines(WATER, 1))).held_reason).toBe('auto_admitted');
  });

  it('caps pending requests at five per table', async () => {
    await start('host-phone');
    for (let i = 0; i < 5; i += 1) expect((await request(`spam-${i}`)).status).toBe('pending');
    expect(await failure(request('spam-5'))).toMatch(/Too many requests/);
  });

  it('caps requests at twenty per table per hour, answered or not', async () => {
    await start('host-phone');
    for (let i = 0; i < 20; i += 1) {
      await request(`spam-${i}`);
      await db.exec(`UPDATE public.session_join_requests SET status = 'declined' WHERE status = 'pending'`);
    }
    expect(await failure(request('spam-20'))).toMatch(/Too many requests/);
  });
});

describe('analytics', () => {
  const record = async (visit: string) => {
    const { rows } = await db.query<{ n: number }>(
      `SELECT public.record_analytics_events($1, $2::jsonb) AS n`,
      [visit, JSON.stringify([{ event: 'menu_viewed', props: {} }])]);
    return rows[0].n;
  };

  it('stops at a venue-wide ceiling no matter how many visit ids a script invents', async () => {
    expect(await record('visit-ok')).toBe(1);
    await db.exec(`
      INSERT INTO public.analytics_events(visit_id, event, created_at)
      SELECT 'flood-' || g, 'menu_viewed', now() FROM generate_series(1, 3000) g`);
    expect(await record('fresh-visit-id')).toBe(0);

    await db.exec(`UPDATE public.analytics_events SET created_at = now() - interval '2 minutes'`);
    expect(await record('fresh-visit-id')).toBe(1);
  });
});
