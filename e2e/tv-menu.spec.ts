import type { Route } from '@playwright/test';
import { test, expect } from './fixtures';

/**
 * The menu board on the TV at the entrance (/tv), on the portrait full-HD
 * screen it is laid out for. Nobody touches it: it shows the brand, one
 * section of the menu at a time with its prices, and the QR code to the full
 * menu, and moves on by itself.
 */
test.use({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });

const SECTIONS = [
  { id: 'sub-burgers', category_id: 'cat-food', name: 'Burgers', name_bs: 'Burgeri', name_ar: null, sort_order: 1 },
  { id: 'sub-coffee', category_id: 'cat-drinks', name: 'Coffee', name_bs: 'Kafa', name_ar: 'قهوة', sort_order: 1 },
];

const dish = (id: string, subcategory_id: string, name: string, price: number, extra: Record<string, unknown> = {}) => ({
  id, subcategory_id, name, name_bs: null, name_ar: null, description: null, description_bs: null, description_ar: null,
  price, image_url: null, is_available: true, sort_order: 2, dietary_tags: [], merchandising_tags: [], allergens: [], ...extra,
});

test.beforeEach(async ({ page, state }) => {
  // Two sections, so there is a next slide; one dish the kitchen has taken off.
  await page.route('**/rest/v1/subcategories**', (route: Route) => route.fulfill({
    status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(SECTIONS),
  }));
  state.menuItems.push(
    dish('item-gravity', 'sub-burgers', 'Solar Gravity', 21.5),
    dish('item-gone', 'sub-burgers', 'Sold Out Burger', 19, { is_available: false }),
    dish('item-espresso', 'sub-coffee', 'Espresso', 3, { sort_order: 1 }),
  );
});

test('shows the brand, a section, its dishes with their prices, and the QR code to the full menu', async ({ page }) => {
  const venues: (string | undefined)[] = [];
  const analytics: string[] = [];
  page.on('request', (request) => {
    if (/\/rest\/v1\/(categories|subcategories|menu_items)/.test(request.url())) venues.push(request.headers()['x-venue']);
    if (request.url().includes('record_analytics_events')) analytics.push(request.url());
  });

  await page.goto('/tv?every=600');

  const header = page.locator('header');
  await expect(header.getByRole('img', { name: 'La Soul' })).toBeVisible();
  await expect(header.getByText('Menu', { exact: true })).toBeVisible();
  await expect(header.getByText('100% halal · alcohol-free')).toBeVisible();

  await expect(page.getByRole('heading', { level: 2, name: 'Burgers' })).toBeVisible();
  await expect(page.getByText('Food', { exact: true })).toBeVisible();
  await expect(page.getByText('Prices in KM')).toBeVisible();
  const rows = page.locator('main li');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('La Soul Burger');
  await expect(rows.nth(0)).toContainText('18');
  await expect(rows.nth(1)).toContainText('Solar Gravity');
  await expect(rows.nth(1)).toContainText('21.50');
  await expect(page.getByText('Sold Out Burger')).toHaveCount(0);

  const qr = page.getByTestId('tv-qr');
  await expect(qr).toBeVisible();
  await expect(qr).toHaveAttribute('data-url', /\/menu\/lasoul\/$/);
  expect(await qr.locator('svg path').count()).toBeGreaterThan(0);
  const box = await qr.locator('svg').boundingBox();
  expect(box?.width).toBeGreaterThan(150);
  await expect(page.locator('footer p').first()).toHaveText('Scan for the full menu');

  // Left alone all day: no pointer over the menu, no search result, and not a guest in the numbers.
  expect(await page.evaluate(() => document.documentElement.style.cursor)).toBe('none');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
  // La Soul's menu, named as the guest menu names it.
  expect(venues.length).toBeGreaterThan(0);
  expect(new Set(venues)).toEqual(new Set(['lasoul']));
  expect(analytics).toEqual([]);
});

test('moves on to the next section by itself', async ({ page }) => {
  await page.goto('/tv?every=2');
  await expect(page.getByRole('heading', { level: 2, name: 'Burgers' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Coffee' })).toBeVisible({ timeout: 8_000 });
  await expect(page.locator('main li').filter({ hasText: 'Espresso' })).toContainText('3');
  await expect(page.getByRole('heading', { level: 2, name: 'Burgers' })).toHaveCount(0);
});

test('speaks the language the address asks for, right to left in Arabic', async ({ page }) => {
  await page.goto('/tv?lang=ar&every=600');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByText('الطعام', { exact: true })).toBeVisible();
  await expect(page.locator('footer p').first()).toHaveText('امسح الرمز لتصفّح القائمة كاملة');
});
