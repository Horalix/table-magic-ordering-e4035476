/**
 * @vitest-environment node
 *
 * Deleting from the menu can be undone, and always works
 * (20261105120000_menu_undo.sql).
 *
 * A manager deleted dishes by accident and could not get them back, and could
 * not delete others at all: a dish that has ever been on an order is held by
 * order_items. Delete now puts a dish, a section or a course in the bin. These
 * tests pin that it always succeeds, that guests stop seeing it at once, that
 * order history keeps its name, and that Restore puts back exactly what went.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error -- plain JS harness, no types needed
import { actAs, createTestDatabase } from '../../scripts/db-harness.mjs';

type Db = {
  query: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<{ rows: T[]; affectedRows?: number }>;
  exec: (sql: string) => Promise<unknown>;
  close: () => Promise<void>;
};

const ROOT = path.join(__dirname, '..', '..');
const MIGRATION = path.join(ROOT, 'supabase', 'migrations', '20261105120000_menu_undo.sql');

const L = 'a5000000-0000-4000-8000-000000000001'; // La Soul
const V = 'a5000000-0000-4000-8000-000000000002'; // Vera Italia

const OWNER = '10000000-0000-0000-0000-000000000001';
const ADMIN_L = '10000000-0000-0000-0000-000000000002';
const ADMIN_V = '10000000-0000-0000-0000-000000000003';
const WAITER_L = '10000000-0000-0000-0000-000000000004';

const FOOD = 'c0000000-0000-0000-0000-00000000000a';
const DRINKS = 'c0000000-0000-0000-0000-00000000000c';
const BURGERS = 'd0000000-0000-0000-0000-00000000000a';
const SIDES = 'd0000000-0000-0000-0000-00000000001a';
const COFFEE = 'd0000000-0000-0000-0000-00000000000c';
const BURGER = 'e0000000-0000-0000-0000-00000000000a';
const SLIDER = 'e0000000-0000-0000-0000-00000000001a';
const FRIES = 'e0000000-0000-0000-0000-00000000002a';
const STRIPS = 'e0000000-0000-0000-0000-00000000003a';
const ARABIC_COFFEE = 'e0000000-0000-0000-0000-00000000000c';

const CAT_V = 'c0000000-0000-0000-0000-00000000000b';
const SUB_V = 'd0000000-0000-0000-0000-00000000000b';
const PIZZA = 'e0000000-0000-0000-0000-00000000000b';

const T_L = '30000000-0000-0000-0000-00000000000a';
const S_L = '40000000-0000-0000-0000-00000000000a';

let db: Db;

beforeAll(async () => {
  db = (await createTestDatabase({ quiet: true })) as unknown as Db;
  // Applying it a second time changes nothing.
  await db.exec(readFileSync(MIGRATION, 'utf8'));
  await db.exec(`
    -- What Supabase grants by default; the access rules decide the rest.
    GRANT USAGE ON SCHEMA public TO anon, authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
    GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;
  `);
}, 240_000);
afterAll(async () => { await db?.close(); });

beforeEach(async () => {
  await db.exec(`
    TRUNCATE public.audit_log, public.order_ticket_events, public.order_items, public.orders,
             public.table_sessions, public.tables, public.menu_combo_options, public.menu_combo_slots,
             public.menu_items, public.subcategories, public.categories, public.order_code_counters
      RESTART IDENTITY CASCADE;
    DELETE FROM public.user_roles;
    DELETE FROM auth.users;
    UPDATE public.restaurant_settings SET ordering_enabled = true, online_card_enabled = false, menu_only = false;

    INSERT INTO auth.users(id) VALUES ('${OWNER}'), ('${ADMIN_L}'), ('${ADMIN_V}'), ('${WAITER_L}');
    INSERT INTO public.user_roles(user_id, role, venue_id) VALUES
      ('${OWNER}', 'admin', NULL), ('${ADMIN_L}', 'admin', '${L}'), ('${ADMIN_V}', 'admin', '${V}'),
      ('${WAITER_L}', 'staff', '${L}');

    INSERT INTO public.categories(id, name, sort_order, venue_id) VALUES
      ('${FOOD}', 'Food', 1, '${L}'), ('${DRINKS}', 'Drinks', 2, '${L}'), ('${CAT_V}', 'Cucina', 1, '${V}');
    INSERT INTO public.subcategories(id, category_id, name, sort_order) VALUES
      ('${BURGERS}', '${FOOD}', 'Burgers', 1), ('${SIDES}', '${FOOD}', 'Sides', 2),
      ('${COFFEE}', '${DRINKS}', 'Coffee', 1), ('${SUB_V}', '${CAT_V}', 'Pizze', 1);
    INSERT INTO public.menu_items(id, subcategory_id, name, price, is_available, station) VALUES
      ('${BURGER}', '${BURGERS}', 'La Soul Burger', 16.50, true, 'kitchen'),
      ('${SLIDER}', '${BURGERS}', 'Grilled Chicken Slider', 10.00, false, 'kitchen'),
      ('${FRIES}', '${SIDES}', 'La Soul Fries', 9.00, true, 'kitchen'),
      ('${STRIPS}', '${SIDES}', 'Chicken Strips', 7.00, true, 'kitchen'),
      ('${ARABIC_COFFEE}', '${COFFEE}', 'Arabic Coffee White', 15.00, true, 'bar'),
      ('${PIZZA}', '${SUB_V}', 'Pizza Margherita', 14.00, true, 'kitchen');

    INSERT INTO public.tables(id, table_number, venue_id) VALUES ('${T_L}', 7, '${L}');
    INSERT INTO public.table_sessions(id, table_id, token, is_active, guest_name, last_heartbeat_at)
      VALUES ('${S_L}', '${T_L}', 'tok-l', true, 'Amina', now());
  `);
  await actAs(db, null);
  await showing('lasoul');
});

/** The app names the restaurant it shows in x-venue; the bin also asks for deleted rows. */
function showing(slug: string | null, extra: Record<string, string> = {}) {
  const headers = { ...(slug ? { 'x-venue': slug } : {}), ...extra };
  return db.query(`SELECT set_config('request.headers', $1, false)`, [JSON.stringify(headers)]);
}

/** Run as a signed-in user, under the access rules. */
async function as<T>(user: string, run: () => Promise<T>): Promise<T> {
  await actAs(db, user);
  await db.exec('SET ROLE authenticated');
  try { return await run(); } finally { await db.exec('RESET ROLE'); await actAs(db, null); }
}

/** Run as a guest, under the access rules. */
async function asGuest<T>(run: () => Promise<T>): Promise<T> {
  await db.exec('SET ROLE anon');
  try { return await run(); } finally { await db.exec('RESET ROLE'); }
}

const del = (user: string, kind: string, id: string) =>
  as(user, async () => (await db.query<{ r: Record<string, unknown> }>(`SELECT public.admin_delete_menu_entry($1, $2) AS r`, [kind, id])).rows[0].r);
const restore = (user: string, kind: string, id: string) =>
  as(user, async () => (await db.query<{ r: Record<string, unknown> }>(`SELECT public.admin_restore_menu_entry($1, $2) AS r`, [kind, id])).rows[0].r);

const names = (rows: { name: string }[]) => rows.map((r) => r.name).sort();
const guestDishes = () => asGuest(async () => names((await db.query<{ name: string }>(`SELECT name FROM public.menu_items`)).rows));
const guestSections = () => asGuest(async () => names((await db.query<{ name: string }>(`SELECT name FROM public.subcategories`)).rows));
const guestCourses = () => asGuest(async () => names((await db.query<{ name: string }>(`SELECT name FROM public.categories`)).rows));
const dish = async (id: string) =>
  (await db.query<{ deleted_at: string | null; is_available: boolean; available_before_delete: boolean | null }>(
    `SELECT deleted_at, is_available, available_before_delete FROM public.menu_items WHERE id = $1`, [id])).rows[0];

/** An order for the burger, so order_items holds it, as on any dish that has ever sold. */
async function orderBurger() {
  await db.query(
    `SELECT public.guest_place_order($1, 'tok-l', 'Amina', 'cash', $2::jsonb, 0, '9f0e8d7c-6b5a-4c3d-2e1f-0a9b8c7d6e51')`,
    [S_L, JSON.stringify([{ menu_item_id: BURGER, quantity: 2 }])],
  );
  const { rows } = await db.query<{ n: string }>(`SELECT count(*) AS n FROM public.order_items WHERE menu_item_id = $1`, [BURGER]);
  expect(Number(rows[0].n)).toBe(1);
}

describe('deleting a dish', () => {
  it('works even when the dish is on past orders, which a real delete refuses', async () => {
    await orderBurger();
    await expect(db.query(`DELETE FROM public.menu_items WHERE id = $1`, [BURGER])).rejects.toThrow(/foreign key/);

    const r = await del(ADMIN_L, 'item', BURGER);
    expect(r.name).toBe('La Soul Burger');
    expect(r.already).toBe(false);
    expect(await guestDishes()).not.toContain('La Soul Burger');
    // The order keeps its line.
    const { rows } = await db.query<{ n: string }>(`SELECT count(*) AS n FROM public.order_items WHERE menu_item_id = $1`, [BURGER]);
    expect(Number(rows[0].n)).toBe(1);
  });

  it('is marked unavailable too, so suggestions and orders skip it, and search does not find it', async () => {
    await del(ADMIN_L, 'item', BURGER);
    const d = await dish(BURGER);
    expect(d.is_available).toBe(false);
    expect(d.available_before_delete).toBe(true);
    const found = await asGuest(async () =>
      names((await db.query<{ name: string }>(`SELECT name FROM public.guest_search_menu('la soul')`)).rows));
    expect(found).toEqual(['La Soul Fries']);
    await expect(db.query(
      `SELECT public.guest_place_order($1, 'tok-l', 'Amina', 'cash', $2::jsonb, 0, '9f0e8d7c-6b5a-4c3d-2e1f-0a9b8c7d6e52')`,
      [S_L, JSON.stringify([{ menu_item_id: BURGER, quantity: 1 }])],
    )).rejects.toThrow(/Unavailable|No available/);
  });

  it('is undone by Restore, sold out again if it was sold out', async () => {
    await del(ADMIN_L, 'item', BURGER);
    await del(ADMIN_L, 'item', SLIDER);
    await restore(ADMIN_L, 'item', BURGER);
    await restore(ADMIN_L, 'item', SLIDER);
    expect(await dish(BURGER)).toMatchObject({ deleted_at: null, is_available: true, available_before_delete: null });
    expect(await dish(SLIDER)).toMatchObject({ deleted_at: null, is_available: false });
    expect(await guestDishes()).toContain('La Soul Burger');
  });

  it('twice, or restoring twice, changes nothing', async () => {
    const first = await del(ADMIN_L, 'item', BURGER);
    const again = await del(ADMIN_L, 'item', BURGER);
    expect(again.already).toBe(true);
    expect(again.deleted_at).toBe(first.deleted_at);
    await restore(ADMIN_L, 'item', BURGER);
    expect((await restore(ADMIN_L, 'item', BURGER)).already).toBe(true);
    expect(await dish(BURGER)).toMatchObject({ deleted_at: null, is_available: true });
  });
});

describe('who sees deleted dishes', () => {
  it('a signed-in admin looking at the menu sees what guests see', async () => {
    await del(ADMIN_L, 'item', BURGER);
    const seen = await as(ADMIN_L, async () => names((await db.query<{ name: string }>(`SELECT name FROM public.menu_items`)).rows));
    expect(seen).not.toContain('La Soul Burger');
  });

  it('the restaurant’s staff see them when they ask: the bin, and the names on past orders', async () => {
    await orderBurger();
    await del(ADMIN_L, 'item', BURGER);
    await showing('lasoul', { 'x-menu-deleted': 'show' });
    const forWaiter = await as(WAITER_L, async () =>
      (await db.query<{ name: string }>(
        `SELECT mi.name FROM public.order_items oi JOIN public.menu_items mi ON mi.id = oi.menu_item_id`)).rows);
    expect(names(forWaiter)).toEqual(['La Soul Burger']);
    const bin = await as(ADMIN_L, async () =>
      names((await db.query<{ name: string }>(`SELECT name FROM public.menu_items WHERE deleted_at IS NOT NULL`)).rows));
    expect(bin).toEqual(['La Soul Burger']);
  });

  it('guests never do, even when they ask', async () => {
    await del(ADMIN_L, 'item', BURGER);
    await showing('lasoul', { 'x-menu-deleted': 'show' });
    expect(await guestDishes()).not.toContain('La Soul Burger');
  });

  it('the other restaurant’s admin does not see this one’s bin', async () => {
    await del(ADMIN_L, 'item', BURGER);
    await showing('lasoul', { 'x-menu-deleted': 'show' });
    const seen = await as(ADMIN_V, async () =>
      names((await db.query<{ name: string }>(`SELECT name FROM public.menu_items WHERE deleted_at IS NOT NULL`)).rows));
    expect(seen).toEqual([]);
  });
});

describe('who may delete and restore', () => {
  it('this restaurant’s admin and the owner; not the other restaurant’s admin, a waiter or a guest', async () => {
    await expect(del(ADMIN_V, 'item', BURGER)).rejects.toThrow(/admin/);
    await expect(del(WAITER_L, 'item', BURGER)).rejects.toThrow(/admin/);
    await expect(asGuest(() => db.query(`SELECT public.admin_delete_menu_entry('item', $1)`, [BURGER]))).rejects.toThrow(/permission denied/);
    expect((await dish(BURGER)).deleted_at).toBeNull();

    await del(OWNER, 'item', BURGER);
    await expect(restore(ADMIN_V, 'item', BURGER)).rejects.toThrow(/admin/);
    await expect(restore(WAITER_L, 'item', BURGER)).rejects.toThrow(/admin/);
    await restore(ADMIN_L, 'item', BURGER);
    expect((await dish(BURGER)).deleted_at).toBeNull();
  });

  it('writes who did it in the audit log, under the dish’s restaurant', async () => {
    await del(ADMIN_L, 'item', BURGER);
    await restore(ADMIN_L, 'item', BURGER);
    const { rows } = await db.query<{ action: string; actor_user_id: string; venue_id: string }>(
      `SELECT action, actor_user_id, venue_id FROM public.audit_log ORDER BY created_at, action`);
    expect(rows.map((r) => r.action).sort()).toEqual(['menu.item.deleted', 'menu.item.restored']);
    expect(rows.every((r) => r.actor_user_id === ADMIN_L && r.venue_id === L)).toBe(true);
  });

  it('refuses an unknown kind and a dish that does not exist', async () => {
    await expect(del(ADMIN_L, 'table', BURGER)).rejects.toThrow(/Unknown kind/);
    await expect(del(ADMIN_L, 'item', '00000000-0000-0000-0000-000000000000')).rejects.toThrow(/no longer exists/);
  });
});

describe('deleting a section or a course', () => {
  it('a section goes with its dishes, even ones on past orders', async () => {
    await orderBurger();
    const r = await del(ADMIN_L, 'subcategory', BURGERS);
    expect(r.items).toBe(2);
    expect(await guestSections()).not.toContain('Burgers');
    expect(await guestDishes()).toEqual(['Arabic Coffee White', 'Chicken Strips', 'La Soul Fries']);
  });

  it('restoring a section brings back what went with it, not a dish deleted on its own before', async () => {
    await del(ADMIN_L, 'item', STRIPS);
    await del(ADMIN_L, 'subcategory', SIDES);
    await restore(ADMIN_L, 'subcategory', SIDES);
    expect(await guestSections()).toContain('Sides');
    expect(await guestDishes()).toContain('La Soul Fries');
    expect(await guestDishes()).not.toContain('Chicken Strips');
  });

  it('a course goes with its sections and dishes, and comes back the same way', async () => {
    const r = await del(ADMIN_L, 'category', FOOD);
    expect(r).toMatchObject({ subcategories: 2, items: 4 });
    expect(await guestCourses()).toEqual(['Drinks']);
    expect(await guestDishes()).toEqual(['Arabic Coffee White']);

    await restore(ADMIN_L, 'category', FOOD);
    expect(await guestCourses()).toEqual(['Drinks', 'Food']);
    // The slider is sold out: on the menu, crossed out, as before.
    expect(await guestDishes()).toEqual(['Arabic Coffee White', 'Chicken Strips', 'Grilled Chicken Slider', 'La Soul Burger', 'La Soul Fries']);
    expect((await dish(SLIDER)).is_available).toBe(false);
  });

  it('restoring one dish from a deleted course brings back its section and course, not the rest', async () => {
    await del(ADMIN_L, 'category', FOOD);
    await restore(ADMIN_L, 'item', FRIES);
    expect(await guestCourses()).toEqual(['Drinks', 'Food']);
    expect(await guestSections()).toEqual(['Coffee', 'Sides']);
    expect(await guestDishes()).toEqual(['Arabic Coffee White', 'La Soul Fries']);
  });

  it('a deleted combo choice is no longer offered', async () => {
    await db.exec(`
      INSERT INTO public.menu_combo_slots(id, combo_item_id, label, sort_order, venue_id)
        VALUES ('f1000000-0000-0000-0000-000000000001', '${BURGER}', 'Side', 1, '${L}');
      INSERT INTO public.menu_combo_options(slot_id, item_id, surcharge, sort_order, venue_id) VALUES
        ('f1000000-0000-0000-0000-000000000001', '${FRIES}', 0, 1, '${L}'),
        ('f1000000-0000-0000-0000-000000000001', '${STRIPS}', 1, 2, '${L}');
    `);
    await del(ADMIN_L, 'item', STRIPS);
    const combos = await asGuest(async () =>
      (await db.query<{ c: { slots: { options: { name: string }[] }[] }[] }>(`SELECT public.guest_get_combos() AS c`)).rows[0].c);
    expect(combos[0].slots[0].options.map((o) => o.name)).toEqual(['La Soul Fries']);
  });
});

describe('the nine La Soul dishes deleted on 5 November (20261105120100)', () => {
  const NINE = path.join(ROOT, 'supabase', 'migrations', '20261105120100_la_soul_deleted_dishes_to_bin.sql');
  const SHOPSKA = 'e5cb4265-b20c-4040-bb35-0a590ca91976';

  /** La Soul's real courses and sections, as the live menu had them. */
  async function laSoulSections() {
    const fixture = JSON.parse(readFileSync(path.join(ROOT, 'supabase', 'tests', 'fixtures', 'la-soul-menu-2026-10-24.json'), 'utf8')) as {
      categories: { id: string; name: string; sort_order: number }[];
      subcategories: { id: string; category_id: string; name: string; sort_order: number }[];
    };
    await db.exec(`TRUNCATE public.menu_items, public.subcategories, public.categories RESTART IDENTITY CASCADE;`);
    for (const c of fixture.categories) {
      await db.query(`INSERT INTO public.categories(id, name, sort_order, venue_id) VALUES ($1, $2, $3, $4)`, [c.id, c.name, c.sort_order, L]);
    }
    for (const s of fixture.subcategories) {
      await db.query(`INSERT INTO public.subcategories(id, category_id, name, sort_order) VALUES ($1, $2, $3, $4)`, [s.id, s.category_id, s.name, s.sort_order]);
    }
  }

  it('puts all nine in La Soul’s bin, unseen by guests, as they were', async () => {
    await laSoulSections();
    await db.exec(readFileSync(NINE, 'utf8'));
    const { rows } = await db.query<{ name: string; is_available: boolean; available_before_delete: boolean; deleted_at: string; venue_id: string }>(
      `SELECT name, is_available, available_before_delete, deleted_at, venue_id FROM public.menu_items ORDER BY name`);
    expect(rows.map((r) => r.name)).toEqual([
      'Arabic Coffee White', 'Chicken Strips', 'Chicken Strips Combo', 'Grilled Chicken Slider', 'La Soul Fries',
      'Mozzarella Sticks', 'Mozzarella Sticks Combo', 'Puff Truffle Egg', 'Shopska Salad',
    ]);
    expect(rows.every((r) => !r.is_available && r.available_before_delete && r.deleted_at && r.venue_id === L)).toBe(true);
    expect(await guestDishes()).toEqual([]);

    const shopska = (await db.query<{ name_bs: string; name_ar: string; price: string; description: string }>(
      `SELECT name_bs, name_ar, price, description FROM public.menu_items WHERE id = $1`, [SHOPSKA])).rows[0];
    expect(shopska).toMatchObject({ name_bs: 'Šopska salata', name_ar: 'سلطة شوبسكا' });
    expect(Number(shopska.price)).toBe(11);
    expect(shopska.description).toMatch(/^Diced tomato, yellow bell pepper/);
  });

  it('one tap on Restore puts a dish back on the menu; the rest stay in the bin', async () => {
    await laSoulSections();
    await db.exec(readFileSync(NINE, 'utf8'));
    await restore(ADMIN_L, 'item', SHOPSKA);
    expect(await guestDishes()).toEqual(['Shopska Salad']);
    expect((await dish(SHOPSKA)).is_available).toBe(true);
  });

  it('running it again changes nothing, and it never touches a restored dish', async () => {
    await laSoulSections();
    await db.exec(readFileSync(NINE, 'utf8'));
    await restore(ADMIN_L, 'item', SHOPSKA);
    await db.exec(readFileSync(NINE, 'utf8'));
    const { rows } = await db.query<{ n: string }>(`SELECT count(*) AS n FROM public.menu_items`);
    expect(Number(rows[0].n)).toBe(9);
    expect(await guestDishes()).toEqual(['Shopska Salad']);
  });

  it('adds nothing where La Soul’s sections are not there', async () => {
    await db.exec(readFileSync(NINE, 'utf8'));
    const { rows } = await db.query<{ n: string }>(
      `SELECT count(*) AS n FROM public.menu_items WHERE id = $1`, [SHOPSKA]);
    expect(Number(rows[0].n)).toBe(0);
  });
});
