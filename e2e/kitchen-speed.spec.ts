import { test, expect, anOrder } from './staff-fixtures';

/**
 * The kitchen board, timed.
 *
 * Each spec is one of the jobs a cook does fifty times a night — notice a new
 * ticket, start it, finish it, take back a mis-tap — and holds it to the fewest
 * taps (or keys) and to being impossible to miss.
 */

const iso = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

test.describe('a new order', () => {
  test('arrives with a banner nobody can miss, and "Got it" clears it', async ({ staff, page }) => {
    test.slow();
    await page.goto('/kitchen');
    await expect(page.getByText('#047')).toBeVisible();
    await expect(page.getByText('New order', { exact: true })).toHaveCount(0);

    staff.orders = [...staff.orders, anOrder({
      id: 'order-new', order_code: '312', created_at: iso(0), released_to_kitchen_at: iso(0),
      table_sessions: { tables: { table_number: 12, section_id: 'sec-1', sections: { name: 'Terrace', color: '#B0641F' } } },
    })];
    const banner = page.getByRole('alert').filter({ hasText: 'New order' });
    await expect(banner).toBeVisible({ timeout: 25_000 });
    await expect(banner).toContainText('Table 12 #312');
    // Flagged on its card too.
    await expect(page.locator('#ticket-order-new').getByText('New', { exact: true })).toBeVisible();

    await banner.getByRole('button', { name: 'Got it' }).click();
    await expect(banner).toHaveCount(0);
  });
});

test.describe('bump bar and keyboard', () => {
  test('1 picks the oldest ticket, Enter starts it, Backspace takes it back', async ({ staff, page }) => {
    staff.orders = [
      anOrder({ id: 'order-old', order_code: '200', created_at: iso(12), released_to_kitchen_at: iso(12) }),
      anOrder({
        id: 'order-new', order_code: '201', created_at: iso(3), released_to_kitchen_at: iso(3),
        order_items: [{
          id: 'oi-9', order_id: 'order-new', menu_item_id: 'x', quantity: 1, unit_price: 5, notes: null,
          status: 'pending', station: 'kitchen', menu_items: { name: 'Tea' },
        }],
      }),
    ];
    await page.goto('/kitchen');
    await expect(page.getByText('#200')).toBeVisible();

    await page.keyboard.press('1');
    await expect(page.locator('#ticket-order-old')).toHaveAttribute('data-selected', 'true');
    await page.keyboard.press('Enter');
    await expect.poll(() => staff.itemWrites).toEqual([
      { id: 'oi-1', status: 'preparing' }, { id: 'oi-2', status: 'preparing' },
    ]);

    await page.keyboard.press('Backspace');
    await expect.poll(() => staff.itemWrites.slice(2)).toEqual([
      { id: 'oi-1', status: 'pending' }, { id: 'oi-2', status: 'pending' },
    ]);

    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#ticket-order-new')).toHaveAttribute('data-selected', 'true');
  });

  test('keys do nothing while someone is typing', async ({ staff, page }) => {
    await page.goto('/kitchen');
    await expect(page.getByText('#047')).toBeVisible();
    await page.getByRole('button', { name: 'Void' }).first().click();
    await page.getByLabel('Reason for voiding').fill('1 ');
    await page.keyboard.press('Enter');
    expect(staff.itemWrites).toEqual([]);
  });

  test('lists its shortcuts', async ({ page }) => {
    // A tablet or a PC on the pass; on a phone the key list is not offered.
    await page.setViewportSize({ width: 1180, height: 820 });
    await page.goto('/kitchen');
    await page.getByRole('button', { name: 'Keyboard and bump bar shortcuts' }).click();
    await expect(page.getByRole('dialog')).toContainText('Bump: start all → all ready → served');
  });
});

test.describe('taking back a mis-tap', () => {
  test('"Mark served" can be undone from the toast, after the card has gone', async ({ staff, page }) => {
    staff.orders = [anOrder({
      id: 'order-r', order_code: '077', status: 'ready', ready_at: iso(1),
      order_items: [{
        id: 'oi-r', order_id: 'order-r', menu_item_id: 'x', quantity: 1, unit_price: 5, notes: null,
        status: 'ready', station: 'kitchen', menu_items: { name: 'Soup' },
      }],
    })];
    const reverts: unknown[] = [];
    await page.route('**/rest/v1/rpc/staff_revert_order_status**', (route) => {
      reverts.push(route.request().postDataJSON());
      return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ status: 'ready', reverted_from: 'served' }) });
    });
    await page.goto('/kitchen');
    await page.getByRole('button', { name: 'Mark served' }).click();
    await expect.poll(() => staff.statusWrites).toEqual([{ id: 'order-r', status: 'served' }]);
    await expect(page.getByText('#077')).toHaveCount(0);

    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect.poll(() => reverts).toEqual([{ _order_id: 'order-r', _to: 'ready', _reason: 'kitchen undo' }]);
  });
});

test.describe('built for a tablet on the pass', () => {
  test('bump buttons are big enough for a wet thumb', async ({ page }) => {
    await page.setViewportSize({ width: 1180, height: 820 });
    await page.goto('/kitchen');
    await expect(page.getByText('#047')).toBeVisible();
    const start = page.getByRole('button', { name: 'Mark La Soul Burger as preparing' });
    // Cards scale in from 96%; measure once they have settled.
    await page.waitForTimeout(600);
    const box = await start.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(54);
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(92);
  });

  test('a late ticket says so in colour and in words', async ({ staff, page }) => {
    staff.orders = [anOrder({ created_at: iso(20), released_to_kitchen_at: iso(20) })];
    await page.goto('/kitchen');
    await expect(page.locator('#ticket-order-1')).toContainText(/!!\s*20m — late/);
  });

  test('remembers the section after a reload', async ({ page }) => {
    await page.goto('/kitchen');
    await page.getByLabel('Filter by section').selectOption('sec-1');
    await page.reload();
    await expect(page.getByLabel('Filter by section')).toHaveValue('sec-1');
  });

  test('offers full screen', async ({ page }) => {
    await page.goto('/kitchen');
    await expect(page.getByRole('button', { name: 'Full screen' })).toBeVisible();
  });
});
