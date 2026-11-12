import { test, expect } from './staff-fixtures';
import type { Page } from '@playwright/test';

/**
 * The Android waiter app (android/README.md) is the waiter screen and nothing
 * else: a waiter signs in, works the shift and signs out. Chrome tells the
 * page which app opened it (the referrer "android-app://<package>/"), and
 * inside the app the screens drop what leads away from the waiter screen. In
 * a browser nothing changes. And each site has the page a tablet gets the
 * app from.
 */

/**
 * What Chrome gives the first page the app opens (read on an Android 16 emulator, with the app
 * installed). A test browser will not send a referrer of that kind itself, so the page is told.
 */
const openedByTheApp = (page: Page) => page.addInitScript(() => {
  Object.defineProperty(document, 'referrer', { get: () => 'android-app://net.lasoul.waiter/' });
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

test.describe('in a browser', () => {
  test('the waiter screen and its sign-in are as they were, with a way to the app', async ({ page }) => {
    await asMarko(page);
    await page.goto('/waiter');
    await expect(page.getByRole('link', { name: 'Floor monitor' })).toBeVisible();

    await page.goto('/waiter/login');
    await expect(page.getByRole('button', { name: 'Admin login' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Get the waiter app' })).toHaveAttribute('href', '/waiter-app/');
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

  test('the app itself is there to download, whole', async ({ request }) => {
    for (const file of ['la-soul-waiter.apk', 'vera-italia-waiter.apk']) {
      const apk = await request.get(`/waiter-app/${file}`);
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
    expect(apps.map((a) => a.target.package_name).sort()).toEqual(['net.lasoul.waiter', 'net.veraitalia.waiter']);
  });
});
