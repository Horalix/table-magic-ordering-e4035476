/**
 * @vitest-environment node
 *
 * A waiter can take a table nobody has (20261027090000_waiter_take_table.sql).
 *
 * A table outside the day's rota opened with no waiter, and nothing on any
 * waiter's phone mentioned it. The phone shows those tables to everyone now;
 * this is the tap that makes one somebody's — never by taking it from a
 * colleague — and, being staff having seen the table, it stops anything more
 * from it being held.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error -- plain JS harness, no types needed
import { createTestDatabase, actAs } from '../../scripts/db-harness.mjs';

type Db = {
  query: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
  exec: (sql: string) => Promise<unknown>;
  close: () => Promise<void>;
};

const ADMIN = '11111111-1111-1111-1111-111111111111';
const ANA = '22222222-2222-2222-2222-222222222222';
const BORIS = '33333333-3333-3333-3333-333333333333';
const WAITER_ANA = '44444444-4444-4444-4444-444444444444';
const WAITER_BORIS = '55555555-5555-5555-5555-555555555555';
const SESSION = 'eeeeeeee-eeee-eeee-eeee-eeeeeeee0001';

let db: Db;

beforeAll(async () => { db = await createTestDatabase({ quiet: true }); }, 180_000);
afterAll(async () => { await db.close(); });

beforeEach(async () => {
  await db.exec(`
    TRUNCATE public.waiter_calls, public.bill_requests, public.orders, public.table_sessions, public.tables,
             public.waiters RESTART IDENTITY CASCADE;
    DELETE FROM public.user_roles;
    DELETE FROM auth.users;
    INSERT INTO auth.users(id) VALUES ('${ADMIN}'), ('${ANA}'), ('${BORIS}');
    INSERT INTO public.user_roles(user_id, role) VALUES ('${ADMIN}', 'admin'), ('${ANA}', 'staff'), ('${BORIS}', 'staff');
    INSERT INTO public.waiters(id, user_id, display_name) VALUES
      ('${WAITER_ANA}', '${ANA}', 'Ana'), ('${WAITER_BORIS}', '${BORIS}', 'Boris');
    INSERT INTO public.tables(id, table_number) VALUES ('dddddddd-0000-0000-0000-000000000001', 7);
    INSERT INTO public.table_sessions(id, table_id, token, is_active, guest_name, last_heartbeat_at)
      VALUES ('${SESSION}', 'dddddddd-0000-0000-0000-000000000001', 'tok-7', true, 'Amina', now());
  `);
  await actAs(db, null);
});

const take = async (who: string | null) => {
  await actAs(db, who);
  try {
    const { rows } = await db.query<{ r: { taken: boolean; reason?: string; waiter?: string } }>(
      `SELECT public.staff_take_table($1) AS r`, [SESSION]);
    return rows[0].r;
  } finally {
    await actAs(db, null);
  }
};

const session = async () => (await db.query<{ assigned_waiter_id: string | null; staff_seen_at: string | null }>(
  `SELECT assigned_waiter_id, staff_seen_at FROM public.table_sessions WHERE id = $1`, [SESSION])).rows[0];

describe('a waiter takes a table nobody has', () => {
  it('makes it theirs and counts as staff having seen it', async () => {
    expect(await session()).toMatchObject({ assigned_waiter_id: null, staff_seen_at: null });
    expect(await take(ANA)).toEqual({ taken: true });
    const s = await session();
    expect(s.assigned_waiter_id).toBe(WAITER_ANA);
    expect(s.staff_seen_at).not.toBeNull();
    // Tapping again is harmless.
    expect(await take(ANA)).toEqual({ taken: true });
  });

  it('never takes a table from a colleague, and says who has it', async () => {
    await take(ANA);
    expect(await take(BORIS)).toEqual({ taken: false, reason: 'already_taken', waiter: 'Ana' });
    expect((await session()).assigned_waiter_id).toBe(WAITER_ANA);
  });

  it('refuses a closed table, a guest, and staff without a waiter profile', async () => {
    await db.exec(`UPDATE public.table_sessions SET is_active = false WHERE id = '${SESSION}'`);
    expect(await take(ANA)).toEqual({ taken: false, reason: 'not_open' });
    await db.exec(`UPDATE public.table_sessions SET is_active = true WHERE id = '${SESSION}'`);
    await expect(take(null)).rejects.toThrow(/Only staff/);
    await expect(take(ADMIN)).rejects.toThrow(/No waiter profile/);
    const { rows } = await db.query<{ anon: boolean }>(
      `SELECT has_function_privilege('anon', 'public.staff_take_table(uuid)', 'EXECUTE') AS anon`);
    expect(rows[0].anon).toBe(false);
  });
});

describe('an opening rush', () => {
  it('holds first orders only past eight tables sitting down at once, not three', async () => {
    const { rows } = await db.query<{ n: number }>(`SELECT hold_burst_sessions AS n FROM public.restaurant_settings WHERE id = 1`);
    expect(rows[0].n).toBe(8);
  });
});
