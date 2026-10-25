/**
 * @vitest-environment node
 *
 * The Bosnian/Arabic translation pass (20261025140000_menu_translations.sql).
 *
 * createTestDatabase() applies the migration to empty tables, where it does
 * nothing. Each test seeds rows with the text the live menu had when the file
 * was written, runs the file again, and checks what moved.
 *
 * The load-bearing test is `keeps a field the owner edited by hand`: a
 * translation fix must never undo what the restaurant typed in Admin -> Menu.
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
  path.join(__dirname, '..', 'migrations', '20261025140000_menu_translations.sql'), 'utf8');

const FOOD = '30f16ea1-33e6-4509-b1fc-1501a6865e7f';
const DRINKS = '386e73f9-e190-4bc5-9be7-2c2f632a44ed';
const FRIES = '4e36b969-10b8-4cf1-a821-54c601ccb532';
const BREAKFAST = 'b5528d1e-d540-4895-af4d-737cd71c533e';
const BURGERS = 'bbb753a5-2123-4a05-a4c5-5cdfc4ab2b78';
const HOT_DRINKS = 'e3fe5627-f5de-44d7-aefb-a68f8327f362';

const CHEESE_FRIES = '78dfd2e2-d8a8-4df6-aa33-c5945daa166d';
const PLATTER = '5a674711-02e2-416e-99de-7fa1e76003aa';
const VOLCANO = 'da5762f6-ed01-432d-861e-52995c2248d8';

let db: Db;

type Item = { name_bs: string | null; name_ar: string | null; description_bs: string | null; description_ar: string | null };
const item = async (id: string) => (await db.query<Item>(
  `SELECT name_bs, name_ar, description_bs, description_ar FROM public.menu_items WHERE id = $1`, [id])).rows[0];

async function seed() {
  await db.exec(`
    TRUNCATE public.audit_log, public.order_ticket_events, public.order_items, public.orders,
             public.table_sessions, public.tables,
             public.menu_items, public.subcategories, public.categories, public.order_code_counters
      RESTART IDENTITY CASCADE;
  `);
  // Live text as of 25 October 2026 (the snapshot the migration was written against).
  await db.query(`INSERT INTO public.categories(id, name, name_bs, name_ar, sort_order) VALUES
      ($1, 'Drinks', 'Pića', 'مشروبات', 0), ($2, 'Food', 'Hrana', 'طعام', 1)`, [DRINKS, FOOD]);
  await db.query(`INSERT INTO public.subcategories(id, category_id, name, name_bs, name_ar, sort_order) VALUES
      ($1, $5, 'Fries', 'Pomfrit', 'بطاطس مقلية', 0),
      ($2, $5, 'Breakfast', 'Doručak', 'إفطار', 0),
      ($3, $5, 'Burgers', 'Burgeri', 'برجر', 0),
      ($4, $6, 'Hot Drinks', 'Topla Pića', 'مشروبات ساخنة', 0)`,
  [FRIES, BREAKFAST, BURGERS, HOT_DRINKS, FOOD, DRINKS]);
  await db.query(`INSERT INTO public.menu_items
      (id, subcategory_id, name, price, station, name_bs, name_ar, description, description_bs, description_ar) VALUES
      ($1, $2, 'Original Cheese Fries', 9, 'kitchen', NULL, NULL,
       'French Fries, Cheese Sauce, Original Sauce, chopped pickle Jalapeno pepper, garnish with spring onion & Sakura mix.', NULL, NULL)`,
  [CHEESE_FRIES, FRIES]);
  await db.query(`INSERT INTO public.menu_items
      (id, subcategory_id, name, price, station, name_bs, name_ar, description, description_bs, description_ar) VALUES
      ($1, $2, 'Breakfast Platter', 25, 'kitchen', 'Doručak plata', 'طبق الإفطار',
       'A combination of mixed cheese in olive oil and herbs, black and green olives, crispy fried falafel, boiled egg, menemen and zaatar labneh served with Pita bread on the side.',
       $3, $4)`,
  [PLATTER, BREAKFAST,
    'Kombinacija miješanog sira u maslinovom ulju i bilju, crnih i zelenih maslina, hrskavo prženog falafela, kuhanog jajeta, menemen i labneh sa za\'atarom, servirano sa pita hljebom sa strane.',
    'مزيج من الأجبان المتنوعة بزيت الزيتون والأعشاب، زيتون أسود وأخضر، فلافل مقلية مقرمشة، بيض مسلوق، بيض بالخضروات ولبنة بالزعتر تقدم مع خبز البيتا على الجانب.']);
  await db.query(`INSERT INTO public.menu_items
      (id, subcategory_id, name, price, station, name_bs, name_ar, description, description_bs, description_ar) VALUES
      ($1, $2, 'Volcano Beef Burger', 16, 'kitchen', 'Volcano Beef Burger', 'برجر لحم البقر البركاني',
       'Beetroot Sesame Bun, Beef patty, sliced cheddar cheese, Volcano sauce, crispy potato floss, tomato, onion.',
       $3, $4)`,
  [VOLCANO, BURGERS,
    'Brioche pecivo od cvekle sa susamom, goveđe pecivo, narezani cheddar sir, Volcano sos, hrskavi krompir flos, paradajz, luk.',
    'خبزة شمندر بالسمسم، شريحة لحم بقري، شرائح جبنة شيدر، صلصة فولكانو، بطاطس مقرمشة، طماطم، بصل.']);
}

describe('menu translations migration', () => {
  beforeAll(async () => { db = await createTestDatabase({ quiet: true }); await actAs(db, null); }, 180_000);
  afterAll(async () => { await db?.close(); });
  beforeEach(seed);

  it('fills an item that had no translation at all', async () => {
    await db.exec(MIGRATION);
    expect(await item(CHEESE_FRIES)).toEqual({
      name_bs: 'Original pomfrit sa sirom',
      name_ar: 'بطاطس بالجبن الأصلية',
      description_bs: 'Pomfrit, sos od sira, originalni sos, sjeckane kisele jalapeño papričice, ukrašeno mladim lukom i Sakura mješavinom.',
      description_ar: 'بطاطس مقلية، صلصة جبنة، الصلصة الأصلية، هلابينو مخلل مفروم، مزيّنة بالبصل الأخضر وخلطة ساكورا.',
    });
  });

  it('replaces the old text of every field it targets', async () => {
    await db.exec(MIGRATION);
    const p = await item(PLATTER);
    expect(p.name_bs).toBe('Plata za doručak');
    expect(p.name_ar).toBe('طبق الفطور');
    expect(p.description_ar).toContain('منيمن');        // menemen, not "eggs with vegetables"
    expect(p.description_ar).toContain('خبز عربي');
    expect(p.description_bs).not.toContain("za'atar");
  });

  it('updates category and subcategory names too', async () => {
    await db.exec(MIGRATION);
    const { rows: subs } = await db.query<{ name_bs: string; name_ar: string }>(
      `SELECT name_bs, name_ar FROM public.subcategories WHERE id IN ($1, $2) ORDER BY name`, [BREAKFAST, HOT_DRINKS]);
    expect(subs).toEqual([{ name_bs: 'Doručak', name_ar: 'فطور' }, { name_bs: 'Topli napici', name_ar: 'مشروبات ساخنة' }]);
    const { rows: cats } = await db.query<{ name_ar: string }>(`SELECT name_ar FROM public.categories WHERE id = $1`, [FOOD]);
    expect(cats[0].name_ar).toBe('مأكولات');
  });

  it('keeps a field the owner edited by hand, and still fixes the others on that item', async () => {
    await db.query(`UPDATE public.menu_items SET name_bs = 'Vulkan burger (junetina)' WHERE id = $1`, [VOLCANO]);
    await db.exec(MIGRATION);
    const v = await item(VOLCANO);
    expect(v.name_bs).toBe('Vulkan burger (junetina)');
    expect(v.description_bs).toBe('Pecivo od cvekle sa susamom, juneća pljeskavica, kriške čedar sira, Volcano sos, hrskave krompir niti, paradajz, luk.');
    expect(v.name_ar).toBe('برجر فولكانو باللحم');
  });

  it('can be run twice; the second run changes nothing', async () => {
    await db.exec(MIGRATION);
    const first = await item(PLATTER);
    await db.query(`UPDATE public.menu_items SET description_bs = 'Ručno uređen opis.' WHERE id = $1`, [PLATTER]);
    await db.exec(MIGRATION);
    expect(await item(PLATTER)).toEqual({ ...first, description_bs: 'Ručno uređen opis.' });
  });

  it('uses Latin digits and KM in every Arabic string it writes', () => {
    const arabic = MIGRATION.match(/\$new\$[^$]*[؀-ۿ][^$]*\$new\$/g) ?? [];
    expect(arabic.length).toBeGreaterThan(100);
    for (const s of arabic) {
      expect(s).not.toMatch(/[٠-٩۰-۹٪]/);
      expect(s).not.toContain('دينار');
    }
  });

  it('never writes a Croatian or English word the house style rules out into Bosnian', () => {
    const bosnian = (MIGRATION.match(/SET (?:name|description)_bs = \$new\$[^$]*\$new\$/g) ?? []).join('\n');
    expect(bosnian).not.toMatch(/\bkav[aeiu]\b/i);
    expect(bosnian).not.toMatch(/\bkruh/i);
    expect(bosnian).not.toMatch(/\bumak/i);
    expect(bosnian).not.toMatch(/\bpunđ/i);
    expect(bosnian).not.toMatch(/\b(low-fat|light|cherry|iceberg)\b/i);
  });

  it('creates the machine-translation log closed to guests and staff', async () => {
    const { rows } = await db.query<{ rls: boolean; anon: boolean; authed: boolean }>(`
      SELECT c.relrowsecurity AS rls,
             has_table_privilege('anon', c.oid, 'SELECT') AS anon,
             has_table_privilege('authenticated', c.oid, 'SELECT') AS authed
        FROM pg_class c WHERE c.oid = 'public.menu_machine_translations'::regclass`);
    expect(rows[0]).toEqual({ rls: true, anon: false, authed: false });
  });
});
