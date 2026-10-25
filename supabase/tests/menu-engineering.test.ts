/**
 * @vitest-environment node
 *
 * The menu-engineering matrix (20261025121000_menu_engineering.sql), held to
 * the textbook and to the two corrections a small café needs.
 *
 *   - LeBruto, Quain & Ashley (1995), Exhibits 1–3: eight items, the 8.75%
 *     popularity line, a $0.86 weighted-average contribution margin. The
 *     matrix must reproduce their labels.
 *   - A dish sold out for half the window is judged on the half it was on.
 *   - A share whose interval straddles the line is 'insufficient', not a
 *     quadrant chosen by noise.
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
const SUB = 'bbbbbbbb-0000-0000-0000-000000000001';
const TABLE = 'dddddddd-0000-0000-0000-000000000001';

let db: Db;

interface Row {
  item_id: string;
  name: string;
  menu_class: string;
  units: number;
  menu_mix: string;
  mix_low: string;
  mix_high: string;
  popularity_threshold: string;
  unit_cm: string;
  class_avg_cm: string;
  popularity: string;
  profitability: string;
  quadrant: string;
  available_days: number;
  availability_basis: string;
  cost_estimated: boolean;
}

/** LeBruto et al. 1995, Exhibit 4: number sold, price, food cost. */
const LEBRUTO = [
  { name: 'Turkey Sandwich', sold: 130, price: 2.2, cost: 1.1, quadrant: 'star' },
  { name: 'Bologna Sandwich', sold: 100, price: 1.6, cost: 0.76, quadrant: 'dog' },
  { name: 'Spaghetti', sold: 60, price: 1.2, cost: 0.33, quadrant: 'puzzle' },
  { name: 'Pizza', sold: 300, price: 1.25, cost: 0.19, quadrant: 'star' },
  { name: 'Chicken a la King', sold: 40, price: 1.75, cost: 1.25, quadrant: 'dog' },
  { name: 'Grilled Cheese', sold: 180, price: 1.1, cost: 0.66, quadrant: 'plowhorse' },
  { name: 'Hamburger', sold: 320, price: 1.75, cost: 0.9, quadrant: 'plowhorse' },
  { name: 'Fish and Chips', sold: 90, price: 2.1, cost: 1.2, quadrant: 'puzzle' },
];

const itemId = (n: number) => `cccccccc-0000-0000-0000-${String(n).padStart(12, '0')}`;

async function reset() {
  await db.exec(`
    TRUNCATE public.menu_item_availability_log, public.order_ticket_events, public.order_items,
             public.orders, public.table_sessions, public.tables,
             public.menu_items, public.subcategories, public.categories
      RESTART IDENTITY CASCADE;
    DELETE FROM public.user_roles;
    DELETE FROM auth.users;
    INSERT INTO auth.users(id) VALUES ('${STAFF}');
    INSERT INTO public.user_roles(user_id, role) VALUES ('${STAFF}', 'staff');
    INSERT INTO public.categories(id, name, sort_order) VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'Food', 1);
    INSERT INTO public.subcategories(id, category_id, name, sort_order)
      VALUES ('${SUB}', 'aaaaaaaa-0000-0000-0000-000000000001', 'Kitchen', 1);
    INSERT INTO public.tables(id, table_number) VALUES ('${TABLE}', 7);
  `);
  await db.exec(`ALTER TABLE public.orders DISABLE TRIGGER trg_enforce_order_limits`);
  await actAs(db, null);
}

async function addItem(n: number, name: string, price: number, cost: number | null, role = 'main') {
  await db.query(
    `INSERT INTO public.menu_items(id, subcategory_id, name, price, food_cost, meal_role, is_available, created_at)
     VALUES ($1, '${SUB}', $2, $3, $4, $5::public.meal_role, true, now() - interval '400 days')`,
    [itemId(n), name, price, cost, role],
  );
}

/** One served order on the trading day `daysAgo` before today, at 12:00 Sarajevo. */
async function orderOn(daysAgo: number): Promise<string> {
  const at = `((public.business_day() - ${daysAgo}) + time '12:00')::timestamp AT TIME ZONE 'Europe/Sarajevo'`;
  const session = crypto.randomUUID();
  await db.query(
    `INSERT INTO public.table_sessions(id, table_id, token, is_active, opened_at)
     VALUES ($1, '${TABLE}', $2, false, ${at})`, [session, `t-${session}`]);
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO public.orders(table_session_id, total, status, payment_status, payment_method,
                               released_to_kitchen_at, created_at)
     VALUES ($1, 0, 'served', 'paid', 'cash', ${at}, ${at}) RETURNING id`, [session]);
  return rows[0].id;
}

/** `lines` single-portion lines of one item, spread round-robin over the given orders. */
async function lines(orders: string[], item: string, count: number, price: number) {
  await db.query(
    `INSERT INTO public.order_items(order_id, menu_item_id, quantity, unit_price, status)
     SELECT ($1::uuid[])[1 + (g % cardinality($1::uuid[]))], $2, 1, $3, 'served'
       FROM generate_series(0, $4 - 1) g`,
    [orders, item, price, count],
  );
}

async function engineering(days = 28): Promise<Row[]> {
  await actAs(db, STAFF);
  try {
    return (await db.query<Row>(`SELECT * FROM public.menu_engineering($1)`, [days])).rows;
  } finally {
    await actAs(db, null);
  }
}

async function seedLeBruto(scale: number) {
  for (const [i, it] of LEBRUTO.entries()) await addItem(i + 1, it.name, it.price, it.cost);
  const orders: string[] = [];
  for (let d = 1; d <= 7; d += 1) orders.push(await orderOn(d));
  await db.exec(`ALTER TABLE public.order_items DISABLE TRIGGER USER`);
  try {
    for (const [i, it] of LEBRUTO.entries()) await lines(orders, itemId(i + 1), it.sold * scale, it.price);
  } finally {
    await db.exec(`ALTER TABLE public.order_items ENABLE TRIGGER USER`);
  }
}

describe('menu engineering', () => {
  beforeAll(async () => { db = await createTestDatabase({ quiet: true }); }, 180_000);
  afterAll(async () => { await db?.close(); });
  beforeEach(reset);

  it('reproduces the LeBruto et al. worked example: 8.75% line, $0.86 average CM, eight labels', async () => {
    // Ten times the exhibit's volume, same mix: enough sales that no share is
    // within noise of the line, so every item gets the textbook's label.
    await seedLeBruto(10);
    const rows = await engineering();
    expect(rows).toHaveLength(8);
    for (const r of rows) {
      expect(Number(r.popularity_threshold)).toBeCloseTo(0.0875, 4);
      expect(Number(r.class_avg_cm)).toBeCloseTo(0.86, 2);
      expect(r.cost_estimated).toBe(false);
    }
    const byName = Object.fromEntries(rows.map((r) => [r.name, r]));
    for (const it of LEBRUTO) {
      expect(`${it.name}: ${byName[it.name].quadrant}`).toBe(`${it.name}: ${it.quadrant}`);
    }
    expect(Number(byName['Bologna Sandwich'].menu_mix)).toBeCloseTo(0.082, 3);
  });

  it('at the exhibit\'s own volume, calls only the 8.20% Bologna Sandwich too close to the 8.75% line', async () => {
    await seedLeBruto(1);
    const rows = await engineering();
    const byName = Object.fromEntries(rows.map((r) => [r.name, r]));
    expect(byName['Bologna Sandwich'].quadrant).toBe('insufficient');
    expect(Number(byName['Bologna Sandwich'].mix_low)).toBeLessThan(0.0875);
    expect(Number(byName['Bologna Sandwich'].mix_high)).toBeGreaterThan(0.0875);
    for (const it of LEBRUTO.filter((x) => x.name !== 'Bologna Sandwich')) {
      expect(`${it.name}: ${byName[it.name].quadrant}`).toBe(`${it.name}: ${it.quadrant}`);
    }
  });

  it('judges a dish sold out for half the window only on the days it was on', async () => {
    for (const n of [1, 2, 3]) await addItem(n, `Main ${n}`, 20, 6);
    await addItem(4, 'Comeback Risotto', 20, 6);
    const days = Array.from({ length: 28 }, (_, i) => i + 1);
    const orders: Record<number, string> = {};
    for (const d of days) orders[d] = await orderOn(d);
    await db.exec(`ALTER TABLE public.order_items DISABLE TRIGGER USER`);
    try {
      for (const d of days) {
        for (const n of [1, 2, 3]) await lines([orders[d]], itemId(n), 10, 20);
        if (d <= 14) await lines([orders[d]], itemId(4), 8, 20);
      }
    } finally {
      await db.exec(`ALTER TABLE public.order_items ENABLE TRIGGER USER`);
    }
    // Sold out from before the window until 14 trading days ago.
    await db.query(
      `INSERT INTO public.menu_item_availability_log(menu_item_id, is_available, changed_at) VALUES
         ($1, false, ((public.business_day() - 40) + time '12:00')::timestamp AT TIME ZONE 'Europe/Sarajevo'),
         ($1, true,  ((public.business_day() - 14) + time '06:00')::timestamp AT TIME ZONE 'Europe/Sarajevo')`,
      [itemId(4)]);

    const rows = await engineering(28);
    const risotto = rows.find((r) => r.name === 'Comeback Risotto')!;
    expect(risotto.available_days).toBe(14);
    expect(risotto.availability_basis).toBe('logged');
    // 112 of the 532 sold on its days (21%), against a 17.5% line. Over the
    // whole window it would have been 112 of 952 (12%) and called unpopular.
    expect(Number(risotto.menu_mix)).toBeCloseTo(112 / 532, 3);
    expect(risotto.popularity).toBe('high');
    expect(risotto.quadrant).not.toBe('dog');
    expect(risotto.quadrant).not.toBe('puzzle');
  });

  it('calls a share that straddles the line insufficient instead of guessing a quadrant', async () => {
    await addItem(1, 'Baklava', 6, 2, 'dessert');
    await addItem(2, 'Tufahija', 6, 2, 'dessert');
    const orders: string[] = [];
    for (let d = 1; d <= 10; d += 1) orders.push(await orderOn(d));
    await lines(orders, itemId(1), 7, 6);
    await lines(orders, itemId(2), 13, 6);

    const rows = await engineering();
    const baklava = rows.find((r) => r.name === 'Baklava')!;
    const tufahija = rows.find((r) => r.name === 'Tufahija')!;
    // 35% against a 35% line, from twenty orders: could be either side.
    expect(Number(baklava.popularity_threshold)).toBeCloseTo(0.35, 4);
    expect(baklava.quadrant).toBe('insufficient');
    expect(tufahija.popularity).toBe('high');
  });

  it('marks margins built on estimated costs, and refuses a caller who is not staff', async () => {
    await addItem(1, 'Burek', 8, null);
    const o = await orderOn(2);
    await lines([o], itemId(1), 5, 8);
    const rows = await engineering();
    expect(rows[0].cost_estimated).toBe(true);

    await expect(db.query(`SELECT * FROM public.menu_engineering(28)`)).rejects.toThrow(/staff/i);
  });

  it('records availability changes from the menu screen, and nothing else', async () => {
    await addItem(1, 'Pita', 7, 2);
    await db.exec(`UPDATE public.menu_items SET price = 8 WHERE id = '${itemId(1)}'`);
    await db.exec(`UPDATE public.menu_items SET is_available = false WHERE id = '${itemId(1)}'`);
    await db.exec(`UPDATE public.menu_items SET is_available = false WHERE id = '${itemId(1)}'`);
    const { rows } = await db.query<{ is_available: boolean }>(
      `SELECT is_available FROM public.menu_item_availability_log WHERE menu_item_id = $1`, [itemId(1)]);
    expect(rows.map((r) => r.is_available)).toEqual([false]);
  });
});
