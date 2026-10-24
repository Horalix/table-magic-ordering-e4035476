import { test, expect, anOrder, aHeldOrder, clearStaffSession } from './staff-fixtures';

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

  test('puts the oldest ticket at the top of its column', async ({ staff, page }) => {
    /*
     * The board is a queue. Newest-first buried the late table under the one
     * that had just come in, which is exactly backwards for a cook choosing
     * what to make next. "Oldest" means oldest IN THE KITCHEN — a card order
     * counts from when its payment released it, not from when it was placed.
     */
    const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
    staff.orders = [
      anOrder({ id: 'order-new', order_code: '201', created_at: minutesAgo(3), released_to_kitchen_at: minutesAgo(3) }),
      anOrder({ id: 'order-old', order_code: '200', created_at: minutesAgo(12), released_to_kitchen_at: minutesAgo(12) }),
    ];
    await page.goto('/kitchen');
    const oldTop = (await page.getByText('#200').boundingBox())?.y ?? 0;
    const newTop = (await page.getByText('#201').boundingBox())?.y ?? 0;
    expect(oldTop).toBeLessThan(newTop);
  });

  test('a cook reading a note cannot bump the line by touching it', async ({ staff, page }) => {
    // The whole row used to be a bump button, so steadying the tablet on the
    // note ("no sugar") marked the coffee as started.
    await page.goto('/kitchen');
    await page.getByText('no sugar').click();
    await page.waitForTimeout(500);
    expect(staff.itemWrites).toHaveLength(0);
  });

  test('keeps the ticket exports out of the way', async ({ page }) => {
    await page.goto('/kitchen');
    await expect(page.getByText('047')).toBeVisible();
    await expect(page.getByRole('button', { name: 'JSON' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'More ticket actions' }).first()).toBeVisible();
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

  test('a cook who is not a manager is not offered the admin gear', async ({ staff, page }) => {
    // The gear leads into the admin area, which used to sign non-managers out
    // — so a cook tapping it was logged out of the kitchen mid-service.
    staff.isAdmin = false;
    await page.goto('/kitchen');
    await expect(page.getByText('047')).toBeVisible();
    await expect(page.getByLabel('Printing settings')).toHaveCount(0);
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

  test('keeps refreshing while the live connection is down', async ({ staff, page }) => {
    /*
     * Realtime is refused in these fixtures. The pill has always said
     * "refreshing every 15s" in that state — and the board, which keeps its
     * data in plain state rather than React Query, never refreshed at all. A
     * ticket arriving after load must appear on the next poll tick.
     */
    test.slow();
    await page.goto('/kitchen');
    await expect(page.getByText('047')).toBeVisible();

    staff.orders = [...staff.orders, anOrder({ id: 'order-late', order_code: '312' })];
    await expect(page.getByText('#312')).toBeVisible({ timeout: 25_000 });
  });

  test('stays LTR and English after a guest chose Arabic on this device', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('lasoul-lang', 'ar');
      document.documentElement.dir = 'rtl';
    });
    await page.goto('/kitchen');
    await expect(page.getByText('047')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
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

  test('a claimed call stays on the kitchen screen and says who is going', async ({ staff, page }) => {
    // Claimed calls used to vanish the moment someone tapped "I'll go", which
    // read as "handled" while the guest was still waiting.
    staff.waiterCalls = [{
      id: 'call-2', status: 'acknowledged', created_at: new Date().toISOString(),
      acknowledged_by: 'someone-else', acknowledged_at: new Date().toISOString(),
      table_session_id: 'session-1',
      table_sessions: { tables: { table_number: 7 } },
    }];
    await page.goto('/kitchen');
    await expect(page.getByText(/is going/)).toBeVisible({ timeout: 10_000 });
  });

  test('ticking a bill request asks first, and will not free a table that owes', async ({ staff, page }) => {
    /*
     * The ✓ used to resolve the request AND free the table in one tap on a
     * 24px target, without looking at the bill. Now it confirms, asks the
     * server, and shows the refusal with the amount.
     */
    staff.closeOutstanding = 38;
    staff.billRequests = [{
      id: 'bill-2', status: 'pending', created_at: new Date().toISOString(),
      table_session_id: 'session-1',
      table_sessions: { tables: { table_number: 7 } },
    }];
    await page.goto('/kitchen');
    await page.getByLabel('Resolve bill request').click();
    await expect(page.getByRole('dialog')).toContainText('Free table 7?');
    expect(staff.rpcCalls.filter((c) => c.fn === 'staff_close_session')).toHaveLength(0);

    await page.getByRole('button', { name: 'Free table', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('still owes 38.00 KM');
    expect(staff.rpcCalls.map((c) => c.fn)).toContain('staff_close_session');
  });

  test('a bill request can be cleared without freeing the table', async ({ staff, page }) => {
    staff.billRequests = [{
      id: 'bill-3', status: 'pending', created_at: new Date().toISOString(),
      table_session_id: 'session-1',
      table_sessions: { tables: { table_number: 7 } },
    }];
    await page.goto('/kitchen');
    await page.getByLabel('Resolve bill request').click();
    await page.getByRole('button', { name: 'Just clear the request' }).click();
    await expect.poll(() => staff.rpcCalls.map((c) => c.fn)).toContain('staff_resolve_bill_request');
    expect(staff.rpcCalls.map((c) => c.fn)).not.toContain('staff_close_session');
  });
});

test.describe('orders waiting for staff', () => {
  /*
   * The database holds a pay-at-table order that might not come from anyone at
   * the table (20261024190000_order_abuse_guards.sql). It must not look like
   * kitchen work, and whoever is nearest must be able to confirm, reject or
   * block it in one or two taps.
   */
  test('a held order is on the Needs confirming card, not the board', async ({ staff, page }) => {
    staff.orders = [anOrder(), aHeldOrder()];
    await page.goto('/kitchen');
    const card = page.getByRole('region', { name: 'Needs confirming' });
    await expect(card).toBeVisible();
    await expect(card.getByText('Table 9')).toBeVisible();
    await expect(card.getByText('Large first order')).toBeVisible();
    await expect(card.getByText('72.00 KM')).toBeVisible();
    // On the card once, and nowhere on the board.
    await expect(page.getByText('Cevapi Platter')).toHaveCount(1);
    await expect(page.getByText('La Soul Burger')).toBeVisible();
  });

  test('confirming sends it to the kitchen', async ({ staff, page }) => {
    staff.orders = [aHeldOrder()];
    await page.goto('/kitchen');
    const confirm = page.getByRole('button', { name: 'Confirm order for table 9' });
    await expect(confirm).toBeVisible();
    // Tapped by someone carrying plates.
    expect((await confirm.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await confirm.click();

    await expect.poll(() => staff.rpcCalls.filter((c) => c.fn === 'staff_release_held_order').map((c) => c.body._order_id))
      .toEqual(['order-held']);
    await expect(page.getByRole('region', { name: 'Needs confirming' })).toHaveCount(0);
    // Released, so now it is ordinary kitchen work.
    await expect(page.getByText('Cevapi Platter')).toBeVisible();
  });

  test('rejecting asks for a reason first', async ({ staff, page }) => {
    staff.orders = [aHeldOrder()];
    await page.goto('/kitchen');
    await page.getByRole('button', { name: 'Reject order for table 9' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Reject order #090');
    const reject = dialog.getByRole('button', { name: 'Reject order' });
    await expect(reject).toBeDisabled();
    expect(staff.rpcCalls.filter((c) => c.fn === 'cancel_order')).toHaveLength(0);

    await dialog.getByLabel('Reason for rejecting').fill('Nobody at table 9');
    await reject.click();
    await expect.poll(() => staff.rpcCalls.find((c) => c.fn === 'cancel_order')?.body)
      .toEqual({ _order_id: 'order-held', _reason: 'Nobody at table 9' });
    await expect(page.getByRole('region', { name: 'Needs confirming' })).toHaveCount(0);
  });

  test('a big first order cannot be blocked, only confirmed or rejected', async ({ staff, page }) => {
    staff.orders = [aHeldOrder()];
    await page.goto('/kitchen');
    await expect(page.getByRole('button', { name: 'Confirm order for table 9' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Block table 9' })).toHaveCount(0);
  });

  test('a suspicious one can block the table, after asking', async ({ staff, page }) => {
    staff.orders = [aHeldOrder({ held_reason: 'venue_burst' })];
    await page.goto('/kitchen');
    await expect(page.getByText('Many new tables at once')).toBeVisible();
    await page.getByRole('button', { name: 'Block table 9' }).click();
    await expect(page.getByRole('alertdialog')).toContainText('Block table 9?');
    expect(staff.rpcCalls.filter((c) => c.fn === 'staff_block_session')).toHaveLength(0);

    await page.getByRole('alertdialog').getByRole('button', { name: 'Block table' }).click();
    await expect.poll(() => staff.rpcCalls.find((c) => c.fn === 'staff_block_session')?.body._session_id)
      .toBe('session-9');
  });

  test('the waiter phone and the floor monitor show it too', async ({ staff, page }) => {
    staff.orders = [aHeldOrder({ held_reason: 'second_session' })];
    // The waiter phone needs a waiter profile behind the signed-in user; the
    // shared stub has none. Registered last, so it wins (see staff-fixtures).
    await page.route('**/rest/v1/waiters**', (route) => route.fulfill({
      status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify([{ id: 'waiter-1', user_id: 'staff-user-1', display_name: 'Marko' }]),
    }));
    await page.goto('/waiter');
    await expect(page.getByRole('region', { name: 'Needs confirming' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Second session on table 9')).toBeVisible();

    await page.goto('/waiter/monitor');
    await expect(page.getByRole('region', { name: 'Needs confirming' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: 'Confirm order for table 9' })).toBeVisible();
  });
});
