/**
 * @vitest-environment node
 *
 * Staff safety.
 *
 * Two taps that used to make money vanish from the books: freeing a table that
 * still owed, and marking a refunded order paid again. Both are refused by the
 * database now, because the database is the only thing that sees every screen —
 * the kitchen tick, the waiter phone and the admin Tables page all reach the
 * same function.
 */
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error -- plain JS harness, no types needed
import { createTestDatabase, actAs } from '../../scripts/db-harness.mjs';

type Db = {
  query: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
  exec: (sql: string) => Promise<unknown>;
  close: () => Promise<void>;
};

const ADMIN = '11111111-1111-1111-1111-111111111111';
const ANA = '22222222-2222-2222-2222-222222222222';
const BURGER = 'cccccccc-cccc-cccc-cccc-cccccccc0001';
const SESSION = 'eeeeeeee-eeee-eeee-eeee-eeeeeeee0001';
const TOKEN = 'sess-token-7';

let db: Db;

async function seed() {
  await db.exec(`
    TRUNCATE public.audit_log, public.order_ticket_events, public.order_items, public.orders,
             public.order_refunds, public.waiter_calls, public.bill_requests,
             public.table_sessions, public.tables,
             public.menu_items, public.subcategories, public.categories, public.order_code_counters
      RESTART IDENTITY CASCADE;
    DELETE FROM public.user_roles;
    DELETE FROM auth.users;

    UPDATE public.restaurant_settings SET ordering_enabled = true, online_card_enabled = false WHERE id = 1;

    INSERT INTO auth.users(id) VALUES ('${ADMIN}'), ('${ANA}');
    INSERT INTO public.user_roles(user_id, role) VALUES ('${ADMIN}', 'admin'), ('${ANA}', 'staff');

    INSERT INTO public.categories(id, name, sort_order) VALUES
      ('aaaaaaaa-0000-0000-0000-000000000001', 'Food', 1);
    INSERT INTO public.subcategories(id, category_id, name, sort_order) VALUES
      ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Burgers', 1);
    INSERT INTO public.menu_items(id, subcategory_id, name, price, is_available, station) VALUES
      ('${BURGER}', 'bbbbbbbb-0000-0000-0000-000000000001', 'La Soul Burger', 18.00, true, 'kitchen');

    INSERT INTO public.tables(id, table_number) VALUES ('dddddddd-0000-0000-0000-000000000001', 7);
    INSERT INTO public.table_sessions(id, table_id, token, is_active, guest_name, last_heartbeat_at)
      VALUES ('${SESSION}', 'dddddddd-0000-0000-0000-000000000001', '${TOKEN}', true, 'Amina', now());
  `);
  await actAs(db, null);
}

const placeOrder = async () => {
  const { rows } = await db.query<{ result: Record<string, unknown> }>(
    `SELECT public.guest_place_order($1, $2, 'Amina', 'cash', $3::jsonb, 0) AS result`,
    [SESSION, TOKEN, JSON.stringify([{ menu_item_id: BURGER, quantity: 1 }])],
  );
  return rows[0].result.order_id as string;
};

const pay = async (orderId: string, method = 'cash') => {
  await actAs(db, ANA);
  const { rows } = await db.query<{ r: { status: string } }>(
    `SELECT public.record_table_payment($1, $2, NULL) AS r`, [orderId, method]);
  await actAs(db, null);
  return rows[0].r;
};

const close = async () => {
  await actAs(db, ANA);
  const { rows } = await db.query<{ r: { closed: boolean; already_closed: boolean; outstanding: string; unpaid_orders: number } }>(
    `SELECT public.staff_close_session($1) AS r`, [SESSION]);
  await actAs(db, null);
  return rows[0].r;
};

const sessionActive = async () => {
  const { rows } = await db.query<{ is_active: boolean }>(
    `SELECT is_active FROM public.table_sessions WHERE id = $1`, [SESSION]);
  return rows[0].is_active;
};

const refund = async (orderId: string, amount: number) => {
  await actAs(db, ADMIN);
  await db.query(
    `SELECT public.record_order_refund($1, $2, 'cash', 'guest complaint', true, NULL)`, [orderId, amount]);
  await actAs(db, null);
};

beforeAll(async () => { db = (await createTestDatabase({ quiet: true })) as unknown as Db; }, 180_000);
afterAll(async () => { await db?.close(); });
beforeEach(seed);

describe('freeing a table', () => {
  it('refuses while the table owes money, and says how much', async () => {
    await placeOrder();

    const result = await close();

    expect(result.closed).toBe(false);
    expect(Number(result.outstanding)).toBe(18);
    expect(result.unpaid_orders).toBe(1);
    expect(await sessionActive()).toBe(true);
  });

  it('frees the table once everything is paid', async () => {
    await pay(await placeOrder());

    const result = await close();

    expect(result.closed).toBe(true);
    expect(await sessionActive()).toBe(false);
  });

  it('does not count a refunded order as owed', async () => {
    // Paid, then given back: nothing to collect, and nothing should pin the
    // table open. The old bill-request check counted it as unpaid.
    const id = await placeOrder();
    await pay(id);
    await refund(id, 18);

    expect((await close()).closed).toBe(true);
  });

  it('does not count a cancelled order as owed', async () => {
    const id = await placeOrder();
    await actAs(db, ADMIN);
    await db.query(`SELECT public.cancel_order($1, 'guest left before it was made')`, [id]);
    await actAs(db, null);

    expect((await close()).closed).toBe(true);
  });

  it('clears calls and bill requests still open on the table', async () => {
    await pay(await placeOrder());
    await db.query(`INSERT INTO public.waiter_calls(table_session_id) VALUES ($1)`, [SESSION]);
    await db.query(`INSERT INTO public.bill_requests(table_session_id) VALUES ($1)`, [SESSION]);

    await close();

    const { rows } = await db.query<{ open: string }>(`
      SELECT (SELECT count(*) FROM public.waiter_calls WHERE status <> 'resolved')
           + (SELECT count(*) FROM public.bill_requests WHERE status <> 'resolved') AS open`);
    expect(Number(rows[0].open)).toBe(0);
  });

  it('reports success when the table is already free', async () => {
    await close();
    const again = await close();
    expect(again.closed).toBe(true);
    expect(again.already_closed).toBe(true);
  });

  it('is staff only', async () => {
    await actAs(db, null);
    await expect(db.query(`SELECT public.staff_close_session($1)`, [SESSION]))
      .rejects.toThrow(/Only staff/i);
  });

  it('leaves an audit entry with the author', async () => {
    await close();
    const { rows } = await db.query<{ actor_user_id: string }>(
      `SELECT actor_user_id FROM public.audit_log WHERE action = 'table.freed'`);
    expect(rows[0]?.actor_user_id).toBe(ANA);
  });

  it('agrees with the bill-request path', async () => {
    // One definition of "owes money": the floor monitor's "paid and gone"
    // button must refuse exactly when the waiter phone's "Free table" does.
    await placeOrder();
    const { rows: req } = await db.query<{ id: string }>(
      `INSERT INTO public.bill_requests(table_session_id) VALUES ($1) RETURNING id`, [SESSION]);

    await actAs(db, ANA);
    const { rows } = await db.query<{ r: { resolved: boolean; closed: boolean; outstanding: string } }>(
      `SELECT public.staff_resolve_bill_request($1, true) AS r`, [req[0].id]);
    await actAs(db, null);

    expect(rows[0].r.resolved).toBe(true);
    expect(rows[0].r.closed).toBe(false);
    expect(Number(rows[0].r.outstanding)).toBe(18);
    expect(await sessionActive()).toBe(true);
  });
});

describe('paying a refunded order', () => {
  it('refuses a fully refunded order', async () => {
    const id = await placeOrder();
    await pay(id);
    await refund(id, 18);

    await expect(pay(id)).rejects.toThrow(/refunded/i);
  });

  it('refuses a partially refunded order', async () => {
    // The exact case that slipped through: `partially_refunded` is not `paid`,
    // so the Paid buttons came back and a tap recorded the money twice.
    const id = await placeOrder();
    await pay(id);
    await refund(id, 5);

    await expect(pay(id, 'pos_terminal')).rejects.toThrow(/refunded/i);

    const { rows } = await db.query<{ payment_status: string; payment_method: string }>(
      `SELECT payment_status, payment_method FROM public.orders WHERE id = $1`, [id]);
    expect(rows[0].payment_status).toBe('partially_refunded');
    expect(rows[0].payment_method).toBe('cash');
  });

  it('still answers already_paid for an order that is simply paid', async () => {
    const id = await placeOrder();
    await pay(id);
    expect((await pay(id)).status).toBe('already_paid');
  });

  it('still records an ordinary payment', async () => {
    expect((await pay(await placeOrder())).status).toBe('paid');
  });
});
