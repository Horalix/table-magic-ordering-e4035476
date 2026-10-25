import { test, expect, seedSession } from './fixtures';

/**
 * Promotions, as a guest meets them: a dish on sale, a combo built choice by
 * choice, what is new, and the moment a price changes under an open cart.
 *
 * What the server charges is proven in supabase/tests/promotions.test.ts.
 * These hold the screens to the same numbers, and check that what the cart
 * sends is what the guest was shown.
 */

const dish = (over: Record<string, unknown>) => ({
  description: null, description_bs: null, description_ar: null,
  image_url: null, dietary_tags: [], merchandising_tags: [], allergens: [],
  portion_note: null, prep_minutes: null, is_available: true,
  available_from: null, available_to: null,
  subcategory_id: 'sub-burgers', sort_order: 1, category_name: 'Food',
  sale_kind: null, sale_value: null, sale_starts_at: null, sale_ends_at: null, sale_label: null,
  new_until: null, featured_rank: null, featured_note: null, featured_note_bs: null, featured_note_ar: null,
  ...over,
});

const BURGER = dish({ id: 'item-burger', name: 'La Soul Burger', name_bs: 'La Soul Burger', name_ar: 'برغر لا سول', price: 18, allergens: ['gluten'] });
const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
const daysFromNow = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);

test.describe('a dish on sale', () => {
  test.beforeEach(async ({ page }) => { await seedSession(page); });

  test('shows the sale everywhere the guest looks, and is sent at the price shown', async ({ page, state }) => {
    state.menuItems = [{ ...BURGER, sale_kind: 'percent', sale_value: 20, sale_label: 'happy_hour', sale_ends_at: inHours(3) }];
    await page.goto('/menu/food');

    // The list row: badge, the paid price, the menu price struck through.
    const row = page.locator('#section-burgers');
    await expect(row.getByText('Happy hour')).toBeVisible();
    await expect(row.locator('s')).toHaveText('18');
    await expect(row.getByText('14.40', { exact: true })).toBeVisible();

    // The grid card says the same.
    await page.getByRole('button', { name: 'Filters' }).click();
    await page.getByRole('button', { name: 'Grid' }).click();
    await expect(row.locator('s')).toHaveText('18');
    await page.getByRole('button', { name: 'List' }).click();

    // The sheet: the price with KM, when the offer ends, and the Add button.
    await page.getByText('La Soul Burger').first().click();
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByText('Happy hour')).toBeVisible();
    await expect(sheet.getByText(/Offer ends (today|tomorrow) at \d\d:\d\d/)).toBeVisible();
    await sheet.getByRole('button', { name: /Add to order · 14\.40\sKM/ }).click();

    // The cart bar's total is the sale total.
    await expect(page.locator('[data-cart-bar]')).toContainText('14.40');

    await page.goto('/cart');
    await expect(page.locator('s').first()).toHaveText(/^18\.00\sKM$/);
    await expect(page.getByText('Was 18.00 KM, now 14.40 KM').first()).toBeAttached();
    await page.getByRole('button', { name: /Send order · 14\.40\sKM/ }).click();
    await expect(page.getByRole('heading', { name: /Order sent to the kitchen/ })).toBeVisible();

    expect(state.orderRequests).toHaveLength(1);
    expect((state.orderRequests[0]._items as Record<string, unknown>[])[0]).toMatchObject({
      menu_item_id: 'item-burger', quantity: 1, unit_price_seen: 14.4,
    });
  });

  test('search shows the sale too', async ({ page, state }) => {
    state.menuItems = [{ ...BURGER, sale_kind: 'price', sale_value: 15 }];
    await page.goto('/menu');
    // The home screen's offers row has read the sale.
    await expect(page.getByRole('heading', { name: 'Special offers' })).toBeVisible();
    await page.getByRole('searchbox').fill('burger');
    const result = page.locator('[data-search-results] li').filter({ hasText: 'La Soul Burger' });
    await expect(result.locator('s')).toHaveText('18');
    await expect(result.getByText('15', { exact: true })).toBeVisible();
    await expect(result.getByText('−17%')).toBeVisible();
  });

  test('a sale that ended while the cart was open: the cart takes the new price before anything is sent', async ({ page, state }) => {
    state.menuItems = [{ ...BURGER, sale_kind: 'percent', sale_value: 20 }];
    state.pricesChanged = [{ line: 0, menu_item_id: 'item-burger', unit_price: 18, regular_unit_price: 18 }];
    await page.goto('/menu/food');
    await page.getByRole('button', { name: /Add La Soul Burger to order/ }).click();
    await page.goto('/cart');

    await page.getByRole('button', { name: /Send order · 14\.40\sKM/ }).click();
    await expect(page.getByText(/Prices changed while you were ordering/)).toBeVisible();
    // Nothing was placed; the line now shows what will be charged.
    expect(state.placedOrders).toHaveLength(0);
    await expect(page.locator('s')).toHaveCount(0);
    const send = page.getByRole('button', { name: /Send order · 18\.00\sKM/ });
    await expect(send).toBeVisible();

    await send.click();
    await expect(page.getByRole('heading', { name: /Order sent to the kitchen/ })).toBeVisible();
    expect((state.orderRequests[1]._items as Record<string, unknown>[])[0]).toMatchObject({ unit_price_seen: 18 });
  });
});

const option = (over: Record<string, unknown>) => ({
  surcharge: 0, name_bs: null, name_ar: null, image_url: null, is_available: true,
  available_from: null, available_to: null, sale_kind: null, sale_value: null,
  sale_starts_at: null, sale_ends_at: null, station: 'kitchen', ...over,
});

const COMBO = dish({ id: 'item-combo', name: 'Burger Combo', name_bs: 'Burger meni', name_ar: 'وجبة برغر', price: 22, sort_order: 2 });
const COMBO_DEF = {
  combo_item_id: 'item-combo',
  slots: [
    { id: 'slot-burger', label: 'Burger', label_bs: 'Burger', label_ar: 'البرغر', sort_order: 1, options: [
      option({ item_id: 'item-burger', name: 'La Soul Burger', name_ar: 'برغر لا سول', price: 18 }),
      option({ item_id: 'item-cheese', name: 'Cheeseburger', name_bs: 'Čizburger', name_ar: 'تشيز برغر', price: 20, surcharge: 2 }),
    ] },
    { id: 'slot-side', label: 'Side', label_bs: 'Prilog', label_ar: 'الطبق الجانبي', sort_order: 2, options: [
      option({ item_id: 'item-fries', name: 'Fries', name_bs: 'Pomfrit', name_ar: 'بطاطس مقلية', price: 5 }),
    ] },
    { id: 'slot-drink', label: 'Drink', label_bs: 'Piće', label_ar: 'المشروب', sort_order: 3, options: [
      option({ item_id: 'item-cola', name: 'Coca-Cola', name_ar: 'كوكا كولا', price: 4, station: 'bar' }),
      option({ item_id: 'item-lemonade', name: 'Lemonade', name_bs: 'Limunada', name_ar: 'ليموناضة', price: 5.5, surcharge: 1, station: 'bar' }),
      option({ item_id: 'item-juice', name: 'Orange juice', price: 6, station: 'bar', is_available: false }),
    ] },
  ],
};

test.describe('a combo', () => {
  test.beforeEach(async ({ page, state }) => {
    await seedSession(page);
    state.menuItems = [BURGER, COMBO];
    state.combos = [COMBO_DEF];
  });

  test('is built in its sheet, part by part, and reaches the cart and the order with its parts', async ({ page, state }) => {
    await page.goto('/menu/food');
    const row = page.locator('#section-burgers');
    await expect(row.getByText('Combo', { exact: true })).toBeVisible();
    await expect(row.getByText('from 22')).toBeVisible();

    // "+" opens the sheet: a combo cannot be added without its choices.
    await page.getByRole('button', { name: 'Choose what comes in Burger Combo' }).click();
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByRole('heading', { name: 'Burger Combo' })).toBeVisible();
    expect(state.orderRequests).toHaveLength(0);

    // Required parts are marked; a single-dish part is simply included.
    const burgerPart = sheet.locator('[data-combo-slot="Burger"]');
    const sidePart = sheet.locator('[data-combo-slot="Side"]');
    const drinkPart = sheet.locator('[data-combo-slot="Drink"]');
    await expect(burgerPart.getByText('Required')).toBeVisible();
    await expect(sidePart.getByText('Included')).toBeVisible();
    await expect(drinkPart.getByRole('radio', { name: /Orange juice/ })).toBeDisabled();

    // Trying to add too early says what is missing instead of doing nothing.
    await sheet.getByRole('button', { name: 'Choose your Burger' }).click();
    await expect(burgerPart).toHaveClass(/ring-destructive/);
    await expect(sheet).toBeVisible();

    await burgerPart.getByRole('radio', { name: /Cheeseburger/ }).click();
    await expect(sheet.getByRole('button', { name: 'Choose your Drink' })).toBeVisible();
    await drinkPart.getByRole('radio', { name: /Lemonade/ }).click();

    // 22 + 2 + 1; separately 20 + 5 + 5.50.
    await expect(sheet.getByText('You save 5.50 KM compared with ordering separately')).toBeVisible();
    await sheet.getByRole('button', { name: /Add to order · 25\.00\sKM/ }).click();
    await expect(sheet).toBeHidden();

    await page.goto('/cart');
    const parts = page.locator('[data-combo-parts]');
    await expect(parts).toContainText('Burger: Cheeseburger');
    await expect(parts).toContainText('Side: Fries');
    await expect(parts).toContainText('Drink: Lemonade');
    await expect(parts).toContainText('+1.00 KM');
    await page.getByRole('button', { name: /Send order · 25\.00\sKM/ }).click();
    await expect(page.getByRole('heading', { name: /Order sent to the kitchen/ })).toBeVisible();

    expect((state.orderRequests[0]._items as Record<string, unknown>[])[0]).toEqual({
      menu_item_id: 'item-combo',
      quantity: 1,
      notes: null,
      from_suggestion: null,
      choices: [
        { slot_id: 'slot-burger', item_id: 'item-cheese' },
        { slot_id: 'slot-side', item_id: 'item-fries' },
        { slot_id: 'slot-drink', item_id: 'item-lemonade' },
      ],
      unit_price_seen: 25,
    });
  });

  test('two different combos stay two lines', async ({ page }) => {
    await page.goto('/menu/food');
    for (const drink of ['Coca-Cola', 'Lemonade']) {
      await page.getByRole('button', { name: 'Choose what comes in Burger Combo' }).click();
      const sheet = page.getByRole('dialog');
      await sheet.getByRole('radio', { name: /La Soul Burger/ }).click();
      await sheet.getByRole('radio', { name: new RegExp(drink) }).click();
      await sheet.getByRole('button', { name: /Add to order/ }).click();
      await expect(sheet).toBeHidden();
    }
    await page.goto('/cart');
    await expect(page.locator('[data-combo-parts]')).toHaveCount(2);
    await expect(page.getByRole('button', { name: /Send order · 45\.00\sKM/ })).toBeVisible();
  });
});

test.describe('what is new, and what the home screen leads with', () => {
  test('a "New at La Soul" row opens the dish in one tap; an expired one is gone', async ({ page, state }) => {
    state.menuItems = [
      BURGER,
      dish({ id: 'item-banana', name: 'Banana Pudding', name_bs: 'Puding od banane', name_ar: 'بودينغ الموز', price: 7, merchandising_tags: ['new'], new_until: daysFromNow(20), subcategory_id: 'sub-desserts' }),
      dish({ id: 'item-old', name: 'Last Year Cake', price: 6, merchandising_tags: ['new'], new_until: '2026-01-01', subcategory_id: 'sub-desserts' }),
      dish({ id: 'item-chemex', name: 'Chemex Hot', price: 9, featured_rank: 1, featured_note: 'Brewed at your table', subcategory_id: 'sub-coffee' }),
    ];
    await page.goto('/menu');

    const newRow = page.locator('[data-promo-row="new"]');
    await expect(newRow.getByRole('heading', { name: 'New at La Soul' })).toBeVisible();
    await expect(newRow.getByText('Banana Pudding')).toBeVisible();
    await expect(newRow.getByText('Last Year Cake')).toHaveCount(0);

    const featured = page.locator('[data-promo-row="featured"]');
    await expect(featured.getByText('Chemex Hot')).toBeVisible();
    await expect(featured.getByText('Brewed at your table')).toBeVisible();

    await newRow.getByRole('button', { name: /Banana Pudding/ }).click();
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByRole('heading', { name: 'Banana Pudding' })).toBeVisible();
    await expect(sheet.getByText('New', { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();

    // The rows scroll sideways inside themselves; the page never does.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test('without promotions the home screen is as it was', async ({ page }) => {
    await page.goto('/menu');
    await expect(page.getByRole('heading', { level: 2, name: /Food|Hrana/ })).toBeVisible();
    await expect(page.locator('[data-promo-row]')).toHaveCount(0);
  });
});
