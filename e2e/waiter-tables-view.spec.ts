import { test, expect, anOrder } from './staff-fixtures';
import type { Page } from '@playwright/test';

/**
 * Settings → "My tables shows" on the waiter phone: only the seated tables
 * (as it always was), or every table in the waiter's sections today.
 */

const iso = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

const json = (body: unknown) => ({
  status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body),
});

/**
 * Marko is on the Terrace (tables 5–9) with Lejla. He has 6 and 7, Lejla has
 * 8, table 9 sat down with nobody, and 5 is free.
 */
async function terraceWithMarko(page: Page) {
  const asked: string[] = [];
  page.on('request', (r) => { if (r.url().includes('/rest/v1/')) asked.push(new URL(r.url()).pathname.split('/rest/v1/')[1]); });
  await page.route('**/rest/v1/waiters**', (route) => route.fulfill(json(
    route.request().url().includes('user_id=eq')
      ? { id: 'waiter-1', user_id: 'staff-user-1', display_name: 'Marko' }
      : [
          { id: 'waiter-1', user_id: 'staff-user-1', display_name: 'Marko' },
          { id: 'waiter-2', user_id: 'staff-user-2', display_name: 'Lejla' },
        ],
  )));
  const mine = [
    { id: 'session-7', opened_at: iso(40), guest_name: 'Amina', table_id: 't7', tables: { table_number: 7, section_id: 'sec-1' } },
    { id: 'session-6', opened_at: iso(70), guest_name: 'Haris', table_id: 't6', tables: { table_number: 6, section_id: 'sec-1' } },
  ];
  const nobody = { id: 'session-9', opened_at: iso(5), guest_name: 'Lejla', table_id: 't9', tables: { table_number: 9, section_id: 'sec-1' } };
  await page.route('**/rest/v1/table_sessions**', (route) => {
    const url = decodeURIComponent(route.request().url());
    if (url.includes('tables.section_id=in.')) {
      return route.fulfill(json([
        { id: 'session-7', table_id: 't7', assigned_waiter_id: 'waiter-1', tables: { section_id: 'sec-1' } },
        { id: 'session-6', table_id: 't6', assigned_waiter_id: 'waiter-1', tables: { section_id: 'sec-1' } },
        { id: 'session-8', table_id: 't8', assigned_waiter_id: 'waiter-2', tables: { section_id: 'sec-1' } },
        { id: 'session-9', table_id: 't9', assigned_waiter_id: null, tables: { section_id: 'sec-1' } },
      ]));
    }
    return route.fulfill(json(url.includes('assigned_waiter_id=is.null') ? [nobody] : mine));
  });
  await page.route('**/rest/v1/section_assignments**', (route) => route.fulfill(json(
    decodeURIComponent(route.request().url()).includes('waiter_id=eq.waiter-1') ? [{ section_id: 'sec-1' }] : [],
  )));
  await page.route('**/rest/v1/tables**', (route) => route.fulfill(json(
    [5, 6, 7, 8, 9].map((n) => ({ id: `t${n}`, table_number: n, section_id: 'sec-1' })),
  )));
  return asked;
}

const chooseAllTables = async (page: Page) => {
  await page.getByRole('button', { name: 'Settings' }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await dialog.getByRole('radio', { name: /All my tables/ }).click();
  await dialog.getByRole('button', { name: 'Done' }).click();
};

test.describe('what "My tables" shows', () => {
  test('starts with only the seated tables, and asks for nothing more', async ({ page }) => {
    const asked = await terraceWithMarko(page);
    await page.goto('/waiter');
    await expect(page.getByRole('button', { name: /My tables/ })).toBeVisible();
    await expect(page.getByRole('list', { name: 'All my tables' })).toHaveCount(0);
    expect(asked.some((p) => p.startsWith('section_assignments') || p.startsWith('tables'))).toBe(false);
  });

  test('"All my tables" lists every table in my sections, and the phone remembers it', async ({ staff, page }) => {
    staff.orders = [];
    await terraceWithMarko(page);
    await page.goto('/waiter');
    await chooseAllTables(page);

    const floor = page.getByRole('list', { name: 'All my tables' });
    await expect(floor.getByRole('listitem')).toHaveCount(5);
    await expect(floor.getByLabel('Table 5, free')).toBeVisible();
    await expect(floor.getByRole('button', { name: /^Table 6, yours/ })).toBeVisible();
    await expect(floor.getByRole('button', { name: /^Table 7, yours/ })).toBeVisible();
    await expect(floor.getByLabel('Table 8, seated with Lejla')).toBeVisible();
    await expect(floor.getByRole('button', { name: /^Table 9, seated, no waiter/ })).toBeVisible();
    await expect(page.getByRole('list', { name: 'Floor summary' })).toHaveText(/2 yours.*1 with Lejla.*1 no waiter.*1 free/);
    // Each table once: no second list of cards under the tiles, and table 9
    // is not repeated under "No waiter yet".
    await expect(page.getByRole('button', { name: 'Free table' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'No waiter yet' })).toHaveCount(0);

    await page.reload();
    await expect(page.getByRole('list', { name: 'All my tables' }).getByRole('listitem')).toHaveCount(5);

    // And back again.
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('dialog', { name: 'Settings' }).getByRole('radio', { name: /Only seated tables/ }).click();
    await page.getByRole('dialog', { name: 'Settings' }).getByRole('button', { name: 'Done' }).click();
    await expect(page.getByRole('list', { name: 'All my tables' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /My tables/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'No waiter yet' })).toBeVisible();
  });

  test('the floor sits right under "Attention needed", above the kitchen', async ({ page }) => {
    await terraceWithMarko(page);
    await page.goto('/waiter');
    await chooseAllTables(page);
    await expect(page.getByRole('list', { name: 'All my tables' })).toBeVisible();
    const top = async (name: string) => (await page.getByRole('heading', { name, exact: true }).boundingBox())!.y;
    expect(await top('Attention needed')).toBeLessThan(await top('My tables'));
    expect(await top('My tables')).toBeLessThan(await top('In the kitchen'));
  });

  test('a tile says what is going on at the table, and opens it', async ({ staff, page }) => {
    const t6 = { tables: { table_number: 6 } };
    const t7 = { tables: { table_number: 7 } };
    staff.orders = [
      anOrder({ id: 'up-7', status: 'ready', total: 24, table_session_id: 'session-7', table_sessions: t7 }),
      anOrder({ id: 'cook-6', status: 'preparing', total: 31, table_session_id: 'session-6', table_sessions: t6 }),
    ];
    staff.billRequests = [{ id: 'b6', status: 'pending', created_at: iso(2), table_session_id: 'session-6', table_sessions: t6 }];
    await terraceWithMarko(page);
    await page.goto('/waiter');
    await chooseAllTables(page);

    const floor = page.getByRole('list', { name: 'All my tables' });
    const tile7 = floor.getByRole('button', { name: /^Table 7, yours/ });
    const tile6 = floor.getByRole('button', { name: /^Table 6, yours/ });
    await expect(tile7).toHaveAccessibleName('Table 7, yours, food ready, owes 24.00 KM');
    await expect(tile7).toContainText('Food up');
    await expect(tile6).toHaveAccessibleName('Table 6, yours, wants the bill, 1 in the kitchen, owes 31.00 KM');
    await expect(tile6).toContainText('Bill');

    await tile6.click();
    const sheet = page.getByRole('dialog', { name: 'Table 6' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText('Wants the bill')).toBeVisible();
    await expect(sheet.getByText('1 order cooking')).toBeVisible();
    await expect(sheet.getByText(/Owes\s*31\.00 KM/)).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Cash' })).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Free table' })).toBeVisible();

    // "Go to it" closes the sheet and brings up the card with its buttons.
    await sheet.getByRole('button', { name: 'Go to it' }).click();
    await expect(sheet).toBeHidden();
    await expect(page.getByRole('button', { name: 'Bill given' })).toBeInViewport();
  });

  test('a table seated with nobody is one tap to take', async ({ staff, page }) => {
    await terraceWithMarko(page);
    await page.goto('/waiter');
    await chooseAllTables(page);
    await page.getByRole('button', { name: /^Table 9, seated, no waiter/ }).click();
    await expect.poll(() => staff.rpcCalls.filter((c) => c.fn === 'staff_take_table').map((c) => c.body))
      .toContainEqual({ _session_id: 'session-9' });
  });

  test('with no section today, says so and still shows my seated tables', async ({ page }) => {
    await terraceWithMarko(page);
    await page.route('**/rest/v1/section_assignments**', (route) => route.fulfill(json([])));
    await page.goto('/waiter');
    await chooseAllTables(page);
    await expect(page.getByText(/No section is yours today/)).toBeVisible();
    await expect(page.getByRole('list', { name: 'All my tables' }).getByRole('listitem')).toHaveCount(2);
  });

  test('fits a phone: nothing runs off the side, the header or the settings', async ({ page }) => {
    await terraceWithMarko(page);
    await page.goto('/waiter');
    await chooseAllTables(page);
    await expect(page.getByRole('list', { name: 'All my tables' }).getByRole('listitem')).toHaveCount(5);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const width = await page.evaluate(() => window.innerWidth);
    // Every tile the same height, so the room reads as a grid.
    for (const tile of await page.getByRole('list', { name: 'All my tables' }).getByRole('listitem').all()) {
      const box = await tile.boundingBox();
      expect(box && box.x >= 0 && box.x + box.width <= width).toBe(true);
      expect(Math.round(box!.height)).toBe(84);
    }
    await page.getByRole('button', { name: /^Table 7, yours/ }).click();
    const sheet = await page.getByRole('dialog', { name: 'Table 7' }).boundingBox();
    expect(sheet && sheet.x >= 0 && sheet.x + sheet.width <= width).toBe(true);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Table 7' })).toBeHidden();
    await page.getByRole('button', { name: 'Settings' }).click();
    const box = await page.getByRole('dialog', { name: 'Settings' }).boundingBox();
    expect(box && box.x >= 0 && box.x + box.width <= width).toBe(true);
  });
});
