/**
 * @vitest-environment node
 *
 * Unit contribution margin: real costs when recorded, an honest, flagged
 * estimate when not, and never "free" because a cost is missing.
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
// @ts-expect-error -- plain JS harness, no types needed
import { createTestDatabase } from '../../scripts/db-harness.mjs';

type Db = {
  query: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
  exec: (sql: string) => Promise<unknown>;
  close: () => Promise<void>;
};

let db: Db;

describe('menu_unit_margins', () => {
  beforeAll(async () => {
    db = await createTestDatabase({ quiet: true });
    await db.exec(`
      INSERT INTO public.categories(id, name, sort_order) VALUES ('aaaaaaaa-0000-0000-0000-0000000000a1', 'Food', 1);
      INSERT INTO public.subcategories(id, category_id, name, sort_order)
        VALUES ('bbbbbbbb-0000-0000-0000-0000000000b1', 'aaaaaaaa-0000-0000-0000-0000000000a1', 'All', 1);
      INSERT INTO public.menu_items(id, subcategory_id, name, price, is_available, meal_role, food_cost) VALUES
        ('cccccccc-0000-0000-0000-0000000000c1', 'bbbbbbbb-0000-0000-0000-0000000000b1', 'Burger', 15.50, true, 'main', 4.00),
        ('cccccccc-0000-0000-0000-0000000000c2', 'bbbbbbbb-0000-0000-0000-0000000000b1', 'Espresso', 2.00, true, 'hot_drink', NULL),
        ('cccccccc-0000-0000-0000-0000000000c3', 'bbbbbbbb-0000-0000-0000-0000000000b1', 'Mystery', 10.00, true, NULL, NULL);
    `);
  }, 180_000);
  afterAll(async () => { await db?.close(); });

  const row = async (id: string) => (await db.query<{ unit_cost: string; unit_cm: string; cost_estimated: boolean }>(
    'SELECT unit_cost, unit_cm, cost_estimated FROM public.menu_unit_margins() WHERE item_id = $1', [id])).rows[0];

  it('uses a recorded food cost as is', async () => {
    expect(await row('cccccccc-0000-0000-0000-0000000000c1')).toEqual({ unit_cost: '4.00', unit_cm: '11.50', cost_estimated: false });
  });

  it('estimates a missing cost from the role default and says so', async () => {
    const r = await row('cccccccc-0000-0000-0000-0000000000c2');
    expect(Number(r.unit_cost)).toBeCloseTo(0.30, 2); // 15% of 2.00
    expect(r.cost_estimated).toBe(true);
  });

  it('falls back to the "other" share when the item has no role, never to zero', async () => {
    expect(Number((await row('cccccccc-0000-0000-0000-0000000000c3')).unit_cost)).toBeCloseTo(3.0, 2);
  });

  it('follows the owner\'s own percentages', async () => {
    await db.exec(`UPDATE public.restaurant_settings SET default_cost_pct = default_cost_pct || '{"hot_drink":0.5}' WHERE id = 1`);
    expect(Number((await row('cccccccc-0000-0000-0000-0000000000c2')).unit_cm)).toBeCloseTo(1.0, 2);
  });
});
