import { test, expect } from './staff-fixtures';
import type { Page } from '@playwright/test';

/**
 * The Android waiter app (android/README.md) is the waiter screen and nothing
 * else: a waiter signs in, works the shift and signs out. The kitchen app is
 * the kitchen screen and nothing else. Chrome tells the page which app opened
 * it (the referrer "android-app://<package>/"), and inside an app the screens
 * drop what leads away from its one screen. In a browser nothing changes. And
 * each site has the pages a tablet gets the apps from.
 */

/**
 * What Chrome gives the first page the app opens (read on an Android 16 emulator, with the app
 * installed). A test browser will not send a referrer of that kind itself, so the page is told.
 */
const openedByTheApp = (page: Page) => page.addInitScript(() => {
  Object.defineProperty(document, 'referrer', { get: () => 'android-app://net.lasoul.waiter/' });
});
const openedByTheKitchenApp = (page: Page) => page.addInitScript(() => {
  Object.defineProperty(document, 'referrer', { get: () => 'android-app://net.lasoul.kitchen/' });
});

async function asMarko(page: Page) {
  await page.route('**/rest/v1/waiters**', (route) => route.fulfill({
    status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify(route.request().url().includes('user_id=eq')
      ? { id: 'waiter-1', user_id: 'staff-user-1', display_name: 'Marko', is_active: true }
      : [{ id: 'waiter-1', user_id: 'staff-user-1', display_name: 'Marko', is_active: true }]),
  }));
}

test.describe('inside the Android app', () => {
  test('the waiter screen has no way to the floor monitor, and keeps sound and Sign out', async ({ page }) => {
    await asMarko(page);
    await openedByTheApp(page);
    await page.goto('/waiter');
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Floor monitor' })).toHaveCount(0);
    // Kept for the rest of the visit, whose later pages have an ordinary referrer.
    expect(await page.evaluate(() => sessionStorage.getItem('waiter-app'))).toBe('1');
  });

  test('the sign-in is for waiters: no manager link, no link to get the app it is already in', async ({ page, context }) => {
    await context.clearCookies();
    await page.addInitScript(() => { try { localStorage.clear(); } catch { /* fresh anyway */ } });
    await openedByTheApp(page);
    await page.goto('/waiter/login');
    await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Admin login' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Get the waiter app' })).toHaveCount(0);
  });
});

test.describe('inside the Android kitchen app', () => {
  test("every sign-in is the kitchen's: no manager link, no link to an app", async ({ page, context }) => {
    await context.clearCookies();
    await page.addInitScript(() => { try { localStorage.clear(); } catch { /* fresh anyway */ } });
    await openedByTheKitchenApp(page);
    // Even the waiters' address: the app is the kitchen screen only.
    await page.goto('/waiter/login');
    await expect(page.getByRole('heading', { level: 1, name: 'Kitchen Sign In' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Admin login' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Get the kitchen app' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Get the waiter app' })).toHaveCount(0);
    expect(await page.evaluate(() => sessionStorage.getItem('kitchen-app'))).toBe('1');
    expect(await page.evaluate(() => sessionStorage.getItem('waiter-app'))).toBeNull();
  });
});

test.describe('in a browser', () => {
  test('the waiter screen and its sign-in are as they were, with a way to the app', async ({ page }) => {
    await asMarko(page);
    await page.goto('/waiter');
    await expect(page.getByRole('link', { name: 'Floor monitor' })).toBeVisible();

    await page.goto('/waiter/login');
    await expect(page.getByRole('button', { name: 'Admin login' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Get the waiter app' })).toHaveAttribute('href', '/waiter-app/');
  });

  test("the kitchen's sign-in offers the kitchen app", async ({ page, context }) => {
    await context.clearCookies();
    await page.addInitScript(() => { try { localStorage.clear(); } catch { /* fresh anyway */ } });
    await page.goto('/waiter/login?to=kitchen');
    await expect(page.getByRole('heading', { level: 1, name: 'Kitchen Sign In' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Admin login' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Get the kitchen app' })).toHaveAttribute('href', '/kitchen-app/');
    await expect(page.getByRole('link', { name: 'Get the waiter app' })).toHaveCount(0);
  });
});

test.describe('the page a tablet gets the app from', () => {
  test('offers this site\'s app, says how to install it, and is nobody\'s search result', async ({ page }) => {
    const response = await page.goto('/waiter-app/');
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1, name: 'La Soul Waiter' })).toBeVisible();
    const download = page.getByRole('link', { name: /Download the app|Preuzmi aplikaciju/ });
    await expect(download).toHaveAttribute('href', '/waiter-app/la-soul-waiter.apk');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');

    // Both languages, one at a time.
    await page.getByRole('button', { name: 'EN' }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Install it' })).toBeVisible();
    await expect(page.getByText('Turn on Alerts on lock screen and tap Allow.', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'BS' }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Instalacija' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Install it' })).toBeHidden();
  });

  test('the kitchen has its own page, with its own app', async ({ page }) => {
    const response = await page.goto('/kitchen-app/');
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1, name: 'La Soul Kitchen' })).toBeVisible();
    const download = page.getByRole('link', { name: /Download the app|Preuzmi aplikaciju/ });
    await expect(download).toHaveAttribute('href', '/kitchen-app/la-soul-kitchen.apk');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
    await page.getByRole('button', { name: 'EN' }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'So no order is missed' })).toBeVisible();
    await page.getByRole('button', { name: 'BS' }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Da nijedna narudžba ne promakne' })).toBeVisible();
    // Its icon is there to be drawn.
    const icon = await page.request.get('/kitchen-app/la-soul-kitchen.png');
    expect(icon.status()).toBe(200);
  });

  test('the app itself is there to download, whole', async ({ request }) => {
    for (const file of ['waiter-app/la-soul-waiter.apk', 'waiter-app/vera-italia-waiter.apk', 'kitchen-app/la-soul-kitchen.apk', 'kitchen-app/vera-italia-kitchen.apk']) {
      const apk = await request.get(`/${file}`);
      expect(apk.status()).toBe(200);
      const body = await apk.body();
      expect(body.subarray(0, 2).toString()).toBe('PK');
      expect(body.length).toBeGreaterThan(1_000_000);
    }
  });

  test('the sites vouch for the apps where Chrome looks', async ({ request }) => {
    const links = await request.get('/.well-known/assetlinks.json');
    expect(links.status()).toBe(200);
    const apps = (await links.json()) as { target: { package_name: string } }[];
    expect(apps.map((a) => a.target.package_name).sort()).toEqual([
      'net.lasoul.kitchen', 'net.lasoul.waiter', 'net.veraitalia.kitchen', 'net.veraitalia.waiter',
    ]);
  });
});

test.describe('the pages that say how to get the apps', () => {
  test('the Manager page says how to add it to the Home Screen, opens the admin, and is nobody\'s search result', async ({ page }) => {
    const response = await page.goto('/manager-app/');
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1, name: 'La Soul Manager' })).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest-manager.webmanifest');
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('href', '/icons/manager-apple-touch-icon.png');
    await page.getByRole('button', { name: 'EN' }).click();
    // Nothing to download: the way in is the admin, and the steps follow.
    await expect(page.getByRole('link', { name: 'Open the admin' })).toHaveAttribute('href', '/admin');
    await expect(page.getByRole('heading', { level: 2, name: 'iPhone and iPad' })).toBeVisible();
    await expect(page.getByText('Add to Home Screen', { exact: false }).first()).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Android' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'All the apps and links' })).toHaveAttribute('href', '/apps/');
    await page.getByRole('button', { name: 'BS' }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Da uvijek zazvoni' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Otvori admin' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  });

  test('added to the Home Screen from there, it still opens the admin', async ({ page }) => {
    await page.addInitScript(() => {
      const original = window.matchMedia.bind(window);
      window.matchMedia = (query: string) => (/display-mode:\s*standalone/.test(query)
        ? ({ ...original(query), matches: true } as MediaQueryList) : original(query));
    });
    await page.goto('/manager-app/');
    await expect(page).toHaveURL(/\/admin(\/login)?$/);
  });

  test('one page lists every app and link, each leading where it says', async ({ page }) => {
    const response = await page.goto('/apps/');
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1, name: 'La Soul apps' })).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
    await page.getByRole('button', { name: 'EN' }).click();
    // One language at a time, in the cards too.
    await expect(page.getByText('For the manager and the owner.')).toBeVisible();
    await expect(page.getByText('Za menadžera i vlasnika.')).toBeHidden();
    const hrefs = (names: string[]) => Promise.all(names.map((n) => page.getByRole('link', { name: new RegExp(`^${n}`) }).first().getAttribute('href')));
    expect(await hrefs(['Manager', 'Waiter For waiters', 'Kitchen For the kitchen'])).toEqual(['/manager-app/', '/waiter-app/', '/kitchen-app/']);
    expect(await hrefs(['Admin', 'Waiter sign-in', 'Kitchen board', 'Menu on the TV', 'Book a table'])).toEqual(['/admin', '/waiter/login', '/kitchen', '/tv', '/reserve/']);
    await page.getByRole('button', { name: 'BS' }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Instalacija' })).toBeVisible();
    await expect(page.getByText('Za menadžera i vlasnika.')).toBeVisible();
    await expect(page.getByText('For the manager and the owner.')).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    // Every address it names is one the site answers.
    for (const path of ['/manager-app/', '/waiter-app/', '/kitchen-app/', '/admin', '/waiter/login', '/kitchen', '/tv', '/reserve/', '/menu/']) {
      expect((await page.request.get(path)).status(), path).toBe(200);
    }
  });
});
