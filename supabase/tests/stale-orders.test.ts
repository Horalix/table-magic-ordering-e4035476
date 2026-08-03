/**
 * @vitest-environment node
 *
 * Closing orders that were never going to arrive.
 *
 * The load-bearing test is `will not cancel an order somebody paid for`.
 * Everything else here is bookkeeping; that one is the difference between a
 * useful cleanup job and a cron job that quietly reduces the day's takings
 * because a waiter forgot to tap "served".
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
const STAFF = '22222222-2222-2222-2222-222222222222';
const BURGER = 'cccccccc-cccc-cccc-cccc-cccccccc0001';
const TABLE = 'dddddddd-0000-0000-0000-000000000001';
const SESSION = 'eeeeeeee-eeee-eeee-eeee-eeeeeeee0001';

let db: Db;

async function seed() {
  await db.exec(`
    TRUNCATE public.audit_log, public.order_ticket_events, public.order_items, public.orders,
             public.table_sessions, public.tables,
             public.menu_items, public.subcategories, public.categories, public.order_code_counters
      RESTART IDENTITY CASCADE;
    DELETE FROM public.user_roles;
    DELETE FROM auth.users;

    UPDATE public.restaurant_settings SET stale_order_hours = 6 WHERE id = 1;

    INSERT INTO auth.users(id) VALUES ('${ADMIN}'), ('${STAFF}');
    INSERT INTO public.user_roles(user_id, role) VALUES ('${ADMIN}', 'admin'), ('${STAFF}', 'staff');

    INSERT INTO public.categories(id, name, sort_order) VALUES
      ('aaaaaaaa-0000-0000-0000-000000000001', 'Food', 1);
    INSERT INTO public.subcategories(id, category_id, name, sort_order) VALUES
      ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Mains', 1);
    INSERT INTO public.menu_items(id, subcategory_id, name, price, is_available, station) VALUES
      ('${BURGER}', 'bbbbbbbb-0000-0000-0000-000000000001', 'Burger', 20.00, true, 'kitchen');

    INSERT INTO public.tables(id, table_number) VALUES ('${TABLE}', 7);
    INSERT INTO public.table_sessions(id, table_id, token, is_active, last_heartbeat_at)
      VALUES ('${SESSION}', '${TABLE}', 'tok-7', true, now());
  `);
  await db.exec(`ALTER TABLE public.orders DISABLE TRIGGER trg_enforce_order_limits`);
  await actAs(db, null);
}

/** An order of a given age, status and payment state. */
async function order(opts: {
  hoursAgo: number;
  status: string;
  paid?: boolean;
  method?: string;
}) {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO public.orders(table_session_id, total, status, payment_status, payment_method,
                               released_to_kitchen_at, created_at, paid_at)
     VALUES ($1, 20, $2::public.order_status, $3, $4,
             CASE WHEN $2 IN ('awaiting_payment','payment_failed') THEN NULL ELSE now() END,
             now() - make_interval(hours => $5),
             CASE WHEN $3 = 'paid' THEN now() ELSE NULL END)
     RETURNING id`,
    [SESSION, opts.status, opts.paid ? 'paid' : 'unpaid',
     opts.method ?? (opts.paid ? 'cash' : 'card_online'), opts.hoursAgo]);
  return rows[0].id;
}

const statusOf = async (id: string) => {
  const { rows } = await db.query<{ status: string; cancel_reason: string | null }>(
    `SELECT status, cancel_reason FROM public.orders WHERE id = $1`, [id]);
  return rows[0];
};

const close = async (hours?: number) => {
  await actAs(db, STAFF);
  const { rows } = await db.query<{ r: Record<string, number> }>(
    hours === undefined
      ? `SELECT public.close_stale_orders() AS r`
      : `SELECT public.close_stale_orders(${hours}) AS r`);
  await actAs(db, null);
  return rows[0].r;
};

beforeAll(async () => { db = (await createTestDatabase({ quiet: true })) as unknown as Db; }, 180_000);
afterAll(async () => { await db?.close(); });
beforeEach(seed);

describe('what gets closed', () => {
  it('closes a card order whose payment was abandoned', async () => {
    // Never reached the kitchen — release_order_to_kitchen is gated on payment.
    const id = await order({ hoursAgo: 200, status: 'awaiting_payment' });
    const r = await close();
    expect(r.abandoned_payment).toBe(1);
    expect((await statusOf(id)).status).toBe('cancelled');
  });

  it('closes an unpaid order the kitchen never served', async () => {
    const id = await order({ hoursAgo: 30, status: 'preparing' });
    const r = await close();
    expect(r.never_served).toBe(1);
    expect((await statusOf(id)).status).toBe('cancelled');
  });

  it('says why, in the row itself', async () => {
    // A cancelled order with no reason is indistinguishable from a staff
    // cancellation six months later, when it matters.
    const id = await order({ hoursAgo: 30, status: 'pending' });
    await close();
    expect((await statusOf(id)).cancel_reason).toMatch(/Auto-closed: never served, unpaid/);
  });

  it('leaves this evening alone', async () => {
    const id = await order({ hoursAgo: 2, status: 'preparing' });
    const r = await close();
    expect(r.total).toBe(0);
    expect((await statusOf(id)).status).toBe('preparing');
  });

  it('stops the kitchen ticket from printing later', async () => {
    const id = await order({ hoursAgo: 30, status: 'pending' });
    await db.query(
      `INSERT INTO public.order_ticket_events(order_id, status) VALUES ($1, 'queued')`, [id]);
    await close();
    const { rows } = await db.query<{ status: string }>(
      `SELECT status FROM public.order_ticket_events WHERE order_id = $1`, [id]);
    expect(rows[0].status).toBe('cancelled');
  });
});

describe('what it refuses to touch', () => {
  it('will not cancel an order somebody paid for', async () => {
    /*
     * THE IMPORTANT ONE. Paid but never marked served is nearly always a
     * forgotten tap, not missing food. Cancelling it would drop the order out
     * of completed_orders — quietly reducing the day's revenue — and make a
     * refund look owed for a meal that was eaten. "Nearly always" is not a
     * standard a nightly job gets to act on.
     */
    const id = await order({ hoursAgo: 300, status: 'preparing', paid: true });
    const r = await close();
    expect(r.total).toBe(0);
    expect((await statusOf(id)).status).toBe('preparing');
  });

  it('leaves a served order alone', async () => {
    const id = await order({ hoursAgo: 300, status: 'served', paid: true });
    await close();
    expect((await statusOf(id)).status).toBe('served');
  });

  it('does not close the table session', async () => {
    // Explicitly asked for: close the order, not the guest's tab.
    await order({ hoursAgo: 200, status: 'awaiting_payment' });
    await close();
    const { rows } = await db.query<{ is_active: boolean }>(
      `SELECT is_active FROM public.table_sessions WHERE id = '${SESSION}'`);
    expect(rows[0].is_active).toBe(true);
  });

  it('refuses a window short enough to hit live service', async () => {
    // A fat-fingered settings write must not be able to cancel the current rush.
    await actAs(db, STAFF);
    await expect(db.query(`SELECT public.close_stale_orders(1)`))
      .rejects.toThrow(/Refusing to close orders younger than 2 hours/);
    await actAs(db, null);
  });

  it('is staff-only', async () => {
    await expect(db.query(`SELECT public.close_stale_orders()`)).rejects.toThrow(/Only staff/);
  });
});

describe('what a person is asked to look at', () => {
  it('puts the paid ones first, because those are the money', async () => {
    await order({ hoursAgo: 20, status: 'pending' });
    await order({ hoursAgo: 300, status: 'preparing', paid: true });

    await actAs(db, STAFF);
    const { rows } = await db.query<{ payment_status: string; problem: string; hours_open: string }>(
      `SELECT * FROM public.orders_needing_attention()`);
    await actAs(db, null);

    expect(rows).toHaveLength(2);
    expect(rows[0].payment_status).toBe('paid');
    expect(rows[0].problem).toMatch(/confirm the food went out/);
    expect(Number(rows[0].hours_open)).toBeGreaterThan(299);
  });

  it('tells the truth about what the cleanup will handle itself', async () => {
    await order({ hoursAgo: 20, status: 'pending' });
    await actAs(db, STAFF);
    const { rows } = await db.query<{ problem: string }>(
      `SELECT * FROM public.orders_needing_attention()`);
    await actAs(db, null);
    expect(rows[0].problem).toMatch(/nightly cleanup will close this/);
  });

  it('names the table so somebody can go and ask', async () => {
    await order({ hoursAgo: 300, status: 'preparing', paid: true });
    await actAs(db, STAFF);
    const { rows } = await db.query<{ table_number: number }>(
      `SELECT * FROM public.orders_needing_attention()`);
    await actAs(db, null);
    expect(rows[0].table_number).toBe(7);
  });

  it('is staff-only', async () => {
    await expect(db.query(`SELECT * FROM public.orders_needing_attention()`)).rejects.toThrow(/Only staff/);
  });
});

describe('the nightly job', () => {
  it('closes stale orders as part of maintenance', async () => {
    const id = await order({ hoursAgo: 200, status: 'awaiting_payment' });
    await actAs(db, STAFF);
    const { rows } = await db.query<{ r: { stale_orders_closed: { total: number } } }>(
      `SELECT public.run_daily_maintenance() AS r`);
    await actAs(db, null);

    expect(rows[0].r.stale_orders_closed.total).toBe(1);
    expect((await statusOf(id)).status).toBe('cancelled');
  });
});
