/**
 * @vitest-environment node
 *
 * Removing a sign-in for good (supabase/functions/_shared/remove-login.ts):
 * the owner's Remove on Team (manage-admins `remove`) and a waiter's last
 * role let go under Waiters (delete-waiter).
 *
 * Supabase Auth deletes the account's row in auth.users. Five columns that
 * name who acknowledged a call or a bill, or closed a shift, were made
 * without ON DELETE, so Auth refused to delete anyone who had worked a
 * shift, and delete-waiter, which caught a throw that never came, said the
 * sign-in was gone while it stayed. These pin the list against every
 * migration, and show the delete going through once they let go.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error -- plain JS harness, no types needed
import { createTestDatabase } from '../../scripts/db-harness.mjs';
import { releaseSignatures, SIGNED_BY, type ClearColumn } from '../functions/_shared/remove-login.ts';
import { ownerMayRemoveAccount } from '../functions/_shared/venue-access.ts';

type Db = {
  query: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
  exec: (sql: string) => Promise<unknown>;
  close: () => Promise<void>;
};

const ROOT = path.join(__dirname, '..', '..');
const source = (file: string) => readFileSync(path.join(ROOT, file), 'utf8');

const WAITER = 'b7000000-0000-4000-8000-000000000001';

let db: Db;
beforeAll(async () => { db = (await createTestDatabase({ quiet: true })) as unknown as Db; }, 180_000);
afterAll(async () => { await db?.close(); });

/** The service role's `UPDATE … SET column = null WHERE column = id`, against the test database. */
const clearInDb: ClearColumn = async (table, column, userId) => {
  try {
    await db.query(`UPDATE public.${table} SET ${column} = null WHERE ${column} = $1`, [userId]);
    return { error: null };
  } catch (error) {
    return { error: { message: (error as Error).message } };
  }
};

describe('every column that names an account lets go of it when the account is deleted', () => {
  it('after all the migrations: each foreign key to auth.users cascades, sets null, or is released first', async () => {
    const { rows } = await db.query<{ tbl: string; col: string; on_delete: string }>(`
      SELECT c.conrelid::regclass::text AS tbl, a.attname AS col, c.confdeltype::text AS on_delete
        FROM pg_constraint c
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
       WHERE c.contype = 'f' AND c.confrelid = 'auth.users'::regclass
       ORDER BY 1, 2`);
    expect(rows.length).toBeGreaterThan(5);
    // 'c' cascade, 'n' set null: Auth's delete takes care of those.
    const blocking = rows
      .filter((r) => r.on_delete !== 'c' && r.on_delete !== 'n')
      .map((r) => `${r.tbl.replace(/^public\./, '')}.${r.col}`)
      .sort();
    expect(blocking).toEqual(SIGNED_BY.map(({ table, column }) => `${table}.${column}`).sort());
    // The roles go with the account.
    expect(rows.find((r) => r.tbl === 'user_roles' && r.col === 'user_id')?.on_delete).toBe('c');
  });

  it('a waiter who closed a shift: Auth is refused until the name lets go; then the account, its roles go, the shift close stays', async () => {
    await db.query(`INSERT INTO auth.users (id, email) VALUES ($1, 'remove-me@waiter.lasoul.local')`, [WAITER]);
    await db.query(`INSERT INTO public.user_roles (user_id, role, venue_id) VALUES ($1, 'admin', null)`, [WAITER]);
    const { rows: [shift] } = await db.query<{ id: string }>(
      `INSERT INTO public.shift_closes (day, closed_by) VALUES (DATE '2026-11-04', $1) RETURNING id`, [WAITER]);

    await expect(db.query(`DELETE FROM auth.users WHERE id = $1`, [WAITER])).rejects.toThrow(/foreign key/i);

    expect(await releaseSignatures(clearInDb, WAITER)).toBeNull();
    await db.query(`DELETE FROM auth.users WHERE id = $1`, [WAITER]);

    const { rows: roles } = await db.query(`SELECT 1 FROM public.user_roles WHERE user_id = $1`, [WAITER]);
    expect(roles).toHaveLength(0);
    const { rows: kept } = await db.query<{ closed_by: string | null }>(
      `SELECT closed_by FROM public.shift_closes WHERE id = $1`, [shift.id]);
    expect(kept).toEqual([{ closed_by: null }]);
  });
});

describe('releaseSignatures', () => {
  it('lets go of each column in turn, for that account only', async () => {
    const calls: string[] = [];
    const ok: ClearColumn = async (table, column, userId) => { calls.push(`${table}.${column}=${userId}`); return { error: null }; };
    expect(await releaseSignatures(ok, 'u-1')).toBeNull();
    expect(calls).toEqual(SIGNED_BY.map(({ table, column }) => `${table}.${column}=u-1`));
  });

  it('stops at the first refusal and says where, so Auth is not asked', async () => {
    const calls: string[] = [];
    const refuses: ClearColumn = async (table, column) => {
      calls.push(`${table}.${column}`);
      return { error: table === 'bill_requests' ? { message: 'permission denied' } : null };
    };
    expect(await releaseSignatures(refuses, 'u-1')).toBe('bill_requests.acknowledged_by: permission denied');
    expect(calls).toEqual(['waiter_calls.acknowledged_by', 'waiter_calls.resolved_by', 'bill_requests.acknowledged_by']);
  });
});

describe('the owner removes any account but their own (manage-admins remove)', () => {
  it('anyone else: an admin, a waiter, another owner, a sign-in with no role', () => {
    expect(ownerMayRemoveAccount({ userId: 'someone', callerId: 'owner-1' })).toBe(true);
    expect(ownerMayRemoveAccount({ userId: 'owner-2', callerId: 'owner-1' })).toBe(true);
  });

  it('never their own, and not without saying whose', () => {
    expect(ownerMayRemoveAccount({ userId: 'owner-1', callerId: 'owner-1' })).toBe(false);
    expect(ownerMayRemoveAccount({ userId: '', callerId: 'owner-1' })).toBe(false);
    expect(ownerMayRemoveAccount({ userId: null, callerId: 'owner-1' })).toBe(false);
  });

  it('the function lets only the owner in, decides through it, lets go of the names, then asks Auth and reads its answer', () => {
    const fn = source('supabase/functions/manage-admins/index.ts');
    const remove = fn.slice(fn.indexOf("body.action === 'remove'"));
    expect(fn).toContain("if (!owner) return reply({ error: 'Only the owner manages restaurant admins' }, 403);");
    expect(remove).toContain('ownerMayRemoveAccount({ userId, callerId: me.id })');
    const release = remove.indexOf('releaseSignatures(');
    const deleteUser = remove.indexOf('admin.auth.admin.deleteUser(userId)');
    expect(release).toBeGreaterThan(0);
    expect(deleteUser).toBeGreaterThan(release);
    expect(remove).toMatch(/const \{ error: delErr \} = await admin\.auth\.admin\.deleteUser\(userId\);\s+if \(delErr\)/);
    // The waiter rows and roles go only after the account did.
    expect(remove.indexOf("admin.from('waiters').delete().eq('user_id', userId)")).toBeGreaterThan(deleteUser);
  });

  it('delete-waiter lets go of the names too, and says the sign-in went only when Auth deleted it', () => {
    const fn = source('supabase/functions/delete-waiter/index.ts');
    expect(fn).toContain('releaseSignatures(');
    expect(fn.indexOf('releaseSignatures(')).toBeLessThan(fn.indexOf('admin.auth.admin.deleteUser(waiter.user_id)'));
    expect(fn).toContain('loginRemoved = !delErr;');
    // supabase-js answers a refusal; it does not throw one.
    expect(fn).not.toMatch(/try \{\s+await admin\.auth\.admin\.deleteUser/);
  });

  it('the list shows sign-ins with no role, and when each last signed in', () => {
    const fn = source('supabase/functions/manage-admins/index.ts');
    expect(fn).toContain("kind: 'none'");
    expect(fn).toContain('last_sign_in_at: lastSignIn.get(r.user_id) ?? null');
    expect(fn).toContain('u.is_anonymous');
  });
});
