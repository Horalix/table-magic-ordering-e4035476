import type { Page, Route } from '@playwright/test';
import { test, expect } from './fixtures';

/**
 * The suggestion card, as a guest meets it.
 *
 * What is suggested is decided and tested in SQL (supabase/tests/reco-*);
 * these specs pin what the card does with the answer: drinks for the table
 * with an honest count and a "just one" way out, the running-tab moment, and
 * that the order line carries the decision it came from.
 */

interface Calls { recommendations: Record<string, unknown>[]; seen: Record<string, unknown>[] }

const LEMONADE = {
  decision_id: 'decision-1', id: 'item-lemonade', name: 'Strawberry Lemonade', name_bs: 'Limunada od jagode',
  name_ar: null, price: 7, image_url: null, dietary_tags: [], recommendation_type: 'pair_with',
  source_item_id: 'item-burger', suggested_quantity: 3,
};

/** A cart of three burgers, in a live session. */
async function seedCart(page: Page, quantity = 3) {
  await page.addInitScript((qty) => {
    if (localStorage.getItem('lasoul-cart')) return;
    localStorage.setItem('lasoul-cart', JSON.stringify({
      state: {
        items: [{ id: 'item-burger', menuItemId: 'item-burger', name: 'La Soul Burger', price: 18, quantity: qty }],
        tableNumber: 7, qrToken: 'qr-token-7', sessionToken: 'sess-token-7', sessionId: 'session-1',
        guestName: 'Amina', lastOrderTime: null, pendingPayment: null, tableSeenAt: Date.now(), clientId: 'e2e-device',
      },
      version: 0,
    }));
  }, quantity);
}

/** Answer guest_get_recommendations per placement; record every call. */
async function stubSuggestions(page: Page, byPlacement: Record<string, unknown[]>) {
  const calls: Calls = { recommendations: [], seen: [] };
  await page.route('**/rest/v1/rpc/guest_get_recommendations**', async (route: Route) => {
    const body = route.request().postDataJSON() ?? {};
    calls.recommendations.push(body);
    await route.fulfill({
      status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(byPlacement[String(body._placement)] ?? []),
    });
  });
  await page.route('**/rest/v1/rpc/guest_mark_suggestion_seen**', async (route: Route) => {
    calls.seen.push(route.request().postDataJSON() ?? {});
    await route.fulfill({ status: 200, contentType: 'application/json', body: 'null' });
  });
  return calls;
}

test.describe('drinks for the table', () => {
  test('offers one each, says so, and adds them with the decision attached', async ({ page, state }) => {
    await seedCart(page, 3);
    const calls = await stubSuggestions(page, { cart: [LEMONADE] });
    state.menuItems.push({ ...state.menuItems[0], id: 'item-lemonade', name: 'Strawberry Lemonade', price: 7 });

    await page.goto('/cart');
    const card = page.getByRole('region', { name: /For the table|Za cijeli sto/ });
    await expect(card).toBeVisible();
    await expect(card.getByText(/3 × Strawberry Lemonade/)).toBeVisible();
    await expect(card.getByText(/One for each of you/)).toBeVisible();
    await expect(card.getByText(/21\.00.KM · 7\.00.KM each/)).toBeVisible();

    // The server was told how many burgers, not just that there was one.
    expect(calls.recommendations[0]).toMatchObject({ _placement: 'cart', _cart_quantities: [3] });

    // Seen once on screen: the sighting is reported against the decision.
    await expect.poll(() => calls.seen.length).toBe(1);
    expect(calls.seen[0]).toMatchObject({ _decision_id: 'decision-1' });

    await card.getByRole('button', { name: /Add 3 × Strawberry Lemonade to order/ }).click();
    await expect(page.getByText('Strawberry Lemonade').first()).toBeVisible();

    let sent: { _items?: { menu_item_id: string; quantity: number; from_suggestion?: Record<string, unknown> | null }[] } = {};
    await page.route('**/rest/v1/rpc/guest_place_order**', async (route) => {
      sent = route.request().postDataJSON() ?? {};
      await route.fallback();
    });
    await page.getByRole('button', { name: /Send order|Pošalji narudžbu/ }).click();
    // The payment step appears only when more than one way to pay is on.
    const sentHeading = page.getByRole('heading', { name: /Order sent to the kitchen|Narudžba je poslana/i });
    const cash = page.getByRole('button', { name: /^Cash|Gotovina/ });
    await expect(sentHeading.or(cash)).toBeVisible();
    if (await cash.isVisible()) await cash.click();
    await expect(sentHeading).toBeVisible();

    // The order carried three lemonades, tied to the decision that offered them.
    expect(state.placedOrders).toHaveLength(1);
    const lemonade = (sent._items ?? []).find((i) => i.menu_item_id === 'item-lemonade');
    expect(lemonade).toMatchObject({ quantity: 3 });
    expect(lemonade?.from_suggestion).toMatchObject({ decision_id: 'decision-1', placement: 'cart' });
  });

  test('lets the guest take just one', async ({ page }) => {
    await seedCart(page, 3);
    await stubSuggestions(page, { cart: [LEMONADE] });

    await page.goto('/cart');
    const card = page.getByRole('region', { name: /For the table/ });
    await card.getByRole('button', { name: /Just one|Add Strawberry Lemonade to order/ }).first().click();
    await expect(card).toHaveCount(0);
    // One lemonade line, quantity one.
    await expect(page.getByRole('button', { name: /One more Strawberry Lemonade/ })).toBeVisible();
    await expect(page.getByText(/3 × Strawberry Lemonade/)).toHaveCount(0);
  });

  test('offers a single drink to a single guest, and says nothing about the table', async ({ page }) => {
    await seedCart(page, 1);
    await stubSuggestions(page, { cart: [{ ...LEMONADE, suggested_quantity: 1 }] });

    await page.goto('/cart');
    await expect(page.getByRole('region', { name: /Complete your order|Upotpunite narudžbu/ })).toBeVisible();
    await expect(page.getByText(/For the table/)).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Add Strawberry Lemonade to order/ })).toBeVisible();
  });

  test('shows nothing when nothing belongs', async ({ page }) => {
    await seedCart(page, 1);
    const calls = await stubSuggestions(page, { cart: [] });

    await page.goto('/cart');
    await expect.poll(() => calls.recommendations.length).toBeGreaterThan(0);
    await expect(page.getByRole('button', { name: /No thanks|Ne, hvala/ })).toHaveCount(0);
  });
});

test.describe('the running tab while the food is coming', () => {
  test('offers drinks for the table that ordered food and nothing to drink', async ({ page, state }) => {
    await seedCart(page, 0);
    await page.addInitScript(() => {
      // An empty cart: what is on the table is what was already ordered.
      const raw = JSON.parse(localStorage.getItem('lasoul-cart') ?? '{}');
      raw.state.items = [];
      localStorage.setItem('lasoul-cart', JSON.stringify(raw));
    });
    const calls = await stubSuggestions(page, {
      tab: [{ ...LEMONADE, decision_id: 'decision-tab', suggested_quantity: 2, recommendation_type: 'add_on' }],
    });
    state.tabOrders = [{
      id: 'order-1', status: 'preparing', held: false, total: 36, notes: null, guest_name: 'Amina',
      payment_method: 'cash', payment_status: 'unpaid', created_at: new Date().toISOString(),
      order_items: [{
        id: 'oi-1', quantity: 2, unit_price: 18, notes: null, status: 'preparing',
        menu_items: { name: 'La Soul Burger', name_bs: 'La Soul Burger', name_ar: null },
      }],
    }];

    await page.goto('/tab');
    const card = page.getByRole('region', { name: /For the table|Za cijeli sto/ });
    await expect(card).toBeVisible();
    await expect(card.getByText(/2 × Strawberry Lemonade/)).toBeVisible();
    expect(calls.recommendations.some((c) => c._placement === 'tab')).toBe(true);
  });
});
