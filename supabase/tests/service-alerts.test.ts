/**
 * @vitest-environment node
 *
 * Alerts that stay quiet on ordinary variation
 * (20261025124000_service_alerts.sql).
 *
 *   - One ticket forgotten under the lamp for two hours is an incident, not a
 *     slow kitchen: the p90 must not move.
 *   - A whole service running 40% slower is: the p90 must.
 *   - A bad day is only called bad against at least four of the same weekday.
 */
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error -- plain JS harness, no types needed
import { createTestDatabase, actAs } from '../../scripts/db-harness.mjs';

type Db = {
  query: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
  exec: (sql: string) => Promise<unknown>;
  close: () => Promise<void>;
};

interface StationNow {
  station: string; tickets: number; p90: number; baseline_p90: number; ratio: number; status: string; alert: boolean;
}
interface Timings { baseline: { station: string; daypart: string; tickets: number; p90: number }[]; now: StationNow[] }
interface Day { day: string; net: number; history: number; median: number; z: number; status: string; alert: boolean }
interface Anomalies { today: { history: number; status: string }; days: Day[] }

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
    INSERT INTO public.menu_items(id, subcategory_id, name, price, is_available, station)
      VALUES ('${ITEM}', 'bbbbbbbb-0000-0000-0000-000000000001', 'Burger', 20, true, 'kitchen');
    INSERT INTO public.tables(id, table_number) VALUES ('${TABLE}', 7);
  `);
  await db.exec(`ALTER TABLE public.orders DISABLE TRIGGER trg_enforce_order_limits`);
  await actAs(db, null);
}

/** A kitchen ticket sent `sentMinutesAgo` before now and ready `minutes` later. */
async function ticket(sentMinutesAgo: number, minutes: number, total = 20) {
  const session = crypto.randomUUID();
  const sent = `now() - make_interval(mins => $2::int)`;
  await db.query(
    `INSERT INTO public.table_sessions(id, table_id, token, is_active, opened_at)
     VALUES ($1, '${TABLE}', $1::uuid::text || '-t', false, ${sent})`, [session, sentMinutesAgo]);
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO public.orders(table_session_id, total, status, payment_status, payment_method,
                               released_to_kitchen_at, created_at)
     VALUES ($1, $3, 'served', 'paid', 'cash', ${sent}, ${sent}) RETURNING id`,
    [session, sentMinutesAgo, total]);
  await db.query(
    `INSERT INTO public.order_items(order_id, menu_item_id, quantity, unit_price, status, station, ready_at)
     VALUES ($1, '${ITEM}', 1, $3, 'served', 'kitchen', now() - make_interval(mins => $2::int) + make_interval(secs => $4::numeric * 60))`,
    [rows[0].id, sentMinutesAgo, total, minutes]);
}

const BASE_MINUTES = [8, 9, 10, 10, 11, 11, 12, 12, 13, 14];

/** Five previous days of normal service at this time of day: p90 13 minutes. */
async function seedBaseline() {
  for (let d = 1; d <= 5; d += 1) {
    for (const m of BASE_MINUTES) await ticket(d * 24 * 60 + 30, m);
  }
}

async function asStaff<T>(sql: string): Promise<T> {
  await actAs(db, STAFF);
  try {
    return (await db.query<{ r: T }>(sql)).rows[0].r;
  } finally {
    await actAs(db, null);
  }
}

const kitchen = (t: Timings) => t.now.find((s) => s.station === 'kitchen')!;

beforeAll(async () => { db = await createTestDatabase({ quiet: true }); }, 180_000);
afterAll(async () => { await db?.close(); });
beforeEach(reset);

describe('ticket-time alerts', () => {
  it('one forgotten two-hour ticket does not raise the alarm', async () => {
    await seedBaseline();
    for (const m of [8, 9, 10, 10, 11, 12, 12, 13, 13]) await ticket(60, m);
    await ticket(125, 120);                 // sat under the lamp for two hours

    const t = await asStaff<Timings>(`SELECT public.station_timings(28) AS r`);
    const k = kitchen(t);
    expect(k.tickets).toBe(10);
    expect(Number(k.baseline_p90)).toBe(13);
    expect(Number(k.p90)).toBe(13);
    expect(k.alert).toBe(false);
    expect(k.status).toBe('normal');
  });

  it('a service running 40% slower does', async () => {
    await seedBaseline();
    for (const m of [...BASE_MINUTES, 10, 12]) await ticket(70, m * 1.4);

    const k = kitchen(await asStaff<Timings>(`SELECT public.station_timings(28) AS r`));
    expect(k.tickets).toBe(12);
    expect(Number(k.ratio)).toBeGreaterThan(1.3);
    expect(k.alert).toBe(true);
    expect(k.status).toBe('slow');
  });

  it('will not judge a slow hour from too few tickets or without a baseline', async () => {
    for (const m of [30, 30, 30]) await ticket(40, m);
    const k = kitchen(await asStaff<Timings>(`SELECT public.station_timings(28) AS r`));
    expect(k.alert).toBe(false);
    expect(k.status).toBe('learning');
  });
});

/** One order of `net` KM at noon Sarajevo on the trading day `daysAgo` before today. */
async function dayOfSales(daysAgo: number, net: number) {
  const at = `((public.business_day() - ${daysAgo}) + time '12:00')::timestamp AT TIME ZONE 'Europe/Sarajevo'`;
  const session = crypto.randomUUID();
  await db.query(
    `INSERT INTO public.table_sessions(id, table_id, token, is_active, opened_at)
     VALUES ($1, '${TABLE}', $2, false, ${at})`, [session, `d-${session}`]);
  await db.query(
    `INSERT INTO public.orders(table_session_id, total, status, payment_status, payment_method,
                               released_to_kitchen_at, created_at)
     VALUES ($1, $2, 'served', 'paid', 'cash', ${at}, ${at})`, [session, net]);
}

describe('daily anomalies', () => {
  it('flags a day far below its own weekday once there are four weeks of history', async () => {
    const usual = [1000, 1040, 960, 1010, 990, 1025];
    for (const [i, net] of usual.entries()) await dayOfSales(1 + 7 * (i + 1), net);
    await dayOfSales(1, 600);

    const r = await asStaff<Anomalies>(`SELECT public.daily_anomalies() AS r`);
    const yesterday = r.days[0];
    expect(yesterday.history).toBe(6);
    expect(Number(yesterday.median)).toBe(1005);
    expect(yesterday.status).toBe('low');
    expect(yesterday.alert).toBe(true);
  });

  it('stays quiet on an ordinary dip, and says "learning" before four weeks', async () => {
    for (const [i, net] of [1000, 1040, 960, 1010, 990, 1025].entries()) await dayOfSales(1 + 7 * (i + 1), net);
    await dayOfSales(1, 940);
    let r = await asStaff<Anomalies>(`SELECT public.daily_anomalies() AS r`);
    expect(r.days[0].alert).toBe(false);

    await reset();
    for (const [i, net] of [1000, 1040, 960].entries()) await dayOfSales(1 + 7 * (i + 1), net);
    await dayOfSales(1, 300);
    r = await asStaff<Anomalies>(`SELECT public.daily_anomalies() AS r`);
    expect(r.days[0].status).toBe('learning');
    expect(r.days[0].alert).toBe(false);
  });

  it('refuses a caller who is not staff', async () => {
    await expect(db.query(`SELECT public.daily_anomalies()`)).rejects.toThrow(/staff/i);
    await expect(db.query(`SELECT public.station_timings()`)).rejects.toThrow(/staff/i);
  });
});
