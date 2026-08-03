/**
 * @vitest-environment node
 *
 * The section rota, and the trigger that reads it.
 *
 * This file exists because the rota had no test at all and the business-day
 * migration rewrote the lookup inside it. The rewrite asserted that its search
 * text matched; nothing asserted that a waiter still ends up attached to a
 * table. That is the wrong thing to leave unverified — a silent failure here
 * means guests sit down and nobody is responsible for them, and the only
 * symptom is a waiter who says the app is quiet tonight.
 *
 * The load-bearing test is `still assigns a waiter after midnight`, which is
 * the exact window the UTC bug broke: 02:00 local, mid-service.
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
const SECTION = 'ffffffff-0000-0000-0000-000000000001';
const TABLE = 'dddddddd-0000-0000-0000-000000000001';
const TABLE_NO_SECTION = 'dddddddd-0000-0000-0000-000000000002';
const AMINA = '99999999-0000-0000-0000-00000000000a';
const NENO = '99999999-0000-0000-0000-00000000000b';

let db: Db;

async function seed() {
  await db.exec(`
    TRUNCATE public.section_assignments, public.table_sessions, public.tables,
             public.waiters, public.sections RESTART IDENTITY CASCADE;
    DELETE FROM public.user_roles;
    DELETE FROM auth.users;

    INSERT INTO auth.users(id) VALUES ('${ADMIN}');
    INSERT INTO public.user_roles(user_id, role) VALUES ('${ADMIN}', 'admin');

    INSERT INTO public.sections(id, name, sort_order) VALUES ('${SECTION}', 'Terrace', 1);
    INSERT INTO auth.users(id) VALUES ('${AMINA}'), ('${NENO}');
    INSERT INTO public.waiters(id, user_id, display_name, is_active) VALUES
      ('${AMINA}', '${AMINA}', 'Amina', true),
      ('${NENO}',  '${NENO}',  'Neno',  true);

    INSERT INTO public.tables(id, table_number, section_id) VALUES ('${TABLE}', 7, '${SECTION}');
    INSERT INTO public.tables(id, table_number) VALUES ('${TABLE_NO_SECTION}', 8);
  `);
  await actAs(db, null);
}

/**
 * Put a waiter on a section for a trading day.
 *
 * The unique key is (section, waiter, day), not (section, day) — several
 * waiters legitimately share a section across an evening, which is what the
 * load-spreading branch of the trigger exists for.
 */
const rota = (waiter: string, day = 'public.business_day()') =>
  db.query(
    `INSERT INTO public.section_assignments(section_id, waiter_id, shift_date)
     VALUES ('${SECTION}', $1, ${day})`,
    [waiter]);

/** Open a table session and report who it landed on. */
async function openSession(table = TABLE, active = true) {
  const id = crypto.randomUUID();
  await db.query(
    `INSERT INTO public.table_sessions(id, table_id, token, is_active, last_heartbeat_at)
     VALUES ($1, $2, $3, $4, now())`,
    [id, table, `tok-${id.slice(0, 8)}`, active]);
  const { rows } = await db.query<{ assigned_waiter_id: string | null }>(
    `SELECT assigned_waiter_id FROM public.table_sessions WHERE id = $1`, [id]);
  return rows[0].assigned_waiter_id;
}

beforeAll(async () => { db = (await createTestDatabase({ quiet: true })) as unknown as Db; }, 180_000);
afterAll(async () => { await db?.close(); });
beforeEach(seed);

describe('a table gets a waiter', () => {
  it('assigns the waiter rostered on that section', async () => {
    await rota(AMINA);
    expect(await openSession()).toBe(AMINA);
  });

  it('still assigns a waiter after midnight', async () => {
    /*
     * THE ONE THAT MATTERS. The lookup used to compare against CURRENT_DATE,
     * the UTC date, while the rota is written for the trading day. Between
     * 02:00 and midnight local those agree; for the two hours after local
     * midnight they do not, and every table opened in that window got no
     * waiter at all. Mid-service, silently.
     *
     * Asserting through business_day() rather than a wall-clock reading means
     * this test says the same thing at 14:00 and at 01:00.
     */
    await rota(AMINA);

    const { rows } = await db.query<{ same: boolean }>(`
      SELECT (SELECT shift_date FROM public.section_assignments LIMIT 1) = public.business_day() AS same`);
    expect(rows[0].same).toBe(true);

    expect(await openSession()).toBe(AMINA);
  });

  it('does not read yesterday\'s rota', async () => {
    // Whoever closed last night is not automatically on today.
    await rota(AMINA, "public.business_day() - 1");
    expect(await openSession()).toBeNull();
  });

  it('does not read tomorrow\'s rota either', async () => {
    await rota(AMINA, "public.business_day() + 1");
    expect(await openSession()).toBeNull();
  });

  it('leaves a table with no section unassigned', async () => {
    await rota(AMINA);
    expect(await openSession(TABLE_NO_SECTION)).toBeNull();
  });

  it('leaves it unassigned when nobody is rostered', async () => {
    // Correct, and better than guessing: an unassigned table is visible on the
    // floor screen, whereas a wrongly assigned one looks handled.
    expect(await openSession()).toBeNull();
  });

  it('does not overwrite a waiter who was named explicitly', async () => {
    await rota(AMINA);
    const id = crypto.randomUUID();
    await db.query(
      `INSERT INTO public.table_sessions(id, table_id, token, is_active, assigned_waiter_id, last_heartbeat_at)
       VALUES ($1, '${TABLE}', $2, true, '${NENO}', now())`, [id, `tok-x`]);
    const { rows } = await db.query<{ assigned_waiter_id: string }>(
      `SELECT assigned_waiter_id FROM public.table_sessions WHERE id = $1`, [id]);
    expect(rows[0].assigned_waiter_id).toBe(NENO);
  });
});

describe('spreading the load', () => {
  it('prefers the waiter holding fewer live tables', async () => {
    // Under test: the ORDER BY COUNT(ts.id) in the trigger. The busier waiter
    // should not keep collecting tables.
    await rota(AMINA);
    await rota(NENO);

    // Amina already has three live tables; Neno has none.
    for (let i = 0; i < 3; i += 1) {
      await db.query(
        `INSERT INTO public.table_sessions(id, table_id, token, is_active, assigned_waiter_id, last_heartbeat_at)
         VALUES (gen_random_uuid(), '${TABLE}', $1, true, '${AMINA}', now())`, [`busy-${i}`]);
    }

    expect(await openSession()).toBe(NENO);
  });

  it('ignores tables that have already closed', async () => {
    // A waiter who served twenty tables and closed them all is free now.
    await rota(AMINA);

    for (let i = 0; i < 5; i += 1) {
      await db.query(
        `INSERT INTO public.table_sessions(id, table_id, token, is_active, assigned_waiter_id)
         VALUES (gen_random_uuid(), '${TABLE}', $1, false, '${AMINA}')`, [`done-${i}`]);
    }

    expect(await openSession()).toBe(AMINA);
  });
});
