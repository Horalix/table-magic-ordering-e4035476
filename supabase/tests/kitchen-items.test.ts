/**
 * @vitest-environment node
 *
 * Item-level kitchen control, against real PostgreSQL.
 *
 * The invariant that matters most: item status is the truth and order status is
 * a derived projection of it, derived FORWARD ONLY, so the payment-gated
 * transitions and the financial integrity trigger are never weakened by any of
 * this. Undo is the one backwards path and it is time-boxed, audited, and
 * unreachable except through its own RPC.
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

const ADMIN = '11111111-1111-1111-1111-111111111111';
const STAFF = '22222222-2222-2222-2222-222222222222';
const BURGER = 'cccccccc-0000-0000-0000-000000000001';
const FRIES = 'cccccccc-0000-0000-0000-000000000002';
const COFFEE = 'cccccccc-0000-0000-0000-000000000003';
const SESSION = 'eeeeeeee-0000-0000-0000-000000000001';
const TOKEN = 'sess-token-7';

async function seed() {
  await db.exec(`
    TRUNCATE public.audit_log, public.order_ticket_events, public.order_items, public.orders,
             public.table_sessions, public.tables,
             public.menu_items, public.subcategories, public.categories, public.order_code_counters
      RESTART IDENTITY CASCADE;
    DELETE FROM public.user_roles;
    DELETE FROM auth.users;

    UPDATE public.restaurant_settings
       SET ordering_enabled = true, online_card_enabled = false, kitchen_undo_seconds = 90
     WHERE id = 1;

    INSERT INTO auth.users(id) VALUES ('${ADMIN}'), ('${STAFF}');
    INSERT INTO public.user_roles(user_id, role) VALUES ('${ADMIN}', 'admin'), ('${STAFF}', 'staff');

    INSERT INTO public.categories(id, name, sort_order) VALUES
      ('aaaaaaaa-0000-0000-0000-000000000001', 'Food', 1),
      ('aaaaaaaa-0000-0000-0000-000000000002', 'Drinks', 2);
    INSERT INTO public.subcategories(id, category_id, name, sort_order) VALUES
      ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Burgers', 1),
      ('bbbbbbbb-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000002', 'Hot Drinks', 2);

    INSERT INTO public.menu_items(id, subcategory_id, name, price, is_available, station) VALUES
      ('${BURGER}', 'bbbbbbbb-0000-0000-0000-000000000001', 'La Soul Burger', 18.00, true, 'kitchen'),
      ('${FRIES}',  'bbbbbbbb-0000-0000-0000-000000000001', 'French Fries',    6.00, true, 'kitchen'),
      ('${COFFEE}', 'bbbbbbbb-0000-0000-0000-000000000002', 'Espresso',        3.00, true, 'bar');

    INSERT INTO public.tables(id, table_number) VALUES ('dddddddd-0000-0000-0000-000000000001', 7);
    INSERT INTO public.table_sessions(id, table_id, token, is_active, guest_name, last_heartbeat_at)
      VALUES ('${SESSION}', 'dddddddd-0000-0000-0000-000000000001', '${TOKEN}', true, 'Amina', now());
  `);
  await actAs(db, null);
}

async function placeOrder(items: string[]) {
  const { rows } = await db.query<{ result: Record<string, unknown> }>(
    `SELECT public.guest_place_order($1, $2, 'Amina', 'cash', $3::jsonb, 0) AS result`,
    [SESSION, TOKEN, JSON.stringify(items.map((id) => ({ menu_item_id: id, quantity: 1 })))],
  );
  return rows[0].result.order_id as string;
}

async function itemIds(orderId: string) {
  const { rows } = await db.query<{ id: string; menu_item_id: string; station: string; status: string }>(
    `SELECT id, menu_item_id, station, status FROM public.order_items WHERE order_id = $1 ORDER BY menu_item_id`,
    [orderId],
  );
  return rows;
}

const orderStatus = async (id: string) => {
  const { rows } = await db.query<{ status: string }>(`SELECT status FROM public.orders WHERE id = $1`, [id]);
  return rows[0].status;
};

const bump = (itemId: string, status: string) =>
  db.query(`SELECT public.staff_bump_order_item($1, $2)`, [itemId, status]);

beforeAll(async () => {
  db = (await createTestDatabase({ quiet: true })) as unknown as Db;
}, 120_000);
afterAll(async () => { await db?.close(); });
beforeEach(seed);

// ---------------------------------------------------------------------------

describe('order status is derived from its items', () => {
  it('moves to preparing on the first bump, not before', async () => {
    const order = await placeOrder([BURGER, FRIES, COFFEE]);
    const items = await itemIds(order);
    expect(await orderStatus(order)).toBe('pending');

    await actAs(db, STAFF);
    await bump(items[0].id, 'preparing');
    expect(await orderStatus(order)).toBe('preparing');
    await actAs(db, null);
  });

  it('only reaches ready when every line is ready', async () => {
    const order = await placeOrder([BURGER, FRIES, COFFEE]);
    const items = await itemIds(order);

    await actAs(db, STAFF);
    await bump(items[0].id, 'ready');
    await bump(items[1].id, 'ready');
    expect(await orderStatus(order)).toBe('preparing');

    await bump(items[2].id, 'ready');
    expect(await orderStatus(order)).toBe('ready');
    await actAs(db, null);
  });

  it('never derives served — a runner carries the tray, not the line', async () => {
    const order = await placeOrder([BURGER]);
    const items = await itemIds(order);

    await actAs(db, STAFF);
    await bump(items[0].id, 'served');
    // The item can be served; the order still waits for an explicit call.
    expect(await orderStatus(order)).toBe('ready');
    await actAs(db, null);
  });

  it('cascades an order-level bump down to every line without recursing', async () => {
    const order = await placeOrder([BURGER, FRIES, COFFEE]);

    await actAs(db, STAFF);
    await db.query(`SELECT public.staff_update_order_status($1, 'preparing')`, [order]);
    await db.query(`SELECT public.staff_update_order_status($1, 'ready')`, [order]);
    await db.query(`SELECT public.staff_update_order_status($1, 'served')`, [order]);
    await actAs(db, null);

    const items = await itemIds(order);
    expect(items.every((i) => i.status === 'served')).toBe(true);
    expect(await orderStatus(order)).toBe('served');
  });

  it('leaves a card order alone until it is paid for', async () => {
    await db.query(`UPDATE public.restaurant_settings SET online_card_enabled = true WHERE id = 1`);
    const { rows } = await db.query<{ result: Record<string, unknown> }>(
      `SELECT public.guest_place_order($1, $2, 'Amina', 'card_online', $3::jsonb, 0) AS result`,
      [SESSION, TOKEN, JSON.stringify([{ menu_item_id: BURGER, quantity: 1 }])],
    );
    const items = await itemIds(rows[0].result.order_id as string);

    await actAs(db, STAFF);
    await expect(bump(items[0].id, 'preparing')).rejects.toThrow(/not been paid for/i);
    await actAs(db, null);
  });
});

describe('item status cannot be written directly', () => {
  it('rejects a raw UPDATE from a staff client', async () => {
    const order = await placeOrder([BURGER]);
    const items = await itemIds(order);

    await actAs(db, STAFF);
    await expect(
      db.query(`UPDATE public.order_items SET status = 'ready' WHERE id = $1`, [items[0].id]),
    ).rejects.toThrow(/bumping it, not by writing/i);
    await actAs(db, null);
  });

  it('rejects re-pricing or re-pointing a placed line', async () => {
    const order = await placeOrder([BURGER]);
    const items = await itemIds(order);

    await expect(
      db.query(`UPDATE public.order_items SET unit_price = 0.01 WHERE id = $1`, [items[0].id]),
    ).rejects.toThrow(/re-priced or re-pointed/i);

    await expect(
      db.query(`UPDATE public.order_items SET quantity = 99 WHERE id = $1`, [items[0].id]),
    ).rejects.toThrow(/re-priced or re-pointed/i);
  });

  it('refuses a bump from someone who is not staff', async () => {
    const order = await placeOrder([BURGER]);
    const items = await itemIds(order);
    await actAs(db, null);
    await expect(bump(items[0].id, 'ready')).rejects.toThrow(/Only staff/i);
  });
});

describe('undo', () => {
  it('takes an order back inside the window and clears only the stamp it left', async () => {
    const order = await placeOrder([BURGER]);

    await actAs(db, STAFF);
    await db.query(`SELECT public.staff_update_order_status($1, 'preparing')`, [order]);
    await db.query(`SELECT public.staff_update_order_status($1, 'ready')`, [order]);

    await db.query(`SELECT public.staff_revert_order_status($1, 'preparing', 'mis-tap')`, [order]);
    await actAs(db, null);

    const { rows } = await db.query<{ status: string; ready_at: string | null; preparing_at: string | null }>(
      `SELECT status, ready_at, preparing_at FROM public.orders WHERE id = $1`, [order]);

    expect(rows[0].status).toBe('preparing');
    expect(rows[0].ready_at).toBeNull();
    // The order genuinely was in prep for that whole time — the earlier stamp stands.
    expect(rows[0].preparing_at).not.toBeNull();
  });

  it('takes the items back with it', async () => {
    const order = await placeOrder([BURGER, FRIES]);

    await actAs(db, STAFF);
    await db.query(`SELECT public.staff_update_order_status($1, 'preparing')`, [order]);
    await db.query(`SELECT public.staff_update_order_status($1, 'ready')`, [order]);
    await db.query(`SELECT public.staff_revert_order_status($1, 'preparing', 'mis-tap')`, [order]);
    await actAs(db, null);

    const items = await itemIds(order);
    expect(items.every((i) => i.status === 'preparing')).toBe(true);
  });

  it('refuses once the window has passed', async () => {
    const order = await placeOrder([BURGER]);
    await actAs(db, STAFF);
    await db.query(`SELECT public.staff_update_order_status($1, 'preparing')`, [order]);
    await db.query(`SELECT public.staff_update_order_status($1, 'ready')`, [order]);

    await db.query(`UPDATE public.restaurant_settings SET kitchen_undo_seconds = 0 WHERE id = 1`);
    await expect(
      db.query(`SELECT public.staff_revert_order_status($1, 'preparing', 'too late')`, [order]),
    ).rejects.toThrow(/window has passed/i);
    await actAs(db, null);
  });

  it('never reverts into a payment-gated state', async () => {
    const order = await placeOrder([BURGER]);
    await actAs(db, STAFF);
    await expect(
      db.query(`SELECT public.staff_revert_order_status($1, 'awaiting_payment', 'nope')`, [order]),
    ).rejects.toThrow(/Cannot undo/i);
    await actAs(db, null);
  });

  it('needs a manager to undo a served order that has been paid for', async () => {
    const order = await placeOrder([BURGER]);
    await actAs(db, STAFF);
    await db.query(`SELECT public.staff_update_order_status($1, 'preparing')`, [order]);
    await db.query(`SELECT public.staff_update_order_status($1, 'ready')`, [order]);
    await db.query(`SELECT public.staff_update_order_status($1, 'served')`, [order]);
    await db.query(`SELECT public.record_table_payment($1, 'cash', NULL)`, [order]);

    await expect(
      db.query(`SELECT public.staff_revert_order_status($1, 'ready', 'wrong table')`, [order]),
    ).rejects.toThrow(/manager/i);

    await actAs(db, ADMIN);
    await db.query(`SELECT public.staff_revert_order_status($1, 'ready', 'wrong table')`, [order]);
    expect(await orderStatus(order)).toBe('ready');
    await actAs(db, null);
  });

  it('does not let a plain UPDATE walk an order backwards', async () => {
    const order = await placeOrder([BURGER]);
    await actAs(db, STAFF);
    await db.query(`SELECT public.staff_update_order_status($1, 'preparing')`, [order]);
    await db.query(`SELECT public.staff_update_order_status($1, 'ready')`, [order]);

    // The revert edges exist, but only staff_revert_order_status may use them.
    await expect(
      db.query(`UPDATE public.orders SET status = 'preparing' WHERE id = $1`, [order]),
    ).rejects.toThrow(/Illegal order transition/i);
    await actAs(db, null);
  });

  it('records the undo, with how old the mistake was', async () => {
    const order = await placeOrder([BURGER]);
    await actAs(db, STAFF);
    await db.query(`SELECT public.staff_update_order_status($1, 'preparing')`, [order]);
    await db.query(`SELECT public.staff_revert_order_status($1, 'pending', 'wrong ticket')`, [order]);

    const { rows } = await db.query<{ action: string; reason: string; before_state: Record<string, unknown> }>(
      `SELECT action, reason, before_state FROM public.audit_log
        WHERE action = 'order.status_reverted' ORDER BY created_at DESC LIMIT 1`);
    await actAs(db, null);

    expect(rows[0].action).toBe('order.status_reverted');
    expect(rows[0].reason).toBe('wrong ticket');
    expect(rows[0].before_state).toHaveProperty('age_seconds');
  });

  it('lets a cook take one line back without touching the others', async () => {
    const order = await placeOrder([BURGER, FRIES]);
    const items = await itemIds(order);
    const burgerLine = items.find((i) => i.menu_item_id === BURGER)!;

    await actAs(db, STAFF);
    await bump(burgerLine.id, 'ready');
    await bump(burgerLine.id, 'preparing');
    await actAs(db, null);

    const after = await itemIds(order);
    expect(after.find((i) => i.menu_item_id === BURGER)?.status).toBe('preparing');
    expect(after.find((i) => i.menu_item_id === FRIES)?.status).toBe('pending');
  });
});

describe('stations', () => {
  it('routes drinks to the bar from the category', async () => {
    const order = await placeOrder([BURGER, COFFEE]);
    const items = await itemIds(order);

    expect(items.find((i) => i.menu_item_id === BURGER)?.station).toBe('kitchen');
    expect(items.find((i) => i.menu_item_id === COFFEE)?.station).toBe('bar');
  });

  it('freezes the station onto the line, so re-categorising does not rewrite history', async () => {
    const order = await placeOrder([COFFEE]);
    await db.query(`UPDATE public.menu_items SET station = 'kitchen' WHERE id = $1`, [COFFEE]);

    const items = await itemIds(order);
    expect(items[0].station).toBe('bar');
  });

  it('lets the bar work its own board', async () => {
    await placeOrder([BURGER, COFFEE]);

    await actAs(db, STAFF);
    const { rows } = await db.query<{ name: string; station: string }>(
      `SELECT name, station FROM public.kds_all_day('bar')`);
    await actAs(db, null);

    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Espresso');
  });
});

describe('all day', () => {
  it('totals a dish across every open order', async () => {
    await placeOrder([FRIES]);
    await placeOrder([FRIES, BURGER]);
    await placeOrder([FRIES]);

    await actAs(db, STAFF);
    const { rows } = await db.query<{ name: string; qty_pending: number; pending_ids: string[] }>(
      `SELECT name, qty_pending, pending_ids FROM public.kds_all_day(NULL) WHERE name = 'French Fries'`);
    await actAs(db, null);

    expect(rows[0].qty_pending).toBe(3);
    expect(rows[0].pending_ids).toHaveLength(3);
  });

  it('splits the count by what stage each line is at', async () => {
    const a = await placeOrder([FRIES]);
    await placeOrder([FRIES]);
    const items = await itemIds(a);

    await actAs(db, STAFF);
    await bump(items[0].id, 'ready');
    const { rows } = await db.query<{ qty_pending: number; qty_ready: number }>(
      `SELECT qty_pending, qty_ready FROM public.kds_all_day(NULL) WHERE name = 'French Fries'`);
    await actAs(db, null);

    expect(rows[0].qty_pending).toBe(1);
    expect(rows[0].qty_ready).toBe(1);
  });

  it('drops a dish once every portion has gone out', async () => {
    const order = await placeOrder([FRIES]);
    const items = await itemIds(order);

    await actAs(db, STAFF);
    await bump(items[0].id, 'served');
    const { rows } = await db.query(`SELECT * FROM public.kds_all_day(NULL) WHERE name = 'French Fries'`);
    await actAs(db, null);

    expect(rows).toHaveLength(0);
  });

  it('never offers a finished line to "start all"', async () => {
    // If the ids came back as one list, tapping "start all" would walk an
    // already-plated dish BACKWARDS through the undo window — silently
    // un-cooking something the pass is waiting on.
    const a = await placeOrder([FRIES]);
    await placeOrder([FRIES]);
    const items = await itemIds(a);

    await actAs(db, STAFF);
    await bump(items[0].id, 'ready');
    const { rows } = await db.query<{ pending_ids: string[]; open_ids: string[] }>(
      `SELECT pending_ids, open_ids FROM public.kds_all_day(NULL) WHERE name = 'French Fries'`);
    await actAs(db, null);

    expect(rows[0].pending_ids).toHaveLength(1);
    expect(rows[0].pending_ids).not.toContain(items[0].id);
    expect(rows[0].open_ids).not.toContain(items[0].id);
  });

  it('bumps a whole tray in one call', async () => {
    await placeOrder([FRIES]);
    await placeOrder([FRIES]);

    await actAs(db, STAFF);
    const { rows: all } = await db.query<{ open_ids: string[] }>(
      `SELECT open_ids FROM public.kds_all_day(NULL) WHERE name = 'French Fries'`);
    const { rows } = await db.query<{ result: Record<string, number> }>(
      `SELECT public.staff_bump_order_items($1::uuid[], 'ready') AS result`, [all[0].open_ids]);
    await actAs(db, null);

    expect(rows[0].result.updated).toBe(2);
  });

  it('stays correct past the page size of the board', async () => {
    // The whole reason this lives in SQL: a client-side rollup over a
    // paginated board is silently wrong, and an undercounted prep quantity is
    // invisible in a way a missing card is not.
    await db.exec(`ALTER TABLE public.orders DISABLE TRIGGER trg_enforce_order_limits`);
    for (let i = 0; i < 60; i += 1) {
      const { rows } = await db.query<{ id: string }>(`
        INSERT INTO public.orders(table_session_id, total, status, payment_method, payment_status,
                                  released_to_kitchen_at, order_code)
        VALUES ($1, 6, 'pending', 'cash', 'unpaid', now(), '001') RETURNING id`, [SESSION]);
      await db.query(
        `INSERT INTO public.order_items(order_id, menu_item_id, quantity, unit_price, status)
         SELECT $1, $2, 1, price, 'pending' FROM public.menu_items WHERE id = $2`,
        [rows[0].id, FRIES]);
    }
    await db.exec(`ALTER TABLE public.orders ENABLE TRIGGER trg_enforce_order_limits`);

    await actAs(db, STAFF);
    const { rows } = await db.query<{ qty_pending: number }>(
      `SELECT qty_pending FROM public.kds_all_day(NULL) WHERE name = 'French Fries'`);
    await actAs(db, null);

    expect(rows[0].qty_pending).toBe(60);
  });

  it('excludes cancelled orders', async () => {
    const order = await placeOrder([FRIES]);
    await actAs(db, STAFF);
    await db.query(`SELECT public.cancel_order($1, 'guest left')`, [order]);
    const { rows } = await db.query(`SELECT * FROM public.kds_all_day(NULL)`);
    await actAs(db, null);
    expect(rows).toHaveLength(0);
  });

  it('is staff only', async () => {
    await actAs(db, null);
    await expect(db.query(`SELECT * FROM public.kds_all_day(NULL)`)).rejects.toThrow(/Only staff/i);
  });
});
