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

  test('marking plates served is one tap', async ({ staff, page }) => {
    staff.orders = [anOrder({ id: 'w1', status: 'ready', table_session_id: 'session-1', table_sessions: t7 })];
    await asMarko(page);
    await page.goto('/waiter');
    await page.getByRole('button', { name: 'Mark served' }).click();
    await expect.poll(() => staff.statusWrites).toEqual([{ id: 'w1', status: 'served' }]);
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
