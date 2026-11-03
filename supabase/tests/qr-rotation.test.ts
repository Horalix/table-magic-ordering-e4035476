/**
 * @vitest-environment node
 *
 * "Generate a new code" (Admin → QR codes), on the live database, answered
 * "function gen_random_bytes(integer) does not exist".
 *
 * Supabase installs pgcrypto in the `extensions` schema; this harness installs
 * it in public, so every test found the function and the bug never showed.
 * Here pgcrypto is moved where Supabase keeps it before anything is asked,
 * and both codes — the room's and a table's — must still be made
 * (20261103130000_qr_tokens_core_random.sql).
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
const ADMIN_L = '11111111-1111-1111-1111-111111111111';
const TABLE = 'dddddddd-0000-0000-0000-000000000001';
const TOKEN = /^[0-9a-f]{64}$/;

let db: Db;

async function seed() {
  await db.exec(`
    TRUNCATE public.audit_log, public.table_sessions, public.tables RESTART IDENTITY CASCADE;
    DELETE FROM public.user_roles;
    DELETE FROM auth.users;
    INSERT INTO auth.users(id) VALUES ('${ADMIN_L}');
    INSERT INTO public.user_roles(user_id, role, venue_id) VALUES ('${ADMIN_L}', 'admin', '${L}');
    INSERT INTO public.tables(id, table_number, qr_token, venue_id) VALUES ('${TABLE}', 7, 'printed-sticker', '${L}');
  `);
  await actAs(db, null);
}

/** Run as La Soul's admin, under the access rules. */
async function asAdmin<T>(run: () => Promise<T>): Promise<T> {
  await actAs(db, ADMIN_L);
  await db.exec('SET ROLE authenticated');
  try {
    return await run();
  } finally {
    await db.exec('RESET ROLE');
    await actAs(db, null);
  }
}

describe('a new QR code, on a database laid out like Supabase', () => {
  beforeAll(async () => {
    db = await createTestDatabase();
    await db.exec('ALTER EXTENSION pgcrypto SET SCHEMA extensions');
  }, 120_000);
  afterAll(async () => { await db?.close(); });
  beforeEach(seed);

  it('is made for the room, replaces the printed one, and is new each time', async () => {
    const roomCode = async () =>
      (await db.query<{ t: string }>(`SELECT venue_qr_token AS t FROM public.restaurant_settings WHERE venue_id = $1`, [L])).rows[0].t;
    const printed = await roomCode();
    const first = await asAdmin(async () =>
      (await db.query<{ t: string }>(`SELECT public.rotate_venue_qr_token() AS t`)).rows[0].t);
    expect(first).toMatch(TOKEN);
    expect(first).not.toBe(printed);
    expect(await roomCode()).toBe(first);

    const second = await asAdmin(async () =>
      (await db.query<{ t: string }>(`SELECT public.rotate_venue_qr_token() AS t`)).rows[0].t);
    expect(second).toMatch(TOKEN);
    expect(second).not.toBe(first);
  });

  it('is made for a table, and replaces its sticker', async () => {
    const made = await asAdmin(async () =>
      (await db.query<{ t: string }>(`SELECT public.rotate_table_qr_token($1) AS t`, [TABLE])).rows[0].t);
    expect(made).toMatch(TOKEN);
    const { rows } = await db.query<{ t: string }>(`SELECT qr_token AS t FROM public.tables WHERE id = $1`, [TABLE]);
    expect(rows[0].t).toBe(made);
  });

  it('no function of the app calls pgcrypto without saying where it lives', async () => {
    const { rows } = await db.query<{ name: string }>(`
      SELECT p.proname AS name FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace
         AND p.prosrc ~ '(^|[^.])gen_random_bytes\\s*\\('
       ORDER BY 1`);
    expect(rows.map((r) => r.name)).toEqual([]);
  });
});
