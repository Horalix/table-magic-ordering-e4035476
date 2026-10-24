/**
 * @vitest-environment node
 *
 * What a guest is offered on the first night, before there is any history.
 *
 * These read like a waiter's habits on purpose: if one of them fails, the
 * question to ask is "would a good waiter at La Soul say this?", not "which
 * weight moved".
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

const MIGRATION = readFileSync(
  path.join(__dirname, '..', 'migrations', '20261024180000_house_pairings.sql'), 'utf8');

const SUB = {
  burgers: 'bbbbbbbb-0000-0000-0000-000000000001',
  fries: 'bbbbbbbb-0000-0000-0000-000000000002',
  breakfast: 'bbbbbbbb-0000-0000-0000-000000000003',
  coffee: 'bbbbbbbb-0000-0000-0000-000000000004',
  other: 'bbbbbbbb-0000-0000-0000-000000000005',
  lemonade: 'bbbbbbbb-0000-0000-0000-000000000006',
  juice: 'bbbbbbbb-0000-0000-0000-000000000007',
  desserts: 'bbbbbbbb-0000-0000-0000-000000000008',
};
const ITEM = {
  burger: 'cccccccc-0000-0000-0000-000000000001',
  fries: 'cccccccc-0000-0000-0000-000000000002',
  eggs: 'cccccccc-0000-0000-0000-000000000003',
  cappuccino: 'cccccccc-0000-0000-0000-000000000004',
  espresso: 'cccccccc-0000-0000-0000-000000000005',
  cola: 'cccccccc-0000-0000-0000-000000000006',
  lemonade: 'cccccccc-0000-0000-0000-000000000007',
  orange: 'cccccccc-0000-0000-0000-000000000008',
  croissant: 'cccccccc-0000-0000-0000-000000000009',
  tiramisu: 'cccccccc-0000-0000-0000-000000000010',
};
const TABLE = 'dddddddd-0000-0000-0000-000000000001';
const SESSION = 'eeeeeeee-eeee-eeee-eeee-eeeeeeee0001';

let db: Db;

async function seed() {
  await db.exec(`
    TRUNCATE public.menu_item_recommendations, public.recommendation_impressions, public.recommendation_decisions,
             public.suggestion_stats, public.menu_item_affinity, public.session_item_affinity,
             public.order_items, public.orders, public.table_sessions, public.tables,
             public.menu_items, public.subcategories, public.categories
      RESTART IDENTITY CASCADE;
    UPDATE public.restaurant_settings
       SET recommendations_enabled = true, reco_holdout_pct = 0, reco_exploration = 0
     WHERE id = 1;

    INSERT INTO public.categories(id, name, sort_order) VALUES
      ('aaaaaaaa-0000-0000-0000-000000000001', 'Food', 1),
      ('aaaaaaaa-0000-0000-0000-000000000002', 'Drinks', 2),
      ('aaaaaaaa-0000-0000-0000-000000000003', 'Desserts', 3);
    INSERT INTO public.subcategories(id, category_id, name, sort_order) VALUES
      ('${SUB.burgers}',   'aaaaaaaa-0000-0000-0000-000000000001', 'Burgers', 1),
      ('${SUB.fries}',     'aaaaaaaa-0000-0000-0000-000000000001', 'Fries', 2),
      ('${SUB.breakfast}', 'aaaaaaaa-0000-0000-0000-000000000001', 'Breakfast', 3),
      ('${SUB.coffee}',    'aaaaaaaa-0000-0000-0000-000000000002', 'Coffee', 4),
      ('${SUB.other}',     'aaaaaaaa-0000-0000-0000-000000000002', 'Other', 5),
      ('${SUB.lemonade}',  'aaaaaaaa-0000-0000-0000-000000000002', 'Lemonade', 6),
      ('${SUB.juice}',     'aaaaaaaa-0000-0000-0000-000000000002', 'Fresh Juice', 7),
      ('${SUB.desserts}',  'aaaaaaaa-0000-0000-0000-000000000003', 'Desserts', 8);

    -- Names as they are on the real menu, including the stray leading space.
    INSERT INTO public.menu_items(id, subcategory_id, name, price, is_available, station, meal_role) VALUES
      ('${ITEM.burger}',     '${SUB.burgers}',   'La Soul Burger',     15.50, true, 'kitchen', 'main'),
      ('${ITEM.fries}',      '${SUB.fries}',     'Regular Fries',       5.00, true, 'kitchen', 'side'),
      ('${ITEM.eggs}',       '${SUB.breakfast}', 'Turkish Egg',        14.50, true, 'kitchen', 'main'),
      ('${ITEM.cappuccino}', '${SUB.coffee}',    'Cappucino',           6.00, true, 'bar',     'hot_drink'),
      ('${ITEM.espresso}',   '${SUB.coffee}',    'Espresso',            2.00, true, 'bar',     'hot_drink'),
      ('${ITEM.cola}',       '${SUB.other}',     'Coca-Cola',           3.00, true, 'bar',     'cold_drink'),
      ('${ITEM.lemonade}',   '${SUB.lemonade}',  'Strawberry Lemonade', 7.00, true, 'bar',     'cold_drink'),
      ('${ITEM.orange}',     '${SUB.juice}',     'Fresh Orange Juice',  6.00, true, 'bar',     'cold_drink'),
      ('${ITEM.croissant}',  '${SUB.desserts}',  ' Butter Croissant',   9.00, true, 'kitchen', 'dessert'),
      ('${ITEM.tiramisu}',   '${SUB.desserts}',  'Tiramisu with Espresso Coffee Shot', 11.00, true, 'kitchen', 'dessert');

    INSERT INTO public.tables(id, table_number) VALUES ('${TABLE}', 7);
    INSERT INTO public.table_sessions(id, table_id, token, is_active, guest_name, last_heartbeat_at)
      VALUES ('${SESSION}', '${TABLE}', 'tok', true, 'Amina', now());
  `);
  await db.exec(MIGRATION);
  await actAs(db, null);
}

const suggest = async (cart: string[], placement = 'cart') => {
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM public.rank_recommendations($1::uuid[], $2, 'en', 8, $3::uuid, '{}'::text[])`,
    [cart, placement, SESSION]);
  return rows.map((r) => r.id);
};

describe('house pairings on the first night', () => {
  beforeAll(async () => { db = await createTestDatabase({ quiet: true }); }, 180_000);
  afterAll(async () => { await db?.close(); });
  beforeEach(seed);

  it('offers a cold drink first with a burger, fries close behind', async () => {
    // A guest sees one suggestion at a time. A cart with no drink is the gap
    // the engine is built to notice, so the drink leads; once there is one,
    // the fries do (next test). That is the order a waiter asks in, too.
    const offered = await suggest([ITEM.burger]);
    expect([ITEM.lemonade, ITEM.cola, ITEM.orange]).toContain(offered[0]);
    expect(offered.slice(0, 3)).toContain(ITEM.fries);
    expect(offered).not.toContain(ITEM.cappuccino);
  });

  it('does not offer a second drink to a burger that already has a Coke', async () => {
    const offered = await suggest([ITEM.burger, ITEM.cola]);
    expect(offered[0]).toBe(ITEM.fries);
    expect(offered).not.toContain(ITEM.lemonade);
    expect(offered).not.toContain(ITEM.orange);
  });

  it('pairs breakfast with orange juice and a cappuccino, whatever the hour', async () => {
    const offered = await suggest([ITEM.eggs]);
    expect(offered.slice(0, 2).sort()).toEqual([ITEM.cappuccino, ITEM.orange].sort());
  });

  it('offers a croissant with a coffee on its own', async () => {
    expect((await suggest([ITEM.cappuccino]))[0]).toBe(ITEM.croissant);
  });

  it('offers an espresso with a dessert, and no second dessert', async () => {
    const offered = await suggest([ITEM.tiramisu]);
    expect(offered[0]).toBe(ITEM.espresso);
    expect(offered).not.toContain(ITEM.croissant);
  });

  it('after the meal: the tiramisu with an espresso shot leads', async () => {
    expect((await suggest([], 'after_meal'))[0]).toBe(ITEM.tiramisu);
  });

  it('says which dish a pairing goes with', async () => {
    // So the card can read "Goes with your La Soul Burger".
    const { rows } = await db.query<{ id: string; source_item_id: string | null }>(
      `SELECT id, source_item_id FROM public.rank_recommendations($1::uuid[], 'cart', 'en', 8, $2::uuid, '{}'::text[])`,
      [[ITEM.burger, ITEM.cola], SESSION]);
    expect(rows.find((r) => r.id === ITEM.fries)?.source_item_id).toBe(ITEM.burger);
  });

  it('can be run twice without doubling a rule', async () => {
    await db.exec(MIGRATION);
    const { rows } = await db.query<{ n: number; d: number }>(
      `SELECT count(*)::int AS n,
              count(DISTINCT (COALESCE(source_subcategory_id::text, '') || recommended_item_id::text || recommendation_type))::int AS d
         FROM public.menu_item_recommendations`);
    expect(rows[0].n).toBe(rows[0].d);
  });
});
