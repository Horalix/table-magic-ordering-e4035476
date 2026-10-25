import { test, expect } from './staff-fixtures';

/**
 * Online card payment (Monri), from the admin side.
 *
 * Going live with Monri is a checklist on Admin → Service, not a rebuild: the
 * page says whether Monri is connected and which callback URL to register,
 * and the switch refuses to turn card payments on before they can work.
 */
test.describe('online card payments', () => {
  test('cannot be switched on until Monri is connected, and the page says what is missing', async ({ page }) => {
    await page.goto('/admin/service');
    await expect(page.getByText('Monri not connected yet')).toBeVisible();
    await expect(page.getByText(/\/functions\/v1\/monri-webhook$/)).toBeVisible();

    const toggle = page.getByRole('switch', { name: /Online card payment/ });
    await toggle.click();
    await expect(page.getByText(/Monri is not connected yet/)).toBeVisible();
    await expect(toggle).not.toBeChecked();
  });
});
