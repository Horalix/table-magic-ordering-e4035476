import type { Page } from '@playwright/test';
import { test, expect, seedSession } from './fixtures';
import { test as staffTest, expect as staffExpect } from './staff-fixtures';

/**
 * "Menu only" (Admin → Service): La Soul goes live on its own address with
 * the menu and nothing else, before the owner has decided to take orders
 * through the app. Nothing on a guest's phone may then promise ordering:
 * not the add buttons, not the cart, not the waiter button, not "scan the
 * code on your table to order" — and a table's printed code opens the menu.
 */

const BANNER = /You’re browsing\. Scan the QR code|Trenutno samo razgledate meni/;
const ADD = /Add La Soul Burger to order|Dodaj La Soul Burger u narudžbu/;

/** The guest RPCs the page called, by name. */
const rpcCalls = (page: Page) => {
  const calls: string[] = [];
  page.on('request', (request) => {
    const fn = request.url().split('/rpc/')[1]?.split('?')[0];
    if (fn) calls.push(fn);
  });
  return calls;
};

const statusAnswered = (page: Page) =>
  page.waitForResponse((r) => r.url().includes('/rpc/guest_get_service_status'));

test.describe('a restaurant that shows its menu only', () => {
  test('a guest browsing gets the menu, and no promise of ordering', async ({ page, state }) => {
    state.serviceStatus = { ...state.serviceStatus, menu_only: true };
    const answered = statusAnswered(page);
    await page.goto('/menu/lasoul/');
    await answered;
    await expect(page.getByRole('heading', { name: /Food|Hrana/ }).first()).toBeVisible();
    await page.waitForTimeout(300);
    await expect(page.getByText(BANNER)).toHaveCount(0);
  });

  test('with it off, the same guest is told how to order', async ({ page }) => {
    await page.goto('/menu/lasoul/');
    await expect(page.getByText(BANNER)).toBeVisible();
  });

  test('a phone already seated loses the cart, the waiter button and the add buttons', async ({ page, state }) => {
    state.serviceStatus = { ...state.serviceStatus, menu_only: true };
    await seedSession(page);
    const answered = statusAnswered(page);
    await page.goto('/menu/lasoul/?table=7');
    await answered;
    await expect(page.getByRole('heading', { name: /Food|Hrana/ }).first()).toBeVisible();
    await page.waitForTimeout(300);
    await expect(page.getByRole('button', { name: /Call Waiter|Pozovi konobara/ })).toHaveCount(0);
    await expect(page.getByText(/Table 7|Sto 7/)).toHaveCount(0);

    await page.goto('/menu/lasoul/food/');
    await expect(page.getByText('La Soul Burger').first()).toBeVisible();
    await page.waitForTimeout(300);
    await expect(page.getByRole('button', { name: ADD })).toHaveCount(0);

    // The dish itself: no Add, and no "scan to order" either.
    await page.getByText('La Soul Burger').first().click();
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByText('La Soul Burger').first()).toBeVisible();
    await expect(sheet.getByRole('button', { name: /Add to order|Dodaj u narudžbu/ })).toHaveCount(0);
    await expect(sheet.getByText(/Scan the QR code at your table|Skenirajte QR kod na stolu/)).toHaveCount(0);
  });

  test('the cart and the bill send the guest back to the menu', async ({ page, state }) => {
    state.serviceStatus = { ...state.serviceStatus, menu_only: true };
    await seedSession(page);
    // The phone remembers the switch, so the page can turn back before it has
    // finished loading; WebKit then calls the visit interrupted. Where it
    // ends up is what counts.
    const visit = (path: string) => page.goto(path, { waitUntil: 'commit' }).catch((error: unknown) => {
      if (!/interrupted by another navigation/.test(String(error))) throw error;
    });
    await visit('/cart');
    await expect(page).toHaveURL(/\/menu\/lasoul\/$/);
    await visit('/tab');
    await expect(page).toHaveURL(/\/menu\/lasoul\/$/);
  });

  test('a table’s printed code opens the menu, with no check-in', async ({ page, state }) => {
    state.serviceStatus = { ...state.serviceStatus, menu_only: true };
    const calls = rpcCalls(page);
    await page.goto('/table/7?token=qr-token-7');
    await expect(page).toHaveURL(/\/menu\/lasoul\/$/);
    await expect(page.getByRole('heading', { name: /Food|Hrana/ }).first()).toBeVisible();
    expect(calls).not.toContain('guest_start_table_session');
    expect(calls).not.toContain('guest_request_join');
  });

  test('the website promises no ordering from the table', async ({ page, state }) => {
    state.serviceStatus = { ...state.serviceStatus, menu_only: true };
    const answered = statusAnswered(page);
    await page.goto('/');
    await answered;
    await expect(page.getByText('Can I see the menu on my phone?')).toBeAttached();
    await page.waitForTimeout(300);
    await expect(page.getByRole('heading', { name: 'Order from your table' })).toHaveCount(0);
    await expect(page.getByText(/ordered right from your table|Can I order from my table/)).toHaveCount(0);
  });

  test('with it off, the website shows how to order from the table', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Order from your table' })).toBeAttached();
    await expect(page.getByText('Can I order from my table?')).toBeAttached();
  });

  test('the room’s code opens the menu, with no table number to type', async ({ page, state }) => {
    state.serviceStatus = { ...state.serviceStatus, menu_only: true };
    state.venueToken = { ...state.venueToken, venue: 'lasoul' };
    await page.goto('/start?token=venue-token');
    await expect(page).toHaveURL(/\/menu\/lasoul\/$/);
  });
});

staffTest.describe('the Menu only switch on Admin → Service', () => {
  staffTest('asks first, then saves it for this restaurant', async ({ staff, page }) => {
    staff.settings = { ...staff.settings, menu_only: false };
    const writes: unknown[] = [];
    await page.route('**/rest/v1/restaurant_settings**', async (route) => {
      if (route.request().method() === 'PATCH') writes.push(route.request().postDataJSON());
      await route.fulfill({
        status: 200, contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(staff.settings),
      });
    });
    await page.goto('/admin/service');
    const toggle = page.getByRole('switch', { name: /Show guests the menu and nothing else/ });
    await toggle.click();
    await staffExpect(page.getByRole('alertdialog')).toContainText('Show the menu only?');
    staffExpect(writes).toEqual([]);
    await page.getByRole('button', { name: 'Show the menu only' }).click();
    await staffExpect.poll(() => writes).toEqual([{ menu_only: true }]);
    await staffExpect(toggle).toBeChecked();
    await staffExpect(page.getByText('Menu only is on, so guests cannot order.')).toBeVisible();
  });

  staffTest('before the database update, it cannot be switched and says what is needed', async ({ page }) => {
    await page.goto('/admin/service');
    await staffExpect(page.getByRole('switch', { name: /Show guests the menu and nothing else/ })).toBeDisabled();
    await staffExpect(page.getByText(/Needs the database update first/)).toBeVisible();
  });
});
