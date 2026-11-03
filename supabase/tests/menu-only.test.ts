/**
 * @vitest-environment node
 *
 * "Menu only" (20261103120000_menu_only.sql).
 *
 * La Soul goes live on its own address with the menu and nothing else, before
 * the owner has decided to take orders through the app. The app hides the
 * ordering, the waiter button and the bill; these tests pin that the database
 * refuses them on its own too, so an app left open from before the switch
 * cannot put a ticket on a kitchen screen nobody is watching — and that the
 * switch belongs to one restaurant, never the other.
 */
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error -- plain JS harness, no types needed
import { createTestDatabase, actAs } from '../../scripts/db-harness.mjs';

type Db = {
  query: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
  exec: (sql: string) => Promise<unknown>;
  close: () => Promise<void>;
};

const L = 'a5000000-0000-4000-8000-000000000001'; // La Soul
const V = 'a5000000-0000-4000-8000-000000000002'; // Vera Italia
const SESSION = 'eeeeeeee-0000-0000-0000-000000000001';
const TOKEN = 'sess-token-7';
const BURGER = 'cccccccc-0000-0000-0000-000000000001';
const KEY = '9f0e8d7c-6b5a-4c3d-2e1f-0a9b8c7d6e5f';

let db: Db;

async function seed() {
  await db.exec(`
    TRUNCATE public.audit_log, public.order_ticket_events, public.order_items, public.orders,
             public.waiter_calls, public.bill_requests,
             public.table_sessions, public.tables,
             public.menu_items, public.subcategories, public.categories, public.order_code_counters
      RESTART IDENTITY CASCADE;

    UPDATE public.restaurant_settings
       SET ordering_enabled = true, online_card_enabled = false, pay_at_table_enabled = true, menu_only = false;

    INSERT INTO public.categories(id, name, sort_order)
      VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'Food', 1);
    INSERT INTO public.subcategories(id, category_id, name, sort_order)
      VALUES ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Burgers', 1);
    INSERT INTO public.menu_items(id, subcategory_id, name, price, is_available)
      VALUES ('${BURGER}', 'bbbbbbbb-0000-0000-0000-000000000001', 'La Soul Burger', 18.00, true);

    INSERT INTO public.tables(id, table_number, venue_id) VALUES
      ('dddddddd-0000-0000-0000-000000000001', 7, '${L}'),
      ('dddddddd-0000-0000-0000-000000000002', 3, '${V}');
    INSERT INTO public.table_sessions(id, table_id, token, is_active, guest_name)
      VALUES ('${SESSION}', 'dddddddd-0000-0000-0000-000000000001', '${TOKEN}', true, 'Amina');
  `);
  await actAs(db, null);
}

const menuOnly = (venue: string, on: boolean) =>
  db.query(`UPDATE public.restaurant_settings SET menu_only = $2 WHERE venue_id = $1`, [venue, on]);

const status = async () => {
  const { rows } = await db.query<{ s: Record<string, unknown> }>(`SELECT public.guest_get_service_status() AS s`);
  return rows[0].s;
};

const place = () => db.query(
  `SELECT public.guest_place_order($1, $2, 'Amina', 'cash', $3::jsonb, 0, $4) AS result`,
  [SESSION, TOKEN, JSON.stringify([{ menu_item_id: BURGER, quantity: 1 }]), KEY],
);

const count = async (table: string) => {
  const { rows } = await db.query<{ n: string }>(`SELECT count(*) AS n FROM public.${table}`);
  return Number(rows[0].n);
};

describe('a restaurant that shows its menu only', () => {
  beforeAll(async () => { db = await createTestDatabase(); }, 120_000);
  afterAll(async () => { await db?.close(); });
  beforeEach(seed);

  it('is off until an admin switches it on, and the guest app is told', async () => {
    expect((await status()).menu_only).toBe(false);
    await menuOnly(L, true);
    expect((await status()).menu_only).toBe(true);
  });

  it('refuses an order, a waiter call and a bill request, and keeps nothing of them', async () => {
    await menuOnly(L, true);
    await expect(place()).rejects.toThrow(/menu only/);
    await expect(db.query(`SELECT public.guest_call_waiter($1, $2, 'assist')`, [SESSION, TOKEN])).rejects.toThrow(/menu only/);
    await expect(db.query(`SELECT public.guest_request_bill($1, $2)`, [SESSION, TOKEN])).rejects.toThrow(/menu only/);
    expect(await count('orders')).toBe(0);
    expect(await count('order_items')).toBe(0);
    expect(await count('waiter_calls')).toBe(0);
    expect(await count('bill_requests')).toBe(0);
  });

  it('opens no new table', async () => {
    await menuOnly(L, true);
    await expect(db.query(
      `INSERT INTO public.table_sessions(table_id, token, is_active, guest_name)
       VALUES ('dddddddd-0000-0000-0000-000000000001', 'another-token', true, 'Haris')`,
    )).rejects.toThrow(/menu only/);
  });

  it('is one restaurant’s switch: the other keeps opening tables', async () => {
    await menuOnly(L, true);
    await db.query(
      `INSERT INTO public.table_sessions(table_id, token, is_active, guest_name)
       VALUES ('dddddddd-0000-0000-0000-000000000002', 'vera-token', true, 'Lejla')`,
    );
    const { rows } = await db.query<{ venue_id: string }>(`SELECT venue_id FROM public.table_sessions WHERE token = 'vera-token'`);
    expect(rows[0].venue_id).toBe(V);
  });

  it('switched off again, the table orders as before', async () => {
    await menuOnly(L, true);
    await menuOnly(L, false);
    const { rows } = await place();
    expect((rows[0] as { result: Record<string, unknown> }).result.order_id).toBeTruthy();
    expect(await count('orders')).toBe(1);
  });
});
