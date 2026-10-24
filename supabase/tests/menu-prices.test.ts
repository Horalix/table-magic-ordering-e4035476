/**
 * @vitest-environment node
 *
 * The October 2026 price list.
 *
 * The load-bearing test is `leaves a price an admin changed by hand alone`:
 * a migration that blindly overwrote prices would undo whatever the restaurant
 * set in Admin -> Menu between this file being written and Lovable applying it.
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
  path.join(__dirname, '..', 'migrations', '20261024120000_menu_prices_and_new_items.sql'), 'utf8');

const AMERICANO = '19828d06-5910-45eb-9744-27df058c99ed';
const ESPRESSO = 'a0000000-0000-0000-0000-00000000e5e5';
const HAND_ADDED = '0b6e1d2e-8f1c-4c0e-b0f2-6a7c1a2b3c4d';

let db: Db;

async function seed() {
  await db.exec(`
    TRUNCATE public.audit_log, public.order_ticket_events, public.order_items, public.orders,
             public.table_sessions, public.tables,
             public.menu_items, public.subcategories, public.categories, public.order_code_counters
      RESTART IDENTITY CASCADE;

    INSERT INTO public.categories(id, name, sort_order) VALUES
      ('aaaaaaaa-0000-0000-0000-000000000001', 'Drinks', 0),
      ('aaaaaaaa-0000-0000-0000-000000000002', 'Food', 1),
      ('aaaaaaaa-0000-0000-0000-000000000003', 'Desserts', 2);
    INSERT INTO public.subcategories(id, category_id, name, sort_order) VALUES
      ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Coffee', 0),
      ('bbbbbbbb-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'Filter Coffee', 1),
      ('bbbbbbbb-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000002', 'Burgers', 0),
      ('bbbbbbbb-0000-0000-0000-000000000004', 'aaaaaaaa-0000-0000-0000-000000000003', 'Desserts', 0);
    INSERT INTO public.menu_items(id, subcategory_id, name, price, station) VALUES
      ('${AMERICANO}', 'bbbbbbbb-0000-0000-0000-000000000001', 'Americano', 5.00, 'bar'),
      ('${ESPRESSO}',  'bbbbbbbb-0000-0000-0000-000000000001', 'House Espresso', 2.00, 'bar');
  `);
}

const priceOf = async (id: string) => {
  const { rows } = await db.query<{ price: string }>(`SELECT price FROM public.menu_items WHERE id = $1`, [id]);
  return Number(rows[0]?.price);
};

describe('October 2026 price list', () => {
  beforeAll(async () => { db = await createTestDatabase(); await actAs(db, null); }, 120_000);
  afterAll(async () => { await db?.close(); });
  beforeEach(seed);

  it('moves an item from the old price to the new one', async () => {
    await db.exec(MIGRATION);
    expect(await priceOf(AMERICANO)).toBe(6);
  });

  it('leaves a price an admin changed by hand alone', async () => {
    await db.exec(`UPDATE public.menu_items SET price = 5.50 WHERE id = '${AMERICANO}'`);
    await db.exec(MIGRATION);
    expect(await priceOf(AMERICANO)).toBe(5.5);
  });

  it('does not touch items that are not on the list', async () => {
    await db.exec(MIGRATION);
    expect(await priceOf(ESPRESSO)).toBe(2);
  });

  it('adds the four new dishes under the right subcategories, in three languages', async () => {
    await db.exec(MIGRATION);
    const { rows } = await db.query<{ name: string; sub: string; price: string; name_bs: string; name_ar: string }>(`
      SELECT m.name, s.name AS sub, m.price, m.name_bs, m.name_ar
        FROM public.menu_items m JOIN public.subcategories s ON s.id = m.subcategory_id
       WHERE m.name IN ('Chemex Hot', 'Healthy Beef Burger', 'Healthy Chicken Burger', 'Banana Pudding')
       ORDER BY m.name`);
    expect(rows.map((r) => [r.name, r.sub, Number(r.price)])).toEqual([
      ['Banana Pudding', 'Desserts', 13],
      ['Chemex Hot', 'Filter Coffee', 12],
      ['Healthy Beef Burger', 'Burgers', 18.5],
      ['Healthy Chicken Burger', 'Burgers', 18.5],
    ]);
    expect(rows.every((r) => r.name_bs && r.name_ar)).toBe(true);
  });

  it('can be run twice without duplicating anything', async () => {
    await db.exec(MIGRATION);
    await db.exec(MIGRATION);
    const { rows } = await db.query<{ n: string }>(`SELECT count(*) AS n FROM public.menu_items`);
    expect(Number(rows[0].n)).toBe(6);
    expect(await priceOf(AMERICANO)).toBe(6);
  });

  it('does not add a dish the restaurant already created by hand', async () => {
    await db.exec(`INSERT INTO public.menu_items(id, subcategory_id, name, price, station)
                   VALUES ('${HAND_ADDED}', 'bbbbbbbb-0000-0000-0000-000000000004', 'Banana Pudding', 12.00, 'kitchen')`);
    await db.exec(MIGRATION);
    const { rows } = await db.query<{ n: string }>(
      `SELECT count(*) AS n FROM public.menu_items WHERE name = 'Banana Pudding'`);
    expect(Number(rows[0].n)).toBe(1);
  });
});
