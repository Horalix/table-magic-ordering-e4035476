/**
 * @vitest-environment node
 *
 * Two restaurants, one database (20261028090000_two_restaurants_foundation.sql,
 * docs/two-restaurants.md): La Soul and Vera Italia, and nothing crosses.
 *
 * Every test here tries to cross — a guest ordering the other restaurant's
 * dish, a waiter reading or changing the other restaurant's orders, an admin
 * editing the other menu or making a super admin — and must be refused.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error -- plain JS harness, no types needed
import { createTestDatabase, actAs } from '../../scripts/db-harness.mjs';

type Db = {
  query: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<{ rows: T[]; affectedRows?: number }>;
  exec: (sql: string) => Promise<unknown>;
  close: () => Promise<void>;
};

const L = 'a5000000-0000-4000-8000-000000000001'; // La Soul
const V = 'a5000000-0000-4000-8000-000000000002'; // Vera Italia

const SUPER = '10000000-0000-0000-0000-000000000001';
const ADMIN_L = '10000000-0000-0000-0000-000000000002';
const ADMIN_V = '10000000-0000-0000-0000-000000000003';
const WAITER_L = '10000000-0000-0000-0000-000000000004';
const WAITER_V = '10000000-0000-0000-0000-000000000005';
const NEWCOMER = '10000000-0000-0000-0000-000000000006';

const CAT_L = 'c0000000-0000-0000-0000-00000000000a';
const CAT_V = 'c0000000-0000-0000-0000-00000000000b';
const SUB_L = 'd0000000-0000-0000-0000-00000000000a';
const SUB_V = 'd0000000-0000-0000-0000-00000000000b';
const DISH_L = 'e0000000-0000-0000-0000-00000000000a'; // La Soul Burger
const DISH_V = 'e0000000-0000-0000-0000-00000000000b'; // Pizza Margherita
const SEC_L = 'f0000000-0000-0000-0000-00000000000a';
const SEC_V = 'f0000000-0000-0000-0000-00000000000b';
const W_L = '20000000-0000-0000-0000-00000000000a';
const W_V = '20000000-0000-0000-0000-00000000000b';
const T7_L = '30000000-0000-0000-0000-00000000000a';
const T7_V = '30000000-0000-0000-0000-00000000000b';
const S_L = '40000000-0000-0000-0000-00000000000a';
const S_V = '40000000-0000-0000-0000-00000000000b';

let db: Db;

beforeAll(async () => {
  db = (await createTestDatabase({ quiet: true })) as unknown as Db;
  // What Supabase grants by default; the access rules decide the rest.
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
             public.waiter_calls, public.bill_requests, public.table_sessions, public.tables,
             public.section_assignments, public.sections, public.waiters, public.shift_closes,
             public.menu_items, public.subcategories, public.categories, public.order_code_counters,
             public.printers, public.analytics_events
      RESTART IDENTITY CASCADE;
    DELETE FROM public.user_roles;
    DELETE FROM auth.users;
    UPDATE public.restaurant_settings SET ordering_enabled = true, online_card_enabled = false;

    INSERT INTO auth.users(id) VALUES ('${SUPER}'), ('${ADMIN_L}'), ('${ADMIN_V}'), ('${WAITER_L}'), ('${WAITER_V}'), ('${NEWCOMER}');
    INSERT INTO public.user_roles(user_id, role, venue_id) VALUES
      ('${SUPER}', 'admin', NULL), ('${ADMIN_L}', 'admin', '${L}'), ('${ADMIN_V}', 'admin', '${V}'),
      ('${WAITER_L}', 'staff', '${L}'), ('${WAITER_V}', 'staff', '${V}');

    INSERT INTO public.categories(id, name, sort_order, venue_id) VALUES
      ('${CAT_L}', 'Food', 1, '${L}'), ('${CAT_V}', 'Cucina', 1, '${V}');
    INSERT INTO public.subcategories(id, category_id, name, sort_order) VALUES
      ('${SUB_L}', '${CAT_L}', 'Burgers', 1), ('${SUB_V}', '${CAT_V}', 'Pizze', 1);
    INSERT INTO public.menu_items(id, subcategory_id, name, price, is_available, station) VALUES
      ('${DISH_L}', '${SUB_L}', 'La Soul Burger', 18.00, true, 'kitchen'),
      ('${DISH_V}', '${SUB_V}', 'Pizza Margherita', 14.00, true, 'kitchen');

    INSERT INTO public.sections(id, name, venue_id) VALUES ('${SEC_L}', 'Terrace', '${L}'), ('${SEC_V}', 'Sala', '${V}');
    INSERT INTO public.waiters(id, user_id, display_name, venue_id) VALUES
      ('${W_L}', '${WAITER_L}', 'Amar', '${L}'), ('${W_V}', '${WAITER_V}', 'Giulia', '${V}');
    INSERT INTO public.tables(id, table_number, qr_token, venue_id) VALUES
      ('${T7_L}', 7, 'sticker-lasoul-7', '${L}'), ('${T7_V}', 7, 'sticker-vera-7', '${V}');
    INSERT INTO public.table_sessions(id, table_id, token, is_active, guest_name, last_heartbeat_at) VALUES
      ('${S_L}', '${T7_L}', 'tok-l', true, 'Amina', now()),
      ('${S_V}', '${T7_V}', 'tok-v', true, 'Marco', now());
  `);
  await actAs(db, null);
});

/** Run as a signed-in user, under the access rules. */
async function as<T>(user: string, run: () => Promise<T>): Promise<T> {
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
async function guestOrders(session: string, token: string, dish: string) {
  const { rows } = await db.query<{ result: { order_id: string } }>(
    `SELECT public.guest_place_order($1, $2, 'Guest', 'cash', $3::jsonb, 0) AS result`,
    [session, token, JSON.stringify([{ menu_item_id: dish, quantity: 1 }])],
  );
  return rows[0].result.order_id;
}

const ids = (rows: { id: string }[]) => rows.map((r) => r.id).sort();
const venueOf = async (table: string, id: string) =>
  (await db.query<{ venue_id: string }>(`SELECT venue_id FROM public.${table} WHERE id = $1`, [id])).rows[0]?.venue_id;

describe('a guest orders only from the restaurant they sit in', () => {
  it('orders their own restaurant\'s dish, and the order belongs to that restaurant', async () => {
    const order = await guestOrders(S_V, 'tok-v', DISH_V);
    expect(await venueOf('orders', order)).toBe(V);
    const { rows } = await db.query<{ venue_id: string }>(`SELECT venue_id FROM public.order_items WHERE order_id = $1`, [order]);
    expect(rows.map((r) => r.venue_id)).toEqual([V]);
  });

  it('cannot order La Soul\'s dish at a Vera Italia table, or the other way round', async () => {
    // To the guest the other restaurant's dish reads like a sold-out one.
    await expect(guestOrders(S_V, 'tok-v', DISH_L)).rejects.toThrow(/Unavailable: La Soul Burger/);
    await expect(guestOrders(S_L, 'tok-l', DISH_V)).rejects.toThrow(/Unavailable: Pizza Margherita/);
    expect((await db.query(`SELECT 1 FROM public.orders`)).rows).toHaveLength(0);

    // Behind that, the database itself refuses an order line for the other
    // menu, however it is written.
    const order = await guestOrders(S_V, 'tok-v', DISH_V);
    await expect(db.exec(`INSERT INTO public.order_items(order_id, menu_item_id, quantity, unit_price)
                          VALUES ('${order}', '${DISH_L}', 1, 18)`)).rejects.toThrow(/Not available at this restaurant/);
  });

  it('a QR code names its table, and through it its restaurant — both have a table 7', async () => {
    const resolve = async (n: number, token: string) =>
      (await db.query<{ id: string | null }>(`SELECT (public.resolve_table_for_token($1, $2)).id AS id`, [n, token])).rows[0].id;
    const room = async (venue: string) =>
      (await db.query<{ t: string }>(`SELECT venue_qr_token AS t FROM public.restaurant_settings WHERE venue_id = $1`, [venue])).rows[0].t;

    expect(await resolve(7, 'sticker-vera-7')).toBe(T7_V);
    expect(await resolve(7, 'sticker-lasoul-7')).toBe(T7_L);
    expect(await resolve(7, await room(V))).toBe(T7_V);
    expect(await resolve(7, await room(L))).toBe(T7_L);
    expect(await resolve(8, await room(V))).toBeNull();
    expect(await resolve(7, 'not-a-code')).toBeNull();
    expect(await room(L)).not.toBe(await room(V));
  });

  it('a room code says which restaurant it is, and that restaurant\'s highest table', async () => {
    await db.exec(`INSERT INTO public.tables(table_number, venue_id) VALUES (12, '${V}')`);
    const { rows } = await db.query<{ r: { valid: boolean; venue: string; max_table_number: number } }>(
      `SELECT public.guest_check_venue_token((SELECT venue_qr_token FROM public.restaurant_settings WHERE venue_id = $1)) AS r`, [V]);
    expect(rows[0].r).toMatchObject({ valid: true, venue: 'veraitalia', max_table_number: 12 });
  });
});

describe('every row belongs to one restaurant', () => {
  it('both restaurants can have a table 7, but one restaurant cannot have two', async () => {
    await expect(db.exec(`INSERT INTO public.tables(table_number, venue_id) VALUES (7, '${V}')`)).rejects.toThrow(/tables_table_number_key/);
    await db.exec(`INSERT INTO public.tables(table_number, venue_id) VALUES (8, '${V}'), (8, '${L}')`);
  });

  it('takes its parent\'s restaurant, whatever it was given', async () => {
    await db.exec(`INSERT INTO public.subcategories(id, category_id, name, sort_order, venue_id)
                   VALUES ('d0000000-0000-0000-0000-00000000000c', '${CAT_V}', 'Antipasti', 2, '${L}')`);
    expect(await venueOf('subcategories', 'd0000000-0000-0000-0000-00000000000c')).toBe(V);
    expect(await venueOf('menu_items', DISH_V)).toBe(V);
    expect(await venueOf('table_sessions', S_V)).toBe(V);
  });

  it('nothing mixes the two', async () => {
    await expect(db.exec(`INSERT INTO public.tables(table_number, venue_id, section_id) VALUES (20, '${V}', '${SEC_L}')`))
      .rejects.toThrow(/Not available at this restaurant/);
    await expect(db.exec(`INSERT INTO public.section_assignments(section_id, waiter_id, shift_date) VALUES ('${SEC_V}', '${W_L}', CURRENT_DATE)`))
      .rejects.toThrow(/Not available at this restaurant/);
    await expect(db.exec(`UPDATE public.table_sessions SET assigned_waiter_id = '${W_V}' WHERE id = '${S_L}'`))
      .rejects.toThrow(/Not available at this restaurant/);
  });

  it('a root row never moves to the other restaurant', async () => {
    await expect(db.exec(`UPDATE public.categories SET venue_id = '${V}' WHERE id = '${CAT_L}'`)).rejects.toThrow(/cannot move/);
    await expect(db.exec(`UPDATE public.tables SET venue_id = '${L}' WHERE id = '${T7_V}'`)).rejects.toThrow(/cannot move/);
  });

  it('order numbers count per restaurant', async () => {
    const next = async (venue: string) =>
      (await db.query<{ c: string }>(`SELECT public.next_order_code($1) AS c`, [venue])).rows[0].c;
    expect(await next(L)).toBe('001');
    expect(await next(V)).toBe('001');
    expect(await next(V)).toBe('002');
    expect(await next(L)).toBe('002');
  });
});

describe('staff see and change only their own restaurant', () => {
  let orderL: string;
  let orderV: string;
  beforeEach(async () => {
    orderL = await guestOrders(S_L, 'tok-l', DISH_L);
    orderV = await guestOrders(S_V, 'tok-v', DISH_V);
  });

  const visibleOrders = (user: string) =>
    as(user, async () => ids((await db.query<{ id: string }>(`SELECT id FROM public.orders`)).rows));

  it('a waiter, a restaurant admin and the owner each see what is theirs', async () => {
    try {
      expect(await visibleOrders(WAITER_L)).toEqual([orderL]);
      expect(await visibleOrders(WAITER_V)).toEqual([orderV]);
      expect(await visibleOrders(ADMIN_L)).toEqual([orderL]);
      expect(await visibleOrders(ADMIN_V)).toEqual([orderV]);
      // The owner sees the restaurant the app is showing — La Soul unless told otherwise.
      expect(await visibleOrders(SUPER)).toEqual([orderL]);
      await showing('veraitalia');
      expect(await visibleOrders(SUPER)).toEqual([orderV]);
      // A waiter whose phone asks for the other restaurant still sees only their own.
      expect(await visibleOrders(WAITER_L)).toEqual([orderL]);
    } finally {
      await showing(null);
    }
  });

  it('tables, sessions, waiters and settings follow the same rule', async () => {
    await as(WAITER_V, async () => {
      expect(ids((await db.query<{ id: string }>(`SELECT id FROM public.tables`)).rows)).toEqual([T7_V]);
      expect(ids((await db.query<{ id: string }>(`SELECT id FROM public.table_sessions`)).rows)).toEqual([S_V]);
      expect(ids((await db.query<{ id: string }>(`SELECT id FROM public.waiters`)).rows)).toEqual([W_V]);
      expect((await db.query<{ venue_id: string }>(`SELECT venue_id FROM public.restaurant_settings`)).rows.map((r) => r.venue_id)).toEqual([V]);
    });
  });

  it('a waiter cannot change the other restaurant\'s order, whatever the way in', async () => {
    // Directly: the access rules hide it.
    await as(WAITER_L, async () => {
      const r = await db.query(`UPDATE public.orders SET notes = 'x' WHERE id = $1`, [orderV]);
      expect(r.affectedRows ?? 0).toBe(0);
    });
    // Through a staff function that bypasses the access rules: the second check refuses.
    await expect(as(WAITER_L, () => db.query(`SELECT public.staff_update_order_status($1, 'confirmed')`, [orderV])))
      .rejects.toThrow(/do not work at this restaurant/);
    // Their own restaurant's order, the same way, is fine.
    await as(WAITER_V, () => db.query(`SELECT public.staff_update_order_status($1, 'confirmed')`, [orderV]));
    expect((await db.query<{ status: string }>(`SELECT status FROM public.orders WHERE id = $1`, [orderV])).rows[0].status).toBe('confirmed');
  });
});

describe('each admin manages only their own restaurant', () => {
  it('edits their own menu, never the other one', async () => {
    await as(ADMIN_L, async () => {
      await db.query(`UPDATE public.menu_items SET price = 19 WHERE id = $1`, [DISH_L]);
      const r = await db.query(`UPDATE public.menu_items SET price = 99 WHERE id = $1`, [DISH_V]);
      expect(r.affectedRows ?? 0).toBe(0);
    });
    // Refused by the second check on signed-in writes, before the access rule even looks.
    await expect(as(ADMIN_L, () => db.query(`INSERT INTO public.categories(name, sort_order, venue_id) VALUES ('Dolci', 2, $1)`, [V])))
      .rejects.toThrow(/do not work at this restaurant|row-level security/);
    const prices = (await db.query<{ id: string; price: string }>(`SELECT id, price FROM public.menu_items`)).rows;
    expect(Object.fromEntries(prices.map((p) => [p.id, Number(p.price)]))).toEqual({ [DISH_L]: 19, [DISH_V]: 14 });
  });

  it('closes their own restaurant\'s day, and the two days stay apart', async () => {
    const close = (user: string, venue: string, cash: number) =>
      as(user, () => db.query(`SELECT public.close_shift(NULL, $1, 0, NULL, NULL, true, $2)`, [cash, venue]));
    await close(ADMIN_L, L, 100);
    await close(ADMIN_V, V, 50);
    await expect(close(ADMIN_L, V, 1)).rejects.toThrow(/Only a manager/);
    await expect(close(WAITER_V, V, 1)).rejects.toThrow(/Only a manager/);
    const rows = (await db.query<{ venue_id: string; counted_cash: string }>(`SELECT venue_id, counted_cash FROM public.shift_closes`)).rows;
    expect(Object.fromEntries(rows.map((r) => [r.venue_id, Number(r.counted_cash)]))).toEqual({ [L]: 100, [V]: 50 });
    await expect(as(WAITER_L, () => db.query(`SELECT public.shift_close_for(NULL, $1)`, [V]))).rejects.toThrow(/Only staff/);
  });

  it('adds staff to their own restaurant only, and can never make a super admin', async () => {
    await as(ADMIN_L, () => db.query(`INSERT INTO public.user_roles(user_id, role, venue_id) VALUES ($1, 'staff', $2)`, [NEWCOMER, L]));
    await db.exec(`DELETE FROM public.user_roles WHERE user_id = '${NEWCOMER}'`);
    await expect(as(ADMIN_L, () => db.query(`INSERT INTO public.user_roles(user_id, role, venue_id) VALUES ($1, 'staff', $2)`, [NEWCOMER, V])))
      .rejects.toThrow(/row-level security|row level security/);
    await expect(as(ADMIN_L, () => db.query(`INSERT INTO public.user_roles(user_id, role, venue_id) VALUES ($1, 'admin', NULL)`, [NEWCOMER])))
      .rejects.toThrow(/row-level security|row level security/);
    // The owner can do both.
    await as(SUPER, () => db.query(`INSERT INTO public.user_roles(user_id, role, venue_id) VALUES ($1, 'staff', $2)`, [NEWCOMER, V]));
  });

  it('everyone can see where they work; only admins see the others', async () => {
    const roles = (user: string) => as(user, async () => (await db.query<{ user_id: string }>(`SELECT user_id FROM public.user_roles`)).rows.map((r) => r.user_id).sort());
    expect(await roles(WAITER_V)).toEqual([WAITER_V]);
    expect(await roles(ADMIN_V)).toEqual([ADMIN_V, WAITER_V].sort());
    expect((await roles(SUPER)).length).toBe(5);
  });
});

describe('every request works inside one restaurant', () => {
  afterEachReset();

  it('something added without naming a restaurant belongs to the one the request is about', async () => {
    // A Vera Italia admin adds a table and a section; the app names no restaurant.
    await as(ADMIN_V, () => db.query(`INSERT INTO public.tables(table_number) VALUES (40)`));
    await as(ADMIN_V, () => db.query(`INSERT INTO public.sections(name) VALUES ('Giardino')`));
    // The owner, looking at Vera Italia, adds one too.
    await showing('veraitalia');
    await as(SUPER, () => db.query(`INSERT INTO public.tables(table_number) VALUES (41)`));
    await showing(null);
    const venues = (await db.query<{ n: number; venue_id: string }>(
      `SELECT table_number AS n, venue_id FROM public.tables WHERE table_number IN (40, 41) ORDER BY 1`)).rows;
    expect(venues).toEqual([{ n: 40, venue_id: V }, { n: 41, venue_id: V }]);
    expect((await db.query<{ venue_id: string }>(`SELECT venue_id FROM public.sections WHERE name = 'Giardino'`)).rows[0].venue_id).toBe(V);
    // With no restaurant named and no restaurant of their own: La Soul, as before.
    await db.exec(`INSERT INTO public.tables(table_number) VALUES (42)`);
    expect((await db.query<{ venue_id: string }>(`SELECT venue_id FROM public.tables WHERE table_number = 42`)).rows[0].venue_id).toBe(L);
  });

  it('pausing one restaurant leaves the other taking orders', async () => {
    await db.exec(`UPDATE public.restaurant_settings SET ordering_enabled = false WHERE venue_id = '${V}'`);
    await expect(guestOrders(S_V, 'tok-v', DISH_V)).rejects.toThrow(/Ordering is paused/);
    await guestOrders(S_L, 'tok-l', DISH_L);
  });

  it('a guest\'s order is numbered by their restaurant', async () => {
    const code = async (order: string) =>
      (await db.query<{ order_code: string }>(`SELECT order_code FROM public.orders WHERE id = $1`, [order])).rows[0].order_code;
    expect(await code(await guestOrders(S_L, 'tok-l', DISH_L))).toBe('001');
    expect(await code(await guestOrders(S_L, 'tok-l', DISH_L))).toBe('002');
    expect(await code(await guestOrders(S_V, 'tok-v', DISH_V))).toBe('001');
  });

  it('each restaurant\'s idle timeout applies to its own tables', async () => {
    await db.exec(`
      UPDATE public.restaurant_settings SET session_idle_timeout_minutes = 15 WHERE venue_id = '${V}';
      UPDATE public.table_sessions SET last_heartbeat_at = now() - interval '20 minutes';
    `);
    await expect(guestOrders(S_V, 'tok-v', DISH_V)).rejects.toThrow(/Invalid or expired table session/);
    await guestOrders(S_L, 'tok-l', DISH_L);
  });

  it('menu search finds only the restaurant being shown', async () => {
    const search = async (q: string) =>
      (await db.query<{ name: string }>(`SELECT name FROM public.guest_search_menu($1)`, [q])).rows.map((r) => r.name);
    await showing('veraitalia');
    expect(await search('Pizza')).toEqual(['Pizza Margherita']);
    expect(await search('Burger')).toEqual([]);
    await showing('lasoul');
    expect(await search('Burger')).toEqual(['La Soul Burger']);
    expect(await search('Pizza')).toEqual([]);
  });

  it('a rush of new tables at one restaurant holds nothing at the other', async () => {
    await db.exec(`
      UPDATE public.restaurant_settings SET hold_burst_sessions = 2, hold_first_order_km = NULL, hold_first_order_items = NULL,
             service_open = NULL, service_close = NULL;
      INSERT INTO public.tables(table_number, venue_id) SELECT n, '${L}' FROM generate_series(30, 34) n;
      INSERT INTO public.table_sessions(table_id, token, is_active, last_heartbeat_at, opened_at)
        SELECT id, 'rush-' || table_number, true, now(), now() FROM public.tables WHERE table_number BETWEEN 30 AND 34;
    `);
    const held = async (order: string) =>
      (await db.query<{ held_reason: string | null }>(`SELECT held_reason FROM public.orders WHERE id = $1`, [order])).rows[0].held_reason;
    expect(await held(await guestOrders(S_L, 'tok-l', DISH_L))).toBe('venue_burst');
    expect(await held(await guestOrders(S_V, 'tok-v', DISH_V))).toBeNull();
  });
});

describe('the kitchen, the printers and the numbers are each restaurant\'s own', () => {
  afterEachReset();

  it('the kitchen board shows only its own restaurant\'s dishes', async () => {
    await guestOrders(S_L, 'tok-l', DISH_L);
    await guestOrders(S_V, 'tok-v', DISH_V);
    const board = (user: string) => as(user, async () =>
      (await db.query<{ name: string }>(`SELECT name FROM public.kds_all_day()`)).rows.map((r) => r.name));
    expect(await board(WAITER_V)).toEqual(['Pizza Margherita']);
    expect(await board(WAITER_L)).toEqual(['La Soul Burger']);
  });

  it('a printer prints only its own restaurant\'s tickets, even when both are called Kitchen', async () => {
    const tokenL = 'l'.repeat(32);
    const tokenV = 'v'.repeat(32);
    await db.exec(`INSERT INTO public.printers(name, station, poll_token, venue_id) VALUES
      ('Kitchen', 'all', '${tokenL}', '${L}'), ('Kitchen', 'all', '${tokenV}', '${V}')`);
    const orderL = await guestOrders(S_L, 'tok-l', DISH_L);
    const orderV = await guestOrders(S_V, 'tok-v', DISH_V);
    for (const order of [orderL, orderV]) {
      await db.query(`SELECT public.enqueue_order_ticket(o.id) FROM public.orders o WHERE o.id = $1
                       AND NOT EXISTS (SELECT 1 FROM public.order_ticket_events t WHERE t.order_id = o.id)`, [order]);
    }
    const claim = async (token: string) =>
      (await db.query<{ job: { order_id: string } | null }>(`SELECT public.cloud_print_claim($1) AS job`, [token])).rows[0].job;
    expect((await claim(tokenV))?.order_id).toBe(orderV);
    expect(await claim(tokenV)).toBeNull();
    expect((await claim(tokenL))?.order_id).toBe(orderL);
  });

  it('sales and visits are counted for the restaurant being looked at, and only for its staff', async () => {
    await guestOrders(S_L, 'tok-l', DISH_L);
    await guestOrders(S_V, 'tok-v', DISH_V);
    await db.exec(`INSERT INTO public.analytics_events(visit_id, event, props, occurred_at, venue_id) VALUES
      ('visit-l', 'menu_viewed', '{}', now(), '${L}'),
      ('visit-v1', 'menu_viewed', '{}', now(), '${V}'), ('visit-v2', 'menu_viewed', '{}', now(), '${V}')`);
    const revenue = (user: string) => as(user, async () =>
      Number((await db.query<{ r: { totals: { revenue: number } } }>(`SELECT public.sales_analytics() AS r`)).rows[0].r.totals.revenue));
    const visits = (user: string) => as(user, async () =>
      Number((await db.query<{ r: { visits: number } }>(`SELECT public.funnel_summary() AS r`)).rows[0].r.visits));
    expect(await revenue(ADMIN_V)).toBe(14);
    expect(await revenue(ADMIN_L)).toBe(18);
    expect(await visits(ADMIN_V)).toBe(2);
    expect(await visits(ADMIN_L)).toBe(1);
    // The owner sees the restaurant the app is showing; La Soul unless told otherwise.
    await showing('veraitalia');
    expect(await revenue(SUPER)).toBe(14);
    await showing(null);
    expect(await revenue(SUPER)).toBe(18);
    // Asking for the other restaurant's numbers gets their own.
    await showing('lasoul');
    expect(await revenue(ADMIN_V)).toBe(14);
    expect(await visits(ADMIN_V)).toBe(2);
    // Someone who works at neither gets neither.
    await expect(as(NEWCOMER, () => db.query(`SELECT public.sales_analytics()`))).rejects.toThrow(/Only staff/);
  });

  it('closing Vera Italia\'s day counts Vera Italia\'s orders', async () => {
    await guestOrders(S_L, 'tok-l', DISH_L);
    await guestOrders(S_L, 'tok-l', DISH_L);
    await guestOrders(S_V, 'tok-v', DISH_V);
    // Their admin names no restaurant: it is theirs.
    await as(ADMIN_V, () => db.query(`SELECT public.close_shift(NULL, 0, 0, NULL, NULL, true)`));
    await as(ADMIN_L, () => db.query(`SELECT public.close_shift(NULL, 0, 0, NULL, NULL, true)`));
    const rows = (await db.query<{ venue_id: string; snapshot: { orders: number } }>(`SELECT venue_id, snapshot FROM public.shift_closes`)).rows;
    expect(Object.fromEntries(rows.map((r) => [r.venue_id, Number(r.snapshot.orders)]))).toEqual({ [L]: 2, [V]: 1 });
  });

  it('a guest is only ever suggested their own restaurant\'s dishes', async () => {
    await db.exec(`
      UPDATE public.restaurant_settings SET recommendations_enabled = true, reco_holdout_pct = 0;
      INSERT INTO public.categories(id, name, sort_order, venue_id) VALUES
        ('c0000000-0000-0000-0000-0000000000da', 'Drinks', 2, '${L}'), ('c0000000-0000-0000-0000-0000000000db', 'Bevande', 2, '${V}');
      INSERT INTO public.subcategories(id, category_id, name, sort_order) VALUES
        ('d0000000-0000-0000-0000-0000000000da', 'c0000000-0000-0000-0000-0000000000da', 'Cold', 1),
        ('d0000000-0000-0000-0000-0000000000db', 'c0000000-0000-0000-0000-0000000000db', 'Fredde', 1);
      INSERT INTO public.menu_items(subcategory_id, name, price, is_available, station)
        SELECT 'd0000000-0000-0000-0000-0000000000da', 'Soul lemonade ' || n, 4 + n, true, 'bar' FROM generate_series(1, 4) n;
      INSERT INTO public.menu_items(subcategory_id, name, price, is_available, station)
        SELECT 'd0000000-0000-0000-0000-0000000000db', 'Limonata ' || n, 4 + n, true, 'bar' FROM generate_series(1, 4) n;
      -- Each dish's own pairing.
      INSERT INTO public.menu_item_recommendations(source_item_id, recommended_item_id, recommendation_type, priority)
        SELECT '${DISH_V}'::uuid, id, 'pair_with', 90 FROM public.menu_items WHERE name = 'Limonata 1'
        UNION ALL SELECT '${DISH_L}'::uuid, id, 'pair_with', 90 FROM public.menu_items WHERE name = 'Soul lemonade 1';
    `);
    // A slip of the admin's hand across restaurants is refused (20261031090000)...
    const slip = `INSERT INTO public.menu_item_recommendations(source_item_id, recommended_item_id, recommendation_type, priority)
                  VALUES ('${DISH_V}', '${DISH_L}', 'pair_with', 95)`;
    await expect(db.exec(slip)).rejects.toThrow(/Not available at this restaurant/);
    // ...but one made before that could still be there, and must never reach a guest.
    await db.exec(`
      ALTER TABLE public.menu_item_recommendations DISABLE TRIGGER ab_same_venue;
      ${slip};
      ALTER TABLE public.menu_item_recommendations ENABLE TRIGGER ab_same_venue;
    `);
    // A few visits at each, so popularity has something to go on.
    for (let i = 0; i < 3; i++) {
      await guestOrders(S_L, 'tok-l', DISH_L);
      await guestOrders(S_V, 'tok-v', DISH_V);
    }
    const suggested = async (session: string, token: string, cart: string[]) =>
      (await db.query<{ id: string }>(
        `SELECT id FROM public.guest_get_recommendations($1, $2, $3::uuid[], 'cart', 'en', 8)`, [session, token, cart])).rows.map((r) => r.id);
    const owner = async (dishes: string[]) =>
      [...new Set((await db.query<{ venue_id: string }>(
        `SELECT venue_id FROM public.menu_items WHERE id = ANY($1::uuid[])`, [dishes])).rows.map((r) => r.venue_id))];
    const atVera = await suggested(S_V, 'tok-v', [DISH_V]);
    expect(atVera.length).toBeGreaterThan(0);
    expect(await owner(atVera)).toEqual([V]);
    // Even with the other restaurant's dish slipped into the cart.
    expect(await owner(await suggested(S_V, 'tok-v', [DISH_V, DISH_L]))).toEqual([V]);
    expect(await owner(await suggested(S_L, 'tok-l', [DISH_L, DISH_V]))).toEqual([L]);
  });

  it('a waiter takes only their own restaurant\'s tables', async () => {
    await expect(as(WAITER_L, () => db.query(`SELECT public.staff_take_table($1)`, [S_V]))).rejects.toThrow(/Only staff can take a table/);
    const taken = await as(WAITER_V, async () =>
      (await db.query<{ r: { taken: boolean } }>(`SELECT public.staff_take_table($1) AS r`, [S_V])).rows[0].r);
    expect(taken.taken).toBe(true);
    expect((await db.query<{ assigned_waiter_id: string }>(`SELECT assigned_waiter_id FROM public.table_sessions WHERE id = $1`, [S_V])).rows[0].assigned_waiter_id).toBe(W_V);
  });

  it('the scheduled clean-up closes each restaurant\'s idle tables by its own clock', async () => {
    await db.exec(`
      UPDATE public.restaurant_settings SET session_idle_timeout_minutes = 15 WHERE venue_id = '${V}';
      UPDATE public.restaurant_settings SET session_idle_timeout_minutes = 120 WHERE venue_id = '${L}';
      UPDATE public.table_sessions SET last_heartbeat_at = now() - interval '30 minutes';
    `);
    expect((await db.query<{ n: number }>(`SELECT public.close_stale_sessions() AS n`)).rows[0].n).toBe(1);
    expect(ids((await db.query<{ id: string }>(`SELECT id FROM public.table_sessions WHERE is_active`)).rows)).toEqual([S_L]);
  });
});

/** The app names the restaurant it is showing in an x-venue header. */
function showing(slug: string | null) {
  return db.query(`SELECT set_config('request.headers', $1, false)`, [slug ? JSON.stringify({ 'x-venue': slug }) : '']);
}

/** Request headers are session-wide in the test database; clear them after each test. */
function afterEachReset() {
  afterEach(async () => { await db.query(`SELECT set_config('request.headers', '', false)`); });
}

describe('moving to two restaurants', () => {
  // The step itself, on a database as production has it today.
  it('puts everything that exists into La Soul, and keeps every admin able to see everything', async () => {
    const old = (await createTestDatabase({ quiet: true, until: '20261028090000' })) as unknown as Db;
    try {
      await old.exec(`
        INSERT INTO auth.users(id) VALUES ('${SUPER}'), ('${WAITER_L}');
        INSERT INTO public.user_roles(user_id, role) VALUES ('${SUPER}', 'admin'), ('${WAITER_L}', 'staff');
        INSERT INTO public.tables(id, table_number) VALUES ('${T7_L}', 7);
      `);
      await old.exec(readFileSync(path.join(__dirname, '..', 'migrations', '20261028090000_two_restaurants_foundation.sql'), 'utf8'));
      const roles = (await old.query<{ role: string; venue_id: string | null }>(`SELECT role, venue_id FROM public.user_roles ORDER BY role`)).rows;
      expect(roles).toEqual([{ role: 'admin', venue_id: null }, { role: 'staff', venue_id: L }]);
      expect((await old.query<{ venue_id: string }>(`SELECT venue_id FROM public.tables`)).rows[0].venue_id).toBe(L);
      const settings = (await old.query<{ id: number; venue_id: string }>(`SELECT id, venue_id FROM public.restaurant_settings ORDER BY id`)).rows;
      expect(settings).toEqual([{ id: 1, venue_id: L }, { id: 2, venue_id: V }]);
      // Applying it again changes nothing.
      await old.exec(readFileSync(path.join(__dirname, '..', 'migrations', '20261028090000_two_restaurants_foundation.sql'), 'utf8'));
    } finally {
      await old.close();
    }
  }, 180_000);
});
