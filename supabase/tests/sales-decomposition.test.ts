/**
 * @vitest-environment node
 *
 * "Why did sales change" (20261025122000_sales_decomposition.sql).
 *
 * The decomposition is only worth showing if it is exact: the log changes of
 * the parts must add up to the log change of net sales with nothing left
 * over, and the parts must be counted on the same trading day as everything
 * else — 00:30 belongs to the evening before.
 */
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error -- plain JS harness, no types needed
import { createTestDatabase, actAs } from '../../scripts/db-harness.mjs';

type Db = {
  query: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
  exec: (sql: string) => Promise<unknown>;
  close: () => Promise<void>;
};

interface Terms {
  comparable: boolean;
  net: number;
  compare_net: number;
  change_pct: number;
  dlog?: number;
  terms: { key: string; current: number; compare: number; dlog: number; change_pct: number }[];
}
interface Decomposition {
  from: string; to: string; cmp_from: string; cmp_to: string;
  scale: number;
  basis: 'visits' | 'covers';
  current: { net: number; visits: number; units: number };
  compare: { net: number; visits: number; units: number };
  total: Terms;
  dayparts: (Terms & { daypart: string; visits: number; compare_visits: number })[];
}

const STAFF = '22222222-2222-2222-2222-222222222222';
const ITEM = 'cccccccc-0000-0000-0000-000000000001';
const TABLE = 'dddddddd-0000-0000-0000-000000000001';

let db: Db;

async function reset() {
  await db.exec(`
    TRUNCATE public.order_ticket_events, public.order_items, public.orders, public.table_sessions,
             public.tables, public.menu_items, public.subcategories, public.categories
      RESTART IDENTITY CASCADE;
    DELETE FROM public.user_roles;
    DELETE FROM auth.users;
    INSERT INTO auth.users(id) VALUES ('${STAFF}');
    INSERT INTO public.user_roles(user_id, role) VALUES ('${STAFF}', 'staff');
    INSERT INTO public.categories(id, name, sort_order) VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'Food', 1);
    INSERT INTO public.subcategories(id, category_id, name, sort_order)
      VALUES ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Mains', 1);
    INSERT INTO public.menu_items(id, subcategory_id, name, price, is_available)
      VALUES ('${ITEM}', 'bbbbbbbb-0000-0000-0000-000000000001', 'Plate', 10, true);
    INSERT INTO public.tables(id, table_number) VALUES ('${TABLE}', 7);
  `);
  await db.exec(`ALTER TABLE public.orders DISABLE TRIGGER trg_enforce_order_limits`);
  await actAs(db, null);
}

/** One visit with one order of `units` portions worth `net` KM, at a Sarajevo wall-clock moment. */
async function visit(at: string, net: number, units: number, covers: number | null = null, tip = 0) {
  const when = `($2::timestamp AT TIME ZONE 'Europe/Sarajevo')`;
  const session = crypto.randomUUID();
  await db.query(
    `INSERT INTO public.table_sessions(id, table_id, token, is_active, opened_at, covers)
     VALUES ($1, '${TABLE}', $4, false, ${when}, $3)`, [session, at, covers, `t-${session}`]);
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO public.orders(table_session_id, total, tip_amount, status, payment_status, payment_method,
                               released_to_kitchen_at, created_at)
     VALUES ($1, $3, $4, 'served', 'paid', 'cash', ${when}, ${when}) RETURNING id`,
    [session, at, net + tip, tip]);
  await db.query(
    `INSERT INTO public.order_items(order_id, menu_item_id, quantity, unit_price, status)
     VALUES ($1, '${ITEM}', $2, $3, 'served')`, [rows[0].id, units, net / units]);
}

const day = (base: string, offset: number) => {
  const d = new Date(`${base}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};

async function decompose(args: (string | null)[]): Promise<Decomposition> {
  await actAs(db, STAFF);
  try {
    const { rows } = await db.query<{ r: Decomposition }>(
      `SELECT public.sales_decomposition($1::date, $2::date, $3::date, $4::date) AS r`, args);
    return rows[0].r;
  } finally {
    await actAs(db, null);
  }
}

const sumLogs = (t: Terms) => t.terms.reduce((s, x) => s + Number(x.dlog), 0);

/**
 * Four weeks of a steady pattern (two lunch tables and one dinner a day),
 * then a week that lost one lunch table a day but whose dinners spent more.
 */
async function seedWeeks(covers: number | null = null) {
  for (let i = 0; i < 28; i += 1) {
    const d = day('2026-08-17', i);
    await visit(`${d} 12:30`, 30, 3, covers);
    await visit(`${d} 13:15`, 30, 3, covers);
    await visit(`${d} 20:00`, 50, 4, covers);
  }
  for (let i = 0; i < 7; i += 1) {
    const d = day('2026-09-14', i);
    await visit(`${d} 12:30`, 30, 3, covers);
    await visit(`${d} 20:00`, 60, 4, covers);
  }
}

describe('why sales changed', () => {
  beforeAll(async () => { db = await createTestDatabase({ quiet: true }); }, 180_000);
  afterAll(async () => { await db?.close(); });
  beforeEach(reset);

  it('splits the change into log terms that sum exactly to the change in net sales', async () => {
    await seedWeeks();
    const r = await decompose(['2026-09-14', '2026-09-20', '2026-09-07', '2026-09-13']);
    expect(r.basis).toBe('visits');
    expect(r.total.comparable).toBe(true);
    expect(r.total.terms.map((t) => t.key)).toEqual(['visits', 'items_per_visit', 'net_per_item']);
    expect(sumLogs(r.total)).toBeCloseTo(Number(r.total.dlog), 12);
    expect(Math.log(r.current.net / r.compare.net)).toBeCloseTo(Number(r.total.dlog), 9);
    // 14 visits against 21: a third fewer tables.
    expect(r.total.terms[0].change_pct).toBeCloseTo(-33.3, 1);

    // Each daypart is exact on its own as well.
    for (const p of r.dayparts.filter((x) => x.comparable)) {
      expect(sumLogs(p)).toBeCloseTo(Number(p.dlog), 12);
    }
    const lunch = r.dayparts.find((p) => p.daypart === 'lunch')!;
    const evening = r.dayparts.find((p) => p.daypart === 'evening')!;
    expect(lunch.terms[0].change_pct).toBeCloseTo(-50, 1);
    expect(evening.terms[0].change_pct).toBe(0);
    expect(evening.terms[2].change_pct).toBeCloseTo(20, 1);
  });

  it('compares a week with the same weekdays of the four before it, scaled to one week', async () => {
    await seedWeeks();
    const r = await decompose(['2026-09-14', '2026-09-20', '2026-08-17', '2026-09-13']);
    expect(Number(r.scale)).toBeCloseTo(0.25, 10);
    expect(r.compare.visits).toBe(84);
    expect(r.total.compare_net).toBeCloseTo((28 * 110) / 4, 2);
    expect(sumLogs(r.total)).toBeCloseTo(Number(r.total.dlog), 12);
  });

  it('uses guests per visit once covers are recorded on most visits, and stays exact', async () => {
    await seedWeeks(2);
    const r = await decompose(['2026-09-14', '2026-09-20', '2026-09-07', '2026-09-13']);
    expect(r.basis).toBe('covers');
    expect(r.total.terms.map((t) => t.key)).toEqual(['visits', 'guests_per_visit', 'items_per_guest', 'net_per_item']);
    expect(sumLogs(r.total)).toBeCloseTo(Number(r.total.dlog), 12);
  });

  it('counts a 00:30 sale in the previous trading day, and a 04:30 one too', async () => {
    await visit('2026-09-20 22:00', 40, 2);
    await visit('2026-09-21 00:30', 25, 1);      // Sunday night's last round
    await visit('2026-09-21 05:30', 99, 9);      // Monday's first coffee
    await visit('2026-09-14 04:30', 15, 1);      // still the Sunday before

    const r = await decompose(['2026-09-20', '2026-09-20', '2026-09-14', '2026-09-14']);
    expect(r.current.visits).toBe(2);
    expect(r.current.net).toBe(65);
    const late = r.dayparts.find((p) => p.daypart === 'late');
    expect(late?.visits).toBe(1);
    // 09-14 holds nothing from before 05:00 that morning.
    expect(r.compare.visits).toBe(0);
    expect(r.total.comparable).toBe(false);
  });

  it('leaves tips out of the money, and refuses a caller who is not staff', async () => {
    await visit('2026-09-15 12:00', 30, 3, null, 5);
    const r = await decompose(['2026-09-15', '2026-09-15', null, null]);
    expect(r.current.net).toBe(30);
    expect(r.cmp_from).toBe('2026-09-14');
    await expect(db.query(`SELECT public.sales_decomposition()`)).rejects.toThrow(/staff/i);
  });
});
