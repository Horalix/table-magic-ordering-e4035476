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
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
             public.menu_items, public.subcategories, public.categories, public.order_code_counters
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
    await expect(guestOrders(S_V, 'tok-v', DISH_L)).rejects.toThrow(/Not available at this restaurant/);
    await expect(guestOrders(S_L, 'tok-l', DISH_V)).rejects.toThrow(/Not available at this restaurant/);
    expect((await db.query(`SELECT 1 FROM public.orders`)).rows).toHaveLength(0);
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
    expect(await visibleOrders(WAITER_L)).toEqual([orderL]);
    expect(await visibleOrders(WAITER_V)).toEqual([orderV]);
    expect(await visibleOrders(ADMIN_L)).toEqual([orderL]);
    expect(await visibleOrders(ADMIN_V)).toEqual([orderV]);
    expect(await visibleOrders(SUPER)).toEqual([orderL, orderV].sort());
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
