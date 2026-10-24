/**
 * @vitest-environment node
 *
 * Placing an order on restaurant Wi-Fi.
 *
 * The load-bearing test is `a retried order is not cooked twice`: the request
 * that committed but whose response never arrived is the normal failure on a
 * crowded terrace, and before this the kitchen got a second ticket for it.
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

const SESSION = 'eeeeeeee-0000-0000-0000-000000000001';
const OTHER_SESSION = 'eeeeeeee-0000-0000-0000-000000000002';
const TOKEN = 'sess-token-7';
const OTHER_TOKEN = 'sess-token-8';
const BURGER = 'cccccccc-0000-0000-0000-000000000001';
const BREAKFAST = 'cccccccc-0000-0000-0000-000000000002';
const LATE = 'cccccccc-0000-0000-0000-000000000003';
const KEY = '9f0e8d7c-6b5a-4c3d-2e1f-0a9b8c7d6e5f';

async function seed() {
  await db.exec(`
    TRUNCATE public.audit_log, public.order_ticket_events, public.order_items, public.orders,
             public.table_sessions, public.tables,
             public.menu_items, public.subcategories, public.categories, public.order_code_counters
      RESTART IDENTITY CASCADE;

    UPDATE public.restaurant_settings
       SET ordering_enabled = true, online_card_enabled = false, pay_at_table_enabled = true
     WHERE id = 1;

    INSERT INTO public.categories(id, name, sort_order)
      VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'Food', 1);
    INSERT INTO public.subcategories(id, category_id, name, sort_order)
      VALUES ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Burgers', 1);
    INSERT INTO public.menu_items(id, subcategory_id, name, price, is_available, available_from, available_to) VALUES
      ('${BURGER}',    'bbbbbbbb-0000-0000-0000-000000000001', 'La Soul Burger', 18.00, true, NULL, NULL),
      ('${BREAKFAST}', 'bbbbbbbb-0000-0000-0000-000000000001', 'Turkish Egg',    15.50, true, '07:00', '07:01'),
      ('${LATE}',      'bbbbbbbb-0000-0000-0000-000000000001', 'Midnight Slider', 12.00, true, '22:00', '02:00');

    INSERT INTO public.tables(id, table_number) VALUES
      ('dddddddd-0000-0000-0000-000000000001', 7),
      ('dddddddd-0000-0000-0000-000000000002', 8);
    INSERT INTO public.table_sessions(id, table_id, token, is_active, guest_name) VALUES
      ('${SESSION}', 'dddddddd-0000-0000-0000-000000000001', '${TOKEN}', true, 'Amina'),
      ('${OTHER_SESSION}', 'dddddddd-0000-0000-0000-000000000002', '${OTHER_TOKEN}', true, 'Haris');
  `);
  await actAs(db, null);
}

async function place(items: unknown[], key: string | null = KEY, session = SESSION, token = TOKEN) {
  const { rows } = await db.query<{ result: Record<string, unknown> }>(
    `SELECT public.guest_place_order($1, $2, 'Amina', 'cash', $3::jsonb, 0, $4) AS result`,
    [session, token, JSON.stringify(items), key],
  );
  return rows[0].result;
}

const orderCount = async () => {
  const { rows } = await db.query<{ n: string }>(`SELECT count(*) AS n FROM public.orders`);
  return Number(rows[0].n);
};

/** Is the item orderable at a given Sarajevo wall-clock time? */
const orderableAt = async (id: string, at: string) => {
  const { rows } = await db.query<{ ok: boolean }>(
    `SELECT public.menu_item_orderable(mi, $2::time) AS ok FROM public.menu_items mi WHERE mi.id = $1`, [id, at]);
  return rows[0].ok;
};

describe('placing an order on restaurant Wi-Fi', () => {
  beforeAll(async () => { db = await createTestDatabase(); }, 120_000);
  afterAll(async () => { await db?.close(); });
  beforeEach(seed);

  it('a retried order is not cooked twice', async () => {
    const first = await place([{ menu_item_id: BURGER, quantity: 2 }]);
    const retry = await place([{ menu_item_id: BURGER, quantity: 2 }]);

    expect(retry.order_id).toBe(first.order_id);
    expect(retry.order_code).toBe(first.order_code);
    expect(retry.replayed).toBe(true);
    expect(await orderCount()).toBe(1);
    const { rows } = await db.query<{ n: string }>(`SELECT count(*) AS n FROM public.order_ticket_events`);
    expect(Number(rows[0].n)).toBeLessThanOrEqual(1);
  });

  it('a new checkout with a new key is a new order', async () => {
    await place([{ menu_item_id: BURGER, quantity: 1 }]);
    await place([{ menu_item_id: BURGER, quantity: 1 }], 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
    expect(await orderCount()).toBe(2);
  });

  it('older clients that send no key still order', async () => {
    await place([{ menu_item_id: BURGER, quantity: 1 }], null);
    await place([{ menu_item_id: BURGER, quantity: 1 }], null);
    expect(await orderCount()).toBe(2);
  });

  it("a key cannot read another table's order", async () => {
    await place([{ menu_item_id: BURGER, quantity: 1 }]);
    const other = await place([{ menu_item_id: BURGER, quantity: 3 }], KEY, OTHER_SESSION, OTHER_TOKEN);
    expect(other.replayed).toBeUndefined();
    expect(Number(other.total)).toBe(54);
    expect(await orderCount()).toBe(2);
  });

  it('refuses an item outside its serving window and says which one', async () => {
    let err: { message?: string; detail?: string } | null = null;
    try {
      await place([{ menu_item_id: BURGER, quantity: 1 }, { menu_item_id: BREAKFAST, quantity: 1 }]);
    } catch (e) {
      err = e as { message?: string; detail?: string };
    }
    expect(err?.message).toMatch(/Unavailable: Turkish Egg/);
    expect(JSON.parse(err?.detail ?? '[]')).toEqual([BREAKFAST]);
    expect(await orderCount()).toBe(0);
  });

  it('understands a late menu that crosses midnight', async () => {
    expect(await orderableAt(LATE, '23:30')).toBe(true);
    expect(await orderableAt(LATE, '01:30')).toBe(true);
    expect(await orderableAt(LATE, '12:00')).toBe(false);
    expect(await orderableAt(BREAKFAST, '07:00:30')).toBe(true);
    expect(await orderableAt(BREAKFAST, '09:00')).toBe(false);
  });

  it('lets a table order more than ten rounds', async () => {
    // The per-minute burst guard is a separate trigger with its own tests;
    // twelve rounds in one test run would trip it.
    await db.exec(`ALTER TABLE public.orders DISABLE TRIGGER trg_enforce_order_limits`);
    for (let i = 0; i < 12; i += 1) {
      await place([{ menu_item_id: BURGER, quantity: 1 }], `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    }
    expect(await orderCount()).toBe(12);
  });
});
