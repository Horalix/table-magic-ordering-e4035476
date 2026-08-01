/**
 * @vitest-environment node
 *
 * Closing the day.
 *
 * The rule under test is the one that matters: a discrepancy is RECORDED,
 * never adjusted away. Counting the drawer must not be able to change what was
 * sold — if the two disagree, that disagreement is the finding, and a close
 * that quietly reconciles it is how a slow leak runs for a year.
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
const SESSION = 'eeeeeeee-eeee-eeee-eeee-eeeeeeee0001';
const TOKEN = 'sess-token-7';

let db: Db;

async function seed() {
  await db.exec(`
    TRUNCATE public.audit_log, public.shift_closes, public.order_ticket_events, public.order_items,
             public.orders, public.table_sessions, public.tables,
             public.menu_items, public.subcategories, public.categories, public.order_code_counters
      RESTART IDENTITY CASCADE;
    DELETE FROM public.user_roles;
    DELETE FROM auth.users;

    UPDATE public.restaurant_settings SET ordering_enabled = true, online_card_enabled = false WHERE id = 1;

    INSERT INTO auth.users(id) VALUES ('${ADMIN}'), ('${STAFF}');
    INSERT INTO public.user_roles(user_id, role) VALUES ('${ADMIN}', 'admin'), ('${STAFF}', 'staff');

    INSERT INTO public.categories(id, name, sort_order) VALUES
      ('aaaaaaaa-0000-0000-0000-000000000001', 'Food', 1);
    INSERT INTO public.subcategories(id, category_id, name, sort_order) VALUES
      ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Burgers', 1);
    INSERT INTO public.menu_items(id, subcategory_id, name, price, is_available, station) VALUES
      ('${BURGER}', 'bbbbbbbb-0000-0000-0000-000000000001', 'La Soul Burger', 20.00, true, 'kitchen');

    INSERT INTO public.tables(id, table_number) VALUES ('dddddddd-0000-0000-0000-000000000001', 7);
    INSERT INTO public.table_sessions(id, table_id, token, is_active, guest_name, last_heartbeat_at)
      VALUES ('${SESSION}', 'dddddddd-0000-0000-0000-000000000001', '${TOKEN}', true, 'Amina', now());
  `);
  await actAs(db, null);
}

/** One paid order, so the day has an expected cash figure. */
async function paidOrder(method: 'cash' | 'pos_terminal' = 'cash') {
  const { rows } = await db.query<{ result: Record<string, unknown> }>(
    `SELECT public.guest_place_order($1, $2, 'Amina', 'cash', $3::jsonb, 0) AS result`,
    [SESSION, TOKEN, JSON.stringify([{ menu_item_id: BURGER, quantity: 1 }])],
  );
  const orderId = rows[0].result.order_id as string;
  await actAs(db, STAFF);
  await db.query(`SELECT public.record_table_payment($1, $2)`, [orderId, method]);
  await actAs(db, null);
  return orderId;
}

const close = async (args: Record<string, unknown> = {}) => {
  const { rows } = await db.query<{ result: Record<string, number | null> }>(
    `SELECT public.close_shift(NULL, $1, $2, $3, $4, $5) AS result`,
    [args.cash ?? null, args.terminal ?? null, args.batch ?? null, args.notes ?? null, args.ack ?? false],
  );
  return rows[0].result;
};

beforeAll(async () => { db = (await createTestDatabase({ quiet: true })) as unknown as Db; }, 180_000);
afterAll(async () => { await db?.close(); });
beforeEach(seed);

describe('closing a day', () => {
  it('is a manager decision', async () => {
    await actAs(db, STAFF);
    await expect(db.query(`SELECT public.close_shift()`)).rejects.toThrow(/Only a manager/);
    await actAs(db, null);
  });

  it('snapshots what the system believes was taken', async () => {
    await paidOrder('cash');

    await actAs(db, ADMIN);
    const result = await close({ cash: 20 });
    await actAs(db, null);

    expect(Number(result.expected_cash)).toBe(20);
    expect(Number(result.cash_difference)).toBe(0);
  });

  it('records a short drawer instead of hiding it', async () => {
    // The whole point. A close that silently balanced this would make a slow
    // leak invisible for as long as it took someone to notice by hand.
    await paidOrder('cash');

    await actAs(db, ADMIN);
    const result = await close({ cash: 15 });
    await actAs(db, null);

    expect(Number(result.cash_difference)).toBe(-5);
  });

  it('changes nothing about what was sold', async () => {
    const order = await paidOrder('cash');

    await actAs(db, ADMIN);
    await close({ cash: 5 });
    await actAs(db, null);

    const { rows } = await db.query<{ total: number; payment_status: string }>(
      `SELECT total, payment_status FROM public.orders WHERE id = $1`, [order]);
    expect(Number(rows[0].total)).toBe(20);
    expect(rows[0].payment_status).toBe('paid');
  });

  it('treats "not counted" as unknown, not as zero', async () => {
    await paidOrder('cash');

    await actAs(db, ADMIN);
    const result = await close({});
    await actAs(db, null);

    // A NULL difference says nobody counted. Zero would claim it balanced.
    expect(result.cash_difference).toBeNull();
    expect(Number(result.expected_cash)).toBe(20);
  });

  it('keeps cash and terminal apart', async () => {
    await paidOrder('cash');
    await paidOrder('pos_terminal');

    await actAs(db, ADMIN);
    const result = await close({ cash: 20, terminal: 25 });
    await actAs(db, null);

    expect(Number(result.expected_cash)).toBe(20);
    expect(Number(result.expected_terminal)).toBe(20);
    expect(Number(result.terminal_difference)).toBe(5);
  });

  it('writes an audit entry naming the difference', async () => {
    await paidOrder('cash');

    await actAs(db, ADMIN);
    await close({ cash: 12, notes: 'two coffees comped' });
    await actAs(db, null);

    const { rows } = await db.query<{ after_state: { cash_difference: number }; reason: string }>(
      `SELECT after_state, reason FROM public.audit_log WHERE action = 'shift.closed'`);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].after_state.cash_difference)).toBe(-8);
    expect(rows[0].reason).toBe('two coffees comped');
  });
});

describe('closing twice', () => {
  it('corrects the same day rather than creating a second version of it', async () => {
    await paidOrder('cash');

    await actAs(db, ADMIN);
    await close({ cash: 15 });
    const second = await close({ cash: 20 });
    await actAs(db, null);

    const { rows } = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.shift_closes`);
    expect(rows[0].n).toBe(1);
    expect(Number(second.cash_difference)).toBe(0);
  });

  it('leaves both attempts in the audit log', async () => {
    // The correction is legitimate; erasing the first count is not.
    await actAs(db, ADMIN);
    await close({ cash: 15 });
    await close({ cash: 20 });
    await actAs(db, null);

    const { rows } = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.audit_log WHERE action = 'shift.closed'`);
    expect(rows[0].n).toBe(2);
  });
});

describe('reading a close back', () => {
  it('returns nothing for a day nobody closed', async () => {
    await actAs(db, STAFF);
    const { rows } = await db.query<{ result: unknown }>(`SELECT public.shift_close_for() AS result`);
    await actAs(db, null);
    expect(rows[0].result).toBeNull();
  });

  it('returns what was counted and what was noted', async () => {
    await actAs(db, ADMIN);
    await close({ cash: 40, batch: 'BATCH-118', notes: 'terminal reprinted', ack: true });
    await actAs(db, STAFF);
    const { rows } = await db.query<{ result: Record<string, unknown> }>(
      `SELECT public.shift_close_for() AS result`);
    await actAs(db, null);

    expect(Number(rows[0].result.counted_cash)).toBe(40);
    expect(rows[0].result.terminal_batch_reference).toBe('BATCH-118');
    expect(rows[0].result.acknowledged_issues).toBe(true);
  });

  it('grants no way to write a close except the RPC', async () => {
    // Asserted on the policy set rather than by attempting an INSERT: this
    // harness connects as the table owner, who bypasses RLS, so an INSERT here
    // would succeed regardless and the test would prove nothing.
    //
    // What matters is that SELECT is the only thing a browser client is
    // granted. Without that, a close could be written without a snapshot and
    // without an author, which is a formality rather than a control.
    const { rows } = await db.query<{ cmd: string; rls: boolean }>(`
      SELECT p.cmd, c.relrowsecurity AS rls
        FROM pg_policies p
        JOIN pg_class c ON c.relname = p.tablename
       WHERE p.schemaname = 'public' AND p.tablename = 'shift_closes'
    `);

    expect(rows.map((r) => r.cmd)).toEqual(['SELECT']);
    expect(rows.every((r) => r.rls)).toBe(true);
  });
});
