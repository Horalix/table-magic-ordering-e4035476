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

  test('a category opens as one page, with each section headed', async ({ page }) => {
    await page.goto('/menu');
    await page.getByRole('heading', { level: 2, name: /Food|Hrana/ }).click();

    await expect(page).toHaveURL(/\/menu\/lasoul\/food/);
    await expect(page.getByRole('heading', { level: 2, name: /Burgers|Burgeri/ })).toBeVisible();
    await expect(page.getByText('La Soul Burger').first()).toBeVisible();
  });

  // Printed QR codes and links from the old menu site land on a section.
  test('a section link opens the category at that section', async ({ page }) => {
    await page.goto('/menu/food?section=burgers');

    await expect(page.locator('#section-burgers')).toBeVisible();
    await expect(page.getByText('La Soul Burger').first()).toBeVisible();
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

    // Scoped to the sheet, which also asserts the sheet IS a dialog — it had
    // no role, no focus trap and no Escape until this pass, so a screen-reader
    // user could open it and never be told anything had happened.
    const sheet = page.getByRole('dialog');
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText(/Allergens|Alergeni/i)).toBeVisible();
    // Named in the guest's language, never as raw codes like 'gluten, dairy'.
    await expect(sheet.getByText('Gluten and Milk & dairy')).toBeVisible();
    await expect(sheet.getByText(/220 g/)).toBeVisible();
    await expect(sheet.getByText(/~12 min/)).toBeVisible();
    await expect(sheet.getByText(/tell your waiter|obavijestite konobara/i)).toBeVisible();

    // And that Escape closes it.
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
  });

  test('a sold-out dish is shown, not hidden, and cannot be added', async ({ page, state }) => {
    // CategoryPage hard-filtered `is_available = true`, so an 86'd dish simply
    // vanished — while MenuSearch deliberately showed it. The two surfaces
    // disagreed, and a guest who came for that dish concluded the restaurant
    // had stopped making it rather than learning it had run out today.
    state.menuItems = [{ ...state.menuItems[0], is_available: false }];

    await page.goto('/menu/food');

    await expect(page.getByText('La Soul Burger').first()).toBeVisible();
    await expect(page.getByText(/Sold out|Rasprodano/i).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /Add to order La Soul Burger/i })).toHaveCount(0);
  });

  test('an item outside its hours says when it comes back', async ({ page, state }) => {
    // A breakfast item at 23:00 was orderable, because nothing read
    // available_from/available_to outside the database.
    state.menuItems = [{
      ...state.menuItems[0],
      available_from: '07:00:00',
      available_to: '07:01:00',
    }];

    await page.goto('/menu/food');

    await expect(page.getByText('La Soul Burger').first()).toBeVisible();
    await expect(page.getByText('07:00–07:01').first()).toBeVisible();
  });

  test('list prices are bare, said once as KM, and the sheet keeps KM on Add', async ({ page }) => {
    await seedSession(page);
    await page.goto('/menu/food');

    const row = page.locator('#section-burgers');
    await expect(row.getByText('La Soul Burger').first()).toBeVisible();
    // "18", not "18.00 KM", on every row…
    await expect(row.getByText('18', { exact: true })).toBeVisible();
    await expect(row.getByText(/KM/)).toHaveCount(0);
    // …because the header says it once.
    await expect(page.getByText(/^Prices in KM$|^Cijene su u KM$/)).toBeVisible();

    // Anything the guest is about to pay keeps the currency.
    await page.getByText('La Soul Burger').first().click();
    await expect(page.getByRole('dialog').getByRole('button', { name: /Add to order · 18\.00\sKM|Dodaj u narudžbu · 18,00\sKM/ })).toBeVisible();
  });

  test('search results are bare too, with the note under them', async ({ page }) => {
    await page.goto('/menu');
    await page.getByRole('searchbox').fill('burger');

    await expect(page.getByText('La Soul Burger')).toBeVisible();
    await expect(page.getByText('18', { exact: true })).toBeVisible();
    await expect(page.getByText(/^Prices in KM$|^Cijene su u KM$/)).toBeVisible();
  });

  test('Back closes the dish sheet and stays on the category page', async ({ page }) => {
    await page.goto('/menu/food');
    await page.getByText('La Soul Burger').first().click();
    const sheet = page.getByRole('dialog');
    await expect(sheet).toBeVisible();

    // Android's Back gesture is a history pop.
    await page.goBack();

    await expect(sheet).toBeHidden();
    await expect(page).toHaveURL(/\/menu\/lasoul\/food/);
    await expect(page.getByRole('heading', { level: 2, name: /Burgers|Burgeri/ })).toBeVisible();
  });

  test('the note field waits behind a link', async ({ page }) => {
    await seedSession(page);
    await page.goto('/menu/food');
    await page.getByText('La Soul Burger').first().click();
    const sheet = page.getByRole('dialog');

    await expect(sheet.getByRole('textbox')).toHaveCount(0);
    await sheet.getByRole('button', { name: /Add a note|Dodajte napomenu/ }).click();
    await expect(sheet.getByRole('textbox')).toBeFocused();
  });

  test('the page never scrolls sideways on a phone', async ({ page }) => {
    await page.goto('/menu');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});

test.describe('adding to the order', () => {
  test.beforeEach(async ({ page }) => {
    await seedSession(page);
  });

  test('an add lands in the cart bar as "+ name", with no toast', async ({ page }) => {
    await page.goto('/menu/food');
    await page.getByRole('button', { name: /Add La Soul Burger to order|Dodaj La Soul Burger u narudžbu/ }).click();

    // The bar's label swaps to the dish for a moment instead of a toast up top.
    await expect(page.getByRole('button', { name: /\+ La Soul Burger/ })).toBeVisible();
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
    // Screen readers hear the count and the total.
    await expect(page.getByRole('status').filter({ hasText: /Added La Soul Burger\. 1 item, 18\.00\sKM|Dodano: La Soul Burger/ })).toHaveCount(1);
    // Then it goes back to saying what it does.
    await expect(page.getByRole('button', { name: /View Order|Pogledaj narudžbu/ })).toBeVisible({ timeout: 4_000 });
  });

  test('adding from the dish sheet closes it and lands in the cart bar', async ({ page }) => {
    await page.goto('/menu/food');
    await page.getByText('La Soul Burger').first().click();
    await page.getByRole('dialog').getByRole('button', { name: /Add to order|Dodaj u narudžbu/ }).click();

    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(page.getByRole('button', { name: /\+ La Soul Burger/ })).toBeVisible();
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
    // Closing by Add took the sheet's history entry back out: Back now leaves
    // the page as it normally would, instead of re-closing a sheet.
    await expect(page).toHaveURL(/\/menu\/lasoul\/food/);
  });
});

test.describe('checkout', () => {
  test.beforeEach(async ({ page }) => {
    await seedSession(page);
  });

  test('pay at the table sends the order in one tap and confirms it', async ({ page, state }) => {
    // Online card is off in the stub flags (and in the e2e build).
    expect(state.serviceStatus.online_card_enabled).toBe(false);
    await page.goto('/menu');
    await page.getByRole('searchbox').fill('burger');
    await page.getByRole('button', { name: /Add to order|Dodaj/ }).first().click();

    await page.goto('/cart');
    await page.getByRole('button', { name: /Send order|Pošalji narudžbu/ }).click();

    // No sheet, no tip before service: straight to the confirmation.
    await expect(page.getByRole('heading', { name: /Order sent to the kitchen|Narudžba je poslana/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /No tip|Bez napojnice/ })).toHaveCount(0);
    // The confirmation must show the real amount, not a cleared cart's zero.
    await expect(page.getByText('18.00 KM')).toBeVisible();
    await expect(page.getByText(/We’ll bring it to table 7|za sto 7/)).toBeVisible();
    expect(state.placedOrders).toHaveLength(1);
    expect(state.placedOrders[0].payment_method).toBe('cash');
    // Nothing has been paid yet, and the screen must not say otherwise.
    await expect(page.getByText(/To pay|Za platiti/)).toBeVisible();
    await expect(page.getByText(/Payment received|Plaćanje primljeno/i)).toHaveCount(0);
    // Every checkout carries a key, so a retry after a lost response is not a second ticket.
    expect(state.placedOrders[0].client_order_id).toMatch(/^[0-9a-f-]{36}$|^c_/);
  });

  test('the one-tap send never opens the payment sheet', async ({ page, state }) => {
    await page.goto('/menu');
    await page.getByRole('searchbox').fill('burger');
    await page.getByRole('button', { name: /Add to order|Dodaj/ }).first().click();

    await page.goto('/cart');
    const placed = page.waitForRequest('**/rpc/guest_place_order');
    await page.getByRole('button', { name: /Send order|Pošalji narudžbu/ }).click();
    await placed;

    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Cash|Gotovina|Card at the table|Kartica za stolom/ })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: /Order sent to the kitchen|Narudžba je poslana/i })).toBeVisible();
    expect(state.placedOrders).toHaveLength(1);
  });

  test('online card is not offered while the restaurant has it switched off', async ({ page }) => {
    await page.goto('/menu');
    await page.getByRole('searchbox').fill('burger');
    await page.getByRole('button', { name: /Add to order|Dodaj/ }).first().click();

    await page.goto('/cart');
    await page.getByRole('button', { name: /Send order|Pošalji narudžbu/ }).click();

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

    await expect(page.getByText(/Order sent to the kitchen|Narudžba je poslana/i)).toBeVisible();
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
    await expect(page.getByRole('button', { name: /Send order|Pošalji narudžbu/ })).toBeDisabled();
  });
});
