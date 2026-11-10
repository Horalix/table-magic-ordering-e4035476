/**
 * @vitest-environment node
 *
 * Tables left open after the work day (20261110120000_close_all_tables.sql).
 *
 * Waiters do not always free their tables. "Close all tables" frees every
 * table that owes nothing, at the restaurant the screen shows and no other;
 * a table that owes money is never freed, and is named with what it owes.
 * Overnight the scheduler frees the settled tables whose guests are long
 * gone, at both restaurants.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error -- plain JS harness, no types needed
import { actAs, createTestDatabase } from '../../scripts/db-harness.mjs';

type Db = {
  query: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<{ rows: T[]; affectedRows?: number }>;
  exec: (sql: string) => Promise<unknown>;
  close: () => Promise<void>;
};

const ROOT = path.join(__dirname, '..', '..');
const MIGRATION = path.join(ROOT, 'supabase', 'migrations', '20261110120000_close_all_tables.sql');

const L = 'a5000000-0000-4000-8000-000000000001'; // La Soul
const V = 'a5000000-0000-4000-8000-000000000002'; // Vera Italia

const OWNER = '10000000-0000-0000-0000-000000000001';
const WAITER_L = '10000000-0000-0000-0000-000000000004';
const WAITER_V = '10000000-0000-0000-0000-000000000005';
const NOBODY = '10000000-0000-0000-0000-000000000006';

// La Soul: table 1 paid, table 2 owes 24, table 3 ordered nothing, table 4 paid and still sitting.
const T = (n: number) => `30000000-0000-0000-0000-0000000000${String(n).padStart(2, '0')}`;
const S = (n: number) => `40000000-0000-0000-0000-0000000000${String(n).padStart(2, '0')}`;
// Vera Italia: table 1 paid.
const TV = '30000000-0000-0000-0000-0000000000b1';
const SV = '40000000-0000-0000-0000-0000000000b1';

interface Closed { closed: number; kept: { session_id: string; table_number: number; outstanding: number; unpaid_orders: number }[] }
interface OpenTables {
  local_time: string; weekday: number; day_ends_at: string | null; closes_overnight: boolean;
  tables: { session_id: string; table_number: number; outstanding: number; unpaid_orders: number; overnight: boolean }[];
}

let db: Db;

beforeAll(async () => {
  db = (await createTestDatabase({ quiet: true })) as unknown as Db;
  // Applying it a second time changes nothing.
  await db.exec(readFileSync(MIGRATION, 'utf8'));
  await db.exec(`
    GRANT USAGE ON SCHEMA public TO anon, authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
  `);
}, 240_000);
afterAll(async () => { await db?.close(); });

beforeEach(async () => {
  await db.exec(`
    TRUNCATE public.audit_log, public.waiter_calls, public.bill_requests, public.order_items, public.orders,
             public.table_sessions, public.tables RESTART IDENTITY CASCADE;
    DELETE FROM public.user_roles;
    DELETE FROM public.maintenance_runs WHERE job = 'close_tables';
    INSERT INTO auth.users(id) VALUES ('${OWNER}'), ('${WAITER_L}'), ('${WAITER_V}'), ('${NOBODY}') ON CONFLICT DO NOTHING;
    INSERT INTO public.user_roles(user_id, role, venue_id) VALUES
      ('${OWNER}', 'admin', NULL), ('${WAITER_L}', 'staff', '${L}'), ('${WAITER_V}', 'staff', '${V}');

    INSERT INTO public.tables(id, table_number, venue_id) VALUES
      ('${T(1)}', 1, '${L}'), ('${T(2)}', 2, '${L}'), ('${T(3)}', 3, '${L}'), ('${T(4)}', 4, '${L}'),
      ('${TV}', 1, '${V}');
    INSERT INTO public.table_sessions(id, table_id, token, is_active, opened_at, last_heartbeat_at) VALUES
      ('${S(1)}', '${T(1)}', 'tok-1', true, now() - interval '7 hours', now()),
      ('${S(2)}', '${T(2)}', 'tok-2', true, now() - interval '7 hours', now()),
      ('${S(3)}', '${T(3)}', 'tok-3', true, now() - interval '30 hours', now()),
      ('${S(4)}', '${T(4)}', 'tok-4', true, now() - interval '1 hour', now()),
      ('${SV}', '${TV}', 'tok-v', true, now() - interval '7 hours', now());
    INSERT INTO public.orders(table_session_id, total, status, payment_status, payment_method, released_to_kitchen_at, served_at, paid_at, created_at) VALUES
      ('${S(1)}', 31, 'served', 'paid', 'cash', now(), now(), now(), now() - interval '6 hours'),
      ('${S(4)}', 12, 'served', 'paid', 'cash', now(), now(), now(), now() - interval '50 minutes'),
      ('${SV}', 58, 'served', 'paid', 'cash', now(), now(), now(), now() - interval '6 hours');
    INSERT INTO public.orders(table_session_id, total, status, payment_status, payment_method, released_to_kitchen_at, served_at, created_at) VALUES
      ('${S(2)}', 24, 'served', 'unpaid', 'cash', now(), now(), now() - interval '6 hours');
    INSERT INTO public.waiter_calls(table_session_id) VALUES ('${S(1)}');
    INSERT INTO public.bill_requests(table_session_id) VALUES ('${S(1)}');
    -- Everyone but table 4 went home hours ago: their phones have been quiet since.
    UPDATE public.table_sessions SET last_heartbeat_at = now() - interval '5 hours' WHERE id IN ('${S(1)}', '${S(2)}', '${SV}');
    UPDATE public.table_sessions SET last_heartbeat_at = now() - interval '29 hours' WHERE id = '${S(3)}';
  `);
});
afterEach(async () => {
  await db.query(`SELECT set_config('request.headers', '', false)`);
  await db.query(`SELECT set_config('lasoul.venue', '', false)`);
  await actAs(db, null);
});

const showing = (slug: string | null) =>
  db.query(`SELECT set_config('request.headers', $1, false)`, [slug ? JSON.stringify({ 'x-venue': slug }) : '']);

/** Run as a signed-in user, under the access rules. */
async function as<T>(user: string, run: () => Promise<T>): Promise<T> {
  await actAs(db, user);
  await db.exec('SET ROLE authenticated');
  try { return await run(); } finally { await db.exec('RESET ROLE'); await actAs(db, null); }
}
const closeAll = (user: string) =>
  as(user, async () => (await db.query<{ r: Closed }>(`SELECT public.staff_close_all_tables() AS r`)).rows[0].r);
const openTables = (user: string) =>
  as(user, async () => (await db.query<{ r: OpenTables }>(`SELECT public.staff_open_tables() AS r`)).rows[0].r);
const stillOpen = async (venue: string) =>
  (await db.query<{ n: number }>(
    `SELECT t.table_number AS n FROM public.table_sessions ts JOIN public.tables t ON t.id = ts.table_id
      WHERE ts.is_active AND ts.venue_id = $1 ORDER BY 1`, [venue])).rows.map((r) => r.n);

describe('Close all tables', () => {
  it('frees every table that owes nothing, and names the one that owes money', async () => {
    const result = await closeAll(WAITER_L);
    expect(result.closed).toBe(3);
    expect(result.kept).toEqual([{ session_id: S(2), table_number: 2, outstanding: 24, unpaid_orders: 1 }]);
    expect(await stillOpen(L)).toEqual([2]);
  });

  it('leaves the other restaurant alone', async () => {
    await closeAll(WAITER_L);
    expect(await stillOpen(V)).toEqual([1]);
    await closeAll(WAITER_V);
    expect(await stillOpen(V)).toEqual([]);
    expect(await stillOpen(L)).toEqual([2]);
  });

  it('is the restaurant the owner is looking at', async () => {
    await showing('veraitalia');
    expect((await closeAll(OWNER)).closed).toBe(1);
    expect(await stillOpen(L)).toEqual([1, 2, 3, 4]);
  });

  it('clears the calls and bill requests of the tables it frees, and writes each to the audit log', async () => {
    await closeAll(WAITER_L);
    const waving = await db.query(`SELECT 1 FROM public.waiter_calls WHERE status <> 'resolved'
                                   UNION ALL SELECT 1 FROM public.bill_requests WHERE status <> 'resolved'`);
    expect(waving.rows).toHaveLength(0);
    const audit = await db.query<{ reason: string; actor_user_id: string; venue_id: string }>(
      `SELECT reason, actor_user_id, venue_id FROM public.audit_log WHERE action = 'table.freed'`);
    expect(audit.rows).toHaveLength(3);
    expect(new Set(audit.rows.map((r) => `${r.reason}|${r.actor_user_id}|${r.venue_id}`)))
      .toEqual(new Set([`Close all tables|${WAITER_L}|${L}`]));
  });

  it('keeps every order, and frees nothing twice', async () => {
    const before = (await db.query(`SELECT id FROM public.orders`)).rows.length;
    await closeAll(WAITER_L);
    expect((await closeAll(WAITER_L)).closed).toBe(0);
    expect((await db.query(`SELECT id FROM public.orders`)).rows.length).toBe(before);
  });

  it('is for staff of the restaurant only', async () => {
    await expect(closeAll(NOBODY)).rejects.toThrow(/Only staff/);
    await expect(openTables(NOBODY)).rejects.toThrow(/Only staff/);
    await db.exec('SET ROLE anon');
    await expect(db.query(`SELECT public.staff_close_all_tables()`)).rejects.toThrow(/permission denied/);
    await db.exec('RESET ROLE');
    // A La Soul waiter asking for Vera Italia is answered for La Soul.
    await showing('veraitalia');
    await closeAll(WAITER_L);
    expect(await stillOpen(V)).toEqual([1]);
  });
});

describe('the end-of-day notice', () => {
  it('lists the open tables with what each owes, and which were left from an earlier day', async () => {
    const open = await openTables(WAITER_L);
    expect(open.tables.map((t) => [t.table_number, Number(t.outstanding), t.unpaid_orders, t.overnight])).toEqual([
      [1, 0, 0, false], [2, 24, 1, false], [3, 0, 0, true], [4, 0, 0, false],
    ].map(([n, owed, unpaid, overnight]) => [n, owed, unpaid, n === 3 ? true : overnight]));
    expect(open.local_time).toMatch(/^\d\d:\d\d$/);
    expect(open.weekday).toBeGreaterThanOrEqual(1);
    expect(open.weekday).toBeLessThanOrEqual(7);
    expect(open.day_ends_at).toBeNull();
    // No scheduler in the test database: the notice must not promise an overnight close.
    expect(open.closes_overnight).toBe(false);
  });

  it("gives the restaurant's own end of the work day once it is set", async () => {
    await db.query(`UPDATE public.restaurant_settings SET day_ends_at = '23:30' WHERE venue_id = $1`, [L]);
    expect((await openTables(WAITER_L)).day_ends_at).toBe('23:30');
    expect((await openTables(WAITER_V)).day_ends_at).toBeNull();
  });
});

describe('overnight', () => {
  const overnight = async () =>
    (await db.query<{ r: Record<string, { closed: number; kept: number }> }>(`SELECT public.run_scheduled_table_close() AS r`)).rows[0].r;

  it('frees the settled tables whose guests are long gone, at both restaurants', async () => {
    const result = await overnight();
    expect(result).toEqual({ lasoul: { closed: 2, kept: 1 }, veraitalia: { closed: 1, kept: 0 } });
    // Table 2 owes money; table 4 is still sitting.
    expect(await stillOpen(L)).toEqual([2, 4]);
    expect(await stillOpen(V)).toEqual([]);
    const audit = await db.query<{ reason: string; actor_user_id: string | null; venue_id: string }>(
      `SELECT reason, actor_user_id, venue_id FROM public.audit_log WHERE action = 'table.freed' ORDER BY venue_id`);
    expect(audit.rows.map((r) => r.venue_id)).toEqual([L, L, V]);
    expect(new Set(audit.rows.map((r) => r.reason))).toEqual(new Set(['Closed overnight: left open after the work day']));
    expect(audit.rows.every((r) => r.actor_user_id === null)).toBe(true);
  });

  it('leaves a table whose guests ordered or were served within the idle timeout', async () => {
    // Table 1's phone went quiet five hours ago, but a dish was served to it ten minutes ago.
    await db.query(`UPDATE public.table_sessions SET last_served_at = now() - interval '10 minutes' WHERE id = $1`, [S(1)]);
    await overnight();
    expect(await stillOpen(L)).toEqual([1, 2, 4]);
  });

  it('is the scheduler\'s, not a signed-in account\'s', async () => {
    await expect(as(OWNER, () => db.query(`SELECT public.close_tables_overnight()`))).rejects.toThrow(/permission denied/);
    await expect(as(WAITER_L, () => db.query(`SELECT public.close_settled_sessions($1, false, 'x')`, [L]))).rejects.toThrow(/permission denied/);
    await actAs(db, OWNER);
    await expect(db.query(`SELECT public.close_tables_overnight()`)).rejects.toThrow(/scheduler/);
  });

  it('records its run', async () => {
    await overnight();
    const run = await db.query<{ last_result: unknown }>(`SELECT last_result FROM public.maintenance_runs WHERE job = 'close_tables'`);
    expect(run.rows[0].last_result).toEqual({ lasoul: { closed: 2, kept: 1 }, veraitalia: { closed: 1, kept: 0 } });
  });
});
