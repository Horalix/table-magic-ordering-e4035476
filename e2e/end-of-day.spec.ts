import { test, expect } from './staff-fixtures';
import type { Page, Route } from '@playwright/test';

/**
 * After the work day, staff screens say which tables are still open and
 * close them all at a tap (src/components/staff/EndOfDayTables.tsx). A table
 * that owes money is named and stays open.
 */

const json = (route: Route, body: unknown) => route.fulfill({
  status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body),
});

const table = (n: number, owed = 0, overnight = false) => ({
  session_id: `session-${n}`, table_number: n, opened_at: new Date(Date.now() - 3 * 3_600_000).toISOString(),
  outstanding: owed, unpaid_orders: owed > 0 ? 1 : 0, overnight,
});

interface Floor {
  local_time: string;
  day_ends_at: string | null;
  tables: ReturnType<typeof table>[];
  closes: number;
}

/** The database's two answers: what is open, and Close all tables (which frees the settled ones). */
async function stubFloor(page: Page, floor: Floor) {
  await page.route('**/rest/v1/rpc/staff_open_tables**', (route) => json(route, {
    local_time: floor.local_time, weekday: 2, day_ends_at: floor.day_ends_at, closes_overnight: true, tables: floor.tables,
  }));
  await page.route('**/rest/v1/rpc/staff_close_all_tables**', (route) => {
    floor.closes += 1;
    const kept = floor.tables.filter((t) => t.unpaid_orders > 0);
    const closed = floor.tables.length - kept.length;
    floor.tables = kept;
    return json(route, {
      closed,
      kept: kept.map(({ session_id, table_number, outstanding, unpaid_orders }) => ({ session_id, table_number, outstanding, unpaid_orders })),
    });
  });
}

async function asMarko(page: Page) {
  await page.route('**/rest/v1/waiters**', (route) => route.fulfill({
    status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify(route.request().url().includes('user_id=eq')
      ? { id: 'waiter-1', user_id: 'staff-user-1', display_name: 'Marko' }
      : [{ id: 'waiter-1', user_id: 'staff-user-1', display_name: 'Marko' }]),
  }));
}

const notice = (page: Page) => page.getByTestId('end-of-day');

test.describe('after the work day', () => {
  // The doors of La Soul close at 21:00 (src/lib/venues.ts); nothing is set in the admin.
  const evening = (): Floor => ({ local_time: '21:45', day_ends_at: null, tables: [table(1), table(3), table(7, 24)], closes: 0 });

  test('the admin says how many tables are open, closes the settled ones, and keeps the one that owes', async ({ page }) => {
    const floor = evening();
    await stubFloor(page, floor);
    await page.goto('/admin/orders');
    await expect(notice(page)).toContainText('The work day is over. 3 tables are still open.');
    await expect(notice(page)).toContainText('Table 7 still owes 24.00 KM.');
    await expect(notice(page)).toContainText('closed automatically overnight');

    await notice(page).getByRole('button', { name: 'Close all tables' }).click();
    const dialog = page.getByRole('dialog', { name: 'Close all tables?' });
    await expect(dialog).toContainText('Tables 1 and 3 are paid up and will be freed.');
    await expect(dialog.getByRole('alert')).toContainText('Table 7 still owes 24.00 KM');
    await dialog.getByRole('button', { name: 'Close 2 tables' }).click();

    await expect(page.getByText('2 tables closed')).toBeVisible();
    await expect(dialog).toHaveCount(0);
    expect(floor.closes).toBe(1);
    // Only the table that owes is left, and nothing can be closed.
    await expect(notice(page)).toContainText('The work day is over. 1 table is still open.');
    await expect(notice(page).getByRole('button', { name: 'Close all tables' })).toHaveCount(0);
    await notice(page).getByRole('button', { name: 'See tables' }).click();
    await expect(page.getByRole('dialog', { name: 'Close all tables?' }).getByRole('button', { name: 'Nothing to close' })).toBeDisabled();
  });

  test('the waiter phone and the floor screen say it too', async ({ page }) => {
    await stubFloor(page, evening());
    await asMarko(page);
    await page.goto('/waiter');
    await expect(notice(page)).toContainText('3 tables are still open');
    await page.goto('/waiter/monitor');
    await expect(notice(page)).toContainText('3 tables are still open');
  });

  test('"Not yet" puts it away while the last guests sit, for this visit', async ({ page }) => {
    await stubFloor(page, evening());
    await page.goto('/admin/orders');
    await notice(page).getByRole('button', { name: 'Not yet' }).click();
    await expect(notice(page)).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Orders' })).toBeVisible();
    await expect(notice(page)).toHaveCount(0);
  });
});

test.describe('during service', () => {
  test('nothing is said, and Tables still has Close all tables', async ({ page }) => {
    const floor: Floor = { local_time: '19:00', day_ends_at: null, tables: [table(1), table(2)], closes: 0 };
    await stubFloor(page, floor);
    await page.goto('/admin/tables');
    await expect(page.getByRole('heading', { level: 1, name: 'Table Management' })).toBeVisible();
    await expect(notice(page)).toHaveCount(0);
    await page.getByRole('button', { name: 'Close all tables (2 open)' }).click();
    await page.getByRole('dialog', { name: 'Close all tables?' }).getByRole('button', { name: 'Close 2 tables' }).click();
    await expect(page.getByText('2 tables closed')).toBeVisible();
    await expect(page.getByRole('button', { name: /Close all tables/ })).toHaveCount(0);
  });

  test('the work day ends when the manager says, not at closing time', async ({ page }) => {
    await stubFloor(page, { local_time: '21:45', day_ends_at: '23:00', tables: [table(1)], closes: 0 });
    await page.goto('/admin/orders');
    await expect(page.getByRole('heading', { level: 1, name: 'Orders' })).toBeVisible();
    await expect(notice(page)).toHaveCount(0);
  });

  test('a table left from an earlier day is flagged at any hour', async ({ page }) => {
    await stubFloor(page, { local_time: '12:00', day_ends_at: null, tables: [table(4, 0, true), table(5)], closes: 0 });
    await page.goto('/admin/orders');
    await expect(notice(page)).toContainText('1 table was left open from an earlier day.');
    await expect(notice(page).getByRole('button', { name: 'Not yet' })).toHaveCount(0);
  });
});

test('a database from before this feature shows nothing', async ({ page }) => {
  // The fixtures answer an unknown function with an empty list.
  await page.goto('/admin/tables');
  await expect(page.getByRole('heading', { level: 1, name: 'Table Management' })).toBeVisible();
  await expect(notice(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Close all tables/ })).toHaveCount(0);
});
