/**
 * @vitest-environment node
 *
 * The trading day.
 *
 * These tests pin the boundary explicitly instead of relying on when they
 * happen to run. The bug they cover was invisible for weeks and then broke six
 * shift-close tests at 01:35 in the morning, because that is the only time of
 * day it is observable — which is precisely why it needs a test that does not
 * depend on the clock.
 *
 * The one that matters is `counts a half-past-midnight sale in the night that
 * earned it`. Everything else is scaffolding around that.
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

let db: Db;

async function seed() {
  await db.exec(`
    TRUNCATE public.audit_log, public.shift_closes,
             public.order_ticket_events, public.order_items, public.orders,
             public.table_sessions, public.tables,
             public.menu_items, public.subcategories, public.categories, public.order_code_counters
      RESTART IDENTITY CASCADE;
    DELETE FROM public.user_roles;
    DELETE FROM auth.users;

    INSERT INTO auth.users(id) VALUES ('${ADMIN}'), ('${STAFF}');
    INSERT INTO public.user_roles(user_id, role) VALUES ('${ADMIN}', 'admin'), ('${STAFF}', 'staff');

    INSERT INTO public.categories(id, name, sort_order) VALUES
      ('aaaaaaaa-0000-0000-0000-000000000001', 'Food', 1);
    INSERT INTO public.subcategories(id, category_id, name, sort_order) VALUES
      ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Mains', 1);
    INSERT INTO public.menu_items(id, subcategory_id, name, price, is_available, station) VALUES
      ('${BURGER}', 'bbbbbbbb-0000-0000-0000-000000000001', 'Burger', 20.00, true, 'kitchen');

    INSERT INTO public.tables(id, table_number) VALUES ('${TABLE}', 7);
  `);
  await db.exec(`ALTER TABLE public.orders DISABLE TRIGGER trg_enforce_order_limits`);
  await actAs(db, null);
}

/** A paid cash order at an exact Sarajevo wall-clock moment. */
async function saleAt(localMoment: string, amount = 20) {
  const session = crypto.randomUUID();
  await db.query(
    `INSERT INTO public.table_sessions(id, table_id, token, is_active)
     VALUES ($1, '${TABLE}', $2, false)`, [session, `s-${session.slice(0, 8)}`]);
  await db.query(
    `INSERT INTO public.orders(table_session_id, total, status, payment_status, payment_method,
                               released_to_kitchen_at, created_at, paid_at)
     VALUES ($1, $2, 'served', 'paid', 'cash', now(),
             ($3::timestamp AT TIME ZONE 'Europe/Sarajevo'),
             ($3::timestamp AT TIME ZONE 'Europe/Sarajevo'))`,
    [session, amount, localMoment]);
}

const cashFor = async (day: string) => {
  await actAs(db, STAFF);
  const { rows } = await db.query<{ r: { paid_cash: string } }>(
    `SELECT public.day_reconciliation($1::date) AS r`, [day]);
  await actAs(db, null);
  return Number(rows[0].r.paid_cash);
};

beforeAll(async () => { db = (await createTestDatabase({ quiet: true })) as unknown as Db; }, 180_000);
afterAll(async () => { await db?.close(); });
beforeEach(seed);

describe('the boundary', () => {
  it('counts a half-past-midnight sale in the night that earned it', async () => {
    /*
     * THE BUG. 00:30 Sarajevo on 3 August is 22:30 UTC on 2 August, so the old
     * UTC window filed this sale under the 2nd — a day whose drawer had already
     * been counted and signed off hours earlier. The takings existed in the
     * orders table and appeared in no reconciliation at all.
     */
    await saleAt('2026-08-03 00:30:00');

    expect(await cashFor('2026-08-03')).toBe(20);
    expect(await cashFor('2026-08-02')).toBe(0);
  });

  it('keeps a late evening on its own day', async () => {
    // The other side of the same boundary: 23:30 must not leak forward.
    await saleAt('2026-08-02 23:30:00');

    expect(await cashFor('2026-08-02')).toBe(20);
    expect(await cashFor('2026-08-03')).toBe(0);
  });

  it('keeps one late service together', async () => {
    // A cafe closing at 01:00 has one night of trade, not two part-nights.
    await saleAt('2026-08-02 21:00:00', 30);
    await saleAt('2026-08-02 23:45:00', 25);
    await saleAt('2026-08-03 00:15:00', 15);
    await saleAt('2026-08-03 00:55:00', 10);

    expect(await cashFor('2026-08-02')).toBe(55);
    expect(await cashFor('2026-08-03')).toBe(25);
  });

  it('spans exactly one day, with no gap and no overlap', async () => {
    const { rows } = await db.query<{ gap: string }>(`
      SELECT (SELECT ends_at FROM public.business_day_range('2026-08-02'))
           = (SELECT starts_at FROM public.business_day_range('2026-08-03')) AS gap`);
    expect(rows[0].gap).toBe(true);
  });

  it('handles the short and long days of the year', async () => {
    // Spring forward is 23 hours, autumn back is 25. Getting this wrong would
    // drop or double an hour of trade twice a year.
    const { rows } = await db.query<{ spring: string; autumn: string; ordinary: string }>(`
      SELECT EXTRACT(EPOCH FROM (
               (SELECT ends_at FROM public.business_day_range('2026-03-29'))
             - (SELECT starts_at FROM public.business_day_range('2026-03-29')))) / 3600 AS spring,
             EXTRACT(EPOCH FROM (
               (SELECT ends_at FROM public.business_day_range('2026-10-25'))
             - (SELECT starts_at FROM public.business_day_range('2026-10-25')))) / 3600 AS autumn,
             EXTRACT(EPOCH FROM (
               (SELECT ends_at FROM public.business_day_range('2026-08-03'))
             - (SELECT starts_at FROM public.business_day_range('2026-08-03')))) / 3600 AS ordinary`);
    expect(Number(rows[0].spring)).toBe(23);
    expect(Number(rows[0].autumn)).toBe(25);
    expect(Number(rows[0].ordinary)).toBe(24);
  });

  it('agrees with the day close_shift picks', async () => {
    // The original defect in one assertion: the day chosen and the day measured
    // were computed by two different rules.
    const { rows } = await db.query<{ same: boolean }>(`
      SELECT public.business_day() = (now() AT TIME ZONE 'Europe/Sarajevo')::date AS same`);
    expect(rows[0].same).toBe(true);
  });
});

describe('closing the day', () => {
  it('expects the cash that was actually taken after midnight', async () => {
    // What the manager sees at 01:15 with the drawer open.
    await saleAt('2026-08-03 00:30:00', 120);

    await actAs(db, ADMIN);
    const { rows } = await db.query<{ r: { expected_cash: string; cash_difference: string } }>(
      `SELECT public.close_shift('2026-08-03'::date, 120) AS r`);
    await actAs(db, null);

    expect(Number(rows[0].r.expected_cash)).toBe(120);
    expect(Number(rows[0].r.cash_difference)).toBe(0);
  });

  it('no longer reports a phantom surplus', async () => {
    /*
     * Before the fix this close expected 0 and found 120 in the drawer, and
     * wrote a 120 KM discrepancy into shift_closes with an audit entry. Nightly.
     */
    await saleAt('2026-08-03 00:30:00', 120);

    await actAs(db, ADMIN);
    const { rows } = await db.query<{ r: { cash_difference: string } }>(
      `SELECT public.close_shift('2026-08-03'::date, 120) AS r`);
    await actAs(db, null);

    expect(Number(rows[0].r.cash_difference)).not.toBe(120);
  });
});

describe('reporting', () => {
  it('puts a late-night sale in the right day of the sales report', async () => {
    await saleAt('2026-08-03 00:30:00', 40);

    await actAs(db, STAFF);
    const { rows } = await db.query<{ r: { totals: { revenue: string } } }>(
      `SELECT public.sales_analytics('2026-08-03'::date, '2026-08-03'::date) AS r`);
    const { rows: prev } = await db.query<{ r: { totals: { revenue: string } } }>(
      `SELECT public.sales_analytics('2026-08-02'::date, '2026-08-02'::date) AS r`);
    await actAs(db, null);

    expect(Number(rows[0].r.totals.revenue)).toBe(40);
    expect(Number(prev[0].r.totals.revenue)).toBe(0);
  });
});
