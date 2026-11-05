import { test, expect } from './staff-fixtures';
import type { Page } from '@playwright/test';

/**
 * Every staff screen says when the restaurant shows its menu only
 * (src/components/staff/MenuOnlyNotice.tsx). Without it a quiet screen looked
 * broken: the waiter's phone blamed a missing section, the floor told guests
 * to scan, the kitchen waited for orders the database refuses.
 */

const NOTICE = 'Menu only is on.';

/** A waiter's phone needs a waiter: Marko, with no tables (none can be opened while Menu only is on). */
async function asMarko(page: Page) {
  await page.route('**/rest/v1/waiters**', (route) => route.fulfill({
    status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify(route.request().url().includes('user_id=eq')
      ? { id: 'waiter-1', user_id: 'staff-user-1', display_name: 'Marko' }
      : [{ id: 'waiter-1', user_id: 'staff-user-1', display_name: 'Marko' }]),
  }));
}

test.describe('with Menu only on', () => {
  test.beforeEach(({ staff }) => {
    staff.settings = { ...staff.settings, menu_only: true };
    staff.orders = [];
  });

  test('the waiter phone says guests cannot order from their phones', async ({ page }) => {
    await asMarko(page);
    await page.goto('/waiter');
    const notice = page.getByRole('status').filter({ hasText: NOTICE });
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('Take orders the usual way.');
  });

  test('the floor screen says it too', async ({ page }) => {
    await page.goto('/waiter/monitor');
    await expect(page.getByRole('status').filter({ hasText: NOTICE })).toBeVisible();
  });

  test('the kitchen board says no orders come from phones', async ({ page }) => {
    await page.goto('/kitchen');
    const notice = page.getByRole('status').filter({ hasText: NOTICE });
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('No orders come from guests’ phones');
  });

  test('the admin says it above every page, with the way to change it', async ({ page }) => {
    await page.goto('/admin/menu');
    const notice = page.getByRole('status').filter({ hasText: NOTICE });
    await expect(notice).toBeVisible();
    await notice.getByRole('link', { name: 'Change it' }).click();
    await expect(page).toHaveURL(/\/admin\/service$/);
    // The switch's own page says it in place, not twice.
    await expect(page.getByRole('heading', { level: 1, name: 'Ordering & service' })).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: NOTICE })).toHaveCount(0);
  });
});

test('with ordering on, no screen shows the notice', async ({ page }) => {
  await page.goto('/kitchen');
  await expect(page.getByText('047')).toBeVisible();
  await expect(page.getByText(NOTICE)).toHaveCount(0);
  await asMarko(page);
  await page.goto('/waiter');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByText(NOTICE)).toHaveCount(0);
});
