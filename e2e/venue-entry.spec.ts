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

  test('forgets a previously remembered table', async ({ page }) => {
    await seedSession(page);
    await page.goto('/start?token=venue-token-current');
    await expect(page.getByRole('spinbutton')).toBeVisible();

    // Scanning is the start of a NEW visit; the old table must not survive it.
    // Polled because the store persists asynchronously after the effect runs.
    await expect.poll(() => page.evaluate(() => {
      const raw = localStorage.getItem('lasoul-cart');
      return raw ? JSON.parse(raw).state?.sessionId ?? null : null;
    })).toBeNull();

    await expect.poll(() => page.evaluate(() => {
      const raw = localStorage.getItem('lasoul-cart');
      return raw ? JSON.parse(raw).state?.tableNumber ?? null : null;
    })).toBeNull();
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
});
