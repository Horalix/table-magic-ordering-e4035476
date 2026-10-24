import { test, expect, seedSession } from './fixtures';

/**
 * An order the restaurant holds for the waiter to confirm.
 *
 * The database holds a pay-at-table order that looks like it might not come
 * from someone at the table (a large first order, a burst of new tables, …).
 * Almost every one of them IS a real guest, so what is asserted here is tone:
 * the guest is told plainly that the waiter will confirm it, is never told
 * why, and is never told it went to the kitchen when it did not.
 */

test.describe('a held order, from the guest side', () => {
  test.beforeEach(async ({ page }) => {
    await seedSession(page);
  });

  test('says the waiter will confirm it, without saying why', async ({ page, state }) => {
    state.holdOrders = true;
    await page.goto('/menu');
    await page.getByRole('searchbox').fill('burger');
    await page.getByRole('button', { name: /Add to order|Dodaj/ }).first().click();

    await page.goto('/cart');
    await page.getByRole('button', { name: /Send order|Pošalji narudžbu/ }).click();
    await page.getByRole('button', { name: /^Cash|Gotovina/ }).click();

    await expect(page.getByRole('heading', { name: /Order received|Narudžba je primljena/i })).toBeVisible();
    await expect(page.getByText(/waiter will confirm it|konobar će je potvrditi/i)).toBeVisible();
    // Not "sent to the kitchen": it has not been.
    await expect(page.getByText(/Order sent to the kitchen|poslana u kuhinju/i)).toHaveCount(0);
    // The reason is for staff only.
    await expect(page.getByText(/large|first order|suspicious/i)).toHaveCount(0);
    await expect(page.getByText('18.00 KM')).toBeVisible();
    expect(state.placedOrders).toHaveLength(1);
  });

  test('an ordinary order still says it went to the kitchen', async ({ page, state }) => {
    expect(state.holdOrders).toBe(false);
    await page.goto('/menu');
    await page.getByRole('searchbox').fill('burger');
    await page.getByRole('button', { name: /Add to order|Dodaj/ }).first().click();
    await page.goto('/cart');
    await page.getByRole('button', { name: /Send order|Pošalji narudžbu/ }).click();
    await page.getByRole('button', { name: /^Cash|Gotovina/ }).click();
    await expect(page.getByRole('heading', { name: /Order sent to the kitchen|Narudžba je poslana/i })).toBeVisible();
    await expect(page.getByText(/waiter will confirm it/i)).toHaveCount(0);
  });

  test('the running tab shows it as waiting for the waiter', async ({ page, state }) => {
    state.tabOrders = [{
      id: 'order-held', status: 'pending', held: true, total: 72, notes: null, guest_name: 'Amina',
      payment_method: 'cash', payment_status: 'unpaid', created_at: new Date().toISOString(),
      order_items: [{
        id: 'oi-1', quantity: 4, unit_price: 18, notes: null, status: 'pending',
        menu_items: { name: 'La Soul Burger', name_bs: 'La Soul Burger', name_ar: null },
      }],
    }];
    await page.goto('/tab');
    await expect(page.getByText(/Waiting for your waiter to confirm|Čeka potvrdu konobara/).first()).toBeVisible();
  });
});
