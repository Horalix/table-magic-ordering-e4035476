/**
 * @vitest-environment node
 *
 * The owner's overview (20261031110000_owner_overview.sql): both restaurants
 * at a glance, each with its own numbers, for the owner only.
 *
 * La Soul and Vera Italia are given different evenings — different orders,
 * calls, bills, ratings and printers — so a number that crossed from one to
 * the other would show up in the wrong row.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error -- plain JS harness, no types needed
import { createTestDatabase, actAs } from '../../scripts/db-harness.mjs';

type Db = {
  query: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
  exec: (sql: string) => Promise<unknown>;
  transaction: <T>(run: (tx: Db) => Promise<T>) => Promise<T>;
  close: () => Promise<void>;
};

interface Overview {
  venue_id: string;
  slug: string;
  name: string;
  sales: { gross: number; orders: number; paid: number; open: number; cancelled: number };
  last_week: { gross: number; orders: number; gross_by_now: number; orders_by_now: number };
  seated: { tables_now: number; covers_now: number | null; sittings_today: number };
  kitchen: { new: number; accepted: number; preparing: number; ready: number; held: number; oldest_wait_minutes: number | null };
  floor: { calls: number; oldest_call_minutes: number | null; bills: number; oldest_bill_minutes: number | null };
  rating: { average: number | null; count: number };
  top_dish: { name: string; units: number } | null;
  printers: { total: number; enabled: number; online: number; down: string[]; waiting: number };
  stale_orders: number;
}

const L = 'a5000000-0000-4000-8000-000000000001'; // La Soul
const V = 'a5000000-0000-4000-8000-000000000002'; // Vera Italia

const OWNER = '10000000-0000-0000-0000-000000000001';
const ADMIN_L = '10000000-0000-0000-0000-000000000002';
const ADMIN_V = '10000000-0000-0000-0000-000000000003';
const WAITER_L = '10000000-0000-0000-0000-000000000004';
const WAITER_V = '10000000-0000-0000-0000-000000000005';

const CAT_L = 'c0000000-0000-0000-0000-00000000000a';
const CAT_V = 'c0000000-0000-0000-0000-00000000000b';
const SUB_L = 'd0000000-0000-0000-0000-00000000000a';
const SUB_V = 'd0000000-0000-0000-0000-00000000000b';
const BURGER = 'e0000000-0000-0000-0000-00000000000a';
const COLA = 'e0000000-0000-0000-0000-00000000000c';
const PIZZA = 'e0000000-0000-0000-0000-00000000000b';
const T7_L = '30000000-0000-0000-0000-00000000000a';
const T8_L = '30000000-0000-0000-0000-00000000000c';
const T7_V = '30000000-0000-0000-0000-00000000000b';
const S7_L = '40000000-0000-0000-0000-00000000000a';
const S8_L = '40000000-0000-0000-0000-00000000000c';
const S7_V = '40000000-0000-0000-0000-00000000000b';

let db: Db;

beforeAll(async () => {
  db = (await createTestDatabase({ quiet: true })) as unknown as Db;
  await db.exec(`
    GRANT USAGE ON SCHEMA public TO anon, authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
    GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;
  `);
}, 180_000);
afterAll(async () => { await db?.close(); });

beforeEach(async () => {
  await db.exec(`
    TRUNCATE public.audit_log, public.order_ticket_events, public.order_items, public.orders,
             public.waiter_calls, public.bill_requests, public.ratings, public.table_sessions, public.tables,
             public.menu_items, public.subcategories, public.categories, public.order_code_counters,
             public.printers
      RESTART IDENTITY CASCADE;
    DELETE FROM public.user_roles;
    DELETE FROM auth.users;
    UPDATE public.restaurant_settings SET ordering_enabled = true, online_card_enabled = false;

    INSERT INTO auth.users(id) VALUES ('${OWNER}'), ('${ADMIN_L}'), ('${ADMIN_V}'), ('${WAITER_L}'), ('${WAITER_V}');
    INSERT INTO public.user_roles(user_id, role, venue_id) VALUES
      ('${OWNER}', 'admin', NULL), ('${ADMIN_L}', 'admin', '${L}'), ('${ADMIN_V}', 'admin', '${V}'),
      ('${WAITER_L}', 'staff', '${L}'), ('${WAITER_V}', 'staff', '${V}');

    INSERT INTO public.categories(id, name, sort_order, venue_id) VALUES
      ('${CAT_L}', 'Food', 1, '${L}'), ('${CAT_V}', 'Cucina', 1, '${V}');
    INSERT INTO public.subcategories(id, category_id, name, sort_order) VALUES
      ('${SUB_L}', '${CAT_L}', 'Burgers', 1), ('${SUB_V}', '${CAT_V}', 'Pizze', 1);
    INSERT INTO public.menu_items(id, subcategory_id, name, price, is_available, station) VALUES
      ('${BURGER}', '${SUB_L}', 'La Soul Burger', 18.00, true, 'kitchen'),
      ('${COLA}', '${SUB_L}', 'Cola', 3.00, true, 'bar'),
      ('${PIZZA}', '${SUB_V}', 'Pizza Margherita', 14.00, true, 'kitchen');

    INSERT INTO public.tables(id, table_number, qr_token, venue_id) VALUES
      ('${T7_L}', 7, 'sticker-lasoul-7', '${L}'), ('${T8_L}', 8, 'sticker-lasoul-8', '${L}'),
      ('${T7_V}', 7, 'sticker-vera-7', '${V}');
    INSERT INTO public.table_sessions(id, table_id, token, is_active, guest_name, last_heartbeat_at, covers) VALUES
      ('${S7_L}', '${T7_L}', 'tok-l7', true, 'Amina', now(), 4),
      ('${S8_L}', '${T8_L}', 'tok-l8', true, 'Haris', now(), NULL),
      ('${S7_V}', '${T7_V}', 'tok-v7', true, 'Marco', now(), 2);
  `);
  await actAs(db, null);
});

afterEach(async () => { await db.query(`SELECT set_config('request.headers', '', false)`); });

/** Run as a signed-in user, under the access rules. */
async function as<T>(user: string | null, run: () => Promise<T>): Promise<T> {
  await actAs(db, user);
  await db.exec('SET ROLE authenticated');
  try {
    return await run();
  } finally {
    await db.exec('RESET ROLE');
    await actAs(db, null);
  }
}

/** A guest orders at a table, the way the app does. */
async function guestOrders(session: string, token: string, lines: [string, number][]) {
  const { rows } = await db.query<{ result: { order_id: string } }>(
    `SELECT public.guest_place_order($1, $2, 'Guest', 'cash', $3::jsonb, 0) AS result`,
    [session, token, JSON.stringify(lines.map(([menu_item_id, quantity]) => ({ menu_item_id, quantity })))],
  );
  return rows[0].result.order_id;
}

/** The app names the restaurant it is showing in an x-venue header. */
const showing = (slug: string | null) =>
  db.query(`SELECT set_config('request.headers', $1, false)`, [slug ? JSON.stringify({ 'x-venue': slug }) : '']);

const overview = (user: string | null = OWNER) =>
  as(user, async () => (await db.query<{ r: Overview[] }>(`SELECT public.owner_overview() AS r`)).rows[0].r);

const byVenue = (rows: Overview[]) => Object.fromEntries(rows.map((r) => [r.slug, r]));

/**
 * Set an order's money and times as the evening would have: in the app only
 * an authorised operation (payment, release) may, so the setup says it is one.
 */
async function rewrite(sql: string) {
  await db.query(`SELECT set_config('lasoul.financial_ctx', 'on', false)`);
  try {
    await db.exec(sql);
  } finally {
    await db.query(`SELECT set_config('lasoul.financial_ctx', '', false)`);
  }
}

/** Two different evenings, one at each restaurant. */
async function anEvening() {
  // La Soul: three orders at two tables — one paid, one cooking, one cancelled.
  const paid = await guestOrders(S7_L, 'tok-l7', [[BURGER, 2], [COLA, 1]]); // 39 KM
  const cooking = await guestOrders(S8_L, 'tok-l8', [[BURGER, 1]]); // 18 KM
  const cancelled = await guestOrders(S8_L, 'tok-l8', [[COLA, 1]]); // 3 KM
  await rewrite(`
    UPDATE public.orders SET payment_status = 'paid' WHERE id = '${paid}';
    UPDATE public.orders SET released_to_kitchen_at = now() - interval '25 minutes' WHERE id = '${cooking}';
    UPDATE public.orders SET status = 'cancelled' WHERE id = '${cancelled}';
  `);
  // Through the kitchen one stage at a time, as the board moves them.
  for (const status of ['confirmed', 'preparing', 'ready', 'served']) {
    await db.query(`UPDATE public.orders SET status = $1::public.order_status WHERE id = $2`, [status, paid]);
  }
  for (const status of ['confirmed', 'preparing']) {
    await db.query(`UPDATE public.orders SET status = $1::public.order_status WHERE id = $2`, [status, cooking]);
  }

  // Vera Italia: one pizza, just in, unpaid.
  await guestOrders(S7_V, 'tok-v7', [[PIZZA, 1]]); // 14 KM

  // A call and a bill at Vera Italia, a bill at La Soul; one call long since dealt with.
  await db.exec(`
    INSERT INTO public.waiter_calls(table_session_id, status, created_at) VALUES
      ('${S7_V}', 'pending', now() - interval '6 minutes'),
      ('${S7_L}', 'resolved', now() - interval '30 minutes');
    INSERT INTO public.bill_requests(table_session_id, status, created_at) VALUES
      ('${S7_V}', 'pending', now() - interval '2 minutes'),
      ('${S8_L}', 'pending', now() - interval '9 minutes');
    INSERT INTO public.ratings(table_session_id, rating) VALUES ('${S7_L}', 5), ('${S8_L}', 4), ('${S7_V}', 2);

    -- La Soul's printer answers; Vera Italia's has been silent for ten minutes.
    INSERT INTO public.printers(name, station, poll_token, venue_id, last_seen_at) VALUES
      ('Kitchen', 'all', '${'l'.repeat(32)}', '${L}', now()),
      ('Cucina', 'all', '${'v'.repeat(32)}', '${V}', now() - interval '10 minutes');
  `);
}

describe('owner_overview: both restaurants, each its own', () => {
  it('gives every restaurant its own row, in a fixed order', async () => {
    const rows = await overview();
    expect(rows.map((r) => [r.slug, r.name, r.venue_id])).toEqual([
      ['lasoul', 'La Soul', L],
      ['veraitalia', 'Vera Italia', V],
    ]);
  });

  it('counts each restaurant\'s sales, orders, tables, kitchen, calls, ratings and printers as its own', async () => {
    await anEvening();
    const { lasoul, veraitalia } = byVenue(await overview());

    // The money, as each restaurant's own Daily Report has it.
    expect(lasoul.sales).toMatchObject({ gross: 57, orders: 2, paid: 1, open: 1, cancelled: 1 });
    expect(veraitalia.sales).toMatchObject({ gross: 14, orders: 1, paid: 0, open: 1, cancelled: 0 });

    // Who is sitting down: covers are what staff entered, unknown is not zero.
    expect(lasoul.seated).toMatchObject({ tables_now: 2, covers_now: 4, sittings_today: 2 });
    expect(veraitalia.seated).toMatchObject({ tables_now: 1, covers_now: 2, sittings_today: 1 });

    // The kitchen: La Soul's burger has been cooking 25 minutes; Vera Italia's pizza is new.
    expect(lasoul.kitchen).toMatchObject({ new: 0, preparing: 1, ready: 0, held: 0 });
    expect(lasoul.kitchen.oldest_wait_minutes).toBeGreaterThanOrEqual(25);
    expect(veraitalia.kitchen).toMatchObject({ new: 1, preparing: 0, ready: 0, held: 0 });
    expect(veraitalia.kitchen.oldest_wait_minutes).toBeLessThan(2);

    // Guests waiting for someone: only what is still pending.
    expect(lasoul.floor).toMatchObject({ calls: 0, oldest_call_minutes: null, bills: 1 });
    expect(lasoul.floor.oldest_bill_minutes).toBeGreaterThanOrEqual(9);
    expect(veraitalia.floor).toMatchObject({ calls: 1, bills: 1 });
    expect(veraitalia.floor.oldest_call_minutes).toBeGreaterThanOrEqual(6);

    expect(lasoul.rating).toEqual({ average: 4.5, count: 2 });
    expect(veraitalia.rating).toEqual({ average: 2, count: 1 });

    // The top dish is the restaurant's own; the cancelled cola does not count.
    expect(lasoul.top_dish).toMatchObject({ name: 'La Soul Burger', units: 3 });
    expect(veraitalia.top_dish).toMatchObject({ name: 'Pizza Margherita', units: 1 });

    expect(lasoul.printers).toMatchObject({ total: 1, enabled: 1, online: 1, down: [] });
    expect(veraitalia.printers).toMatchObject({ total: 1, enabled: 1, online: 0, down: ['Cucina'] });
  });

  it('agrees with what each restaurant\'s own admin reads', async () => {
    await anEvening();
    const { lasoul, veraitalia } = byVenue(await overview());
    const ownReport = (user: string) => as(user, async () =>
      (await db.query<{ r: { gross: number; orders: number } }>(`SELECT public.day_reconciliation() AS r`)).rows[0].r);
    expect(await ownReport(ADMIN_L)).toMatchObject({ gross: lasoul.sales.gross, orders: lasoul.sales.orders });
    expect(await ownReport(ADMIN_V)).toMatchObject({ gross: veraitalia.sales.gross, orders: veraitalia.sales.orders });

    // Tickets waiting at each restaurant's printer: its own orders' only.
    const ownQueue = (user: string) => as(user, async () =>
      (await db.query<{ waiting: number }>(`SELECT waiting FROM public.printer_health()`)).rows.reduce((n, p) => n + p.waiting, 0));
    expect(await ownQueue(ADMIN_L)).toBe(lasoul.printers.waiting);
    expect(await ownQueue(ADMIN_V)).toBe(veraitalia.printers.waiting);
    expect(lasoul.printers.waiting).toBeGreaterThan(0);
    expect(veraitalia.printers.waiting).toBeGreaterThan(0);
  });

  it('sets today beside the same weekday last week, by the same hour and whole', async () => {
    // Last week at La Soul: one order early in that trading day, one at its very end.
    const early = await guestOrders(S7_L, 'tok-l7', [[BURGER, 1]]);
    const late = await guestOrders(S7_L, 'tok-l7', [[COLA, 2]]);
    await rewrite(`
      UPDATE public.orders o SET created_at = r.starts_at + interval '1 second',
                                 released_to_kitchen_at = r.starts_at + interval '1 second'
        FROM public.business_day_range(public.business_day() - 7) r WHERE o.id = '${early}';
      UPDATE public.orders o SET created_at = r.ends_at - interval '1 second',
                                 released_to_kitchen_at = r.ends_at - interval '1 second'
        FROM public.business_day_range(public.business_day() - 7) r WHERE o.id = '${late}';
    `);
    const { lasoul, veraitalia } = byVenue(await overview());
    expect(lasoul.last_week).toMatchObject({ gross: 24, orders: 2, gross_by_now: 18, orders_by_now: 1 });
    expect(veraitalia.last_week).toMatchObject({ gross: 0, orders: 0, gross_by_now: 0, orders_by_now: 0 });
    // Nothing from last week leaks into today.
    expect(lasoul.sales).toMatchObject({ gross: 0, orders: 0 });
  });

  it('a held order is waiting on staff, not on the kitchen; a forgotten one is stale', async () => {
    const held = await guestOrders(S7_V, 'tok-v7', [[PIZZA, 1]]);
    const forgotten = await guestOrders(S7_L, 'tok-l7', [[BURGER, 1]]);
    await rewrite(`
      UPDATE public.orders SET released_to_kitchen_at = NULL, held_reason = 'large_first_order' WHERE id = '${held}';
      UPDATE public.orders SET created_at = now() - interval '2 days', released_to_kitchen_at = now() - interval '2 days'
       WHERE id = '${forgotten}';
    `);
    const { lasoul, veraitalia } = byVenue(await overview());
    expect(veraitalia.kitchen).toMatchObject({ new: 0, held: 1, oldest_wait_minutes: null });
    expect(lasoul.kitchen).toMatchObject({ new: 0, held: 0, oldest_wait_minutes: null });
    expect(lasoul.stale_orders).toBe(1);
    expect(veraitalia.stale_orders).toBe(0);
  });

  it('is the same whichever restaurant the owner\'s app is showing, and leaves that restaurant in place', async () => {
    await anEvening();
    const plain = await overview();
    await showing('veraitalia');
    expect(await overview()).toEqual(plain);

    // Within one transaction, after the overview the request is still about
    // the restaurant it was about before — not the last one the overview took.
    await actAs(db, OWNER);
    try {
      const venue = await db.transaction(async (tx) => {
        await tx.query(`SELECT set_config('lasoul.venue', $1, true)`, [L]);
        await tx.query(`SELECT public.owner_overview()`);
        return (await tx.query<{ v: string }>(`SELECT public.current_venue() AS v`)).rows[0].v;
      });
      expect(venue).toBe(L);
    } finally {
      await actAs(db, null);
    }
  });

  it('refuses a restaurant\'s admin, its staff, and anyone not signed in', async () => {
    await anEvening();
    for (const user of [ADMIN_L, ADMIN_V, WAITER_L, WAITER_V]) {
      await expect(overview(user)).rejects.toThrow(/Only the owner/);
    }
    // Naming the other restaurant, or their own, changes nothing.
    await showing('lasoul');
    await expect(overview(ADMIN_V)).rejects.toThrow(/Only the owner/);
    await showing('veraitalia');
    await expect(overview(ADMIN_V)).rejects.toThrow(/Only the owner/);
    await expect(overview(null)).rejects.toThrow(/Only the owner/);
    // And a guest cannot call it at all.
    await db.exec('SET ROLE anon');
    try {
      await expect(db.query(`SELECT public.owner_overview()`)).rejects.toThrow(/permission denied/);
    } finally {
      await db.exec('RESET ROLE');
    }
  });
});
