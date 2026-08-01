import { test, expect, seedSession } from './fixtures';

/**
 * The guest journey, end to end, in a mobile viewport.
 *
 * These specs assert behaviour a guest would notice, not implementation:
 * can they find a dish, add it, pay at the table, and be told honestly what
 * happened.
 */

test.describe('menu and discovery', () => {
  test('the menu is readable and the categories are reachable', async ({ page }) => {
    await page.goto('/menu');

    await expect(page.getByRole('heading', { level: 2, name: /Food|Hrana/ })).toBeVisible();
    await expect(page.getByRole('searchbox')).toBeVisible();
  });

  test('global search finds a dish by name from the landing page', async ({ page }) => {
    await page.goto('/menu');

    await page.getByRole('searchbox').fill('burger');
    await expect(page.getByText('La Soul Burger')).toBeVisible();
  });

  test('search says so when nothing matches instead of looking broken', async ({ page }) => {
    await page.goto('/menu');

    await page.getByRole('searchbox').fill('zzzzz');
    await expect(page.getByText(/Nothing matched|Nema rezultata/)).toBeVisible();
  });

  test('the product sheet shows allergens, portion and prep time', async ({ page }) => {
    // These three columns existed and a finished allergen block was rendered
    // for nobody, because the call site passed a stripped object. Allergens are
    // the one field on this sheet that can matter medically.
    await page.goto('/menu/food');
    await page.getByText('La Soul Burger').first().click();

    await expect(page.getByText(/Allergens|Alergeni/i)).toBeVisible();
    await expect(page.getByText('gluten, dairy')).toBeVisible();
    await expect(page.getByText(/220 g/)).toBeVisible();
    await expect(page.getByText(/~12 min/)).toBeVisible();
    await expect(page.getByText(/tell your waiter|obavijestite konobara/i)).toBeVisible();
  });

  test('the page never scrolls sideways on a phone', async ({ page }) => {
    await page.goto('/menu');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});

test.describe('checkout', () => {
  test.beforeEach(async ({ page }) => {
    await seedSession(page);
  });

  test('pay at the table sends the order and confirms it', async ({ page, state }) => {
    await page.goto('/menu');
    await page.getByRole('searchbox').fill('burger');
    await page.getByRole('button', { name: /Add to order|Dodaj/ }).first().click();

    await page.goto('/cart');
    await page.getByRole('button', { name: /Checkout/ }).click();

    // No tip is preselected — "No tip" must be a real, reachable choice.
    await expect(page.getByRole('button', { name: /No tip|Bez napojnice/ })).toBeVisible();

    await page.getByRole('button', { name: /^Cash|Gotovina/ }).click();

    await expect(page.getByRole('heading', { name: /Payment received|Plaćanje primljeno/i })).toBeVisible();
    // The confirmation must show the real amount, not a cleared cart's zero.
    await expect(page.getByText('18.00 KM')).toBeVisible();
    expect(state.placedOrders).toHaveLength(1);
    expect(state.placedOrders[0].payment_method).toBe('cash');
  });

  test('card at the table is a distinct choice from cash', async ({ page, state }) => {
    await page.goto('/menu');
    await page.getByRole('searchbox').fill('burger');
    await page.getByRole('button', { name: /Add to order|Dodaj/ }).first().click();

    await page.goto('/cart');
    await page.getByRole('button', { name: /Checkout/ }).click();
    await page.getByRole('button', { name: /Card at the table|Kartica za stolom/ }).click();

    await expect(page.getByRole('heading', { name: /Payment received|Plaćanje primljeno/i })).toBeVisible();
    expect(state.placedOrders[0].payment_method).toBe('pos_terminal');
  });

  test('online card is not offered while the restaurant has it switched off', async ({ page }) => {
    await page.goto('/menu');
    await page.getByRole('searchbox').fill('burger');
    await page.getByRole('button', { name: /Add to order|Dodaj/ }).first().click();

    await page.goto('/cart');
    await page.getByRole('button', { name: /Checkout/ }).click();

    await expect(page.getByRole('button', { name: /Pay now/i })).toHaveCount(0);
  });

  test('a removed line can be put back', async ({ page }) => {
    await page.goto('/menu');
    await page.getByRole('searchbox').fill('burger');
    await page.getByRole('button', { name: /Add to order|Dodaj/ }).first().click();

    await page.goto('/cart');
    await page.getByRole('button', { name: /Remove|Ukloni/ }).first().click();
    await expect(page.getByText(/Undo|Vrati/)).toBeVisible();

    await page.getByText(/Undo|Vrati/).click();
    await expect(page.getByText('La Soul Burger')).toBeVisible();
  });
});

test.describe('payment recovery', () => {
  test.beforeEach(async ({ page }) => {
    await seedSession(page);
  });

  test('a held card order recovers into the payment screen after a reload', async ({ page, state }) => {
    state.paymentPolls = [
      { status: 'ok', payment_status: 'pending', order_status: 'awaiting_payment', released: false, order_code: '047' },
    ];

    await page.addInitScript(() => {
      const raw = localStorage.getItem('lasoul-cart');
      if (!raw) return;
      const parsed = JSON.parse(raw);
      parsed.state.pendingPayment = { orderId: 'order-1', orderCode: '047', total: 18, createdAt: Date.now() };
      localStorage.setItem('lasoul-cart', JSON.stringify(parsed));
    });

    await page.goto('/cart');

    // It must never claim success, and it must never claim failure either.
    await expect(page.getByText(/Confirming your payment|Still confirming/i)).toBeVisible();
    await expect(page.getByText(/Payment received/i)).toHaveCount(0);
  });

  test('an unresolved payment tells the guest not to pay twice', async ({ page, state }) => {
    state.paymentPolls = [
      { status: 'ok', payment_status: 'pending', order_status: 'awaiting_payment', released: false, order_code: '047' },
    ];

    await page.addInitScript(() => {
      const raw = localStorage.getItem('lasoul-cart');
      if (!raw) return;
      const parsed = JSON.parse(raw);
      parsed.state.pendingPayment = { orderId: 'order-1', orderCode: '047', total: 18, createdAt: Date.now() };
      localStorage.setItem('lasoul-cart', JSON.stringify(parsed));
    });

    await page.goto('/cart');
    await expect(page.getByText(/do not pay again|ne plaćajte ponovo/i)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('047')).toBeVisible();
  });

  test('a declined card keeps the order out of the kitchen and offers a way out', async ({ page, state }) => {
    state.paymentPolls = [
      { status: 'ok', payment_status: 'failed', order_status: 'payment_failed', released: false, order_code: '047' },
    ];

    await page.addInitScript(() => {
      const raw = localStorage.getItem('lasoul-cart');
      if (!raw) return;
      const parsed = JSON.parse(raw);
      parsed.state.pendingPayment = { orderId: 'order-1', orderCode: '047', total: 18, createdAt: Date.now() };
      localStorage.setItem('lasoul-cart', JSON.stringify(parsed));
    });

    await page.goto('/cart');

    await expect(page.getByText(/was not completed|nije završeno/i)).toBeVisible();
    await expect(page.getByText(/Not sent to the kitchen yet|Još nije poslano/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /Pay at the table instead|Radije plati/i })).toBeVisible();
  });

  test('switching to pay at the table releases the order', async ({ page, state }) => {
    state.paymentPolls = [
      { status: 'ok', payment_status: 'failed', order_status: 'payment_failed', released: false, order_code: '047' },
    ];

    await page.addInitScript(() => {
      const raw = localStorage.getItem('lasoul-cart');
      if (!raw) return;
      const parsed = JSON.parse(raw);
      parsed.state.pendingPayment = { orderId: 'order-1', orderCode: '047', total: 18, createdAt: Date.now() };
      localStorage.setItem('lasoul-cart', JSON.stringify(parsed));
    });

    await page.goto('/cart');
    await page.getByRole('button', { name: /Pay at the table instead|Radije plati/i }).click();

    await expect(page.getByText(/Payment received|Plaćanje primljeno/i)).toBeVisible();
  });
});

test.describe('service availability', () => {
  test.beforeEach(async ({ page }) => {
    await seedSession(page);
  });

  test('a paused kitchen blocks checkout and says why', async ({ page, state }) => {
    state.serviceStatus = { ...state.serviceStatus, ordering_enabled: false, paused_message: 'Kitchen closed for 20 minutes' };

    await page.goto('/menu');
    await page.getByRole('searchbox').fill('burger');
    await page.getByRole('button', { name: /Add to order|Dodaj/ }).first().click();
    await page.goto('/cart');

    await expect(page.getByText(/Ordering is paused|Naručivanje je pauzirano/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /Checkout/ })).toBeDisabled();
  });
});
