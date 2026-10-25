/**
 * @vitest-environment node
 *
 * Promotions at the till: what a guest is charged for a dish on sale and for
 * a combo, decided by the server at the moment the order is placed.
 *
 * The load-bearing tests are `charges the sale price only inside its window`
 * and `refuses the order when the screen showed a different price`: together
 * they are the promise that the guest pays exactly what they were shown, and
 * that the restaurant never gives a discount it did not mean to.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error -- plain JS harness, no types needed
import { createTestDatabase, actAs } from '../../scripts/db-harness.mjs';

type Db = {
  query: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
  exec: (sql: string) => Promise<unknown>;
  close: () => Promise<void>;
};

let db: Db;

const SESSION = 'eeeeeeee-0000-0000-0000-000000000001';
const TOKEN = 'sess-token-7';
const ADMIN = '0a0a0a0a-0000-4000-8000-000000000001';
const STAFF = '0a0a0a0a-0000-4000-8000-000000000002';

const BURGER = 'cccccccc-0000-0000-0000-000000000001';
const CHEESEBURGER = 'cccccccc-0000-0000-0000-000000000002';
const FRIES = 'cccccccc-0000-0000-0000-000000000003';
const CHEESE_FRIES = 'cccccccc-0000-0000-0000-000000000004';
const COLA = 'cccccccc-0000-0000-0000-000000000005';
const LEMONADE = 'cccccccc-0000-0000-0000-000000000006';
const COMBO = 'cccccccc-0000-0000-0000-000000000010';
const KIDS = 'cccccccc-0000-0000-0000-000000000011';

const SLOT_BURGER = 'f0000000-0000-4000-8000-000000000001';
const SLOT_SIDE = 'f0000000-0000-4000-8000-000000000002';
const SLOT_DRINK = 'f0000000-0000-4000-8000-000000000003';
const KIDS_MAIN = 'f0000000-0000-4000-8000-000000000011';
const KIDS_DRINK = 'f0000000-0000-4000-8000-000000000012';

async function seed() {
  await db.exec(`
    TRUNCATE public.audit_log, public.order_ticket_events, public.suggestion_conversions,
             public.order_items, public.orders,
             public.table_sessions, public.tables, public.menu_combo_options, public.menu_combo_slots,
             public.menu_items, public.subcategories, public.categories, public.order_code_counters
      RESTART IDENTITY CASCADE;
    DELETE FROM public.user_roles;
    DELETE FROM auth.users;
    INSERT INTO auth.users(id) VALUES ('${ADMIN}'), ('${STAFF}');
    INSERT INTO public.user_roles(user_id, role) VALUES ('${ADMIN}', 'admin'), ('${STAFF}', 'staff');

    UPDATE public.restaurant_settings
       SET ordering_enabled = true, online_card_enabled = false, pay_at_table_enabled = true
     WHERE id = 1;

    INSERT INTO public.categories(id, name, sort_order) VALUES
      ('aaaaaaaa-0000-0000-0000-000000000001', 'Food', 1),
      ('aaaaaaaa-0000-0000-0000-000000000002', 'Drinks', 2);
    INSERT INTO public.subcategories(id, category_id, name, sort_order) VALUES
      ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Burgers', 1),
      ('bbbbbbbb-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'Sides', 2),
      ('bbbbbbbb-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000002', 'Soft drinks', 1);
    INSERT INTO public.menu_items(id, subcategory_id, name, name_bs, name_ar, price, is_available, station) VALUES
      ('${BURGER}',       'bbbbbbbb-0000-0000-0000-000000000001', 'La Soul Burger', 'La Soul burger', 'برغر لا سول', 18.00, true, 'kitchen'),
      ('${CHEESEBURGER}', 'bbbbbbbb-0000-0000-0000-000000000001', 'Cheeseburger', 'Čizburger', 'تشيز برغر', 20.00, true, 'kitchen'),
      ('${FRIES}',        'bbbbbbbb-0000-0000-0000-000000000002', 'Fries', 'Pomfrit', 'بطاطس مقلية', 5.00, true, 'kitchen'),
      ('${CHEESE_FRIES}', 'bbbbbbbb-0000-0000-0000-000000000002', 'Cheese fries', 'Pomfrit sa sirom', 'بطاطس بالجبن', 6.50, true, 'kitchen'),
      ('${COLA}',         'bbbbbbbb-0000-0000-0000-000000000003', 'Coca-Cola', 'Coca-Cola', 'كوكا كولا', 4.00, true, 'bar'),
      ('${LEMONADE}',     'bbbbbbbb-0000-0000-0000-000000000003', 'Lemonade', 'Limunada', 'ليموناضة', 5.50, true, 'bar'),
      ('${COMBO}',        'bbbbbbbb-0000-0000-0000-000000000001', 'Burger Combo', 'Burger meni', 'وجبة برغر', 22.00, true, 'kitchen'),
      ('${KIDS}',         'bbbbbbbb-0000-0000-0000-000000000001', 'Kids Combo', 'Dječiji meni', 'وجبة أطفال', 12.00, true, 'kitchen');

    INSERT INTO public.menu_combo_slots(id, combo_item_id, sort_order, label, label_bs, label_ar) VALUES
      ('${SLOT_BURGER}', '${COMBO}', 1, 'Burger', 'Burger', 'البرغر'),
      ('${SLOT_SIDE}',   '${COMBO}', 2, 'Side', 'Prilog', 'الطبق الجانبي'),
      ('${SLOT_DRINK}',  '${COMBO}', 3, 'Drink', 'Piće', 'المشروب'),
      ('${KIDS_MAIN}',   '${KIDS}', 1, 'Burger', 'Burger', 'البرغر'),
      ('${KIDS_DRINK}',  '${KIDS}', 2, 'Drink', 'Piće', 'المشروب');
    INSERT INTO public.menu_combo_options(slot_id, item_id, surcharge, sort_order) VALUES
      ('${SLOT_BURGER}', '${BURGER}', 0, 1),
      ('${SLOT_BURGER}', '${CHEESEBURGER}', 2, 2),
      ('${SLOT_SIDE}',   '${FRIES}', 0, 1),
      ('${SLOT_SIDE}',   '${CHEESE_FRIES}', 1, 2),
      ('${SLOT_DRINK}',  '${COLA}', 0, 1),
      ('${SLOT_DRINK}',  '${LEMONADE}', 1, 2),
      ('${KIDS_MAIN}',   '${BURGER}', 0, 1),
      ('${KIDS_DRINK}',  '${COLA}', 0, 1),
      ('${KIDS_DRINK}',  '${LEMONADE}', 0.50, 2);

    INSERT INTO public.tables(id, table_number) VALUES ('dddddddd-0000-0000-0000-000000000001', 7);
    INSERT INTO public.table_sessions(id, table_id, token, is_active, guest_name) VALUES
      ('${SESSION}', 'dddddddd-0000-0000-0000-000000000001', '${TOKEN}', true, 'Amina');
  `);
  // A test places several orders in a row; the per-minute burst guard is a
  // separate trigger with its own tests.
  await db.exec(`ALTER TABLE public.orders DISABLE TRIGGER trg_enforce_order_limits`);
  await actAs(db, null);
}

type Result = Record<string, unknown>;
type DbError = { message?: string; detail?: string; code?: string };

let keyN = 0;
async function place(items: unknown[]) {
  keyN += 1;
  const key = `00000000-0000-4000-8000-${String(keyN).padStart(12, '0')}`;
  const { rows } = await db.query<{ result: Result }>(
    `SELECT public.guest_place_order($1, $2, 'Amina', 'cash', $3::jsonb, 0, $4) AS result`,
    [SESSION, TOKEN, JSON.stringify(items), key],
  );
  return rows[0].result;
}

async function placeError(items: unknown[]): Promise<DbError> {
  try {
    await place(items);
  } catch (e) {
    return e as DbError;
  }
  throw new Error('expected the order to be refused');
}

type Line = { menu_item_id: string; quantity: number; unit_price: string; regular_unit_price: string; components: unknown };
const lines = async (orderId: unknown) => (await db.query<Line>(
  `SELECT menu_item_id, quantity, unit_price::text, regular_unit_price::text, components
     FROM public.order_items WHERE order_id = $1 ORDER BY created_at, id`, [orderId])).rows;

const orderCount = async () => Number((await db.query<{ n: string }>(`SELECT count(*) AS n FROM public.orders`)).rows[0].n);

const setSale = (id: string, sql: string) => db.exec(`UPDATE public.menu_items SET ${sql} WHERE id = '${id}'`);

const combo = (burger: string, side: string, drink: string, extra: Record<string, unknown> = {}) => ({
  menu_item_id: COMBO,
  quantity: 1,
  choices: [
    { slot_id: SLOT_BURGER, item_id: burger },
    { slot_id: SLOT_SIDE, item_id: side },
    { slot_id: SLOT_DRINK, item_id: drink },
  ],
  ...extra,
});

describe('promotions at the till', () => {
  beforeAll(async () => { db = await createTestDatabase({ quiet: true }); }, 180_000);
  afterAll(async () => { await db?.close(); });
  beforeEach(seed);

  describe('a dish on sale', () => {
    it('charges the sale price only inside its window', async () => {
      await setSale(BURGER, `sale_kind = 'percent', sale_value = 20,
        sale_starts_at = now() - interval '1 hour', sale_ends_at = now() + interval '1 hour', sale_label = 'happy_hour'`);
      const during = await place([{ menu_item_id: BURGER, quantity: 2 }]);
      expect(Number(during.total)).toBe(28.8);
      expect(await lines(during.order_id)).toMatchObject([{ unit_price: '14.40', regular_unit_price: '18.00', components: null }]);

      // Not started yet.
      await setSale(BURGER, `sale_starts_at = now() + interval '1 hour', sale_ends_at = now() + interval '2 hours'`);
      const before = await place([{ menu_item_id: BURGER, quantity: 2 }]);
      expect(Number(before.total)).toBe(36);

      // Already over. The end is exclusive: at sale_ends_at the sale is over.
      await setSale(BURGER, `sale_starts_at = now() - interval '2 hours', sale_ends_at = now()`);
      const after = await place([{ menu_item_id: BURGER, quantity: 2 }]);
      expect(Number(after.total)).toBe(36);
      expect(await lines(after.order_id)).toMatchObject([{ unit_price: '18.00', regular_unit_price: '18.00' }]);
    });

    it('takes a fixed sale price, and ignores one that is not cheaper', async () => {
      await setSale(BURGER, `sale_kind = 'price', sale_value = 15`);
      expect(Number((await place([{ menu_item_id: BURGER, quantity: 1 }])).total)).toBe(15);

      await setSale(BURGER, `sale_value = 19`);
      expect(Number((await place([{ menu_item_id: BURGER, quantity: 1 }])).total)).toBe(18);
    });

    it('rounds a percentage to the cent the way the guest app does', async () => {
      await db.exec(`UPDATE public.menu_items SET price = 4.30, sale_kind = 'percent', sale_value = 15 WHERE id = '${COLA}'`);
      const { rows } = await db.query<{ p: string }>(
        `SELECT public.menu_item_sale_price(mi)::text AS p FROM public.menu_items mi WHERE id = $1`, [COLA]);
      // 4.30 × 0.85 = 3.655 → 3.66 (half away from zero), as in promotions.ts.
      expect(rows[0].p).toBe('3.66');
    });

    it('refuses a sale that makes no sense', async () => {
      await expect(setSale(BURGER, `sale_kind = 'percent', sale_value = 95`)).rejects.toThrow(/menu_items_sale_shape/);
      await expect(setSale(BURGER, `sale_kind = 'percent', sale_value = 12.5`)).rejects.toThrow(/menu_items_sale_shape/);
      await expect(setSale(BURGER, `sale_kind = 'price', sale_value = 10,
        sale_starts_at = now(), sale_ends_at = now() - interval '1 hour'`)).rejects.toThrow(/menu_items_sale_window/);
      await expect(setSale(BURGER, `sale_label = 'ONLY 2 LEFT!'`)).rejects.toThrow(/menu_items_sale_label_key/);
    });

    it('refuses the order when the screen showed a different price', async () => {
      await setSale(BURGER, `sale_kind = 'percent', sale_value = 20`);
      // The cart still shows yesterday's 18.00.
      const err = await placeError([
        { menu_item_id: FRIES, quantity: 1, unit_price_seen: 5 },
        { menu_item_id: BURGER, quantity: 1, unit_price_seen: 18 },
      ]);
      expect(err.message).toBe('Prices changed');
      expect(JSON.parse(err.detail ?? '[]')).toEqual([
        { line: 1, menu_item_id: BURGER, unit_price: 14.4, regular_unit_price: 18 },
      ]);
      expect(await orderCount()).toBe(0);

      // What the guest now sees is what is charged.
      const ok = await place([
        { menu_item_id: FRIES, quantity: 1, unit_price_seen: 5 },
        { menu_item_id: BURGER, quantity: 1, unit_price_seen: 14.4 },
      ]);
      expect(Number(ok.total)).toBe(19.4);
    });

    it('prices an older client that sends no price exactly as before', async () => {
      await setSale(BURGER, `sale_kind = 'price', sale_value = 16`);
      const ok = await place([{ menu_item_id: BURGER, quantity: 1 }]);
      expect(Number(ok.total)).toBe(16);
    });

    it('credits a suggestion with the price actually charged', async () => {
      await setSale(FRIES, `sale_kind = 'price', sale_value = 3.5`);
      const res = await place([
        { menu_item_id: BURGER, quantity: 1 },
        { menu_item_id: FRIES, quantity: 2, from_suggestion: { source_item_id: BURGER, placement: 'item' } },
      ]);
      const { rows } = await db.query<{ line_total: string }>(
        `SELECT line_total::text FROM public.suggestion_conversions WHERE order_id = $1`, [res.order_id]);
      expect(rows).toEqual([{ line_total: '7.00' }]);
    });
  });

  describe('a combo', () => {
    it('is priced with its surcharges and stores what was chosen, station and all', async () => {
      const res = await place([combo(CHEESEBURGER, CHEESE_FRIES, LEMONADE)]);
      expect(Number(res.total)).toBe(26); // 22 + 2 + 1 + 1
      const [line] = await lines(res.order_id);
      expect(line).toMatchObject({ menu_item_id: COMBO, unit_price: '26.00', regular_unit_price: '26.00' });
      expect(line.components).toEqual([
        { slot_label: 'Burger', item_id: CHEESEBURGER, name: 'Cheeseburger', name_bs: 'Čizburger', name_ar: 'تشيز برغر', station: 'kitchen' },
        { slot_label: 'Side', item_id: CHEESE_FRIES, name: 'Cheese fries', name_bs: 'Pomfrit sa sirom', name_ar: 'بطاطس بالجبن', station: 'kitchen' },
        { slot_label: 'Drink', item_id: LEMONADE, name: 'Lemonade', name_bs: 'Limunada', name_ar: 'ليموناضة', station: 'bar' },
      ]);
    });

    it('takes the combo off its sale price and adds surcharges on top', async () => {
      await setSale(COMBO, `sale_kind = 'price', sale_value = 19`);
      const res = await place([combo(BURGER, FRIES, LEMONADE, { quantity: 2 })]);
      expect(Number(res.total)).toBe(40); // (19 + 1) × 2
      expect(await lines(res.order_id)).toMatchObject([{ unit_price: '20.00', regular_unit_price: '23.00', quantity: 2 }]);
    });

    it('rejects a choice that is not on offer in its slot', async () => {
      const err = await placeError([combo(BURGER, COLA, LEMONADE)]);
      expect(err.message).toMatch(/Invalid combo choice: Burger Combo/);
      expect(err.code).toBe('P0002');
      expect(JSON.parse(err.detail ?? '[]')).toEqual([COMBO]);
      expect(await orderCount()).toBe(0);
    });

    it('rejects a missing choice, a slot chosen twice, and a slot from another combo', async () => {
      const missing = await placeError([{ menu_item_id: COMBO, quantity: 1, choices: [
        { slot_id: SLOT_BURGER, item_id: BURGER }, { slot_id: SLOT_SIDE, item_id: FRIES },
      ] }]);
      expect(missing.message).toMatch(/Invalid combo choice: Burger Combo \(Drink\)/);

      const twice = await placeError([{ ...combo(BURGER, FRIES, COLA), choices: [
        { slot_id: SLOT_BURGER, item_id: BURGER }, { slot_id: SLOT_BURGER, item_id: CHEESEBURGER },
        { slot_id: SLOT_SIDE, item_id: FRIES }, { slot_id: SLOT_DRINK, item_id: COLA },
      ] }]);
      expect(twice.message).toMatch(/Invalid combo choice/);

      const foreign = await placeError([{ ...combo(BURGER, FRIES, COLA), choices: [
        ...combo(BURGER, FRIES, COLA).choices, { slot_id: KIDS_DRINK, item_id: COLA },
      ] }]);
      expect(foreign.message).toMatch(/Invalid combo choice/);
      expect(await orderCount()).toBe(0);
    });

    it('fills a slot that has only one dish by itself', async () => {
      const res = await place([{ menu_item_id: KIDS, quantity: 1, choices: [{ slot_id: KIDS_DRINK, item_id: LEMONADE }] }]);
      expect(Number(res.total)).toBe(12.5);
      const [line] = await lines(res.order_id);
      expect((line.components as { name: string }[]).map((c) => c.name)).toEqual(['La Soul Burger', 'Lemonade']);
    });

    it('refuses a combo whose chosen drink has sold out, and names the combo line', async () => {
      await db.exec(`UPDATE public.menu_items SET is_available = false WHERE id = '${LEMONADE}'`);
      const err = await placeError([combo(BURGER, FRIES, LEMONADE)]);
      expect(err.message).toMatch(/Unavailable: Lemonade \(Burger Combo\)/);
      expect(err.code).toBe('P0002');
      expect(JSON.parse(err.detail ?? '[]')).toEqual([COMBO]);
      // Another drink still works.
      expect(Number((await place([combo(BURGER, FRIES, COLA)])).total)).toBe(22);
    });

    it('refuses choices sent for a dish that is not a combo', async () => {
      const err = await placeError([{ menu_item_id: BURGER, quantity: 1, choices: [{ slot_id: SLOT_DRINK, item_id: COLA }] }]);
      expect(err.message).toMatch(/Invalid combo choice: La Soul Burger/);
    });

    it('checks the price seen against the price with surcharges', async () => {
      const err = await placeError([combo(CHEESEBURGER, FRIES, COLA, { unit_price_seen: 22 })]);
      expect(err.message).toBe('Prices changed');
      expect(JSON.parse(err.detail ?? '[]')[0]).toMatchObject({ line: 0, unit_price: 24 });
      expect(Number((await place([combo(CHEESEBURGER, FRIES, COLA, { unit_price_seen: 24 })])).total)).toBe(24);
    });

    it('keeps what was ordered: components cannot be rewritten afterwards', async () => {
      const res = await place([combo(BURGER, FRIES, COLA)]);
      await expect(db.exec(`UPDATE public.order_items SET components = '[]'::jsonb WHERE order_id = '${res.order_id}'`))
        .rejects.toThrow(/cannot be re-priced/);
    });

    it('is listed for guests with its slots and choices', async () => {
      const { rows } = await db.query<{ c: { combo_item_id: string; slots: { label: string; options: { item_id: string; surcharge: number; station: string }[] }[] }[] }>(
        `SELECT public.guest_get_combos() AS c`);
      const burgerCombo = rows[0].c.find((c) => c.combo_item_id === COMBO)!;
      expect(burgerCombo.slots.map((s) => s.label)).toEqual(['Burger', 'Side', 'Drink']);
      expect(burgerCombo.slots[2].options.map((o) => [o.item_id, Number(o.surcharge), o.station]))
        .toEqual([[COLA, 0, 'bar'], [LEMONADE, 1, 'bar']]);
    });
  });

  describe('who can change promotions', () => {
    it('lets guests read combos but never write them', async () => {
      await db.exec('SET ROLE anon');
      try {
        const { rows } = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM public.menu_combo_options`);
        expect(rows[0].n).toBe('9');
        const combos = await db.query<{ c: unknown[] }>(`SELECT public.guest_get_combos() AS c`);
        expect(combos.rows[0].c).toHaveLength(2);
        await expect(db.exec(`INSERT INTO public.menu_combo_slots(combo_item_id, label) VALUES ('${BURGER}', 'Free stuff')`))
          .rejects.toThrow(/row-level security|permission denied/);
        await expect(db.exec(`UPDATE public.menu_combo_options SET surcharge = 0`))
          .rejects.toThrow(/row-level security|permission denied/);
        await expect(db.query(`SELECT * FROM public.price_order_lines('[]'::jsonb)`)).rejects.toThrow(/permission denied/);
      } finally {
        await db.exec('RESET ROLE');
      }
    });

    it('lets only an admin save a combo, and replaces its parts in one go', async () => {
      const slots = JSON.stringify([
        { label: 'Main', options: [{ item_id: CHEESEBURGER, surcharge: 0 }] },
        { label: 'Drink', label_bs: 'Piće', options: [{ item_id: COLA }, { item_id: LEMONADE, surcharge: '1.5' }] },
      ]);
      await actAs(db, STAFF);
      await expect(db.query(`SELECT public.admin_save_combo($1, $2::jsonb)`, [COMBO, slots])).rejects.toThrow(/Admin only/);

      await actAs(db, ADMIN);
      await db.query(`SELECT public.admin_save_combo($1, $2::jsonb)`, [COMBO, slots]);
      await actAs(db, null);

      const { rows } = await db.query<{ label: string; label_bs: string | null; items: string }>(`
        SELECT s.label, s.label_bs, string_agg(o.item_id::text || ':' || o.surcharge::text, ',' ORDER BY o.sort_order) AS items
          FROM public.menu_combo_slots s JOIN public.menu_combo_options o ON o.slot_id = s.id
         WHERE s.combo_item_id = $1 GROUP BY s.id ORDER BY s.sort_order`, [COMBO]);
      expect(rows).toEqual([
        { label: 'Main', label_bs: null, items: `${CHEESEBURGER}:0.00` },
        { label: 'Drink', label_bs: 'Piće', items: `${COLA}:0.00,${LEMONADE}:1.50` },
      ]);
    });

    it('refuses a combo inside a combo, and an empty part', async () => {
      await actAs(db, ADMIN);
      await expect(db.query(`SELECT public.admin_save_combo($1, $2::jsonb)`,
        [COMBO, JSON.stringify([{ label: 'Kids', options: [{ item_id: KIDS }] }])])).rejects.toThrow(/inside another combo/);
      await expect(db.query(`SELECT public.admin_save_combo($1, $2::jsonb)`,
        [COMBO, JSON.stringify([{ label: 'Side', options: [] }])])).rejects.toThrow(/at least one dish/);
      // An empty list turns it back into a plain dish.
      await db.query(`SELECT public.admin_save_combo($1, '[]'::jsonb)`, [COMBO]);
      await actAs(db, null);
      expect(Number((await place([{ menu_item_id: COMBO, quantity: 1 }])).total)).toBe(22);
    });

    it('keeps at most one featured dish per slot on the home screen', async () => {
      await setSale(BURGER, `featured_rank = 1, featured_note = 'Our classic'`);
      await expect(setSale(FRIES, 'featured_rank = 1')).rejects.toThrow(/menu_items_featured_rank_key/);
      await expect(setSale(FRIES, 'featured_rank = 4')).rejects.toThrow(/menu_items_featured_rank_range/);
    });
  });

  it('a second run of the ordering rewrite changes nothing', async () => {
    const sql = readFileSync(path.join(__dirname, '..', 'migrations', '20261026100100_promotions_ordering.sql'), 'utf8');
    await db.exec(sql);
    await setSale(BURGER, `sale_kind = 'percent', sale_value = 50`);
    expect(Number((await place([{ menu_item_id: BURGER, quantity: 1 }])).total)).toBe(9);
  });
});

/**
 * The live database's copy of guest_place_order was created by a runner that
 * drops SQL comments. A rewrite that only matched the repository's text once
 * stopped a whole batch in production; this applies the rewrite to a copy
 * stripped the same way, with its layout squeezed too.
 */
describe('the ordering rewrite on a live-shaped function', () => {
  let live: Db;
  /** guest_place_order as the live runner leaves it: no comments, squeezed spaces. */
  let liveShaped = '';
  const definition = async () => (await live.query<{ d: string }>(`
    SELECT pg_get_functiondef(p.oid) AS d FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'guest_place_order'`)).rows[0].d;
  const rewrite = () => readFileSync(path.join(__dirname, '..', 'migrations', '20261026100100_promotions_ordering.sql'), 'utf8');

  beforeAll(async () => {
    live = await createTestDatabase({ quiet: true, until: '20261026100100' });
    liveShaped = (await definition())
      .replace(/\r\n/g, '\n')
      .split('\n').filter((l) => !/^\s*--/.test(l)).join('\n')
      .replace(/ {2,}/g, ' ');
  }, 180_000);
  afterAll(async () => { await live?.close(); });

  it('fails loudly, changing nothing, when the text it needs has drifted', async () => {
    const drifted = liveShaped.replace('round(sum(mi.price * r.quantity)::numeric, 2)', 'round(sum(mi.price * r.quantity * 1)::numeric, 2)');
    expect(drifted).not.toBe(liveShaped);
    await live.exec(drifted);
    await expect(live.exec(rewrite())).rejects.toThrow(/rewrite \(a\): order total found 0 times/);
    expect(await definition()).toContain('mi.price * r.quantity * 1');
  });

  it('matches without comments and with different whitespace', async () => {
    expect(liveShaped).not.toMatch(/Attribution\. Priced/);
    await live.exec(liveShaped);
    await live.exec(rewrite());

    const after = await definition();
    expect(after).toContain('FROM public.price_order_lines(_items) pl');
    expect(after).toContain('public.menu_item_unit_price(mi)');
    expect(after).not.toMatch(/mi\.price \* r\.quantity/);
  });
});
