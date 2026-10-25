import { test, expect, anOrder } from './staff-fixtures';
import type { Page } from '@playwright/test';

/**
 * The admin jobs done on a phone mid-service, timed in taps: take a dish off,
 * change a price, find an order, get to any of them.
 */

const json = (body: unknown, status = 200) => ({
  status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body),
});

const menuTree = () => [{
  id: 'cat-1', name: 'Food', name_bs: 'Hrana', sort_order: 0,
  subcategories: [{
    id: 'sub-1', category_id: 'cat-1', name: 'Mains', sort_order: 0,
    menu_items: [
      { id: 'm1', subcategory_id: 'sub-1', name: 'La Soul Burger', price: 18, is_available: true, sort_order: 0, image_url: null, dietary_tags: [], allergens: [] },
      { id: 'm2', subcategory_id: 'sub-1', name: 'Caesar Salad', price: 12, is_available: true, sort_order: 1, image_url: null, dietary_tags: [], allergens: [] },
    ],
  }],
}];

async function withMenu(page: Page) {
  const writes: Record<string, unknown>[] = [];
  await page.route('**/rest/v1/categories**', (route) => route.fulfill(json(menuTree())));
  await page.route('**/rest/v1/menu_items**', (route) => {
    if (route.request().method() === 'PATCH') {
      writes.push(route.request().postDataJSON());
      return route.fulfill(json([], 200));
    }
    return route.fulfill(json([]));
  });
  return writes;
}

test.describe('the menu, from the search box', () => {
  test('sold out in one tap after typing', async ({ page }) => {
    const writes = await withMenu(page);
    await page.goto('/admin/menu');
    await page.getByLabel('Search menu items').fill('burg');
    await page.getByRole('switch', { name: 'La Soul Burger: available' }).click();
    await expect.poll(() => writes).toEqual([{ is_available: false }]);
    await expect(page.getByRole('switch', { name: 'La Soul Burger: sold out' })).toBeVisible();
  });

  test('a new price in one tap and Enter', async ({ page }) => {
    const writes = await withMenu(page);
    await page.goto('/admin/menu');
    await page.getByLabel('Search menu items').fill('burg');
    await page.getByRole('button', { name: /Price of La Soul Burger: 18\.00 KM/ }).click();
    await page.getByLabel('New price for La Soul Burger, in KM').fill('19,50');
    await page.keyboard.press('Enter');
    await expect.poll(() => writes).toEqual([{ price: 19.5 }]);
    await expect(page.getByRole('button', { name: /Price of La Soul Burger: 19\.50 KM/ })).toBeVisible();
  });

  test('refuses a price with a slipped zero', async ({ page }) => {
    const writes = await withMenu(page);
    await page.goto('/admin/menu');
    await page.getByLabel('Search menu items').fill('burg');
    await page.getByRole('button', { name: /Price of La Soul Burger/ }).click();
    await page.getByLabel('New price for La Soul Burger, in KM').fill('1800');
    await expect(page.getByRole('button', { name: 'Save price for La Soul Burger' })).toBeDisabled();
    await page.keyboard.press('Enter');
    expect(writes).toEqual([]);
  });

  test('"/" jumps to the search', async ({ page }) => {
    await withMenu(page);
    await page.goto('/admin/menu');
    await expect(page.getByText('Food').first()).toBeVisible();
    await page.keyboard.press('/');
    await expect(page.getByLabel('Search menu items')).toBeFocused();
  });
});

test.describe('finding an order', () => {
  test('by its code, its table, or a dish', async ({ staff, page }) => {
    staff.orders = [
      anOrder({ id: 'o1', order_code: '047' }),
      anOrder({ id: 'o2', order_code: '052', table_sessions: { tables: { table_number: 3 } },
        order_items: [{ id: 'x', quantity: 1, unit_price: 20, status: 'pending', station: 'kitchen', menu_items: { name: 'Truffle risotto' } }] }),
    ];
    await page.goto('/admin/orders');
    await expect(page.getByText('#047')).toBeVisible();
    await page.getByLabel('Find an order').fill('#052');
    await expect(page.getByText('#047')).toHaveCount(0);
    await expect(page.getByText('#052')).toBeVisible();
    await page.getByLabel('Find an order').fill('table 7');
    await expect(page.getByText('#047')).toBeVisible();
    await expect(page.getByText('#052')).toHaveCount(0);
    await page.getByLabel('Find an order').fill('risotto');
    await expect(page.getByText('#052')).toBeVisible();
    await expect(page.getByText('1 of 2 loaded orders match')).toBeVisible();
  });
});

test.describe('admin on a phone', () => {
  test('Today, Orders, Menu and Printing are one tap away', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await withMenu(page);
    await page.goto('/admin');
    const tabs = page.getByRole('navigation', { name: 'Admin quick navigation' });
    await expect(tabs).toBeVisible();
    await tabs.getByRole('link', { name: 'Menu' }).click();
    await expect(page).toHaveURL(/\/admin\/menu$/);
    await expect(tabs.getByRole('link', { name: 'Menu' })).toHaveAttribute('aria-current', 'page');
    await tabs.getByRole('button', { name: 'More' }).click();
    await expect(page.getByRole('link', { name: 'Audit log' })).toBeVisible();
  });

  test('is hidden on a laptop, where the sidebar is', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.goto('/admin');
    await expect(page.getByRole('navigation', { name: 'Admin quick navigation' })).toBeHidden();
  });
});
