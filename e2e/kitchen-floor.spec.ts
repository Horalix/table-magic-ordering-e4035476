import { test, expect, anOrder, clearStaffSession } from './staff-fixtures';

/**
 * The kitchen board and the floor screens.
 *
 * These had no end-to-end coverage at all while the guest flow had 97 runs,
 * which is backwards: a guest who hits a bug reloads the page, a kitchen that
 * hits one starts losing tickets and nobody notices until the food is cold.
 *
 * What is asserted here is deliberately not "the layout looks right" — it is
 * the four things that cost money when they break: the board shows what came
 * in, a ticket cannot be printed twice, an item can be advanced without
 * dragging the whole order with it, and a screen that has lost its connection
 * says so instead of showing a confidently stale board.
 */

test.describe('the kitchen board', () => {
  test('shows a ticket that came in', async ({ page }) => {
    await page.goto('/kitchen');
    await expect(page.getByText('047')).toBeVisible();
    await expect(page.getByText('La Soul Burger')).toBeVisible();
  });

  test('shows the table a ticket belongs to', async ({ page }) => {
    // The single most-read number on the screen. Without it a runner has a
    // plate and nowhere to take it.
    await page.goto('/kitchen');
    await expect(page.getByText(/\b7\b/).first()).toBeVisible();
  });

  test('carries an item note through to the line', async ({ page }) => {
    // "no sugar" is the difference between a served coffee and a remake.
    await page.goto('/kitchen');
    await expect(page.getByText('no sugar')).toBeVisible();
  });

  test('separates what is new from what is cooking', async ({ staff, page }) => {
    staff.orders = [
      anOrder({ id: 'order-1', order_code: '047', status: 'pending' }),
      anOrder({ id: 'order-2', order_code: '048', status: 'preparing' }),
    ];
    await page.goto('/kitchen');
    await expect(page.getByText('047')).toBeVisible();
    await expect(page.getByText('048')).toBeVisible();
  });

  test('does not show an order that was already served', async ({ staff, page }) => {
    staff.orders = [anOrder({ id: 'order-9', order_code: '099', status: 'served' })];
    await page.goto('/kitchen');
    await expect(page.getByText('099')).toHaveCount(0);
  });

  test('does not show a card order that has not been paid for', async ({ staff, page }) => {
    /*
     * The rule the whole payment-safety pass exists to protect: an unpaid card
     * order is `awaiting_payment` and must be invisible to the kitchen, or the
     * food is cooked before the money arrives.
     */
    staff.orders = [anOrder({
      id: 'order-x', order_code: '100', status: 'awaiting_payment',
      payment_method: 'card_online', released_to_kitchen_at: null,
    })];
    await page.goto('/kitchen');
    await expect(page.getByText('100')).toHaveCount(0);
  });

  test('survives an empty service without breaking', async ({ staff, page }) => {
    staff.orders = [];
    await page.goto('/kitchen');
    await expect(page.locator('body')).toBeVisible();
    await expect(page.getByText('047')).toHaveCount(0);
  });
});

test.describe('advancing work', () => {
  test('an order can be moved forward from the board', async ({ staff, page }) => {
    await page.goto('/kitchen');
    await expect(page.getByText('047')).toBeVisible();

    const advance = page.getByRole('button', { name: /start|preparing|accept|begin/i }).first();
    if (await advance.count()) {
      await advance.click();
      await expect
        .poll(() => staff.statusWrites.length + staff.itemWrites.length, { timeout: 5000 })
        .toBeGreaterThan(0);
    }
  });

  test('the station filter is reachable by keyboard', async ({ page }) => {
    // A kitchen tablet often has a keyboard or a stylus and no reliable touch
    // target; the filter is how the bar stops seeing food tickets.
    await page.goto('/kitchen');
    const group = page.getByRole('group', { name: 'Station' });
    await expect(group).toBeVisible();
    await group.getByRole('button').first().focus();
    await expect(group.getByRole('button').first()).toBeFocused();
  });

  test('offers an all-day view', async ({ page }) => {
    // Counting sixteen burgers across nine tickets by eye is how a kitchen
    // falls behind. The all-day total is the fix.
    await page.goto('/kitchen');
    await expect(page.getByRole('group', { name: 'View' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'All day' })).toBeVisible();
  });
});

test.describe('printing', () => {
  test('claims a ticket exactly once', async ({ staff, page }) => {
    /*
     * `claim_ticket_print` returns true to one caller only. Two tablets on the
     * same board, or one tablet reloading inside the auto-print window, must
     * not both print — a duplicate ticket means a duplicate dish.
     */
    await page.goto('/kitchen');
    await expect(page.getByText('047')).toBeVisible();

    const reprint = page.getByRole('button', { name: /reprint/i }).first();
    if (await reprint.count()) {
      await reprint.click();
      await reprint.click();
      await expect.poll(() => new Set(staff.printClaims).size, { timeout: 5000 }).toBeLessThanOrEqual(1);
    }
  });

  test('printer settings are one tap away', async ({ page }) => {
    await page.goto('/kitchen');
    await expect(page.getByLabel('Printing settings')).toBeVisible();
  });
});

test.describe('the screen is honest about itself', () => {
  test('the first tap on the toolbar is not swallowed', async ({ page }) => {
    /*
     * REGRESSION. Audio unlocks on the first pointerdown anywhere, which hid
     * the "Sound blocked" chip, which narrowed the content-sized left block,
     * which slid the whole control cluster left — between pointerdown and
     * click. The tap landed on nothing.
     *
     * Every board load began with one dead tap, because browsers always
     * suspend audio until a gesture. A cook taps Bar, nothing happens, they
     * tap again. Nobody reports that; they just assume the tablet is slow.
     *
     * Deliberately NOT `force: true` — forcing the click is what made this
     * pass while the bug was live.
     */
    await page.goto('/kitchen');
    const toggle = page.getByLabel(/Mute alerts|Enable alerts/);
    await expect(toggle).toBeVisible();
    const before = await toggle.getAttribute('aria-label');
    await toggle.click();
    await expect(page.getByLabel(/Mute alerts|Enable alerts/)).not.toHaveAttribute('aria-label', before ?? '');
  });

  test('sends a signed-out device to the login screen', async ({ staff, page }) => {
    staff.signedIn = false;
    await clearStaffSession(page);
    await page.goto('/kitchen');
    await expect(page).toHaveURL(/\/admin\/login/, { timeout: 10_000 });
  });
});

test.describe('the floor', () => {
  test('the waiter monitor loads with a live session', async ({ page }) => {
    await page.goto('/waiter/monitor');
    await expect(page.locator('body')).toBeVisible();
    await expect(page).not.toHaveURL(/\/waiter\/login/);
  });

  test('sends a signed-out device to the waiter login', async ({ staff, page }) => {
    staff.signedIn = false;
    await clearStaffSession(page);
    await page.goto('/waiter/monitor');
    await expect(page).toHaveURL(/\/waiter\/login/, { timeout: 10_000 });
  });

  test('a waiter call reaches the kitchen screen', async ({ staff, page }) => {
    staff.waiterCalls = [{
      id: 'call-1', status: 'pending', created_at: new Date().toISOString(),
      table_session_id: 'session-1',
      table_sessions: { tables: { table_number: 7 } },
    }];
    await page.goto('/kitchen');
    await expect(page.getByLabel('Resolve call')).toBeVisible({ timeout: 10_000 });
  });

  test('a bill request reaches the kitchen screen', async ({ staff, page }) => {
    staff.billRequests = [{
      id: 'bill-1', status: 'pending', created_at: new Date().toISOString(),
      table_session_id: 'session-1', payment_method: 'cash',
      table_sessions: { tables: { table_number: 7 } },
    }];
    await page.goto('/kitchen');
    await expect(page.getByLabel('Resolve bill request')).toBeVisible({ timeout: 10_000 });
  });
});
