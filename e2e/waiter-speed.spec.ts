import { test, expect, anOrder } from './staff-fixtures';
import type { Page } from '@playwright/test';

/**
 * The waiter phone, timed: what needs me, in what order, and how few taps.
 */

const iso = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

const json = (body: unknown) => ({
  status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body),
});

/** Marko, with tables 7 and 6. */
async function asMarko(page: Page) {
  await page.route('**/rest/v1/waiters**', (route) => route.fulfill(json(
    route.request().url().includes('user_id=eq')
      ? { id: 'waiter-1', user_id: 'staff-user-1', display_name: 'Marko' }
      : [{ id: 'waiter-1', user_id: 'staff-user-1', display_name: 'Marko' }],
  )));
  await page.route('**/rest/v1/table_sessions**', (route) => route.fulfill(json(
    route.request().url().includes('assigned_waiter_id=is.null') ? [] : [
      { id: 'session-1', opened_at: iso(40), guest_name: 'Amina', table_id: 't7', tables: { table_number: 7, section_id: 'sec-1' } },
      { id: 'session-6', opened_at: iso(70), guest_name: 'Haris', table_id: 't6', tables: { table_number: 6, section_id: 'sec-1' } },
    ],
  )));
}

const t6 = { tables: { table_number: 6 } };
const t7 = { tables: { table_number: 7 } };

test.describe('what needs me now', () => {
  test('food that is up comes first, then a call, then the bill', async ({ staff, page }) => {
    staff.orders = [anOrder({ id: 'w1', status: 'ready', table_session_id: 'session-1', table_sessions: t7, ready_at: iso(1) })];
    staff.waiterCalls = [{ id: 'c1', status: 'pending', created_at: iso(3), table_session_id: 'session-1', table_sessions: t7 }];
    staff.billRequests = [{ id: 'b1', status: 'pending', created_at: iso(4), table_session_id: 'session-6', table_sessions: t6 }];
    await asMarko(page);
    await page.goto('/waiter');
    const list = page.locator('section').filter({ hasText: 'Attention needed' });
    await expect(list.getByText('Ready to run')).toBeVisible();
    const order = await list.getByText(/Ready to run|Needs you|Wants the bill/).allTextContents();
    expect(order.map((t) => t.split(' ·')[0].trim())).toEqual(['Ready to run', 'Needs you', 'Wants the bill']);
  });

  // A table on nobody's section used to be silent on every phone.
  test('a call from a table with no waiter reaches everyone, and one tap takes the table', async ({ staff, page }) => {
    await asMarko(page);
    await page.route('**/rest/v1/table_sessions**', (route) => route.fulfill(json(
      route.request().url().includes('assigned_waiter_id=is.null')
        ? [{ id: 'session-9', opened_at: iso(5), guest_name: 'Lejla', table_id: 't9', tables: { table_number: 9, section_id: null } }]
        : [],
    )));
    staff.waiterCalls = [{ id: 'c9', status: 'pending', created_at: iso(1), table_session_id: 'session-9', table_sessions: { tables: { table_number: 9 } } }];
    await page.goto('/waiter');
    const list = page.locator('section').filter({ hasText: 'Attention needed' });
    await expect(list.getByText('Table 9', { exact: true })).toBeVisible();
    await expect(list.getByText('No waiter on table 9')).toBeVisible();
    await list.getByRole('button', { name: 'Take table' }).click();
    await expect.poll(() => staff.rpcCalls.filter((c) => c.fn === 'staff_take_table').map((c) => c.body))
      .toEqual([{ _session_id: 'session-9' }]);
    await expect(page.getByText('Table 9 is yours')).toBeVisible();
  });

  test('marking plates served is one tap', async ({ staff, page }) => {
    staff.orders = [anOrder({ id: 'w1', status: 'ready', table_session_id: 'session-1', table_sessions: t7 })];
    await asMarko(page);
    await page.goto('/waiter');
    await page.getByRole('button', { name: 'Mark served' }).click();
    await expect.poll(() => staff.statusWrites).toEqual([{ id: 'w1', status: 'served' }]);
  });

  // A new order on my table used to appear without a sound or a buzz: the
  // waiter only knew by looking.
  test('a new order on my table buzzes the phone; what was there already does not', async ({ staff, page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __buzz: unknown[] };
      w.__buzz = [];
      Object.defineProperty(navigator, 'vibrate', { value: (p: unknown) => { w.__buzz.push(p); return true; }, configurable: true });
    });
    staff.orders = [anOrder({ id: 'o-old', table_session_id: 'session-1', table_sessions: t7 })];
    await asMarko(page);
    await page.goto('/waiter');
    await expect(page.getByText('In the kitchen')).toBeVisible();
    const buzzes = () => page.evaluate(() => (window as unknown as { __buzz: unknown[] }).__buzz);
    expect(await buzzes()).toEqual([]);

    staff.orders = [...staff.orders, anOrder({ id: 'o-new', order_code: '048', table_session_id: 'session-6', table_sessions: t6 })];
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect.poll(buzzes).toEqual([150]);
  });
});

test.describe('the bill', () => {
  test('take the money and free the table in two taps', async ({ staff, page }) => {
    staff.orders = [anOrder({ id: 'w6', status: 'served', table_session_id: 'session-6', table_sessions: t6, total: 38, payment_status: 'unpaid' })];
    staff.billRequests = [{ id: 'b1', status: 'pending', created_at: iso(2), table_session_id: 'session-6', table_sessions: t6 }];
    await asMarko(page);
    await page.goto('/waiter');

    const card = page.locator('div').filter({ hasText: 'Wants the bill' }).filter({ has: page.getByRole('button', { name: 'Cash' }) }).last();
    await card.getByRole('button', { name: 'Cash' }).click();
    await page.getByRole('button', { name: '38.00 KM received + free table 6' }).click();

    await expect.poll(() => staff.rpcCalls.map((c) => c.fn)).toEqual(['record_table_payment', 'staff_close_session']);
    expect(staff.rpcCalls[0].body).toMatchObject({ _order_id: 'w6', _method: 'cash' });
    expect(staff.rpcCalls[1].body).toEqual({ _session_id: 'session-6' });
  });

  test('a table that paid online is one tap from free', async ({ staff, page }) => {
    staff.orders = [anOrder({
      id: 'w6', status: 'served', table_session_id: 'session-6', table_sessions: t6,
      payment_method: 'card_online', payment_status: 'paid',
    })];
    staff.billRequests = [{ id: 'b1', status: 'pending', created_at: iso(2), table_session_id: 'session-6', table_sessions: t6 }];
    await asMarko(page);
    await page.goto('/waiter');
    await page.getByRole('button', { name: 'Nothing owed — free table 6' }).click();
    await page.getByRole('button', { name: 'Free table', exact: true }).click();
    await expect.poll(() => staff.rpcCalls.map((c) => c.fn)).toEqual(['staff_close_session']);
  });

  test('just recording the payment still leaves the table open', async ({ staff, page }) => {
    staff.orders = [anOrder({ id: 'w6', status: 'served', table_session_id: 'session-6', table_sessions: t6, total: 38, payment_status: 'unpaid' })];
    staff.billRequests = [{ id: 'b1', status: 'pending', created_at: iso(2), table_session_id: 'session-6', table_sessions: t6 }];
    await asMarko(page);
    await page.goto('/waiter');
    await page.getByRole('button', { name: 'Terminal' }).first().click();
    await page.getByRole('button', { name: 'Yes, 38.00 KM received' }).click();
    await expect.poll(() => staff.rpcCalls.map((c) => c.fn)).toEqual(['record_table_payment']);
  });
});
