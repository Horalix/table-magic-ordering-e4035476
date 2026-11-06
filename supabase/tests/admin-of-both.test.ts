/**
 * @vitest-environment node
 *
 * One person can run both restaurants
 * (20261106120000_admin_of_both_restaurants.sql).
 *
 * The owner could not make the same person the admin of La Soul and of Vera
 * Italia: user_roles allowed one admin role per account. Now an account has
 * a row per restaurant it runs, and with them everything an admin of each
 * restaurant has — while still nothing of a restaurant it does not run, and
 * still no say over who runs a restaurant.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error -- plain JS harness, no types needed
import { actAs, createTestDatabase } from '../../scripts/db-harness.mjs';
import { adminRowsToAdd } from '../functions/_shared/venue-access.ts';

type Db = {
  query: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<{ rows: T[]; affectedRows?: number }>;
  exec: (sql: string) => Promise<unknown>;
  close: () => Promise<void>;
};

const ROOT = path.join(__dirname, '..', '..');
const MIGRATION = path.join(ROOT, 'supabase', 'migrations', '20261106120000_admin_of_both_restaurants.sql');

const L = 'a5000000-0000-4000-8000-000000000001'; // La Soul
const V = 'a5000000-0000-4000-8000-000000000002'; // Vera Italia

const OWNER = '10000000-0000-0000-0000-000000000001';
const BOTH = '10000000-0000-0000-0000-000000000009'; // runs La Soul and Vera Italia
const ADMIN_V = '10000000-0000-0000-0000-000000000003';
const NEWCOMER = '10000000-0000-0000-0000-000000000006';

const ROLE_REFUSED = /row-level security|row level security/;
const DUPLICATE = /duplicate key|unique/i;

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
    DELETE FROM public.user_roles;
    INSERT INTO auth.users (id) VALUES
      ('${OWNER}'), ('${BOTH}'), ('${ADMIN_V}'), ('${NEWCOMER}')
      ON CONFLICT DO NOTHING;
    INSERT INTO public.user_roles (user_id, role, venue_id) VALUES
      ('${OWNER}', 'admin', NULL),
      ('${BOTH}', 'admin', '${L}'),
      ('${BOTH}', 'admin', '${V}'),
      ('${ADMIN_V}', 'admin', '${V}');
  `);
});
afterEach(async () => {
  await db.query(`SELECT set_config('request.headers', '', false)`);
  await actAs(db, null);
});

/** Runs `fn` as `user`, the way PostgREST does: role authenticated, the user's id as the claim. */
async function as<T>(user: string, fn: () => Promise<T>): Promise<T> {
  await actAs(db, user);
  await db.exec('SET ROLE authenticated');
  try {
    return await fn();
  } finally {
    await db.exec('RESET ROLE');
    await actAs(db, null);
  }
}
const one = async <T>(sql: string, params: unknown[] = []) => (await db.query<{ v: T }>(sql, params)).rows[0]?.v;
const asking = (slug: string | null) =>
  db.query(`SELECT set_config('request.headers', $1, false)`, [slug ? JSON.stringify({ 'x-venue': slug }) : '']);

describe('the roles table', () => {
  it('holds an admin row for each restaurant one person runs', async () => {
    expect(await one<number>(`SELECT count(*)::int AS v FROM public.user_roles WHERE user_id = $1 AND role = 'admin'`, [BOTH])).toBe(2);
  });

  it('still holds one row per person, role and restaurant, and one owner row per person', async () => {
    await expect(db.query(`INSERT INTO public.user_roles (user_id, role, venue_id) VALUES ($1, 'admin', $2)`, [BOTH, L])).rejects.toThrow(DUPLICATE);
    await expect(db.query(`INSERT INTO public.user_roles (user_id, role, venue_id) VALUES ($1, 'admin', NULL)`, [OWNER])).rejects.toThrow(DUPLICATE);
  });

  it('no longer has the rule of one admin role per account', async () => {
    const rules = await db.query<{ cols: string[] }>(`
      SELECT array_agg(att.attname::text ORDER BY att.attname) AS cols
        FROM pg_constraint con
        JOIN LATERAL unnest(con.conkey) AS k(attnum) ON true
        JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = k.attnum
       WHERE con.conrelid = 'public.user_roles'::regclass AND con.contype = 'u'
       GROUP BY con.oid`);
    expect(rules.rows.map((r) => r.cols.join(','))).not.toContain('role,user_id');
  });
});

describe('an admin of both restaurants', () => {
  it('manages each of them, and is not the owner', async () => {
    expect(await as(BOTH, () => one<boolean>(`SELECT public.can_admin($1) AS v`, [L]))).toBe(true);
    expect(await as(BOTH, () => one<boolean>(`SELECT public.can_admin($1) AS v`, [V]))).toBe(true);
    expect(await as(BOTH, () => one<boolean>(`SELECT public.is_super_admin() AS v`))).toBe(false);
    // Vera Italia's own admin still manages only Vera Italia.
    expect(await as(ADMIN_V, () => one<boolean>(`SELECT public.can_admin($1) AS v`, [L]))).toBe(false);
  });

  it('is answered for the restaurant the page names — the site’s own until they pick', async () => {
    await asking(null);
    expect(await as(BOTH, () => one<string>(`SELECT public.current_venue() AS v`))).toBe(L);
    await asking('veraitalia');
    expect(await as(BOTH, () => one<string>(`SELECT public.current_venue() AS v`))).toBe(V);
    await asking('lasoul');
    expect(await as(BOTH, () => one<string>(`SELECT public.current_venue() AS v`))).toBe(L);
    // Vera Italia's own admin asking for La Soul still gets Vera Italia.
    expect(await as(ADMIN_V, () => one<string>(`SELECT public.current_venue() AS v`))).toBe(V);
  });

  it('hires staff at either restaurant, and appoints no admins: that stays the owner’s', async () => {
    const add = (role: string, venue: string | null) =>
      as(BOTH, () => db.query(`INSERT INTO public.user_roles(user_id, role, venue_id) VALUES ($1, $2, $3)`, [NEWCOMER, role, venue]));
    await add('staff', L);
    await add('staff', V);
    await expect(add('admin', L)).rejects.toThrow(ROLE_REFUSED);
    await expect(add('admin', null)).rejects.toThrow(ROLE_REFUSED);
  });

  it('loses one restaurant when the owner revokes it, and keeps the other', async () => {
    await db.query(`DELETE FROM public.user_roles WHERE user_id = $1 AND role = 'admin' AND venue_id = $2`, [BOTH, L]);
    expect(await as(BOTH, () => one<boolean>(`SELECT public.can_admin($1) AS v`, [L]))).toBe(false);
    expect(await as(BOTH, () => one<boolean>(`SELECT public.can_admin($1) AS v`, [V]))).toBe(true);
  });
});

describe('appointing (manage-admins)', () => {
  it('adds only the restaurants they do not run yet', () => {
    expect(adminRowsToAdd([{ role: 'admin', venue_id: L }], [L, V])).toEqual({ owner: false, already: [L], add: [V] });
    expect(adminRowsToAdd([{ role: 'staff', venue_id: V }], [L, V])).toEqual({ owner: false, already: [], add: [L, V] });
    expect(adminRowsToAdd([{ role: 'admin', venue_id: L }, { role: 'admin', venue_id: V }], [V, V])).toEqual({ owner: false, already: [V], add: [] });
  });

  it('refuses the owner, who runs every restaurant already', () => {
    expect(adminRowsToAdd([{ role: 'admin', venue_id: null }], [V]).owner).toBe(true);
  });
});
