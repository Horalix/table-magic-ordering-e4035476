import { test, expect } from './staff-fixtures';
import type { Page } from '@playwright/test';

/**
 * Deleting from the menu can be undone (20261105120000_menu_undo.sql).
 *
 * A manager deleted dishes by accident and could not get them back, and could
 * not delete others at all. Delete is now one tap with Undo in the toast, and
 * everything deleted waits in "Recently deleted" with Restore.
 */

const json = (body: unknown, status = 200) => ({
  status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body),
});

const YESTERDAY = new Date(Date.now() - 26 * 3600_000).toISOString();

type Row = { id: string; name: string; deleted_at?: string | null };

/** A La Soul menu as the database sends it, with or without the bin's columns. */
function menuState(withBin: boolean) {
  const dish = (id: string, name: string, deleted_at: string | null = null) => ({
    id, subcategory_id: 'sub-1', name, price: 9, is_available: true, sort_order: 0, image_url: null,
    dietary_tags: [], allergens: [], ...(withBin ? { deleted_at, available_before_delete: null } : {}),
  });
  const items: Row[] = [
    dish('m1', 'La Soul Burger'),
    dish('m2', 'La Soul Fries'),
    dish('m3', 'Shopska Salad', YESTERDAY),
  ].filter((d) => withBin || d.id !== 'm3');
  const tree = () => [{
    id: 'cat-1', name: 'Food', name_bs: 'Hrana', sort_order: 0, ...(withBin ? { deleted_at: null } : {}),
    subcategories: [{
      id: 'sub-1', category_id: 'cat-1', name: 'Mains', sort_order: 0, ...(withBin ? { deleted_at: null } : {}),
      menu_items: items,
    }],
  }];
  return { items, tree };
}

async function withMenu(page: Page, withBin: boolean) {
  const state = menuState(withBin);
  const calls: { fn: string; body: Record<string, unknown> }[] = [];
  const headers: (string | undefined)[] = [];
  const deletes: string[] = [];
  await page.route('**/rest/v1/categories**', (route) => {
    headers.push(route.request().headers()['x-menu-deleted']);
    return route.fulfill(json(state.tree()));
  });
  await page.route('**/rest/v1/menu_items**', (route) => {
    if (route.request().method() === 'DELETE') {
      deletes.push(route.request().url());
      return route.fulfill(json([], 200));
    }
    return route.fulfill(json([]));
  });
  for (const fn of ['admin_delete_menu_entry', 'admin_restore_menu_entry']) {
    await page.route(`**/rest/v1/rpc/${fn}`, (route) => {
      const body = route.request().postDataJSON() as { _kind: string; _id: string };
      calls.push({ fn, body });
      const row = state.items.find((i) => i.id === body._id)!;
      row.deleted_at = fn === 'admin_delete_menu_entry' ? new Date().toISOString() : null;
      return route.fulfill(json({ kind: body._kind, id: body._id, name: row.name, items: 1, subcategories: 0, already: false }));
    });
  }
  return { calls, headers, deletes };
}

async function openMains(page: Page) {
  await page.goto('/admin/menu');
  await page.getByRole('button', { name: /^Food/ }).click();
  await page.getByRole('button', { name: /^Mains/ }).click();
}

/** The trash button on a wide screen; the row's menu on a phone. */
async function deleteDish(page: Page, name: string) {
  const more = page.getByRole('button', { name: `More actions for ${name}` });
  if (await more.isVisible()) {
    await more.click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
  } else {
    await page.getByRole('button', { name: `Delete ${name}` }).click();
  }
}

const dishRow = (page: Page, name: string) => page.getByRole('switch', { name: new RegExp(`^${name}:`) });

test.describe('deleting from the menu', () => {
  test('a dish goes in one tap, and Undo brings it back', async ({ page }) => {
    const { calls, headers } = await withMenu(page, true);
    await openMains(page);
    await expect(dishRow(page, 'La Soul Burger')).toBeVisible();
    // The page asks for the bin's rows; the database shows them to this restaurant's staff only.
    expect(headers[0]).toBe('show');

    await deleteDish(page, 'La Soul Burger');
    await expect(page.getByText('Deleted La Soul Burger')).toBeVisible();
    await expect(dishRow(page, 'La Soul Burger')).toHaveCount(0);
    expect(calls).toEqual([{ fn: 'admin_delete_menu_entry', body: { _kind: 'item', _id: 'm1' } }]);

    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByText('La Soul Burger is back on the menu')).toBeVisible();
    await expect(dishRow(page, 'La Soul Burger')).toBeVisible();
    expect(calls[1]).toEqual({ fn: 'admin_restore_menu_entry', body: { _kind: 'item', _id: 'm1' } });
  });

  test('anything deleted before waits in Recently deleted, one tap from Restore', async ({ page }) => {
    const { calls } = await withMenu(page, true);
    await openMains(page);
    // Yesterday's deletion is not on the menu.
    await expect(dishRow(page, 'Shopska Salad')).toHaveCount(0);

    // The button at the top of the page opens it and scrolls down to it.
    await page.getByRole('button', { name: 'Recently deleted (1)' }).first().click();
    await expect(page.getByText('Food › Mains · deleted yesterday')).toBeVisible();
    await page.getByRole('button', { name: 'Restore Shopska Salad' }).click();
    await expect(page.getByText('Shopska Salad is back on the menu')).toBeVisible();
    await expect(dishRow(page, 'Shopska Salad')).toBeVisible();
    expect(calls).toEqual([{ fn: 'admin_restore_menu_entry', body: { _kind: 'item', _id: 'm3' } }]);
    // Nothing left in the bin, so neither it nor its button is shown.
    await expect(page.getByRole('button', { name: /Recently deleted/ })).toHaveCount(0);
  });

  test('a wrong sold-out tap is undone from the toast', async ({ page }) => {
    await withMenu(page, true);
    const writes: Record<string, unknown>[] = [];
    await page.route('**/rest/v1/menu_items**', (route) => {
      if (route.request().method() === 'PATCH') writes.push(route.request().postDataJSON());
      return route.fulfill(json([]));
    });
    await openMains(page);
    await dishRow(page, 'La Soul Fries').click();
    await expect(page.getByText('La Soul Fries is now sold out')).toBeVisible();
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect.poll(() => writes).toEqual([{ is_available: false }, { is_available: true }]);
    await expect(page.getByRole('switch', { name: 'La Soul Fries: available' })).toBeVisible();
  });

  test('before the database has the bin, Delete still asks first and is final', async ({ page }) => {
    const { calls, deletes } = await withMenu(page, false);
    await openMains(page);
    await deleteDish(page, 'La Soul Burger');
    await expect(page.getByRole('alertdialog')).toContainText('permanently removes');
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
    await expect.poll(() => deletes.length).toBe(1);
    expect(deletes[0]).toContain('id=eq.m1');
    expect(calls).toEqual([]);
  });
});

test('the orders page still names a dish deleted since', async ({ page }) => {
  const asked: (string | undefined)[] = [];
  await page.route('**/rest/v1/orders?**', (route) => {
    asked.push(route.request().headers()['x-menu-deleted']);
    return route.fallback();
  });
  await page.goto('/admin/orders');
  await expect.poll(() => asked.length).toBeGreaterThan(0);
  expect(asked[0]).toBe('show');
});
