/**
 * @vitest-environment node
 *
 * The history behind tomorrow's prep list (20261025127000_prep_history.sql):
 * same weekdays only, newest first, by daypart, and a day the dish was sold
 * out is unknown (null), never zero demand.
 */
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error -- plain JS harness, no types needed
import { createTestDatabase, actAs } from '../../scripts/db-harness.mjs';

type Db = {
  query: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
  exec: (sql: string) => Promise<unknown>;
  close: () => Promise<void>;
};

interface History {
  day: string;
  weeks: string[];
  items: { name: string; series: Record<string, (number | null)[]>; last28: Record<string, number>; unit_cm: number; unit_cost: number }[];
}

const STAFF = '22222222-2222-2222-2222-222222222222';
const SOUP = 'cccccccc-0000-0000-0000-000000000001';
const TABLE = 'dddddddd-0000-0000-0000-000000000001';

let db: Db;

beforeAll(async () => { db = await createTestDatabase({ quiet: true }); }, 180_000);
afterAll(async () => { await db?.close(); });
beforeEach(async () => {
  await db.exec(`
    TRUNCATE public.menu_item_availability_log, public.order_ticket_events, public.order_items, public.orders,
             public.table_sessions, public.tables, public.menu_items, public.subcategories, public.categories
      RESTART IDENTITY CASCADE;
    DELETE FROM public.user_roles;
    DELETE FROM auth.users;
    INSERT INTO auth.users(id) VALUES ('${STAFF}');
    INSERT INTO public.user_roles(user_id, role) VALUES ('${STAFF}', 'staff');
    INSERT INTO public.categories(id, name, sort_order) VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'Food', 1);
    INSERT INTO public.subcategories(id, category_id, name, sort_order)
      VALUES ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Soups', 1);
    INSERT INTO public.menu_items(id, subcategory_id, name, price, food_cost, is_available, created_at)
      VALUES ('${SOUP}', 'bbbbbbbb-0000-0000-0000-000000000001', 'Begova čorba', 8, 2.5, true, now() - interval '400 days');
    INSERT INTO public.tables(id, table_number) VALUES ('${TABLE}', 7);
  `);
  await db.exec(`ALTER TABLE public.orders DISABLE TRIGGER trg_enforce_order_limits`);
  await actAs(db, null);
});

/** `qty` bowls on the trading day `daysAgo` before today, at a Sarajevo hour. */
async function sell(daysAgo: number, qty: number, hour = '12:30') {
  const at = `((public.business_day() - ${daysAgo}) + time '${hour}')::timestamp AT TIME ZONE 'Europe/Sarajevo'`;
  const session = crypto.randomUUID();
  await db.query(`INSERT INTO public.table_sessions(id, table_id, token, is_active, opened_at)
                  VALUES ($1, '${TABLE}', $2, false, ${at})`, [session, `t-${session}`]);
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO public.orders(table_session_id, total, status, payment_status, payment_method, released_to_kitchen_at, created_at)
     VALUES ($1, $2, 'served', 'paid', 'cash', ${at}, ${at}) RETURNING id`, [session, qty * 8]);
  await db.query(`INSERT INTO public.order_items(order_id, menu_item_id, quantity, unit_price, status)
                  VALUES ($1, '${SOUP}', $2, 8, 'served')`, [rows[0].id, qty]);
}

async function history(): Promise<History> {
  await actAs(db, STAFF);
  try {
    return (await db.query<{ r: History }>(`SELECT public.prep_history() AS r`)).rows[0].r;
  } finally {
    await actAs(db, null);
  }
}

describe('prep history', () => {
  it('lines up the same weekday, newest first, by daypart; sold-out days are unknown', async () => {
    // Tomorrow is the target, so the same weekdays are 6, 13, 20 … days ago.
    await sell(6, 5);
    await sell(6, 2, '20:00');
    await sell(13, 7);
    // 20 days ago the restaurant traded (an order whose line is removed below)
    // but the soup was off all day.
    await sell(20, 1);
    await db.query(
      `INSERT INTO public.menu_item_availability_log(menu_item_id, is_available, changed_at) VALUES
         ($1, false, ((public.business_day() - 21) + time '23:00')::timestamp AT TIME ZONE 'Europe/Sarajevo'),
         ($1, true,  ((public.business_day() - 19) + time '06:00')::timestamp AT TIME ZONE 'Europe/Sarajevo')`, [SOUP]);
    await db.exec(`DELETE FROM public.order_items WHERE quantity = 1`);
    // …and a trading day 27 days ago with no soup sold while it was on.
    await sell(27, 3, '16:30');

    const h = await history();
    const soup = h.items.find((i) => i.name === 'Begova čorba')!;
    expect(h.weeks).toHaveLength(10);
    expect(soup.series.lunch.slice(0, 4)).toEqual([5, 7, null, 0]);
    expect(soup.series.evening.slice(0, 2)).toEqual([2, 0]);
    expect(soup.series.afternoon[3]).toBe(3);
    // A week with no trading at all is unknown too.
    expect(soup.series.lunch[4]).toBeNull();
    expect(soup.last28.lunch).toBe(12);
    expect(Number(soup.unit_cm)).toBe(5.5);
    expect(Number(soup.unit_cost)).toBe(2.5);
  });

  it('refuses a caller who is not staff', async () => {
    await expect(db.query(`SELECT public.prep_history()`)).rejects.toThrow(/staff/i);
  });
});
