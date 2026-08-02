/**
 * @vitest-environment node
 *
 * Regulars, and the deletion that makes keeping them defensible.
 *
 * The load-bearing test is `leaves the money behind when it forgets` — a
 * "delete my data" that also deletes the order would put a hole in the day's
 * reconciliation, and a restaurant cannot honour a privacy request by losing
 * its books. The link goes; the financial record stays.
 */
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error -- plain JS harness, no types needed
import { createTestDatabase, actAs } from '../../scripts/db-harness.mjs';

type Db = {
  query: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
  exec: (sql: string) => Promise<unknown>;
  close: () => Promise<void>;
};

const STAFF = '22222222-2222-2222-2222-222222222222';
const TABLE = 'dddddddd-0000-0000-0000-000000000001';

let db: Db;

async function seed() {
  await db.exec(`
    TRUNCATE public.audit_log, public.guest_profiles, public.session_join_requests,
             public.session_experiment_assignment, public.experiments,
             public.order_ticket_events, public.order_items, public.orders,
             public.table_sessions, public.tables,
             public.menu_items, public.subcategories, public.categories, public.order_code_counters
      RESTART IDENTITY CASCADE;
    DELETE FROM public.user_roles;
    DELETE FROM auth.users;

    INSERT INTO auth.users(id) VALUES ('${STAFF}');
    INSERT INTO public.user_roles(user_id, role) VALUES ('${STAFF}', 'admin'), ('${STAFF}', 'staff');
    INSERT INTO public.tables(id, table_number) VALUES ('${TABLE}', 7);
  `);
  await db.exec(`ALTER TABLE public.orders DISABLE TRIGGER trg_enforce_order_limits`);
  await actAs(db, null);
}

/** A visit by a given device, with a net item total and an optional tip. */
async function visit(clientId: string | null, net: number, opts: { tip?: number; daysAgo?: number } = {}) {
  const session = crypto.randomUUID();
  await db.query(
    `INSERT INTO public.table_sessions(id, table_id, token, is_active, host_client_id, opened_at)
     VALUES ($1, '${TABLE}', $2, false, $3, now() - make_interval(days => $4))`,
    [session, `t-${session.slice(0, 8)}`, clientId, opts.daysAgo ?? 0]);
  await db.query(
    `INSERT INTO public.orders(table_session_id, total, tip_amount, status, payment_status,
                               payment_method, released_to_kitchen_at, created_at, paid_at)
     VALUES ($1, $2, $3, 'served', 'paid', 'cash', now(), now() - make_interval(days => $4), now())`,
    [session, net + (opts.tip ?? 0), opts.tip ?? 0, opts.daysAgo ?? 0]);
  return session;
}

const refresh = async () => {
  await actAs(db, STAFF);
  await db.query(`SELECT public.refresh_guest_profiles()`);
  await actAs(db, null);
};

const stats = async (days = 30) => {
  await actAs(db, STAFF);
  const { rows } = await db.query<{ r: Record<string, unknown> }>(
    `SELECT public.returning_guest_stats($1) AS r`, [days]);
  await actAs(db, null);
  return rows[0].r;
};

beforeAll(async () => { db = (await createTestDatabase({ quiet: true })) as unknown as Db; }, 180_000);
afterAll(async () => { await db?.close(); });
beforeEach(seed);

describe('profiles', () => {
  it('counts visits per device', async () => {
    await visit('phone-a', 20, { daysAgo: 5 });
    await visit('phone-a', 30, { daysAgo: 2 });
    await visit('phone-b', 15);
    await refresh();

    const { rows } = await db.query<{ client_id: string; visits: number; net_spend: number }>(
      `SELECT client_id, visits, net_spend FROM public.guest_profiles ORDER BY client_id`);
    expect(rows[0].visits).toBe(2);
    expect(Number(rows[0].net_spend)).toBe(50);
    expect(rows[1].visits).toBe(1);
  });

  it('excludes tips from what a device has spent', async () => {
    await visit('phone-a', 20, { tip: 10 });
    await refresh();
    const { rows } = await db.query<{ net_spend: number }>(
      `SELECT net_spend FROM public.guest_profiles WHERE client_id = 'phone-a'`);
    expect(Number(rows[0].net_spend)).toBe(20);
  });

  it('ignores a table that never ordered', async () => {
    await db.query(
      `INSERT INTO public.table_sessions(table_id, token, is_active, host_client_id)
       VALUES ('${TABLE}', 'empty', false, 'phone-ghost')`);
    await refresh();
    const { rows } = await db.query(`SELECT 1 FROM public.guest_profiles WHERE client_id = 'phone-ghost'`);
    expect(rows).toHaveLength(0);
  });

  it('is rebuilt from scratch, so a later refund flows through', async () => {
    // Derived rather than incrementally maintained — that is what stops it
    // drifting away from the orders it describes.
    await visit('phone-a', 50);
    await refresh();
    // Through the real refund RPC — a direct UPDATE to refunded_amount is
    // refused by enforce_order_integrity, which is the point of that guard.
    await actAs(db, STAFF);
    const { rows: o } = await db.query<{ id: string }>(`SELECT id FROM public.orders LIMIT 1`);
    await db.query(`SELECT public.record_order_refund($1, 20, 'cash', 'test', true)`, [o[0].id]);
    await actAs(db, null);
    await refresh();

    const { rows } = await db.query<{ net_spend: number }>(
      `SELECT net_spend FROM public.guest_profiles WHERE client_id = 'phone-a'`);
    expect(Number(rows[0].net_spend)).toBe(30);
  });

  it('is staff-only to read or rebuild', async () => {
    await expect(db.query(`SELECT public.refresh_guest_profiles()`)).rejects.toThrow(/Only staff/);
  });
});

describe('forgetting a device', () => {
  it('leaves the money behind when it forgets', async () => {
    /*
     * THE test. A privacy request must not put a hole in the books. The link
     * from device to visit is severed; the order and its total remain, because
     * they are a financial record the restaurant is required to keep.
     */
    await visit('phone-a', 40);
    await refresh();

    const { rows: r } = await db.query<{ result: { forgotten: boolean; sessions_unlinked: number } }>(
      `SELECT public.guest_forget_me('phone-a') AS result`);
    expect(r[0].result.forgotten).toBe(true);
    expect(r[0].result.sessions_unlinked).toBe(1);

    const { rows: orders } = await db.query<{ total: number }>(`SELECT total FROM public.orders`);
    expect(orders).toHaveLength(1);
    expect(Number(orders[0].total)).toBe(40);
  });

  it('cannot be re-derived afterwards', async () => {
    // Unlinking without removing the profile would just resurrect it on the
    // next nightly rebuild.
    await visit('phone-a', 40);
    await refresh();
    await db.query(`SELECT public.guest_forget_me('phone-a')`);
    await refresh();

    const { rows } = await db.query(`SELECT 1 FROM public.guest_profiles WHERE client_id = 'phone-a'`);
    expect(rows).toHaveLength(0);
  });

  it('removes pending join requests too', async () => {
    const session = await visit('phone-a', 10);
    // A join request may only be filed against a live table, so reopen it.
    await db.query(`UPDATE public.table_sessions SET is_active = true WHERE id = $1`, [session]);
    await db.query(
      `INSERT INTO public.session_join_requests(table_session_id, guest_name, client_id, status)
       VALUES ($1, 'Amina', 'phone-a', 'approved')`, [session]);

    await db.query(`SELECT public.guest_forget_me('phone-a')`);
    const { rows } = await db.query(`SELECT 1 FROM public.session_join_requests WHERE client_id = 'phone-a'`);
    expect(rows).toHaveLength(0);
  });

  it('does not touch another device', async () => {
    await visit('phone-a', 10);
    await visit('phone-b', 20);
    await refresh();
    await db.query(`SELECT public.guest_forget_me('phone-a')`);
    await refresh();

    const { rows } = await db.query<{ client_id: string }>(
      `SELECT client_id FROM public.guest_profiles`);
    expect(rows.map((r) => r.client_id)).toEqual(['phone-b']);
  });

  it('is callable by the device itself, with no account', async () => {
    // There is nothing to authorise against — it is the device's own
    // identifier and it must be able to sever it without asking.
    await visit('phone-a', 10);
    await actAs(db, null);
    const { rows } = await db.query<{ result: { forgotten: boolean } }>(
      `SELECT public.guest_forget_me('phone-a') AS result`);
    expect(rows[0].result.forgotten).toBe(true);
  });

  it('says so rather than pretending, given nothing to forget', async () => {
    const { rows } = await db.query<{ result: { forgotten: boolean; reason: string } }>(
      `SELECT public.guest_forget_me('') AS result`);
    expect(rows[0].result.forgotten).toBe(false);
    expect(rows[0].result.reason).toBe('no_client_id');
  });
});

describe('returning guests', () => {
  it('counts a first visit as new and a second as returning', async () => {
    await visit('phone-a', 20, { daysAgo: 10 });
    await visit('phone-a', 25, { daysAgo: 1 });

    const s = await stats();
    expect(Number(s.visits)).toBe(2);
    expect(Number(s.returning)).toBe(1);
    expect(Number(s.returning_pct)).toBe(50);
  });

  it('reports what a returning table is worth against a new one', async () => {
    await visit('phone-a', 20, { daysAgo: 10 });
    await visit('phone-a', 60, { daysAgo: 1 });
    await visit('phone-b', 20, { daysAgo: 1 });

    const s = await stats();
    expect(Number(s.avg_spend_returning)).toBe(60);
    expect(Number(s.avg_spend_new)).toBe(20);
  });

  it('states coverage, because unidentified visits cannot be classified', async () => {
    // A rate computed over an unknown share of the room is not a rate.
    await visit('phone-a', 20);
    await visit(null, 20);

    const s = await stats();
    expect(Number(s.identified)).toBe(1);
    expect(Number(s.coverage)).toBe(0.5);
  });

  it('has no opinion when nobody is identified', async () => {
    await visit(null, 20);
    const s = await stats();
    expect(s.returning_pct).toBeNull();
  });

  it('is staff-only', async () => {
    await expect(db.query(`SELECT public.returning_guest_stats(30)`)).rejects.toThrow(/Only staff/);
  });
});
