import { test, expect } from './staff-fixtures';
import type { Page, Route } from '@playwright/test';

/**
 * Promotions, from the owner's side: put a dish on sale and see what it
 * will cost before saving, end a sale in one tap, and build a combo with the
 * saving worked out as it is built.
 *
 * What these write is checked against PostgreSQL in
 * supabase/tests/promotions.test.ts; here the point is that the screens send
 * it, and say plainly what will happen.
 */

const row = (over: Record<string, unknown>) => ({
  description: null, description_bs: null, description_ar: null, name_bs: null, name_ar: null,
  image_url: null, dietary_tags: [], merchandising_tags: [], allergens: [], margin_score: 0,
  prep_minutes: null, portion_note: null, available_from: null, available_to: null,
  is_available: true, station: 'kitchen', meal_role: null, sort_order: 1,
  created_at: '2026-10-01T10:00:00Z', updated_at: '2026-10-01T10:00:00Z',
  sale_kind: null, sale_value: null, sale_starts_at: null, sale_ends_at: null, sale_label: null,
  new_until: null, featured_rank: null, featured_note: null, featured_note_bs: null, featured_note_ar: null,
  ...over,
});

const MENU = () => [
  row({ id: 'item-burger', name: 'La Soul Burger', price: 18, subcategory_id: 'sub-burgers' }),
  row({ id: 'item-cheese', name: 'Cheeseburger', price: 20, subcategory_id: 'sub-burgers', sort_order: 2 }),
  row({ id: 'item-cola', name: 'Coca-Cola', price: 4, subcategory_id: 'sub-drinks', station: 'bar' }),
  row({ id: 'item-lemonade', name: 'Lemonade', price: 5.5, subcategory_id: 'sub-drinks', station: 'bar', sort_order: 2 }),
  row({ id: 'item-kids', name: 'Chicken Burger Combo', price: 12, subcategory_id: 'sub-burgers', sort_order: 3 }),
];

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });

interface Writes {
  patches: { url: string; body: Record<string, unknown> }[];
  inserts: Record<string, unknown>[];
  combos: Record<string, unknown>[];
}

/** The menu, served the way the admin screens read and write it. */
async function stubMenu(page: Page, rows: Record<string, unknown>[], combos: unknown[] = []): Promise<Writes> {
  const writes: Writes = { patches: [], inserts: [], combos: [] };
  const subs = [
    { id: 'sub-burgers', category_id: 'cat-food', name: 'Burgers', name_bs: 'Burgeri', name_ar: null, sort_order: 1, created_at: '2026-01-01T00:00:00Z' },
    { id: 'sub-drinks', category_id: 'cat-drinks', name: 'Soft drinks', name_bs: 'Sokovi', name_ar: null, sort_order: 2, created_at: '2026-01-01T00:00:00Z' },
  ];
  await page.route('**/rest/v1/menu_items**', async (route) => {
    const req = route.request();
    if (req.method() === 'PATCH') {
      const body = req.postDataJSON() as Record<string, unknown>;
      writes.patches.push({ url: req.url(), body });
      const id = new URL(req.url()).searchParams.get('id')?.replace('eq.', '');
      const target = rows.find((r) => r.id === id);
      if (target) Object.assign(target, body);
      return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' }, body: '' });
    }
    if (req.method() === 'POST') {
      const body = req.postDataJSON() as Record<string, unknown>;
      writes.inserts.push(body);
      const created = { ...row({}), ...body, id: 'item-new-combo' };
      rows.push(created);
      const one = (req.headers()['accept'] ?? '').includes('vnd.pgrst.object');
      return json(route, one ? { id: created.id } : [created], 201);
    }
    const url = new URL(req.url());
    if (url.searchParams.get('featured_rank') === 'not.is.null') return json(route, rows.filter((r) => r.featured_rank != null));
    return json(route, rows);
  });
  await page.route('**/rest/v1/subcategories**', (route) => json(route, subs));
  await page.route('**/rest/v1/categories**', (route) => json(route, [
    { id: 'cat-food', name: 'Food', name_bs: 'Hrana', name_ar: null, sort_order: 1, image_url: null, created_at: '2026-01-01T00:00:00Z',
      subcategories: [{ ...subs[0], menu_items: rows.filter((r) => r.subcategory_id === 'sub-burgers') }] },
    { id: 'cat-drinks', name: 'Drinks', name_bs: 'Pića', name_ar: null, sort_order: 2, image_url: null, created_at: '2026-01-01T00:00:00Z',
      subcategories: [{ ...subs[1], menu_items: rows.filter((r) => r.subcategory_id === 'sub-drinks') }] },
  ]));
  await page.route('**/rest/v1/order_items**', (route) => json(route, []));
  await page.route('**/rest/v1/rpc/guest_get_combos', (route) => json(route, combos));
  await page.route('**/rest/v1/rpc/admin_save_combo', (route) => {
    writes.combos.push(route.request().postDataJSON());
    return json(route, { combo_item_id: 'item-new-combo', slots: 2 });
  });
  return writes;
}

const fitsWidth = async (page: Page) => {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, `page is ${overflow}px wider than the screen`).toBeLessThanOrEqual(0);
};

test.describe('sales', () => {
  test('a dish goes on sale from its editor, with the price it will have shown before saving', async ({ page }) => {
    const writes = await stubMenu(page, MENU());
    await page.goto('/admin/promotions');
    await expect(page.getByText('Nothing is on sale.')).toBeVisible();

    await page.getByRole('textbox', { name: 'Find a dish' }).fill('soul');
    await page.getByRole('button', { name: 'Sale', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Edit item' })).toBeVisible();

    await dialog.getByRole('switch', { name: 'Sale' }).click();
    await dialog.getByRole('textbox', { name: 'Percent off' }).fill('20');
    const preview = dialog.getByTestId('sale-preview');
    await expect(preview).toHaveText('18.00 → 14.40 KM · −20% · until you end it');

    // A price that is not a sale is caught before it is saved.
    await dialog.getByRole('button', { name: 'Sale price' }).click();
    await dialog.getByRole('textbox', { name: 'Sale price in KM' }).fill('19');
    await expect(preview).toContainText('must be below the menu price');
    await dialog.getByRole('button', { name: '% off' }).click();
    await dialog.getByRole('textbox', { name: 'Percent off' }).fill('20');

    await dialog.getByRole('button', { name: 'Happy hour' }).click();
    await dialog.getByRole('button', { name: 'Ends in a week' }).click();
    await expect(preview).toContainText(/18\.00 → 14\.40 KM · −20% · ends \d+ \w{3} 23:00|ends \w{3} 23:00/);

    await dialog.getByRole('button', { name: 'Save changes' }).click();
    await expect(dialog).toBeHidden();
    const body = writes.patches.at(-1)!.body;
    expect(body).toMatchObject({ sale_kind: 'percent', sale_value: 20, sale_label: 'happy_hour', sale_starts_at: null });
    expect(Date.parse(String(body.sale_ends_at))).toBeGreaterThan(Date.now() + 6 * 86_400_000);
    // Nothing else about the dish changed by accident.
    expect(body).toMatchObject({ name: 'La Soul Burger', price: 18 });

    await expect(page.locator('[data-sale-row="La Soul Burger"]')).toContainText('18.00 → 14.40 KM · −20%');
  });

  test('everything on sale is listed, and a sale ends in one tap', async ({ page }) => {
    const menu = MENU();
    Object.assign(menu[0], { sale_kind: 'percent', sale_value: 20, sale_label: 'happy_hour', sale_ends_at: new Date(Date.now() + 3 * 3_600_000).toISOString() });
    Object.assign(menu[2], { sale_kind: 'price', sale_value: 3, sale_starts_at: new Date(Date.now() + 2 * 86_400_000).toISOString() });
    const writes = await stubMenu(page, menu);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/admin/promotions');

    const burger = page.locator('[data-sale-row="La Soul Burger"]');
    await expect(burger).toContainText('Now');
    await expect(burger).toContainText('Happy hour');
    await expect(burger).toContainText(/ends (today|tomorrow) \d\d:\d\d/);
    await expect(page.locator('[data-sale-row="Coca-Cola"]')).toContainText('Scheduled');
    await fitsWidth(page);

    await burger.getByRole('button', { name: 'End now' }).click();
    await expect(page.getByText('Sale ended — La Soul Burger is back to 18.00 KM')).toBeVisible();
    expect(writes.patches.at(-1)!.body).toEqual({
      sale_kind: null, sale_value: null, sale_starts_at: null, sale_ends_at: null, sale_label: null,
    });
    await expect(page.locator('[data-sale-row="La Soul Burger"]')).toHaveCount(0);

    // And the menu page says which dishes are on sale.
    await page.goto('/admin/menu');
    await page.getByRole('button', { name: /Drinks/ }).first().click();
    await page.getByRole('button', { name: 'Soft drinks 2 items' }).click();
    await expect(page.getByText('Sale soon')).toBeVisible();
  });
});

test.describe('combos', () => {
  test('a combo is built part by part, with what guests save worked out as it is built', async ({ page }) => {
    const writes = await stubMenu(page, MENU());
    await page.goto('/admin/promotions');

    // The kids' "... Combo" dishes are flagged as not choosable yet.
    await expect(page.getByText(/Called combos, but guests cannot choose their parts yet/)).toContainText('Chicken Burger Combo');

    await page.getByLabel('New combo in').selectOption('sub-burgers');
    await page.getByRole('button', { name: 'New combo' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('switch', { name: 'Combo' })).toBeChecked();
    await dialog.getByPlaceholder('Item name (EN)').fill('Burger Combo');
    await dialog.getByPlaceholder('4,50').fill('20');

    await dialog.getByRole('button', { name: '+ Burger' }).click();
    const burgerPart = dialog.locator('[data-combo-slot-editor]').nth(0);
    await burgerPart.getByRole('textbox', { name: 'Add a dish to Burger' }).fill('burger');
    await burgerPart.getByRole('button', { name: /La Soul Burger/ }).click();
    await burgerPart.getByRole('textbox', { name: 'Add a dish to Burger' }).fill('cheese');
    await burgerPart.getByRole('button', { name: /Cheeseburger/ }).click();
    await burgerPart.getByRole('textbox', { name: 'Extra charge for Cheeseburger in Burger' }).fill('2');

    await dialog.getByRole('button', { name: 'Add a part' }).click();
    const drinkPart = dialog.locator('[data-combo-slot-editor]').nth(1);
    await drinkPart.getByRole('textbox', { name: 'Name of part 2' }).fill('Drink');
    await drinkPart.getByLabel('or every dish in').selectOption('sub-drinks');
    await expect(drinkPart.getByRole('list', { name: 'Choices for Drink' }).getByRole('listitem')).toHaveCount(2);

    // Burger 18, or 20 less its 2 extra; a drink 4 or 5.50: 22.00–23.50 for 20.
    const summary = dialog.locator('[data-combo-summary]');
    await expect(summary).toContainText('Ordered separately: 22.00–25.50 KM · Combo: 20.00 KM');
    await expect(summary).toContainText('Guests save 2.00–3.50 KM vs ordering separately');

    await dialog.getByRole('button', { name: 'Add item' }).click();
    await expect(dialog).toBeHidden();
    expect(writes.inserts.at(-1)).toMatchObject({ name: 'Burger Combo', price: 20, subcategory_id: 'sub-burgers' });
    expect(writes.combos.at(-1)).toEqual({
      _combo_item_id: 'item-new-combo',
      _slots: [
        { label: 'Burger', label_bs: null, label_ar: null, options: [{ item_id: 'item-burger', surcharge: 0 }, { item_id: 'item-cheese', surcharge: 2 }] },
        { label: 'Drink', label_bs: null, label_ar: null, options: [{ item_id: 'item-cola', surcharge: 0 }, { item_id: 'item-lemonade', surcharge: 0 }] },
      ],
    });
  });

  test('an existing combo opens with its parts, and lists its saving on the page', async ({ page }) => {
    const menu = [...MENU(), row({ id: 'item-combo', name: 'Burger Combo', price: 20, subcategory_id: 'sub-burgers', sort_order: 4 })];
    const opt = (item_id: string, price: number, surcharge = 0) => ({ item_id, price, surcharge, name: item_id, is_available: true });
    await stubMenu(page, menu, [{
      combo_item_id: 'item-combo',
      slots: [
        { id: 's1', label: 'Burger', options: [opt('item-burger', 18), opt('item-cheese', 20, 2)] },
        { id: 's2', label: 'Drink', options: [opt('item-cola', 4), opt('item-lemonade', 5.5)] },
      ],
    }]);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/admin/promotions');
    await expect(page.locator('[data-combo-row="Burger Combo"]')).toContainText('20.00 KM · Burger + Drink · guests save 2.00–3.50 KM');

    await page.getByRole('button', { name: 'Edit the combo Burger Combo' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('switch', { name: 'Combo' })).toBeChecked();
    await expect(dialog.locator('[data-combo-slot-editor]')).toHaveCount(2);
    await expect(dialog.getByRole('textbox', { name: 'Extra charge for Cheeseburger in Burger' })).toHaveValue('2.00');
    // The editor fits a phone: a long dish name in a part used to widen the whole form.
    const sideways = await dialog.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(sideways).toBeLessThanOrEqual(0);
  });
});

test.describe('new and featured', () => {
  test('marking a dish new gives it an end date, and featuring it takes a free slot', async ({ page }) => {
    const menu = MENU();
    Object.assign(menu[1], { featured_rank: 1, featured_note: 'Double cheese' });
    const writes = await stubMenu(page, menu);
    await page.goto('/admin/promotions');
    await expect(page.getByText('Featured on the home screen')).toBeVisible();
    await expect(page.getByText('“Double cheese”')).toBeVisible();

    await page.getByRole('textbox', { name: 'Find a dish' }).fill('soul');
    await page.getByRole('button', { name: 'New / feature' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('switch', { name: 'Mark as new' }).click();
    const until = await dialog.getByLabel('New until').inputValue();
    expect(Date.parse(until) - Date.now()).toBeGreaterThan(28 * 86_400_000);
    await dialog.getByRole('switch', { name: 'Feature on the home screen' }).click();
    await dialog.getByRole('textbox', { name: 'Featured line (EN)' }).fill('Our classic');
    await dialog.getByRole('button', { name: 'Save changes' }).click();
    await expect(dialog).toBeHidden();

    const body = writes.patches.at(-1)!.body;
    expect(body.merchandising_tags).toEqual(['new']);
    expect(body).toMatchObject({ new_until: until, featured_rank: 2, featured_note: 'Our classic' });
  });
});
