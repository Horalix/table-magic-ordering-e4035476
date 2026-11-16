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

/** Guests waiting for an answer about a table: the count the admin's frame asks for (HEAD), and the list. */
async function withWaiting(page: Page, waiting: number) {
  await page.route('**/rest/v1/reservations**', (route) => (route.request().method() === 'HEAD'
    ? route.fulfill({ ...json(null), headers: { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range', 'content-range': `*/${waiting}` } })
    : route.fulfill(json([]))));
}

const areas = (page: Page) => page.getByRole('navigation', { name: 'Admin quick navigation' });
const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Admin menu' });
const tabs = (page: Page) => page.getByTestId('admin-area-tabs');
const search = (page: Page) => page.getByRole('dialog', { name: 'Search the admin' });

test.describe('admin on a phone', () => {
  test.beforeEach(async ({ page }) => { await page.setViewportSize({ width: 390, height: 844 }); });

  test('the four areas are one tap away, and their pages one more', async ({ page }) => {
    await withMenu(page);
    await page.goto('/admin');
    await expect(areas(page)).toBeVisible();
    await expect(areas(page).getByRole('link')).toHaveText(['Home', 'Service', 'Menu', 'Reports']);
    await expect(areas(page).getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'location');

    await areas(page).getByRole('link', { name: 'Menu' }).click();
    await expect(page).toHaveURL(/\/admin\/menu$/);
    await expect(areas(page).getByRole('link', { name: 'Menu' })).toHaveAttribute('aria-current', 'location');
    // The area's pages are the chips under the top bar; the one open is marked.
    await expect(tabs(page).getByRole('link')).toHaveText(['Dishes', 'Promotions', 'Menu intelligence']);
    await expect(tabs(page).getByRole('link', { name: 'Dishes' })).toHaveAttribute('aria-current', 'page');

    await areas(page).getByRole('link', { name: 'Reports' }).click();
    await expect(page).toHaveURL(/\/admin\/reports$/);
    await tabs(page).getByRole('link', { name: 'Audit log' }).click();
    await expect(page).toHaveURL(/\/admin\/audit$/);
    // Scrolled into view: the chip row is wider than the phone.
    await expect(tabs(page).getByRole('link', { name: 'Audit log' })).toBeInViewport({ ratio: 1 });
  });

  test('Reservations is two taps from anywhere, and Service says how many guests wait', async ({ page }) => {
    await withMenu(page);
    await withWaiting(page, 2);
    await page.goto('/admin/menu');
    const service = areas(page).getByRole('link', { name: /^Service/ });
    // Seen as a number on the icon; said after the name.
    await expect(service).toHaveAccessibleName(/^Service ?, 2 waiting for an answer$/);
    await service.click();
    await tabs(page).getByRole('link', { name: /^Reservations/ }).click();
    await expect(page).toHaveURL(/\/admin\/reservations$/);
    await expect(page.getByTestId('reservations-waiting')).toHaveText('2');
  });

  test('an area opens on the page last used in it', async ({ page }) => {
    await withMenu(page);
    await page.goto('/admin/analytics');
    // Each tap follows the last without waiting for its page to appear: the address changes at
    // once, the page a moment later, and a tap in between must still go where it should.
    await areas(page).getByRole('link', { name: 'Home' }).click();
    await expect(page).toHaveURL(/\/admin$/);
    await areas(page).getByRole('link', { name: 'Reports' }).click();
    await expect(page).toHaveURL(/\/admin\/analytics$/);
    // A second tap on the area you are in goes to its first page.
    await areas(page).getByRole('link', { name: 'Reports' }).click();
    await expect(page).toHaveURL(/\/admin\/reports$/);
    // And the same once every page has had time to appear.
    await expect(page.getByRole('heading', { level: 1, name: 'Daily report' })).toBeVisible();
    await tabs(page).getByRole('link', { name: 'Performance' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Performance' })).toBeVisible();
    await areas(page).getByRole('link', { name: 'Home' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
    await areas(page).getByRole('link', { name: 'Reports' }).click();
    await expect(page).toHaveURL(/\/admin\/performance$/);
  });

  test('More has the search, Setup, the other screens and the account', async ({ page }) => {
    await page.goto('/admin');
    await areas(page).getByRole('button', { name: 'More' }).click();
    const more = page.getByRole('dialog', { name: 'More' });
    await expect(more).toBeVisible();
    await expect(more.getByRole('button', { name: 'Search or jump to a page' })).toBeVisible();
    for (const name of [/^Ordering & service/, /^Tables/, /^QR codes/, /^Floor sections/, /^Waiters/, /^Printing/]) {
      await expect(more.getByRole('link', { name })).toBeVisible();
    }
    await expect(more.getByRole('link', { name: /^Kitchen display/ })).toHaveAttribute('href', '/kitchen');
    await expect(more.getByRole('link', { name: /^Floor monitor/ })).toHaveAttribute('href', '/waiter/monitor');
    await expect(more.getByRole('button', { name: 'Change password' })).toBeVisible();
    await expect(more.getByRole('button', { name: 'Sign out' })).toBeVisible();
    // Nothing wider than the phone, and the sheet fills it.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);

    await more.getByRole('link', { name: /^Printing/ }).click();
    await expect(page).toHaveURL(/\/admin\/printing$/);
    await expect(more).toHaveCount(0);
    // A Setup page is open: More is the lit item.
    await expect(areas(page).getByRole('button', { name: 'More' })).toHaveClass(/text-primary/);
  });

  test('the bottom bar never covers the end of a page', async ({ page }) => {
    await withMenu(page);
    await page.goto('/admin/menu');
    await expect(page.getByText('Food').first()).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const bar = await areas(page).boundingBox();
    const lastOfPage = await page.locator('main > :last-child').boundingBox();
    expect(lastOfPage!.y + lastOfPage!.height).toBeLessThanOrEqual(bar!.y);
  });

  test('is hidden on a laptop, where the sidebar is', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.goto('/admin');
    await expect(areas(page)).toBeHidden();
  });
});

test.describe('admin on a laptop', () => {
  test.beforeEach(async ({ page }) => { await page.setViewportSize({ width: 1366, height: 768 }); });

  test('the sidebar is five areas, fits without scrolling, and the pages are tabs', async ({ page, staff }) => {
    // The owner: the tallest sidebar there is, with the restaurant switch above the search.
    staff.roles = [{ user_id: 'staff-user-1', role: 'admin', venue_id: null }];
    await withMenu(page);
    await page.goto('/admin/orders');
    await expect(page.getByRole('group', { name: 'Restaurant', exact: true })).toBeVisible();
    await expect(sidebar(page).getByRole('link')).toHaveText(['Home', 'Service', 'Menu', 'Reports', 'Setup']);
    await expect(sidebar(page).getByRole('link', { name: 'Service' })).toHaveAttribute('aria-current', 'location');
    await expect(tabs(page).getByRole('link')).toHaveText(['Orders', 'Reservations', 'Tonight’s waiters']);
    await expect(tabs(page).getByRole('link', { name: 'Orders' })).toHaveAttribute('aria-current', 'page');

    // Everything in the sidebar is on screen at 1366×768: nothing to scroll to, in it or in its middle.
    const aside = page.locator('aside');
    expect(await aside.evaluate((el) => el.scrollHeight <= el.clientHeight)).toBe(true);
    expect(await page.getByTestId('admin-sidebar-middle').evaluate((el) => el.scrollHeight <= el.clientHeight)).toBe(true);
    // ...with room to spare between the other screens and the account, not a pixel-perfect fit.
    const lastScreen = await aside.getByRole('link', { name: /^Floor monitor/ }).boundingBox();
    const account = await aside.getByRole('button', { name: 'What’s new' }).boundingBox();
    expect(account!.y - (lastScreen!.y + lastScreen!.height)).toBeGreaterThan(24);
    await expect(aside.getByRole('button', { name: 'Sign out' })).toBeInViewport({ ratio: 1 });
    await expect(aside.getByRole('link', { name: /^Floor monitor/ })).toBeInViewport({ ratio: 1 });

    await sidebar(page).getByRole('link', { name: 'Setup' }).click();
    await expect(page).toHaveURL(/\/admin\/service$/);
    await tabs(page).getByRole('link', { name: 'Printing' }).click();
    await expect(page).toHaveURL(/\/admin\/printing$/);
    // The tabs stay at the top while the page scrolls under them.
    await page.evaluate(() => window.scrollTo(0, 400));
    await expect(tabs(page)).toBeInViewport();

    // The sidebar remembers the same way: Printing has been seen, so Setup comes back to it,
    // even tapped before Home's page has appeared.
    await expect(page.getByRole('heading', { level: 1, name: 'Printing' })).toBeVisible();
    await sidebar(page).getByRole('link', { name: 'Home' }).click();
    await expect(page).toHaveURL(/\/admin\/?(overview)?$/);
    await sidebar(page).getByRole('link', { name: 'Setup' }).click();
    await expect(page).toHaveURL(/\/admin\/printing$/);
  });

  test('in a short window the middle of the sidebar scrolls, and the account stays in reach', async ({ page, staff }) => {
    // A 768 px laptop with the browser's own bars leaves about this much; the owner's sidebar is the tallest.
    staff.roles = [{ user_id: 'staff-user-1', role: 'admin', venue_id: null }];
    await page.setViewportSize({ width: 1280, height: 620 });
    await page.goto('/admin/orders');
    const aside = page.locator('aside');
    await expect(page.getByTestId('admin-venue')).toBeInViewport({ ratio: 1 });
    for (const name of ['What’s new', 'Change password', 'Sign out']) {
      await expect(aside.getByRole('button', { name })).toBeInViewport({ ratio: 1 });
    }
    // What does not fit is a scroll away inside the sidebar, not lost under the edge of the screen.
    const middle = page.getByTestId('admin-sidebar-middle');
    expect(await middle.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    const floor = aside.getByRole('link', { name: /^Floor monitor/ });
    await floor.scrollIntoViewIfNeeded();
    await expect(floor).toBeInViewport({ ratio: 1 });
    await expect(aside.getByRole('button', { name: 'Sign out' })).toBeInViewport({ ratio: 1 });
    // The page itself has not grown a second scrollbar for it.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  });

  test('every part of the navigation is reached with the keyboard', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'a phone has no Tab key; iPhone’s Safari does not tab to links');
    await page.goto('/admin');
    await expect(page.getByTestId('admin-venue')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const seen: string[] = [];
    for (let i = 0; i < 11; i += 1) {
      await page.keyboard.press('Tab');
      seen.push(await page.evaluate(() => (document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent ?? '').trim().replace(/\s+/g, ' ')));
    }
    for (const stop of ['Search or jump to a page', 'Home', 'Service', 'Menu', 'Reports', 'Setup', 'What’s new', 'Change password', 'Sign out']) {
      expect(seen.some((name) => name.startsWith(stop)), `Tab reaches “${stop}” (${seen.join(' | ')})`).toBe(true);
    }
  });
});

test.describe('the search', () => {
  test('Ctrl K finds a page by what the manager would type, with the keyboard alone', async ({ page }) => {
    await withMenu(page);
    await page.goto('/admin');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.keyboard.press('Control+k');
    await expect(search(page)).toBeVisible();
    const box = search(page).getByRole('combobox');
    await expect(box).toBeFocused();

    await box.fill('wifi printer');
    await expect(search(page).getByRole('option').first()).toContainText('Printing');
    await box.fill('sold out');
    await expect(search(page).getByRole('option').first()).toContainText('Dishes');
    await box.fill('pin');
    await expect(search(page).getByRole('option', { name: /^Waiters/ })).toBeVisible();
    await box.fill('close the day');
    // The first result is the one Enter opens (the list marks it a moment after the last letter).
    await expect(search(page).getByRole('option', { selected: true })).toContainText('Daily report');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/admin\/reports$/);
    await expect(search(page)).toHaveCount(0);

    // Opened again: the page just left comes first, and Escape closes it.
    await page.keyboard.press('Control+k');
    await expect(search(page).getByRole('option').first()).toContainText('Dashboard');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Escape');
    await expect(search(page)).toHaveCount(0);
    await expect(page).toHaveURL(/\/admin\/reports$/);
  });

  test('says so when nothing matches, and offers the plain actions', async ({ page }) => {
    await page.goto('/admin');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.keyboard.press('Control+k');
    const box = search(page).getByRole('combobox');
    await box.fill('zzzz');
    await expect(search(page).getByText(/Nothing in the admin matches/)).toBeVisible();
    await box.fill('password');
    await expect(search(page).getByRole('option', { name: /^Change password/ })).toBeVisible();
    await box.fill('kitchen');
    await expect(search(page).getByRole('option', { name: /^Open Kitchen display/ })).toBeVisible();
    await box.fill('sign out');
    await expect(search(page).getByRole('option', { name: /^Sign out/ })).toBeVisible();
  });

  test('opens from the phone’s top bar', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/admin');
    await page.getByRole('banner').getByRole('button', { name: 'Search or jump to a page' }).click();
    await search(page).getByRole('combobox').fill('qr');
    await search(page).getByRole('option', { name: /^QR codes/ }).click();
    await expect(page).toHaveURL(/\/admin\/qr-codes$/);
    // 16 px or more: an iPhone zooms the page into a smaller field.
    await page.getByRole('banner').getByRole('button', { name: 'Search or jump to a page' }).click();
    expect(await search(page).getByRole('combobox').evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
  });
});

/**
 * The Manager app: the admin opened from a phone's Home Screen
 * (docs/reservations.md). A test browser cannot be put on a Home Screen, so
 * these tell the page it was (navigator.standalone on iPhone, the
 * display-mode query elsewhere) and check what the app does differently.
 */
test.describe('the Manager app, opened from the Home Screen', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => {
      try { Object.defineProperty(Navigator.prototype, 'standalone', { get: () => true, configurable: true }); } catch { /* not WebKit */ }
      const real = window.matchMedia.bind(window);
      window.matchMedia = ((query: string) => (/display-mode:\s*standalone/.test(query)
        ? { matches: true, media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false }
        : real(query))) as typeof window.matchMedia;
      // What the app puts on its icon.
      const badges: (number | null)[] = [];
      (window as unknown as { __badges: (number | null)[] }).__badges = badges;
      Object.assign(navigator, {
        setAppBadge: (n?: number) => { badges.push(n ?? 0); return Promise.resolve(); },
        clearAppBadge: () => { badges.push(null); return Promise.resolve(); },
      });
    });
  });

  test('puts the number of guests waiting on its icon, and clears it at none', async ({ page }) => {
    let waiting = 3;
    await page.route('**/rest/v1/reservations**', (route) => (route.request().method() === 'HEAD'
      ? route.fulfill({ ...json(null), headers: { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range', 'content-range': `*/${waiting}` } })
      : route.fulfill(json([]))));
    await page.goto('/admin');
    await expect.poll(() => page.evaluate(() => (window as unknown as { __badges: (number | null)[] }).__badges.at(-1))).toBe(3);
    waiting = 0;
    // The count is asked for again on every page.
    await areas(page).getByRole('link', { name: /^Service/ }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __badges: (number | null)[] }).__badges.at(-1))).toBe(null);
  });

  test('has its own Refresh, no install hint, and nothing wider than the phone', async ({ page }) => {
    const asked: string[] = [];
    await withMenu(page);
    page.on('request', (r) => { if (r.url().includes('/rest/v1/categories')) asked.push(r.url()); });
    await page.goto('/admin/menu');
    await expect(page.getByText('Food').first()).toBeVisible();
    await expect(page.getByTestId('install-hint')).toHaveCount(0);
    const before = asked.length;
    await page.getByRole('button', { name: 'Refresh this page' }).click();
    await expect.poll(() => asked.length).toBeGreaterThan(before);
    await expect(page.getByText('Food').first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  });

  test('opens the kitchen display and the floor monitor with a way back to the admin', async ({ page }) => {
    await page.goto('/admin/orders');
    for (const [name, title] of [[/^Floor monitor/, 'Floor monitor'], [/^Kitchen display/, 'Kitchen display']] as const) {
      await areas(page).getByRole('button', { name: 'More' }).click();
      await page.getByRole('dialog', { name: 'More' }).getByRole('button', { name }).click();
      const frame = page.getByRole('dialog', { name: title });
      await expect(frame).toBeVisible();
      // The screen itself, live, inside; the admin's address has not changed.
      await expect(frame.locator('iframe')).toHaveAttribute('src', title === 'Floor monitor' ? '/waiter/monitor' : '/kitchen');
      await expect(page.frameLocator(`iframe[title="${title}"]`).getByRole('heading', { level: 1 }).first()).toBeVisible();
      await expect(page).toHaveURL(/\/admin\/orders$/);
      await frame.getByRole('button', { name: 'Admin' }).click();
      await expect(frame).toHaveCount(0);
      await expect(page.getByRole('heading', { level: 1, name: 'Orders' })).toBeVisible();
    }
  });
});

test.describe('the admin in Safari on an iPhone', () => {
  test.use({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' });

  test('says once how to put Manager on the Home Screen, and stays put away', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/admin');
    const hint = page.getByTestId('install-hint');
    await expect(hint).toContainText('Put Manager on your Home Screen');
    await expect(hint).toContainText('Add to Home Screen');
    await expect(hint.getByRole('link')).toHaveAttribute('href', '/manager-app/');
    // What Share → Add to Home Screen will read: the Manager app, in the admin's own colour.
    await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute('content', 'Manager');
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#faf8f5');
    await expect(page.locator('meta[name="apple-mobile-web-app-status-bar-style"]')).toHaveAttribute('content', 'default');
    // And the picture it opens on, drawn for this screen: one upright, one on its side.
    await expect(page.locator('link[rel="apple-touch-startup-image"]')).toHaveCount(2);
    expect(await page.locator('link[rel="apple-touch-startup-image"]').first().getAttribute('href')).toMatch(/^data:image\/png;base64,/);

    await hint.getByRole('button', { name: 'Dismiss' }).click();
    await expect(hint).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByTestId('install-hint')).toHaveCount(0);
  });
});
