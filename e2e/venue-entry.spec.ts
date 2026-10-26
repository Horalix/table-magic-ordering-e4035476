import { test, expect, seedSession } from './fixtures';

/**
 * The single-QR entry flow, which is now how every guest arrives.
 *
 * The behaviour that matters: the table number is asked for on every visit,
 * and a session from a previous visit never silently becomes the table this
 * guest is sitting at.
 */

test.describe('scanning the venue QR', () => {
  test('asks which table the guest is at', async ({ page }) => {
    await page.goto('/start?token=venue-token-current');

    await expect(page.getByRole('heading', { name: /Which table|Za kojim/i })).toBeVisible();
    await expect(page.getByRole('spinbutton')).toBeVisible();
  });

  test('rejects an old printed code before asking for anything', async ({ page, state }) => {
    state.venueToken = { valid: false, ordering_enabled: true, paused_message: null, max_table_number: 12 };

    await page.goto('/start?token=an-old-code');

    await expect(page.getByText(/invalid or expired|nevažeći/i)).toBeVisible();
    await expect(page.getByRole('spinbutton')).toHaveCount(0);
  });

  test('refuses a table number the restaurant does not have', async ({ page }) => {
    await page.goto('/start?token=venue-token-current');

    await page.getByRole('spinbutton').fill('99');
    await expect(page.getByRole('alert')).toContainText(/between 1 and 12|između 1 i 12/i);
    await expect(page.getByRole('button', { name: /Continue|Nastavi/ })).toBeDisabled();
  });

  test('accepts a real table and moves on', async ({ page }) => {
    await page.goto('/start?token=venue-token-current');

    await page.getByRole('spinbutton').fill('7');
    await expect(page.getByRole('button', { name: /Continue|Nastavi/ })).toBeEnabled();
    await page.getByRole('button', { name: /Continue|Nastavi/ }).click();

    await expect(page).toHaveURL(/\/table\/7/);
  });

  test('tells the guest when ordering is paused, before they type a number', async ({ page, state }) => {
    state.venueToken = {
      valid: true, ordering_enabled: false,
      paused_message: 'Kitchen closed until 18:00', max_table_number: 12,
    };

    await page.goto('/start?token=venue-token-current');
    await expect(page.getByText('Kitchen closed until 18:00')).toBeVisible();
  });

  test('forgets a previously remembered table once the guest picks another one', async ({ page }) => {
    await seedSession(page);
    await page.goto('/start?token=venue-token-current');
    await expect(page.getByRole('spinbutton')).toBeVisible();

    // Opening the number pad alone must not end the visit: a guest who
    // rescans their own table mid-meal used to lose an unsent cart here.
    const sessionId = () => page.evaluate(() => {
      const raw = localStorage.getItem('lasoul-cart');
      return raw ? JSON.parse(raw).state?.sessionId ?? null : null;
    });
    expect(await sessionId()).toBe('session-1');

    // Choosing a DIFFERENT table is a new visit; the old table must not survive it.
    await page.getByRole('spinbutton').fill('3');
    await page.getByRole('spinbutton').press('Enter');
    await expect.poll(sessionId).not.toBe('session-1');
  });
});

test.describe('returning to the app', () => {
  test.beforeEach(async ({ page }) => {
    await seedSession(page);
  });

  test('resumes a live session without asking again', async ({ page, state }) => {
    state.sessionResume = { status: 'active', session_id: 'session-1', table_number: 7, guest_name: 'Amina' };

    await page.goto('/menu');

    // Ordering is available, and the table is shown with a way to correct it.
    await expect(page.getByRole('button', { name: /Table 7/i })).toBeVisible();
  });

  test('drops an expired session so the next visit starts fresh', async ({ page, state }) => {
    state.sessionResume = { status: 'expired' };

    await page.goto('/menu');

    // No table chip — the guest must scan and type their table again.
    await expect(page.getByRole('searchbox')).toBeVisible();
    await expect(page.getByRole('button', { name: /Table 7/i })).toHaveCount(0);

    await expect.poll(() => page.evaluate(() => {
      const raw = localStorage.getItem('lasoul-cart');
      return raw ? JSON.parse(raw).state?.sessionId ?? null : null;
    })).toBeNull();
  });

  test('drops a session the staff closed at the bill', async ({ page, state }) => {
    state.sessionResume = { status: 'closed' };

    await page.goto('/menu');
    await expect(page.getByRole('button', { name: /Table 7/i })).toHaveCount(0);
  });

  test('keeps the session when the check itself fails', async ({ page }) => {
    // A dropped connection is not proof the visit ended. Wiping a live guest's
    // table because their signal blinked would be far worse than resuming.
    await page.route('**/rest/v1/rpc/guest_resume_session', (route) => route.abort());

    await page.goto('/menu');
    await expect(page.getByRole('button', { name: /Table 7/i })).toBeVisible();
  });

  test('offers a way to change table', async ({ page }) => {
    await page.goto('/menu');
    await page.getByRole('button', { name: /Table 7/i }).click();
    await expect(page).toHaveURL(/\/start/);
  });

  // A table the staff never freed stayed open all day, and every phone that
  // had sat there came back to it hours later.
  test('forgets a table nobody has looked at for an hour, even while it is still open', async ({ page, state }) => {
    state.sessionResume = { status: 'active', session_id: 'session-1', table_number: 7, guest_name: 'Amina' };
    await page.addInitScript(() => {
      const raw = JSON.parse(localStorage.getItem('lasoul-cart') ?? '{}');
      raw.state.tableSeenAt = Date.now() - 2 * 60 * 60 * 1000;
      localStorage.setItem('lasoul-cart', JSON.stringify(raw));
    });

    await page.goto('/menu');
    await expect(page.getByRole('searchbox')).toBeVisible();
    await expect(page.getByRole('button', { name: /Table 7/i })).toHaveCount(0);
  });

  // The home-screen app and the browser tab a QR scan opens are two copies of
  // the app. The one left in the background wrote its old table back over the
  // one just scanned.
  test('takes the table another copy of the app just chose', async ({ page, context, state }) => {
    await page.goto('/menu');
    await expect(page.getByRole('button', { name: /Table 7/i })).toBeVisible();

    state.sessionResume = { status: 'active', session_id: 'session-9', table_number: 9, guest_name: 'Amina' };
    const other = await context.newPage();
    await other.goto('/robots.txt');
    await other.evaluate(() => {
      const raw = JSON.parse(localStorage.getItem('lasoul-cart') ?? '{}');
      raw.state = { ...raw.state, tableNumber: 9, sessionId: 'session-9', sessionToken: 'sess-token-9', tableSeenAt: Date.now() };
      localStorage.setItem('lasoul-cart', JSON.stringify(raw));
    });

    await expect(page.getByRole('button', { name: /Table 9/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Table 7/i })).toHaveCount(0);
  });
});
