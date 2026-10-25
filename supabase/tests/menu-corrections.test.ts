/**
 * @vitest-environment node
 *
 * Owner-confirmed menu corrections and the halal rule
 * (20261025150000_menu_corrections.sql), applied after the translation pass.
 *
 * Rows are seeded with the live text of 25 October 2026, then both
 * migrations run again in order, as they will on the live database.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error -- plain JS harness, no types needed
import { createTestDatabase } from '../../scripts/db-harness.mjs';

type Db = {
  query: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
  exec: (sql: string) => Promise<unknown>;
  close: () => Promise<void>;
};

const read = (f: string) => readFileSync(path.join(__dirname, '..', 'migrations', f), 'utf8');
const TRANSLATIONS = read('20261025140000_menu_translations.sql');
const CORRECTIONS = read('20261025150000_menu_corrections.sql');

const CAT = 'aaaaaaaa-0000-0000-0000-0000000000c1';
const SUB = 'bbbbbbbb-0000-0000-0000-0000000000c1';
const CROISSANT = '9dd68273-ee8c-4c6f-a859-550f2b8d9ed5';
const SHOPSKA = 'e5cb4265-b20c-4040-bb35-0a590ca91976';
const CAPPUCINO = '238b7bdb-0000-4000-8000-000000000001';

let db: Db;

type Row = { name: string; description: string; description_bs: string; description_ar: string; meal_role: string | null };
const row = async (id: string) => (await db.query<Row>(
  'SELECT name, description, description_bs, description_ar, meal_role FROM public.menu_items WHERE id = $1', [id])).rows[0];

async function seed() {
  await db.exec(`
    TRUNCATE public.order_items, public.orders, public.menu_items, public.subcategories, public.categories
      RESTART IDENTITY CASCADE;
    INSERT INTO public.categories(id, name, sort_order) VALUES ('${CAT}', 'Food', 1);
    INSERT INTO public.subcategories(id, category_id, name, sort_order) VALUES ('${SUB}', '${CAT}', 'All', 1);
  `);
  await db.query(`INSERT INTO public.menu_items
      (id, subcategory_id, name, description, description_bs, description_ar, price, is_available, meal_role) VALUES
    ($1, $4, ' Butter Croissant',
     'A plain croissant buttery and flaky of using margarine, beautiful honey comb design inner, side with homemade strawberry jam.',
     'Običan kroasan s puterom i listićima, napravljen od margarina, predivnog dizajna saća iznutra, serviran sa domaćim džemom od jagoda.',
     'كرواسون عادي زبدي ورقائق، مصنوع من المارجرين، تصميم خلية نحل جميل من الداخل، يقدم مع مربى الفراولة المصنوع منزليًا.',
     9, true, 'dessert'),
    ($2, $4, 'Shopska Salad',
     'Diced tomato, diced yellow bell pepper, diced cucumber, diced onion, with olive oil & white grape juice, top with crumble feta cheese & garnish with chopped parsley.',
     'Narezani paradajz, narezana žuta paprika, narezani krastavac, narezani luk, sa maslinovim uljem i bijelim sokom od grožđa, preliveno drobljenim feta sirom i ukrašeno sjeckanim peršunom.',
     'مكعبات طماطم، مكعبات فلفل أصفر، مكعبات خيار، مكعبات بصل، مع زيت زيتون وعصير عنب أبيض، تعلوها جبنة فيتا مفتتة ومزينة بالبقدونس المفروم.',
     11, true, 'starter'),
    ($3, $4, 'Cappucino',
     'A classic of Italian cuisine, Cappucino is espresso with a generous amount of frothed milk, ideal for starting the day.',
     NULL, NULL, 6, true, 'hot_drink')`, [CROISSANT, SHOPSKA, CAPPUCINO, SUB]);
}

describe('menu corrections', () => {
  beforeAll(async () => { db = await createTestDatabase({ quiet: true }); }, 180_000);
  afterAll(async () => { await db?.close(); });
  beforeEach(async () => {
    await seed();
    await db.exec(TRANSLATIONS);
    await db.exec(CORRECTIONS);
  });

  it('says butter, not margarine, in all three languages', async () => {
    const r = await row(CROISSANT);
    expect(r.name).toBe('Butter Croissant');
    for (const text of [r.description, r.description_bs, r.description_ar]) {
      expect(text).not.toMatch(/margarin|مارجرين/i);
    }
    expect(r.description).toMatch(/butter/i);
    expect(r.description_bs).toMatch(/puter/);
    expect(r.description_ar).toMatch(/زبدة/);
  });

  it('says vinegar, not grape juice, in all three languages', async () => {
    const r = await row(SHOPSKA);
    expect(r.description).toMatch(/vinegar/);
    expect(r.description_bs).toMatch(/sirćet/);
    expect(r.description_ar).toMatch(/الخل/);
    for (const text of [r.description, r.description_bs, r.description_ar]) expect(text).not.toMatch(/grape|grožđ|عنب/i);
  });

  it('fixes English spelling only where the text is unchanged', async () => {
    expect((await row(CAPPUCINO)).name).toBe('Cappuccino');
    await db.exec(`UPDATE public.menu_items SET name = 'Cappucino', description = 'Owner wrote this.' WHERE id = '${CAPPUCINO}'`);
    await db.exec(CORRECTIONS);
    const r = await row(CAPPUCINO);
    expect(r.name).toBe('Cappuccino'); // exact old name still matched
    expect(r.description).toBe('Owner wrote this.'); // owner text kept
  });

  it('is idempotent', async () => {
    const before = await row(CROISSANT);
    await db.exec(CORRECTIONS);
    expect(await row(CROISSANT)).toEqual(before);
  });

  it('refuses an alcohol item: La Soul is halal and alcohol-free', async () => {
    await expect(db.exec(`UPDATE public.menu_items SET meal_role = 'alcohol' WHERE id = '${SHOPSKA}'`))
      .rejects.toThrow(/menu_items_no_alcohol/);
  });
});
