/**
 * @vitest-environment node
 *
 * A restaurant's admin manages that restaurant, and nothing of the other
 * (20261031100000_admin_separation.sql, docs/two-restaurants.md).
 *
 * An audit of the admin found the places that still asked "an admin anywhere?"
 * where they meant "an admin of this restaurant?", and readers and jobs that
 * spanned both restaurants. Every gap is tried here in both directions — Vera
 * Italia's admin against La Soul, La Soul's against Vera Italia, accounts that
 * wait tables at one restaurant and manage the other — and the owner is shown
 * still able to do all of it at both. Numbered as in the audit.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { QueryClient } from '@tanstack/react-query';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error -- plain JS harness, no types needed
import { createTestDatabase, actAs } from '../../scripts/db-harness.mjs';
import {
  managesVenue, mayRemoveLogin, namedVenue, resolveAdminVenue, type RoleRow,
} from '../functions/_shared/venue-access.ts';

/** The realtime layer talks to this instead of a Supabase project. */
const sb = vi.hoisted(() => {
  type Handler = (payload: Record<string, unknown>) => void;
  const handlers = new Map<string, Handler>();
  const state: { roles: unknown[]; userId: string | null; status: ((s: string) => void) | null } = {
    roles: [], userId: null, status: null,
  };
  const channel = {
    on(_event: string, filter: { table: string }, handler: Handler) { handlers.set(filter.table, handler); return channel; },
    subscribe(cb: (s: string) => void) { state.status = cb; return channel; },
  };
  const client = {
    channel: () => channel,
    removeChannel: () => Promise.resolve('ok'),
    auth: { getSession: async () => ({ data: { session: state.userId ? { user: { id: state.userId } } : null } }) },
    from: () => ({ select: () => ({ eq: async () => ({ data: state.roles, error: null }) }) }),
  };
  return { handlers, state, client };
});
vi.mock('@/integrations/supabase/client', () => ({ supabase: sb.client }));

// After the mock: these load the client.
import { __realtimeForTests as realtime, venueLens } from '@/lib/realtime';
import { venueOfRoles } from '@/hooks/useStaffVenue';
import { answeredVenueId, menuDataCacheKey, workplaceVenueId } from '@/lib/current-venue';

type Db = {
  query: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<{ rows: T[]; affectedRows?: number }>;
  exec: (sql: string) => Promise<unknown>;
  close: () => Promise<void>;
};

const ROOT = path.join(__dirname, '..', '..');
const MIGRATION = path.join(ROOT, 'supabase', 'migrations', '20261031100000_admin_separation.sql');
const source = (file: string) => readFileSync(path.join(ROOT, file), 'utf8');

const L = 'a5000000-0000-4000-8000-000000000001'; // La Soul
const V = 'a5000000-0000-4000-8000-000000000002'; // Vera Italia

const SUPER = '10000000-0000-0000-0000-000000000001';   // the owner: admin of no one restaurant
const ADMIN_L = '10000000-0000-0000-0000-000000000002';
const ADMIN_V = '10000000-0000-0000-0000-000000000003';
const WAITER_L = '10000000-0000-0000-0000-000000000004';
const WAITER_V = '10000000-0000-0000-0000-000000000005';
const NEWCOMER = '10000000-0000-0000-0000-000000000006';
const MIX_LV = '10000000-0000-0000-0000-000000000007';  // waits at La Soul, manages Vera Italia
const MIX_VL = '10000000-0000-0000-0000-000000000008';  // waits at Vera Italia, manages La Soul

const CAT_L = 'c0000000-0000-0000-0000-00000000000a';
const CAT_V = 'c0000000-0000-0000-0000-00000000000b';
const SUB_L = 'd0000000-0000-0000-0000-00000000000a';
const SUB_V = 'd0000000-0000-0000-0000-00000000000b';
const DISH_L = 'e0000000-0000-0000-0000-00000000000a';
const DISH_L2 = 'e0000000-0000-0000-0000-00000000001a';
const DISH_V = 'e0000000-0000-0000-0000-00000000000b';
const DISH_V2 = 'e0000000-0000-0000-0000-00000000001b';
const SEC_L = 'f0000000-0000-0000-0000-00000000000a';
const SEC_V = 'f0000000-0000-0000-0000-00000000000b';
const W_L = '20000000-0000-0000-0000-00000000000a';
const W_V = '20000000-0000-0000-0000-00000000000b';
const W_MIX_LV = '20000000-0000-0000-0000-00000000002a';
const W_MIX_VL = '20000000-0000-0000-0000-00000000002b';
const T_L = '30000000-0000-0000-0000-00000000000a';
const T_V = '30000000-0000-0000-0000-00000000000b';
const S_L = '40000000-0000-0000-0000-00000000000a';
const S_V = '40000000-0000-0000-0000-00000000000b';

let db: Db;

beforeAll(async () => {
  db = (await createTestDatabase({ quiet: true })) as unknown as Db;
  // Applying it a second time changes nothing (the La Soul harnesses re-apply it).
  await db.exec(readFileSync(MIGRATION, 'utf8'));
  await db.exec(`
    -- What Supabase grants by default; the access rules decide the rest.
    GRANT USAGE ON SCHEMA public, storage TO anon, authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
    GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;
    GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO anon, authenticated;
    -- The PIN functions use pgcrypto from the extensions schema, as on
    -- Supabase; the test database has it in public.
    CREATE OR REPLACE FUNCTION extensions.gen_salt(text) RETURNS text LANGUAGE sql AS 'SELECT public.gen_salt($1)';
    CREATE OR REPLACE FUNCTION extensions.crypt(text, text) RETURNS text LANGUAGE sql AS 'SELECT public.crypt($1, $2)';
  `);
}, 240_000);
afterAll(async () => { await db?.close(); });

beforeEach(async () => {
  await db.exec(`
    TRUNCATE public.audit_log, public.analytics_events, public.guest_profiles, public.suggestion_stats,
             public.suggestion_conversions, public.menu_item_affinity, public.recommendation_decisions,
             public.maintenance_runs, public.session_experiment_assignment, public.experiments,
             public.order_ticket_events, public.order_items, public.orders, public.table_sessions, public.tables,
             public.section_assignments, public.sections, public.waiters, public.menu_combo_options,
             public.menu_combo_slots, public.menu_items, public.subcategories, public.categories,
             public.order_code_counters, public.printers, public.shift_closes
      RESTART IDENTITY CASCADE;
    DELETE FROM public.user_roles;
    DELETE FROM auth.users;
    DELETE FROM storage.objects;
    UPDATE public.restaurant_settings SET ordering_enabled = true, online_card_enabled = false;

    INSERT INTO auth.users(id) VALUES ('${SUPER}'), ('${ADMIN_L}'), ('${ADMIN_V}'), ('${WAITER_L}'), ('${WAITER_V}'),
      ('${NEWCOMER}'), ('${MIX_LV}'), ('${MIX_VL}');
    -- Staff rows first, as the app adds them: the order rows come back in
    -- is not the order the database decides by.
    INSERT INTO public.user_roles(user_id, role, venue_id) VALUES
      ('${MIX_LV}', 'staff', '${L}'), ('${MIX_VL}', 'staff', '${V}'),
      ('${SUPER}', 'admin', NULL), ('${ADMIN_L}', 'admin', '${L}'), ('${ADMIN_V}', 'admin', '${V}'),
      ('${WAITER_L}', 'staff', '${L}'), ('${WAITER_V}', 'staff', '${V}'),
      ('${MIX_LV}', 'admin', '${V}'), ('${MIX_VL}', 'admin', '${L}');

    INSERT INTO public.categories(id, name, sort_order, venue_id) VALUES ('${CAT_L}', 'Food', 1, '${L}'), ('${CAT_V}', 'Cucina', 1, '${V}');
    INSERT INTO public.subcategories(id, category_id, name, sort_order) VALUES ('${SUB_L}', '${CAT_L}', 'Burgers', 1), ('${SUB_V}', '${CAT_V}', 'Pizze', 1);
    INSERT INTO public.menu_items(id, subcategory_id, name, price, is_available, station) VALUES
      ('${DISH_L}', '${SUB_L}', 'La Soul Burger', 18.00, true, 'kitchen'), ('${DISH_L2}', '${SUB_L}', 'Fries', 5.00, true, 'kitchen'),
      ('${DISH_V}', '${SUB_V}', 'Pizza Margherita', 14.00, true, 'kitchen'), ('${DISH_V2}', '${SUB_V}', 'Bruschetta', 6.00, true, 'kitchen');
    INSERT INTO public.sections(id, name, venue_id) VALUES ('${SEC_L}', 'Terrace', '${L}'), ('${SEC_V}', 'Sala', '${V}');
    INSERT INTO public.waiters(id, user_id, display_name, venue_id, username) VALUES
      ('${W_L}', '${WAITER_L}', 'Amar', '${L}', 'amar'), ('${W_V}', '${WAITER_V}', 'Giulia', '${V}', 'giulia'),
      ('${W_MIX_LV}', '${MIX_LV}', 'Edin', '${L}', 'edin'), ('${W_MIX_VL}', '${MIX_VL}', 'Marta', '${V}', 'marta');
    INSERT INTO public.tables(id, table_number, qr_token, venue_id, section_id) VALUES
      ('${T_L}', 7, 'sticker-lasoul-7', '${L}', '${SEC_L}'), ('${T_V}', 7, 'sticker-vera-7', '${V}', '${SEC_V}');
    INSERT INTO public.table_sessions(id, table_id, token, is_active, guest_name, last_heartbeat_at) VALUES
      ('${S_L}', '${T_L}', 'tok-l', true, 'Amina', now()), ('${S_V}', '${T_V}', 'tok-v', true, 'Marco', now());
  `);
  await actAs(db, null);
  await showing(null);
});

/** Run as a signed-in user, under the access rules. */
async function as<T>(user: string, run: () => Promise<T>): Promise<T> {
  await actAs(db, user);
  await db.exec('SET ROLE authenticated');
  try {
    return await run();
  } finally {
    await db.exec('RESET ROLE');
    await actAs(db, null);
  }
}

/** Run as a guest, under the access rules. */
async function asGuest<T>(run: () => Promise<T>): Promise<T> {
  await db.exec('SET ROLE anon');
  try { return await run(); } finally { await db.exec('RESET ROLE'); }
}

/** The app names the restaurant it is showing in an x-venue header. */
function showing(slug: string | null) {
  return db.query(`SELECT set_config('request.headers', $1, false)`, [slug ? JSON.stringify({ 'x-venue': slug }) : '']);
}

const affected = async (sql: string, params?: unknown[]) => (await db.query(sql, params)).affectedRows ?? 0;
const one = async <T,>(sql: string, params?: unknown[]) => (await db.query<{ r: T }>(sql, params)).rows[0]?.r;
const venuesOf = (rows: { venue_id: string | null }[]) => rows.map((r) => r.venue_id ?? 'none').sort();

/** A guest orders at a table of that restaurant, the way the app does. */
async function guestOrder(venue: string) {
  const [session, token, dish] = venue === L ? [S_L, 'tok-l', DISH_L] : [S_V, 'tok-v', DISH_V];
  return (await one<{ order_id: string }>(
    `SELECT public.guest_place_order($1, $2, 'Guest', 'cash', $3::jsonb, 0) AS r`,
    [session, token, JSON.stringify([{ menu_item_id: dish, quantity: 1 }])]))!.order_id;
}

/** ...and pays their waiter in cash. */
async function paidOrder(venue: string) {
  const order = await guestOrder(venue);
  await as(venue === L ? WAITER_L : WAITER_V, () => db.query(`SELECT public.record_table_payment($1, 'cash', NULL)`, [order]));
  return order;
}

// ---------------------------------------------------------------------

describe('1. a manager acts on their own restaurant’s rows', () => {
  const ROLE_REFUSED = /row-level security|row level security/;

  it('sets a waiter’s PIN only at their own restaurant', async () => {
    const pin = (user: string, waiter: string) =>
      as(user, () => db.query(`SELECT public.admin_set_waiter_pin($1, '1234')`, [waiter]));
    const isSet = async (waiter: string) =>
      (await one<boolean>(`SELECT pin_set_at IS NOT NULL AS r FROM public.waiters WHERE id = $1`, [waiter]))!;

    await expect(pin(ADMIN_V, W_L)).rejects.toThrow(/Admin only/);
    await expect(pin(ADMIN_L, W_V)).rejects.toThrow(/Admin only/);
    // Waits tables at La Soul, manages Vera Italia: at La Soul a waiter.
    await expect(pin(MIX_LV, W_L)).rejects.toThrow(/Admin only/);
    await expect(pin(MIX_VL, W_V)).rejects.toThrow(/Admin only/);
    await expect(pin(WAITER_L, W_L)).rejects.toThrow(/Admin only/);
    expect(await isSet(W_L)).toBe(false);
    expect(await isSet(W_V)).toBe(false);

    await pin(ADMIN_L, W_L);
    await pin(ADMIN_V, W_V);
    await pin(MIX_LV, W_MIX_VL);
    expect(await isSet(W_L)).toBe(true);
    expect(await one<boolean>(`SELECT public.verify_waiter_pin($1, '1234') AS r`, [W_V])).toBe(true);
    // The owner, at both.
    await pin(SUPER, W_MIX_LV);
    expect(await isSet(W_MIX_LV)).toBe(true);
  });

  it('saves a combo only of their own restaurant’s dish, and only from its menu', async () => {
    const save = (user: string, dish: string, slots: unknown[]) =>
      as(user, () => db.query(`SELECT public.admin_save_combo($1, $2::jsonb)`, [dish, JSON.stringify(slots)]));
    const side = (item: string) => [{ label: 'Side', options: [{ item_id: item }] }];
    const slots = async (dish: string) =>
      Number(await one(`SELECT count(*)::int AS r FROM public.menu_combo_slots WHERE combo_item_id = $1`, [dish]));
    await db.exec(`INSERT INTO public.menu_combo_slots(combo_item_id, sort_order, label) VALUES ('${DISH_L}', 1, 'Side')`);

    // An empty list would have turned La Soul's combo back into a plain dish.
    await expect(save(ADMIN_V, DISH_L, [])).rejects.toThrow(/Admin only/);
    await expect(save(MIX_LV, DISH_L, [])).rejects.toThrow(/Admin only/);
    await expect(save(ADMIN_L, DISH_V, side(DISH_V2))).rejects.toThrow(/Admin only/);
    await expect(save(MIX_VL, DISH_V, side(DISH_V2))).rejects.toThrow(/Admin only/);
    expect(await slots(DISH_L)).toBe(1);
    expect(await slots(DISH_V)).toBe(0);

    await save(ADMIN_L, DISH_L, side(DISH_L2));
    await save(ADMIN_V, DISH_V, side(DISH_V2));
    expect(await slots(DISH_L)).toBe(1);
    expect(await slots(DISH_V)).toBe(1);
    // Never the other restaurant's dish as a choice.
    await expect(save(ADMIN_L, DISH_L, side(DISH_V2))).rejects.toThrow(/Not available at this restaurant/);
    // The owner, at both.
    await save(SUPER, DISH_L, []);
    await save(SUPER, DISH_V, []);
    expect(await slots(DISH_L) + await slots(DISH_V)).toBe(0);
  });

  it('rotates a table’s QR only at their own restaurant, and the audit entry is that restaurant’s', async () => {
    const rotate = (user: string, table: string) =>
      as(user, () => db.query(`SELECT public.rotate_table_qr_token($1)`, [table]));
    const token = async (table: string) => one<string>(`SELECT qr_token AS r FROM public.tables WHERE id = $1`, [table]);

    await expect(rotate(ADMIN_V, T_L)).rejects.toThrow(/Only a manager/);
    await expect(rotate(MIX_LV, T_L)).rejects.toThrow(/Only a manager/);
    await expect(rotate(ADMIN_L, T_V)).rejects.toThrow(/Only a manager/);
    await expect(rotate(MIX_VL, T_V)).rejects.toThrow(/Only a manager/);
    await expect(rotate(WAITER_L, T_L)).rejects.toThrow(/Only a manager/);
    expect(await token(T_L)).toBe('sticker-lasoul-7');
    expect(await token(T_V)).toBe('sticker-vera-7');

    await rotate(ADMIN_L, T_L);
    await rotate(MIX_LV, T_V);
    expect(await token(T_L)).not.toBe('sticker-lasoul-7');
    expect(await token(T_V)).not.toBe('sticker-vera-7');
    // The owner, looking at Vera Italia, re-stickers a La Soul table.
    await showing('veraitalia');
    await rotate(SUPER, T_L);
    await showing(null);
    const audit = await db.query<{ venue_id: string }>(
      `SELECT venue_id FROM public.audit_log WHERE action = 'qr.table_rotated' AND entity_id = $1`, [T_L]);
    expect(audit.rows.map((r) => r.venue_id)).toEqual([L, L]);
  });

  it('refunds only their own restaurant’s orders', async () => {
    const orderL = await paidOrder(L);
    const orderV = await paidOrder(V);
    const refund = (user: string, order: string) =>
      as(user, () => db.query(`SELECT public.record_order_refund($1, 1, 'cash', 'test', true, NULL)`, [order]));
    const refunds = async (order: string) =>
      Number(await one(`SELECT count(*)::int AS r FROM public.order_refunds WHERE order_id = $1`, [order]));

    // Another restaurant's admin learns nothing of the order; a waiter there who
    // manages the other restaurant is no manager here.
    await expect(refund(ADMIN_V, orderL)).rejects.toThrow(/do not work at this restaurant/);
    await expect(refund(MIX_LV, orderL)).rejects.toThrow(/Only a manager/);
    await expect(refund(ADMIN_L, orderV)).rejects.toThrow(/do not work at this restaurant/);
    await expect(refund(MIX_VL, orderV)).rejects.toThrow(/Only a manager/);
    await expect(refund(WAITER_L, orderL)).rejects.toThrow(/Only a manager/);
    expect(await refunds(orderL) + await refunds(orderV)).toBe(0);

    await refund(ADMIN_L, orderL);
    await refund(MIX_VL, orderL);
    await refund(ADMIN_V, orderV);
    await refund(MIX_LV, orderV);
    // The owner, at both, from either restaurant's screen.
    await showing('veraitalia');
    await refund(SUPER, orderL);
    await showing(null);
    await refund(SUPER, orderV);
    expect(await refunds(orderL)).toBe(3);
    expect(await refunds(orderV)).toBe(3);
    const audit = await db.query<{ venue_id: string; entity: string }>(
      `SELECT venue_id, entity_id::text AS entity FROM public.audit_log WHERE action = 'refund.completed'`);
    expect(audit.rows).toHaveLength(6);
    expect(audit.rows.every((r) => r.venue_id === (r.entity === orderL ? L : V))).toBe(true);
  });

  it('voids a paid order only as a manager of its own restaurant', async () => {
    const orderL = await paidOrder(L);
    const orderV = await paidOrder(V);
    const cancel = (user: string, order: string) =>
      as(user, async () => one<{ status: string }>(`SELECT public.cancel_order($1, 'test') AS r`, [order]));
    const status = (order: string) => one<string>(`SELECT status::text AS r FROM public.orders WHERE id = $1`, [order]);

    // At La Soul this account is a waiter: no manager's override there.
    await expect(cancel(MIX_LV, orderL)).rejects.toThrow(/manager must cancel/);
    await expect(cancel(MIX_VL, orderV)).rejects.toThrow(/manager must cancel/);
    await expect(cancel(ADMIN_V, orderL)).rejects.toThrow(/do not work at this restaurant/);
    await expect(cancel(ADMIN_L, orderV)).rejects.toThrow(/do not work at this restaurant/);
    expect(await status(orderL)).not.toBe('cancelled');
    expect(await status(orderV)).not.toBe('cancelled');

    expect((await cancel(ADMIN_L, orderL))!.status).toBe('cancelled');
    // The owner looking at La Soul voids Vera Italia's: the audit entry is Vera's.
    expect((await cancel(SUPER, orderV))!.status).toBe('cancelled');
    expect(await one(`SELECT venue_id AS r FROM public.audit_log WHERE action = 'order.cancelled' AND entity_id = $1`, [orderV])).toBe(V);
    // An unpaid order not yet cooking: any of its own staff.
    const fresh = await guestOrder(V);
    await expect(cancel(WAITER_L, fresh)).rejects.toThrow(/do not work at this restaurant/);
    expect((await cancel(WAITER_V, fresh))!.status).toBe('cancelled');
  });

  it('a restaurant’s admin hires and lets go staff of their own restaurant; admin roles are the owner’s', async () => {
    const add = (user: string, who: string, role: string, venue: string | null) =>
      as(user, () => db.query(`INSERT INTO public.user_roles(user_id, role, venue_id) VALUES ($1, $2, $3)`, [who, role, venue]));
    const write = (user: string, sql: string, params: unknown[]) => as(user, () => affected(sql, params));

    // (One staff role and one admin role per person: user_roles is unique on user and role.)
    await add(ADMIN_V, NEWCOMER, 'staff', V);
    await expect(add(ADMIN_V, WAITER_L, 'admin', V)).rejects.toThrow(ROLE_REFUSED);
    await expect(add(ADMIN_V, NEWCOMER, 'admin', V)).rejects.toThrow(ROLE_REFUSED);
    await expect(add(ADMIN_L, NEWCOMER, 'admin', L)).rejects.toThrow(ROLE_REFUSED);
    await expect(add(ADMIN_V, NEWCOMER, 'admin', null)).rejects.toThrow(ROLE_REFUSED);
    await expect(add(ADMIN_V, NEWCOMER, 'staff', L)).rejects.toThrow(ROLE_REFUSED);
    await expect(add(ADMIN_L, NEWCOMER, 'staff', V)).rejects.toThrow(ROLE_REFUSED);
    // A waiter at La Soul who manages Vera Italia hires only at Vera Italia.
    await expect(add(MIX_LV, WAITER_V, 'staff', L)).rejects.toThrow(ROLE_REFUSED);

    // Promoting a waiter, or taking another admin's role away: no.
    await expect(write(ADMIN_V, `UPDATE public.user_roles SET role = 'admin' WHERE user_id = $1 AND venue_id = $2`, [NEWCOMER, V]))
      .rejects.toThrow(ROLE_REFUSED);
    expect(await write(ADMIN_V, `DELETE FROM public.user_roles WHERE user_id = $1 AND role = 'admin'`, [MIX_LV])).toBe(0);
    expect(await write(ADMIN_V, `DELETE FROM public.user_roles WHERE user_id = $1`, [ADMIN_V])).toBe(0);
    expect(await write(ADMIN_L, `DELETE FROM public.user_roles WHERE user_id = $1`, [MIX_VL])).toBe(0);
    // Letting their own waiter go: yes. La Soul's admin cannot, nor take them on.
    expect(await write(ADMIN_L, `DELETE FROM public.user_roles WHERE user_id = $1`, [NEWCOMER])).toBe(0);
    expect(await write(ADMIN_V, `DELETE FROM public.user_roles WHERE user_id = $1`, [NEWCOMER])).toBe(1);
    await add(ADMIN_L, NEWCOMER, 'staff', L);
    expect(await one(`SELECT string_agg(role::text || '@' || venue_id::text, ',') AS r FROM public.user_roles WHERE user_id = $1`, [NEWCOMER]))
      .toBe(`staff@${L}`);

    // They still see who manages their restaurant.
    const admins = await as(ADMIN_V, async () =>
      (await db.query<{ user_id: string }>(`SELECT user_id FROM public.user_roles WHERE role = 'admin'`)).rows.map((r) => r.user_id).sort());
    expect(admins).toEqual([ADMIN_V, MIX_LV].sort());

    // The owner: admins at either restaurant.
    await add(SUPER, NEWCOMER, 'admin', V);
    expect(await write(SUPER, `UPDATE public.user_roles SET venue_id = $2 WHERE user_id = $1 AND role = 'admin'`, [NEWCOMER, L])).toBe(1);
    expect(await write(SUPER, `DELETE FROM public.user_roles WHERE user_id = $1 AND role = 'admin'`, [NEWCOMER])).toBe(1);
  });

  it('no other function or rule asks whether someone is an admin anywhere', async () => {
    const fns = await db.query<{ proname: string }>(`
      SELECT p.proname FROM pg_proc p
       WHERE p.pronamespace = 'public'::regnamespace
         AND p.prosrc ~* 'has_role\\s*\\(\\s*auth\\.uid\\(\\)\\s*,\\s*''admin'''
       ORDER BY 1`);
    // is_staff_member(): "staff or admin of any restaurant", every caller's
    // first gate — each then checks the row's restaurant, or the second
    // check on signed-in writes (ac_venue_access) does.
    expect(fns.rows.map((r) => r.proname)).toEqual(['is_staff_member']);
    const rules = await db.query<{ policyname: string }>(`
      SELECT policyname FROM pg_policies
       WHERE schemaname IN ('public', 'storage')
         AND (COALESCE(qual, '') ~ 'has_role' OR COALESCE(with_check, '') ~ 'has_role')`);
    expect(rules.rows).toEqual([]);
  });
});

// ---------------------------------------------------------------------

describe('2, 6, 10. the admin edge functions act on one restaurant', () => {
  const venues = [{ id: L, slug: 'lasoul' }, { id: V, slug: 'veraitalia' }];
  const owner: RoleRow[] = [{ role: 'admin', venue_id: null }];
  const adminL: RoleRow[] = [{ role: 'admin', venue_id: L }];
  const adminV: RoleRow[] = [{ role: 'admin', venue_id: V }];
  const mixLV: RoleRow[] = [{ role: 'staff', venue_id: L }, { role: 'admin', venue_id: V }];
  const both: RoleRow[] = [{ role: 'admin', venue_id: L }, { role: 'admin', venue_id: V }];
  const waiter: RoleRow[] = [{ role: 'staff', venue_id: L }];

  it('the owner names the restaurant, and naming none is refused rather than read as La Soul', () => {
    expect(resolveAdminVenue(owner, null, venues)).toMatchObject({ ok: false, status: 400 });
    expect(resolveAdminVenue(owner, '  ', venues)).toMatchObject({ ok: false, status: 400 });
    expect(resolveAdminVenue(owner, 'nowhere', venues)).toMatchObject({ ok: false, status: 400 });
    expect(resolveAdminVenue(owner, 'veraitalia', venues)).toEqual({ ok: true, venueId: V, slug: 'veraitalia', owner: true });
    expect(resolveAdminVenue(owner, L, venues)).toEqual({ ok: true, venueId: L, slug: 'lasoul', owner: true });
  });

  it('a restaurant’s admin acts on their own restaurant, whatever the page named', () => {
    expect(resolveAdminVenue(adminV, 'lasoul', venues)).toEqual({ ok: true, venueId: V, slug: 'veraitalia', owner: false });
    expect(resolveAdminVenue(adminV, null, venues)).toMatchObject({ ok: true, venueId: V, owner: false });
    expect(resolveAdminVenue(adminL, 'veraitalia', venues)).toMatchObject({ ok: true, venueId: L, owner: false });
    // Waiting tables at La Soul makes no one La Soul's admin.
    expect(resolveAdminVenue(mixLV, 'lasoul', venues)).toMatchObject({ ok: true, venueId: V, owner: false });
    // Managing both (but not the owner): they say which.
    expect(resolveAdminVenue(both, null, venues)).toMatchObject({ ok: false, status: 400 });
    expect(resolveAdminVenue(both, 'veraitalia', venues)).toMatchObject({ ok: true, venueId: V, owner: false });
    expect(resolveAdminVenue(waiter, 'lasoul', venues)).toMatchObject({ ok: false, status: 403 });
    expect(resolveAdminVenue([], 'lasoul', venues)).toMatchObject({ ok: false, status: 403 });
  });

  it('the restaurant comes from the body first, then the x-venue header', () => {
    const req = (venue?: string) => new Request('https://x.test/functions/v1/translate-menu', venue ? { headers: { 'x-venue': venue } } : {});
    expect(namedVenue({ venue: 'veraitalia' }, req('lasoul'))).toBe('veraitalia');
    expect(namedVenue({ force: true }, req('lasoul'))).toBe('lasoul');
    expect(namedVenue(null, req())).toBeNull();
    expect(namedVenue({ venue: 7 }, req())).toBeNull();
  });

  it('a waiter is removed by an admin of their restaurant, and the sign-in only goes with its last role', () => {
    expect(managesVenue(adminV, V)).toBe(true);
    expect(managesVenue(adminV, L)).toBe(false);
    expect(managesVenue(mixLV, L)).toBe(false);
    expect(managesVenue(owner, L) && managesVenue(owner, V)).toBe(true);
    expect(managesVenue(waiter, L)).toBe(false);
    const gone = { userId: WAITER_L, callerId: ADMIN_L };
    expect(mayRemoveLogin({ ...gone, roles: 0, waiters: 0 })).toBe(true);
    // Still an admin (or a waiter) somewhere: the sign-in stays.
    expect(mayRemoveLogin({ ...gone, roles: 1, waiters: 0 })).toBe(false);
    expect(mayRemoveLogin({ ...gone, roles: 0, waiters: 1 })).toBe(false);
    // A count that could not be read is not zero.
    expect(mayRemoveLogin({ ...gone, roles: null, waiters: 0 })).toBe(false);
    expect(mayRemoveLogin({ roles: 0, waiters: 0, userId: ADMIN_L, callerId: ADMIN_L })).toBe(false);
  });

  it('every function decides through it, and none falls back to La Soul or to both menus', () => {
    const create = source('supabase/functions/create-waiter/index.ts');
    expect(create).toContain('resolveAdminVenue(callerRoles, namedVenue(body, req)');
    expect(create).not.toMatch(/DEFAULT_VENUE_ID|a5000000-0000-4000-8000-000000000001/);

    const remove = source('supabase/functions/delete-waiter/index.ts');
    expect(remove).toMatch(/\.eq\('user_id', waiter\.user_id\)\.eq\('venue_id', waiter\.venue_id\)\.eq\('role', 'staff'\)/);
    expect(remove).not.toMatch(/user_roles'\)\.delete\(\)\.eq\('user_id', waiter\.user_id\);/);
    expect(remove).toContain('mayRemoveLogin(');

    const translate = source('supabase/functions/translate-menu/index.ts');
    for (const table of ['categories', 'subcategories', 'menu_items']) {
      expect(translate).toMatch(new RegExp(`from\\("${table}"\\)\\.select\\([^)]*\\)\\.eq\\("venue_id", venueId\\)`));
    }
    expect(translate).toContain('.eq("id", target.row.id).eq("venue_id", venueId)');
    expect(translate).toContain('overwrite = force && body.overwrite === true && restaurant.owner');

    const images = source('supabase/functions/migrate-images/index.ts');
    expect(images).toContain('.eq("venue_id", restaurant.venueId)');
    expect(images).toContain('`${restaurant.slug}/${row.id}.${ext}`');

    // The app sends the restaurant it shows (AdminWaiters.tsx:105 sent the
    // owner's stored pick, nothing before one — so La Soul on Vera's site).
    expect(source('src/pages/admin/AdminWaiters.tsx')).toContain('venue: shownVenueSlug()');
    expect(source('src/pages/admin/AdminMenu.tsx')).toMatch(/'translate-menu', \{ body: \{ force, venue: shownVenueSlug\(\) \} \}/);
    expect(source('src/pages/admin/AdminMenu.tsx')).toMatch(/'migrate-images', \{ body: \{ venue: shownVenueSlug\(\) \} \}/);
  });

  describe('the restaurant an admin page shows', () => {
    const store = new Map<string, string>();
    beforeEach(() => {
      store.clear();
      vi.stubGlobal('localStorage', {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => { store.set(k, v); },
        removeItem: (k: string) => { store.delete(k); },
      });
      vi.stubGlobal('location', { pathname: '/admin/waiters' });
    });
    afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules(); });

    it('is the owner’s pick, else this site’s own restaurant — never nothing', async () => {
      const lasoulSite = await import('@/lib/current-venue');
      expect(lasoulSite.shownVenueSlug()).toBe('lasoul');
      lasoulSite.chooseStaffVenue('veraitalia');
      expect(lasoulSite.shownVenueSlug()).toBe('veraitalia');

      // Vera Italia's own site, before the owner has picked anything: the
      // admin shows Vera Italia, and that is what a new waiter joins.
      store.clear();
      vi.stubEnv('VITE_HOME_VENUE', 'veraitalia');
      vi.resetModules();
      const veraSite = await import('@/lib/current-venue');
      expect(veraSite.staffVenue()).toBeNull();
      expect(veraSite.shownVenueSlug()).toBe('veraitalia');
    });
  });
});

// ---------------------------------------------------------------------

describe('3. menu photos: a restaurant’s folder is its admin’s', () => {
  beforeEach(async () => {
    await db.exec(`INSERT INTO storage.objects(bucket_id, name) VALUES
      ('menu-images', 'lasoul/old.webp'), ('menu-images', 'veraitalia/old.webp'), ('menu-images', 'legacy.webp')`);
  });

  const upload = (user: string, name: string) =>
    as(user, () => db.query(`INSERT INTO storage.objects(bucket_id, name) VALUES ('menu-images', $1)`, [name]));
  const remove = (user: string, name: string) =>
    as(user, () => affected(`DELETE FROM storage.objects WHERE bucket_id = 'menu-images' AND name = $1`, [name]));
  const replace = (user: string, name: string, to = name) =>
    as(user, () => affected(`UPDATE storage.objects SET name = $2 WHERE bucket_id = 'menu-images' AND name = $1`, [name, to]));
  const REFUSED = /row-level security|row level security/;

  it('uploads go into the uploader’s own restaurant’s folder', async () => {
    await upload(ADMIN_V, 'veraitalia/new.webp');
    await upload(ADMIN_L, 'lasoul/new.webp');
    await upload(MIX_LV, 'veraitalia/mix.webp');
    await expect(upload(ADMIN_V, 'lasoul/evil.webp')).rejects.toThrow(REFUSED);
    await expect(upload(ADMIN_L, 'veraitalia/evil.webp')).rejects.toThrow(REFUSED);
    await expect(upload(MIX_LV, 'lasoul/evil.webp')).rejects.toThrow(REFUSED);
    await expect(upload(ADMIN_V, 'evil.webp')).rejects.toThrow(REFUSED);
    await expect(upload(ADMIN_V, 'nowhere/evil.webp')).rejects.toThrow(REFUSED);
    await expect(upload(WAITER_V, 'veraitalia/evil.webp')).rejects.toThrow(REFUSED);
    await expect(asGuest(() => db.query(`INSERT INTO storage.objects(bucket_id, name) VALUES ('menu-images', 'veraitalia/x.webp')`)))
      .rejects.toThrow(REFUSED);
  });

  it('a restaurant’s admin changes and removes only their own folder’s files; the old root files are the owner’s', async () => {
    expect(await remove(ADMIN_V, 'lasoul/old.webp')).toBe(0);
    expect(await remove(MIX_LV, 'lasoul/old.webp')).toBe(0);
    expect(await remove(ADMIN_L, 'veraitalia/old.webp')).toBe(0);
    expect(await remove(ADMIN_V, 'legacy.webp')).toBe(0);
    expect(await replace(ADMIN_L, 'legacy.webp')).toBe(0);
    expect(await replace(ADMIN_V, 'lasoul/old.webp')).toBe(0);
    // Nor move their own file into the other restaurant's folder.
    await expect(replace(ADMIN_V, 'veraitalia/old.webp', 'lasoul/moved.webp')).rejects.toThrow(REFUSED);

    expect(await replace(ADMIN_L, 'lasoul/old.webp')).toBe(1);
    expect(await remove(ADMIN_V, 'veraitalia/old.webp')).toBe(1);
    // The owner: the root and both folders.
    expect(await remove(SUPER, 'legacy.webp')).toBe(1);
    expect(await remove(SUPER, 'lasoul/old.webp')).toBe(1);
    await upload(SUPER, 'veraitalia/owner.webp');
    await upload(SUPER, 'root.webp');
  });

  it('reading stays as it was: public addresses, no listing for guests, managers see their own', async () => {
    expect(await one(`SELECT public AS r FROM storage.buckets WHERE id = 'menu-images'`)).toBe(true);
    expect((await asGuest(() => db.query(`SELECT name FROM storage.objects`))).rows).toEqual([]);
    const seen = (user: string) => as(user, async () =>
      (await db.query<{ name: string }>(`SELECT name FROM storage.objects ORDER BY 1`)).rows.map((r) => r.name));
    expect(await seen(ADMIN_V)).toEqual(['veraitalia/old.webp']);
    expect(await seen(ADMIN_L)).toEqual(['lasoul/old.webp']);
    expect(await seen(WAITER_L)).toEqual([]);
    expect(await seen(SUPER)).toEqual(['lasoul/old.webp', 'legacy.webp', 'veraitalia/old.webp']);
  });

  it('the menu editor uploads into the restaurant’s folder', () => {
    const dialog = source('src/components/admin/MenuItemDialog.tsx');
    expect(dialog).toContain('const path = `${await menuImageFolder()}${crypto.randomUUID()}.${ext}`;');
    expect(dialog).toContain("supabase.rpc('current_venue' as never)");
  });
});

// ---------------------------------------------------------------------

describe('4. readers follow the restaurant being shown', () => {
  const venues = async (user: string, sql: string, header: string | null = null) => {
    await showing(header);
    try {
      return venuesOf(await as(user, async () => (await db.query<{ venue_id: string | null }>(sql)).rows));
    } finally {
      await showing(null);
    }
  };

  it('analytics: each restaurant’s staff their own; the owner the restaurant they look at', async () => {
    await db.exec(`INSERT INTO public.analytics_events(visit_id, event, props, occurred_at, venue_id) VALUES
      ('l', 'menu_viewed', '{}', now(), '${L}'), ('v', 'menu_viewed', '{}', now(), '${V}'),
      ('old', 'menu_viewed', '{}', now(), NULL)`);
    const sql = `SELECT venue_id FROM public.analytics_events`;
    expect(await venues(WAITER_V, sql)).toEqual([V]);
    expect(await venues(WAITER_V, sql, 'lasoul')).toEqual([V]);
    expect(await venues(ADMIN_L, sql, 'veraitalia')).toEqual(['none', L].sort());
    expect(await venues(ADMIN_V, sql, 'lasoul')).toEqual([V]);
    expect(await venues(SUPER, sql)).toEqual(['none', L].sort());
    expect(await venues(SUPER, sql, 'veraitalia')).toEqual([V]);
    // Works at both: the one shown.
    expect(await venues(MIX_LV, sql, 'lasoul')).toEqual(['none', L].sort());
    expect(await venues(MIX_LV, sql, 'veraitalia')).toEqual([V]);
    expect(await venues(NEWCOMER, sql)).toEqual([]);
  });

  it('guest profiles — both restaurants’ spend added together — are the owner’s alone', async () => {
    await db.exec(`INSERT INTO public.guest_profiles(client_id, first_seen, last_seen, visits, orders, net_spend)
      VALUES ('phone-a', now(), now(), 2, 2, 40)`);
    const count = (user: string) => as(user, async () => Number(await one(`SELECT count(*)::int AS r FROM public.guest_profiles`)));
    expect(await count(WAITER_V)).toBe(0);
    expect(await count(ADMIN_L)).toBe(0);
    expect(await count(MIX_LV)).toBe(0);
    expect(await count(SUPER)).toBe(1);
  });

  it('the suggestion counters: staff of their dish’s restaurant', async () => {
    const orderL = await paidOrder(L);
    const orderV = await paidOrder(V);
    await db.exec(`
      INSERT INTO public.suggestion_stats(source_item_id, recommended_item_id, placement, shown, accepted) VALUES
        ('${DISH_L}', '${DISH_L2}', 'cart', 10, 2), ('${DISH_V}', '${DISH_V2}', 'cart', 10, 3);
      INSERT INTO public.suggestion_conversions(order_id, recommended_item_id, placement, line_total) VALUES
        ('${orderL}', '${DISH_L2}', 'cart', 5), ('${orderV}', '${DISH_V2}', 'cart', 6);
      INSERT INTO public.menu_item_affinity(item_a, item_b, pair_orders, a_orders, confidence, lift) VALUES
        ('${DISH_L}', '${DISH_L2}', 3, 4, 0.75, 1.5), ('${DISH_V}', '${DISH_V2}', 3, 4, 0.75, 1.5);
    `);
    // Which restaurant each row's dish is, without leaning on the menu's own rules.
    const VENUE_OF: Record<string, string> = { [DISH_L]: L, [DISH_L2]: L, [DISH_V]: V, [DISH_V2]: V };
    const item = (table: string, col: string) => `SELECT ${col} AS dish FROM public.${table}`;
    const venues = async (user: string, sql: string, header: string | null = null) => {
      await showing(header);
      try {
        return (await as(user, async () => (await db.query<{ dish: string }>(sql)).rows)).map((r) => VENUE_OF[r.dish]).sort();
      } finally {
        await showing(null);
      }
    };
    for (const [table, col] of [['suggestion_stats', 'recommended_item_id'], ['suggestion_conversions', 'recommended_item_id'], ['menu_item_affinity', 'item_a']]) {
      expect(await venues(WAITER_V, item(table, col), 'lasoul')).toEqual([V]);
      expect(await venues(ADMIN_L, item(table, col), 'veraitalia')).toEqual([L]);
      expect(await venues(SUPER, item(table, col), 'veraitalia')).toEqual([V]);
      expect(await venues(SUPER, item(table, col))).toEqual([L]);
      expect(await venues(NEWCOMER, item(table, col))).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------

describe('5. jobs that rewrite both restaurants are the owner’s or the scheduler’s', () => {
  beforeEach(async () => {
    await db.exec(`
      INSERT INTO public.analytics_events(visit_id, event, props, occurred_at, venue_id) VALUES
        ('old-l', 'menu_viewed', '{}', now() - interval '500 days', '${L}'),
        ('old-v', 'menu_viewed', '{}', now() - interval '500 days', '${V}'),
        ('new-l', 'menu_viewed', '{}', now(), '${L}');
      INSERT INTO public.recommendation_decisions(session_id, placement, policy_version, created_at) VALUES
        ('${S_L}', 'cart', 'v1', now() - interval '500 days'), ('${S_V}', 'cart', 'v1', now() - interval '500 days');
    `);
  });
  const events = async () => Number(await one(`SELECT count(*)::int AS r FROM public.analytics_events`));
  const call = (user: string | null, sql: string) => (user ? as(user, () => db.query(sql)) : db.query(sql));

  it('a restaurant’s staff cannot prune both restaurants’ history; the owner can', async () => {
    for (const user of [ADMIN_V, ADMIN_L, WAITER_L, MIX_LV]) {
      await expect(call(user, `SELECT public.prune_analytics_events(120)`)).rejects.toThrow(/Only the owner/);
      await expect(call(user, `SELECT public.prune_recommendation_decisions(120)`)).rejects.toThrow(/Only the owner/);
    }
    await expect(call(NEWCOMER, `SELECT public.prune_analytics_events(120)`)).rejects.toThrow(/Only staff/);
    await expect(call(null, `SELECT public.prune_analytics_events(120)`)).rejects.toThrow(/Only staff/);
    expect(await events()).toBe(3);

    expect(await as(SUPER, () => one(`SELECT public.prune_analytics_events(120) AS r`))).toBe(2);
    expect(await as(SUPER, () => one(`SELECT public.prune_recommendation_decisions(120) AS r`))).toBe(2);
    expect(await events()).toBe(1);
  });

  it('guest profiles and what the suggestions learned are rebuilt by the owner, not a restaurant', async () => {
    for (const user of [ADMIN_V, WAITER_L, MIX_VL]) {
      await expect(call(user, `SELECT public.refresh_guest_profiles()`)).rejects.toThrow(/Only the owner/);
      await expect(call(user, `SELECT public.rebuild_reco_learning(365)`)).rejects.toThrow(/Only the owner/);
    }
    await expect(call(null, `SELECT public.rebuild_reco_learning(365)`)).rejects.toThrow(/Only staff/);
    await as(SUPER, () => db.query(`SELECT public.refresh_guest_profiles()`));
    await as(SUPER, () => db.query(`SELECT public.rebuild_reco_learning(365)`));
  });

  it('a restaurant still refreshes its suggestions, at most once every ten minutes; the owner whenever', async () => {
    const refresh = (user: string) => as(user, () => one<Record<string, unknown>>(`SELECT public.refresh_menu_intelligence() AS r`));
    const first = await refresh(ADMIN_V);
    expect(first!.paced).toBeUndefined();
    const second = await refresh(ADMIN_L);
    expect(second).toMatchObject({ paced: true, refreshed_at: first!.refreshed_at });
    // The staff screens' heartbeat keeps working (it is the scheduler where pg_cron is missing).
    expect(await as(WAITER_V, () => one<{ ran: boolean }>(`SELECT public.maybe_refresh_menu_intelligence() AS r`))).toHaveProperty('ran');
    // The owner is never paced.
    expect((await refresh(SUPER))!.paced).toBeUndefined();
    await expect(call(NEWCOMER, `SELECT public.refresh_menu_intelligence()`)).rejects.toThrow(/Only staff/);
  });

  it('the nightly job is the scheduler’s, and covers both restaurants', async () => {
    for (const user of [SUPER, ADMIN_L, WAITER_V]) {
      await expect(call(user, `SELECT public.run_daily_maintenance()`)).rejects.toThrow(/scheduler/);
    }
    await expect(call(null, `SELECT public.run_daily_maintenance()`)).rejects.toThrow(/Only staff/);
    // What pg_cron runs.
    const night = await one<{ ran: boolean; analytics_events_pruned: number }>(`SELECT public.run_scheduled_maintenance() AS r`);
    expect(night).toMatchObject({ ran: true, analytics_events_pruned: 2 });
    expect(await events()).toBe(1);
  });

  it('an outside scheduler with the service role key still runs it', async () => {
    await db.query(`SELECT set_config('request.jwt.claim.role', 'service_role', false)`);
    try {
      expect(await one<{ ran: boolean }>(`SELECT public.run_daily_maintenance() AS r`)).toMatchObject({ ran: true });
    } finally {
      await db.query(`SELECT set_config('request.jwt.claim.role', '', false)`);
    }
  });
});

// ---------------------------------------------------------------------

describe('7. the audit log is the restaurant’s being shown', () => {
  it('each restaurant’s admin their own; the owner the restaurant they look at, never both mixed', async () => {
    await db.exec(`INSERT INTO public.audit_log(venue_id, action, entity_type) VALUES
      ('${L}', 'test.lasoul', 'x'), ('${V}', 'test.vera', 'x'), (NULL, 'test.before', 'x')`);
    const seen = async (user: string, header: string | null = null) => {
      await showing(header);
      try {
        return venuesOf(await as(user, async () => (await db.query<{ venue_id: string | null }>(`SELECT venue_id FROM public.audit_log`)).rows));
      } finally {
        await showing(null);
      }
    };
    expect(await seen(ADMIN_V)).toEqual([V]);
    expect(await seen(ADMIN_V, 'lasoul')).toEqual([V]);
    expect(await seen(ADMIN_L, 'veraitalia')).toEqual(['none', L].sort());
    expect(await seen(SUPER)).toEqual(['none', L].sort());
    expect(await seen(SUPER, 'veraitalia')).toEqual([V]);
    expect(await seen(WAITER_L)).toEqual([]);
    // Waits at La Soul, manages Vera Italia: Vera's log only.
    expect(await seen(MIX_LV)).toEqual([V]);
    expect(await seen(MIX_LV, 'lasoul')).toEqual([]);
  });

  it('the page says which restaurant each entry is', () => {
    const page = source('src/pages/admin/AdminAudit.tsx');
    expect(page).toContain('{venueNameOf(row)}');
  });
});

// ---------------------------------------------------------------------

describe('8. live updates follow the restaurant shown', () => {
  const ownerRows = [{ role: 'admin', venue_id: null }];
  const mixRows = [{ role: 'staff', venue_id: L }, { role: 'admin', venue_id: V }];

  it('knows when the socket cannot see the restaurant on screen', () => {
    // The owner, looking at Vera Italia: the screens show Vera, the socket hears La Soul.
    expect(venueLens(ownerRows, 'veraitalia')).toEqual({ shown: V, socket: L });
    expect(venueLens(ownerRows, 'lasoul')).toEqual({ shown: L, socket: L });
    expect(venueLens(ownerRows, null)).toEqual({ shown: L, socket: L });
    // A waiter or a restaurant's admin: their own, whatever the page asks.
    expect(venueLens([{ role: 'staff', venue_id: V }], 'lasoul')).toEqual({ shown: V, socket: V });
    expect(venueLens([{ role: 'admin', venue_id: L }], 'veraitalia')).toEqual({ shown: L, socket: L });
    // Works at both, shown the one they only wait at.
    expect(venueLens(mixRows, 'lasoul')).toEqual({ shown: L, socket: V });
    expect(venueLens(mixRows, null)).toEqual({ shown: V, socket: V });
    // A database from before the second restaurant: one restaurant, live.
    expect(venueLens([{ role: 'admin' }], 'veraitalia')).toEqual({ shown: L, socket: L });
  });

  describe('the shared channel', () => {
    let invalidate: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
      vi.useFakeTimers();
      sb.handlers.clear();
      sb.state.userId = null;
      sb.state.roles = [];
      const client = new QueryClient();
      invalidate = vi.spyOn(client, 'invalidateQueries').mockResolvedValue();
      realtime.acquire(client);
      sb.state.status?.('SUBSCRIBED');
      invalidate.mockClear();
    });
    afterEach(() => {
      realtime.release();
      vi.useRealTimers();
      vi.unstubAllGlobals();
    });
    const emit = (table: string, row: Record<string, unknown> | null, eventType = 'INSERT') =>
      sb.handlers.get(table)?.({ eventType, new: row ?? {}, old: {} });

    it('drops the other restaurant’s changes: no chime, no refetch', async () => {
      realtime.setLens({ shown: V, socket: V });
      const heard: string[] = [];
      const off = realtime.onEvent((table) => heard.push(table));
      emit('orders', { id: 'a', venue_id: L });
      emit('orders', { id: 'b', venue_id: V });
      emit('tables', null, 'DELETE'); // only the key: cannot tell, so it counts
      off();
      expect(heard).toEqual(['orders', 'tables']);
      expect(realtime.followsByPolling()).toBe(false);
    });

    it('polls every few seconds where the socket cannot see the restaurant, and hears nothing of La Soul', async () => {
      realtime.setLens({ shown: V, socket: L });
      const heard: string[] = [];
      const ticks: string[] = [];
      const offEvent = realtime.onEvent((table) => heard.push(table));
      const offRefresh = realtime.onRefresh((reason) => ticks.push(reason));
      emit('orders', { id: 'a', venue_id: L });
      expect(heard).toEqual([]);
      expect(realtime.followsByPolling()).toBe(true);
      await vi.advanceTimersByTimeAsync(5_100);
      expect(ticks).toContain('poll');
      expect(invalidate).toHaveBeenCalled();
      offEvent();
      offRefresh();
    });

    it('works it out from the signed-in account and the restaurant picked', async () => {
      realtime.release();
      const store = new Map([['lasoul.staff-venue', 'veraitalia']]);
      vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: () => undefined, removeItem: () => undefined });
      vi.stubGlobal('location', { pathname: '/admin/orders' });
      sb.state.userId = SUPER;
      sb.state.roles = ownerRows;
      realtime.acquire(new QueryClient());
      await vi.advanceTimersByTimeAsync(0);
      expect(realtime.followsByPolling()).toBe(true);
      // Looking at La Soul instead: the socket is enough.
      realtime.release();
      store.set('lasoul.staff-venue', 'lasoul');
      realtime.acquire(new QueryClient());
      await vi.advanceTimersByTimeAsync(0);
      expect(realtime.followsByPolling()).toBe(false);
    });
  });

  it('the admin’s orders, tables and tonight pages use it instead of a channel of their own', () => {
    for (const page of ['AdminOrders', 'AdminTables', 'AdminFloorTonight']) {
      const text = source(`src/pages/admin/${page}.tsx`);
      expect(text).toContain('useStaffTables(');
      expect(text).not.toContain("postgres_changes");
    }
  });
});

// ---------------------------------------------------------------------

describe('9. the offline menu is kept per restaurant', () => {
  const token = (sub: string | null) => {
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
    return `${b64({ alg: 'HS256' })}.${b64(sub ? { sub, role: 'authenticated' } : { role: 'anon' })}.sig`;
  };
  const request = (venue: string | null, sub: string | null = null) => new Request(
    'https://x.supabase.co/rest/v1/menu_items?select=*&order=sort_order', {
      headers: { authorization: `Bearer ${token(sub)}`, ...(venue ? { 'x-venue': venue } : {}) },
    });

  it('two restaurants’ menus at one address are two cache entries', async () => {
    const lasoul = await menuDataCacheKey({ request: request('lasoul') });
    const vera = await menuDataCacheKey({ request: request('veraitalia') });
    const none = await menuDataCacheKey({ request: request(null) });
    expect(new Set([lasoul, vera, none]).size).toBe(3);
    expect(await menuDataCacheKey({ request: request('veraitalia') })).toBe(vera);
    // A signed-in waiter's answer is not a guest's, even with the same header.
    expect(await menuDataCacheKey({ request: request('veraitalia', WAITER_L) })).not.toBe(vera);
    expect(new URL(vera).pathname).toBe('/rest/v1/menu_items');
  });

  it('is self-contained, as the service worker receives it', async () => {
    const standalone = new Function(`return (${menuDataCacheKey.toString()})`)() as typeof menuDataCacheKey;
    expect(await standalone({ request: request('veraitalia', SUPER) }))
      .toBe(await menuDataCacheKey({ request: request('veraitalia', SUPER) }));
    const config = source('vite.config.ts');
    expect(config).toContain('plugins: [{ cacheKeyWillBeUsed: menuDataCacheKey }]');
    expect(config).toContain('cacheName: "menu-data-by-venue"');
  });

  it('the requests themselves are unchanged: everyone gets the menu of the page they are on', async () => {
    const cats = async (who: string | null, header: string | null) => {
      await showing(header);
      try {
        const run = async () => (await db.query<{ id: string }>(`SELECT id FROM public.categories`)).rows.map((r) => r.id);
        return who ? await as(who, run) : await asGuest(run);
      } finally {
        await showing(null);
      }
    };
    expect(await cats(null, 'veraitalia')).toEqual([CAT_V]);
    expect(await cats(null, 'lasoul')).toEqual([CAT_L]);
    expect(await cats(null, null)).toEqual([CAT_L]);
    // The menu is public: a signed-in waiter on the other restaurant's menu
    // page gets that menu (20261031100500) — and the cache keeps it apart
    // from what the same address gave a guest, by the session in the key.
    expect(await cats(WAITER_V, 'lasoul')).toEqual([CAT_L]);
    expect(await cats(WAITER_V, null)).toEqual([CAT_V]);
    expect(await cats(ADMIN_L, 'veraitalia')).toEqual([CAT_V]);
    expect(await cats(ADMIN_L, null)).toEqual([CAT_L]);
    expect(await cats(SUPER, 'veraitalia')).toEqual([CAT_V]);
    expect(await cats(SUPER, null)).toEqual([CAT_L]);
  });
});

// ---------------------------------------------------------------------

describe('11. the small ones', () => {
  it('experiment_srm answers only staff of the experiment’s restaurant', async () => {
    await db.exec(`INSERT INTO public.experiments(id, name, policy_version, holdout_pct, venue_id) VALUES
      ('90000000-0000-0000-0000-00000000000a', 'L', 'v1', 10, '${L}'),
      ('90000000-0000-0000-0000-00000000000b', 'V', 'v1', 10, '${V}')`);
    const srm = (user: string, exp: string) => as(user, () => one(`SELECT public.experiment_srm($1) AS r`, [exp]));
    const EXP_L = '90000000-0000-0000-0000-00000000000a';
    const EXP_V = '90000000-0000-0000-0000-00000000000b';
    await expect(srm(WAITER_V, EXP_L)).rejects.toThrow(/Only staff/);
    await expect(srm(ADMIN_L, EXP_V)).rejects.toThrow(/Only staff/);
    await expect(srm(NEWCOMER, EXP_V)).rejects.toThrow(/Only staff/);
    expect(await srm(WAITER_V, EXP_V)).toMatchObject({ checked: false });
    expect(await srm(ADMIN_L, EXP_L)).toMatchObject({ checked: false });
    expect(await srm(SUPER, EXP_L)).toMatchObject({ checked: false });
    expect(await srm(SUPER, EXP_V)).toMatchObject({ checked: false });
  });

  it('get_waiter_id: not without signing in, and only about your own restaurant’s staff', async () => {
    expect(await one(`SELECT has_function_privilege('anon', 'public.get_waiter_id(uuid)', 'EXECUTE') AS r`)).toBe(false);
    const ask = (user: string, about: string) => as(user, () => one(`SELECT public.get_waiter_id($1) AS r`, [about]));
    expect(await ask(WAITER_L, WAITER_L)).toBe(W_L);
    expect(await ask(ADMIN_L, WAITER_L)).toBe(W_L);
    expect(await ask(WAITER_V, WAITER_L)).toBeNull();
    expect(await ask(ADMIN_V, WAITER_L)).toBeNull();
    expect(await ask(SUPER, WAITER_V)).toBe(W_V);
  });

  it('the app names the restaurant the database answers for, for every account and every page', async () => {
    expect(workplaceVenueId([{ role: 'staff', venue_id: L }, { role: 'admin', venue_id: V }])).toBe(V);
    expect(answeredVenueId([{ role: 'admin', venue_id: null }], V, L)).toBe(V);
    for (const user of [WAITER_L, WAITER_V, ADMIN_L, ADMIN_V, MIX_LV, MIX_VL, SUPER]) {
      const rows = (await db.query<{ role: string; venue_id: string | null }>(
        `SELECT role::text AS role, venue_id FROM public.user_roles WHERE user_id = $1 ORDER BY id`, [user])).rows;
      for (const header of [null, 'lasoul', 'veraitalia']) {
        await showing(header);
        const database = await as(user, () => one<string>(`SELECT public.current_venue() AS r`));
        await showing(null);
        expect({ user, header, app: venueOfRoles(rows, header)?.dbId }).toEqual({ user, header, app: database });
      }
    }
  });
});

// ---------------------------------------------------------------------
// The evening simulation's findings (20261031100500_service_separation.sql;
// the whole service is in two-restaurants-evening.test.ts).
// ---------------------------------------------------------------------

describe('what the evening found', () => {
  const EXP_L = '90000000-0000-0000-0000-00000000001a';
  const EXP_V = '90000000-0000-0000-0000-00000000001b';
  const DEC_L = '91000000-0000-0000-0000-00000000000a';
  const DEC_V = '91000000-0000-0000-0000-00000000000b';

  it('the suggestion ledger — decisions, sightings, hold-out assignments — is read per restaurant', async () => {
    await db.exec(`
      INSERT INTO public.experiments(id, name, policy_version, holdout_pct, venue_id) VALUES
        ('${EXP_L}', 'L', 'v1', 10, '${L}'), ('${EXP_V}', 'V', 'v1', 10, '${V}');
      INSERT INTO public.recommendation_decisions(id, session_id, placement, policy_version) VALUES
        ('${DEC_L}', '${S_L}', 'cart', 'v1'), ('${DEC_V}', '${S_V}', 'cart', 'v1');
      INSERT INTO public.recommendation_impressions(decision_id) VALUES ('${DEC_L}'), ('${DEC_V}');
      INSERT INTO public.session_experiment_assignment(session_id, experiment_id, arm) VALUES
        ('${S_L}', '${EXP_L}', 'treatment'), ('${S_V}', '${EXP_V}', 'holdout');
    `);
    const read = async (user: string, header: string | null) => {
      await showing(header);
      try {
        return await as(user, async () => ({
          decisions: (await db.query<{ id: string }>(`SELECT id FROM public.recommendation_decisions`)).rows.map((r) => r.id),
          sightings: (await db.query<{ id: string }>(`SELECT decision_id AS id FROM public.recommendation_impressions`)).rows.map((r) => r.id),
          assigned: (await db.query<{ id: string }>(`SELECT session_id AS id FROM public.session_experiment_assignment`)).rows.map((r) => r.id),
        }));
      } finally {
        await showing(null);
      }
    };
    const vera = { decisions: [DEC_V], sightings: [DEC_V], assigned: [S_V] };
    const laSoul = { decisions: [DEC_L], sightings: [DEC_L], assigned: [S_L] };
    expect(await read(WAITER_V, 'lasoul')).toEqual(vera);
    expect(await read(ADMIN_L, 'veraitalia')).toEqual(laSoul);
    expect(await read(MIX_LV, null)).toEqual(vera);
    expect(await read(SUPER, 'veraitalia')).toEqual(vera);
    expect(await read(SUPER, null)).toEqual(laSoul);
    expect(await read(NEWCOMER, 'lasoul')).toEqual({ decisions: [], sightings: [], assigned: [] });
  });

  it('a new table joins its own restaurant’s hold-out, never the other’s', async () => {
    // Only La Soul runs one.
    await db.exec(`INSERT INTO public.experiments(id, name, policy_version, holdout_pct, venue_id) VALUES ('${EXP_L}', 'L', 'v1', 50, '${L}')`);
    const sit = async (table: string) => (await db.query<{ id: string }>(
      `INSERT INTO public.table_sessions(table_id, token, is_active, last_heartbeat_at) VALUES ($1, $2, false, now()) RETURNING id`,
      [table, crypto.randomUUID()])).rows[0].id;
    const experimentOf = async (session: string) =>
      one<string>(`SELECT experiment_id AS r FROM public.session_experiment_assignment WHERE session_id = $1`, [session]);
    for (let i = 0; i < 4; i += 1) {
      expect(await experimentOf(await sit(T_V))).toBeUndefined();
      expect(await experimentOf(await sit(T_L))).toBe(EXP_L);
    }
  });

  it('a signed-in waiter on the other restaurant’s menu page sees that menu — and still none of its staff data', async () => {
    await paidOrder(L);
    await paidOrder(V);
    await showing('lasoul');
    try {
      const seen = await as(WAITER_V, async () => ({
        menu: [...new Set((await db.query<{ venue_id: string }>(`SELECT venue_id FROM public.menu_items`)).rows.map((r) => r.venue_id))],
        search: (await db.query<{ name: string }>(`SELECT name FROM public.guest_search_menu('Burger')`)).rows.map((r) => r.name),
        orders: [...new Set((await db.query<{ venue_id: string }>(`SELECT venue_id FROM public.orders`)).rows.map((r) => r.venue_id))],
        tables: [...new Set((await db.query<{ venue_id: string }>(`SELECT venue_id FROM public.tables`)).rows.map((r) => r.venue_id))],
        sections: [...new Set((await db.query<{ venue_id: string }>(`SELECT venue_id FROM public.sections`)).rows.map((r) => r.venue_id))],
      }));
      expect({ ...seen, search: seen.search.sort() })
        .toEqual({ menu: [L], search: ['Fries', 'La Soul Burger'], orders: [V], tables: [V], sections: [V] });
      // Seeing La Soul's menu is not editing it.
      expect(await as(WAITER_V, () => affected(`UPDATE public.menu_items SET price = 1 WHERE id = $1`, [DISH_L]))).toBe(0);
      expect(await as(ADMIN_V, () => affected(`UPDATE public.menu_items SET price = 1 WHERE id = $1`, [DISH_L]))).toBe(0);
    } finally {
      await showing(null);
    }
  });

  it('staff calls on the other restaurant’s rows are refused before they say anything', async () => {
    const order = await paidOrder(V);
    for (const [user, fn, args] of [
      [WAITER_L, `public.record_table_payment($1, 'cash', NULL)`, [order]],
      [WAITER_L, `public.staff_update_order_status($1, 'ready')`, [order]],
      [WAITER_L, `public.staff_release_held_order($1)`, [order]],
      [WAITER_L, `public.staff_close_session($1)`, [S_V]],
      [WAITER_L, `public.staff_mark_session_seen($1)`, [S_V]],
      [ADMIN_L, `public.record_order_refund($1, 1, 'cash', 'x', true, NULL)`, [order]],
    ] as const) {
      await expect(as(user, () => db.query(`SELECT ${fn}`, [...args])), fn).rejects.toThrow(/do not work at this restaurant/);
    }
    // The owner, switched to La Soul, records Vera Italia's refund under Vera Italia.
    await showing('lasoul');
    await as(SUPER, () => db.query(`SELECT public.record_order_refund($1, 1, 'cash', 'chipped', true, NULL)`, [order]));
    await showing(null);
    expect(await one(`SELECT venue_id AS r FROM public.audit_log WHERE action = 'refund.completed' AND entity_id = $1`, [order])).toBe(V);
  });
});
