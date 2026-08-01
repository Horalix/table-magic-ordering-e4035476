/**
 * @vitest-environment node
 *
 * Floor alerts.
 *
 * `waiter_calls.status` has permitted 'acknowledged' since the very first
 * migration and nothing ever wrote it, so two waiters routinely walked to the
 * same table and a cleared call had no author. These tests pin claiming, the
 * takeover rule that stops a claim becoming a trap, and the one thing the
 * "free the table" button must never do: end a session that still owes money.
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
const MARKO = '33333333-3333-3333-3333-333333333333';
const BURGER = 'cccccccc-cccc-cccc-cccc-cccccccc0001';
const SESSION = 'eeeeeeee-eeee-eeee-eeee-eeeeeeee0001';
const TOKEN = 'sess-token-7';

let db: Db;

async function seed() {
  await db.exec(`
    TRUNCATE public.audit_log, public.order_ticket_events, public.order_items, public.orders,
             public.waiter_calls, public.bill_requests,
             public.table_sessions, public.tables,
             public.menu_items, public.subcategories, public.categories, public.order_code_counters
      RESTART IDENTITY CASCADE;
    DELETE FROM public.user_roles;
    DELETE FROM auth.users;

    UPDATE public.restaurant_settings SET ordering_enabled = true, online_card_enabled = false WHERE id = 1;

    INSERT INTO auth.users(id) VALUES ('${ADMIN}'), ('${ANA}'), ('${MARKO}');
    INSERT INTO public.user_roles(user_id, role) VALUES
      ('${ADMIN}', 'admin'), ('${ANA}', 'staff'), ('${MARKO}', 'staff');

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

const newCall = async () => {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO public.waiter_calls(table_session_id) VALUES ($1) RETURNING id`, [SESSION]);
  return rows[0].id;
};

const newBillRequest = async () => {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO public.bill_requests(table_session_id) VALUES ($1) RETURNING id`, [SESSION]);
  return rows[0].id;
};

const call = async (id: string) => {
  const { rows } = await db.query<{ status: string; acknowledged_by: string | null; resolved_by: string | null }>(
    `SELECT status, acknowledged_by, resolved_by FROM public.waiter_calls WHERE id = $1`, [id]);
  return rows[0];
};

const ack = async (id: string) => {
  const { rows } = await db.query<{ result: { status: string; claimed_by: string; mine: boolean } }>(
    `SELECT public.staff_ack_waiter_call($1) AS result`, [id]);
  return rows[0].result;
};

const placeOrder = async () => {
  const { rows } = await db.query<{ result: Record<string, unknown> }>(
    `SELECT public.guest_place_order($1, $2, 'Amina', 'cash', $3::jsonb, 0) AS result`,
    [SESSION, TOKEN, JSON.stringify([{ menu_item_id: BURGER, quantity: 1 }])],
  );
  return rows[0].result.order_id as string;
};

beforeAll(async () => { db = (await createTestDatabase({ quiet: true })) as unknown as Db; }, 180_000);
afterAll(async () => { await db?.close(); });
beforeEach(seed);

describe('claiming a call', () => {
  it('records who is going', async () => {
    const id = await newCall();

    await actAs(db, ANA);
    const result = await ack(id);
    await actAs(db, null);

    expect(result.mine).toBe(true);
    expect((await call(id)).status).toBe('acknowledged');
    expect((await call(id)).acknowledged_by).toBe(ANA);
  });

  it('tells the second waiter someone else already has it', async () => {
    // The whole point: two waiters walking to the same table is the failure.
    const id = await newCall();

    await actAs(db, ANA);
    await ack(id);
    await actAs(db, MARKO);
    const second = await ack(id);
    await actAs(db, null);

    expect(second.mine).toBe(false);
    expect(second.claimed_by).toBe(ANA);
    expect((await call(id)).acknowledged_by).toBe(ANA);
  });

  it('is idempotent for the waiter who already holds it', async () => {
    const id = await newCall();

    await actAs(db, ANA);
    await ack(id);
    const again = await ack(id);
    await actAs(db, null);

    expect(again.mine).toBe(true);
  });

  it('lets a stale claim be taken over, so a claim cannot strand a guest', async () => {
    // A waiter who claims and is then pinned at another table must not be able
    // to make the guest invisible to everyone else.
    const id = await newCall();

    await actAs(db, ANA);
    await ack(id);
    await actAs(db, null);
    await db.exec(`UPDATE public.waiter_calls SET acknowledged_at = now() - interval '10 minutes'`);

    await actAs(db, MARKO);
    const taken = await ack(id);
    await actAs(db, null);

    expect(taken.mine).toBe(true);
    expect((await call(id)).acknowledged_by).toBe(MARKO);
  });

  it('does not re-open a call that has been dealt with', async () => {
    const id = await newCall();

    await actAs(db, ANA);
    await db.query(`SELECT public.staff_resolve_waiter_call($1)`, [id]);
    const after = await ack(id);
    await actAs(db, null);

    expect(after.status).toBe('resolved');
    expect((await call(id)).status).toBe('resolved');
  });

  it('is staff-only', async () => {
    const id = await newCall();
    await expect(db.query(`SELECT public.staff_ack_waiter_call($1)`, [id]))
      .rejects.toThrow(/Only staff/);
  });
});

describe('resolving a call', () => {
  it('records who cleared it', async () => {
    const id = await newCall();

    await actAs(db, MARKO);
    await db.query(`SELECT public.staff_resolve_waiter_call($1)`, [id]);
    await actAs(db, null);

    const row = await call(id);
    expect(row.status).toBe('resolved');
    expect(row.resolved_by).toBe(MARKO);
  });

  it('reports that a second resolve changed nothing', async () => {
    const id = await newCall();

    await actAs(db, ANA);
    await db.query(`SELECT public.staff_resolve_waiter_call($1)`, [id]);
    const { rows } = await db.query<{ result: { resolved: boolean } }>(
      `SELECT public.staff_resolve_waiter_call($1) AS result`, [id]);
    await actAs(db, null);

    expect(rows[0].result.resolved).toBe(false);
  });
});

describe('freeing a table at the bill', () => {
  it('refuses to close a session that still owes money', async () => {
    // There was no such check anywhere: a tap on a 24px button could end a
    // session with an unpaid order on it, and nobody looks at a closed table.
    await placeOrder();
    const request = await newBillRequest();

    await actAs(db, ANA);
    const { rows } = await db.query<{ result: { closed: boolean; outstanding: number } }>(
      `SELECT public.staff_resolve_bill_request($1, true) AS result`, [request]);
    await actAs(db, null);

    expect(rows[0].result.closed).toBe(false);
    expect(Number(rows[0].result.outstanding)).toBe(18);

    const { rows: session } = await db.query<{ is_active: boolean }>(
      `SELECT is_active FROM public.table_sessions WHERE id = $1`, [SESSION]);
    expect(session[0].is_active).toBe(true);
  });

  it('still resolves the request even when it will not close the table', async () => {
    await placeOrder();
    const request = await newBillRequest();

    await actAs(db, ANA);
    await db.query(`SELECT public.staff_resolve_bill_request($1, true)`, [request]);
    await actAs(db, null);

    const { rows } = await db.query<{ status: string }>(
      `SELECT status FROM public.bill_requests WHERE id = $1`, [request]);
    expect(rows[0].status).toBe('resolved');
  });

  it('closes the table once everything is paid for', async () => {
    const order = await placeOrder();
    const request = await newBillRequest();

    await actAs(db, ANA);
    await db.query(`SELECT public.record_table_payment($1, 'cash')`, [order]);
    const { rows } = await db.query<{ result: { closed: boolean } }>(
      `SELECT public.staff_resolve_bill_request($1, true) AS result`, [request]);
    await actAs(db, null);

    expect(rows[0].result.closed).toBe(true);
    const { rows: session } = await db.query<{ is_active: boolean }>(
      `SELECT is_active FROM public.table_sessions WHERE id = $1`, [SESSION]);
    expect(session[0].is_active).toBe(false);
  });

  it('leaves the table seated when only the request is being cleared', async () => {
    // Guests pay and then sit with a coffee. Closing the session here would
    // shorten every recorded sitting and quietly corrupt turnover reporting.
    const request = await newBillRequest();

    await actAs(db, ANA);
    await db.query(`SELECT public.staff_resolve_bill_request($1, false)`, [request]);
    await actAs(db, null);

    const { rows } = await db.query<{ is_active: boolean }>(
      `SELECT is_active FROM public.table_sessions WHERE id = $1`, [SESSION]);
    expect(rows[0].is_active).toBe(true);
  });
});

describe('covers', () => {
  it('records a head count', async () => {
    await actAs(db, ANA);
    await db.query(`SELECT public.staff_set_covers($1, 4)`, [SESSION]);
    await actAs(db, null);

    const { rows } = await db.query<{ covers: number }>(
      `SELECT covers FROM public.table_sessions WHERE id = $1`, [SESSION]);
    expect(rows[0].covers).toBe(4);
  });

  it('can be cleared back to unknown rather than to zero', async () => {
    // NULL and 0 are different claims. A zero would be a lie that silently
    // divides by nothing in every per-head metric.
    await actAs(db, ANA);
    await db.query(`SELECT public.staff_set_covers($1, 4)`, [SESSION]);
    await db.query(`SELECT public.staff_set_covers($1, NULL)`, [SESSION]);
    await actAs(db, null);

    const { rows } = await db.query<{ covers: number | null }>(
      `SELECT covers FROM public.table_sessions WHERE id = $1`, [SESSION]);
    expect(rows[0].covers).toBeNull();
  });

  it('rejects an impossible count', async () => {
    await actAs(db, ANA);
    await expect(db.query(`SELECT public.staff_set_covers($1, 0)`, [SESSION]))
      .rejects.toThrow(/between 1 and 50/);
    await actAs(db, null);
  });

  it('reports how much of the day was actually counted', async () => {
    await db.exec(`
      INSERT INTO public.table_sessions(id, table_id, token, is_active, covers)
      VALUES ('eeeeeeee-0000-0000-0000-000000000002', 'dddddddd-0000-0000-0000-000000000001', 'tok-2', false, NULL),
             ('eeeeeeee-0000-0000-0000-000000000003', 'dddddddd-0000-0000-0000-000000000001', 'tok-3', false, 2);
    `);
    await actAs(db, ANA);
    await db.query(`SELECT public.staff_set_covers($1, 4)`, [SESSION]);
    const { rows } = await db.query<{ result: { sittings: number; counted: number; covers: number; coverage: number } }>(
      `SELECT public.covers_summary() AS result`);
    await actAs(db, null);

    expect(rows[0].result.sittings).toBe(3);
    expect(rows[0].result.counted).toBe(2);
    expect(rows[0].result.covers).toBe(6);
    // Two of three counted — a per-head figure must show this, not hide it.
    expect(Number(rows[0].result.coverage)).toBeCloseTo(0.667, 2);
  });

  it('is staff-only', async () => {
    await expect(db.query(`SELECT public.staff_set_covers($1, 4)`, [SESSION]))
      .rejects.toThrow(/Only staff/);
  });
});
