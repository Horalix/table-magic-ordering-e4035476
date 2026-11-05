import { test, expect } from './staff-fixtures';

/**
 * The QR codes page: what a manager prints and puts on the tables for months.
 *
 * It printed "La Soul" on Vera Italia's codes, promised "Scan to order" while
 * guests could only read the menu, replaced every printed room code with one
 * tap, and drew a code that led nowhere when nothing had loaded.
 */

const VERA = { id: 'a5000000-0000-4000-8000-000000000002', name: 'Vera Italia' };
const LA_SOUL = { id: 'a5000000-0000-4000-8000-000000000001', name: 'La Soul' };

for (const venue of [LA_SOUL, VERA]) {
  test(`${venue.name}'s room code carries its own name and promises only the menu`, async ({ staff, page }) => {
    staff.roles = [{ user_id: 'staff-user-1', role: 'admin', venue_id: venue.id }];
    staff.settings = { ...staff.settings, venue_id: venue.id, venue_qr_token: 'room-token-1', menu_only: true };
    await page.goto('/admin/qr-codes');
    const code = page.locator('#qr-card-venue');
    await expect(code).toContainText(venue.name);
    await expect(code).toContainText('Scan for the menu');
    await expect(code).not.toContainText('order');
  });
}

test('replacing the room code asks first, and keeping it changes nothing', async ({ staff, page }) => {
  staff.settings = { ...staff.settings, venue_qr_token: 'room-token-1' };
  const rotations: string[] = [];
  page.on('request', (r) => { if (r.url().includes('rotate_venue_qr_token')) rotations.push(r.url()); });
  await page.goto('/admin/qr-codes');
  await page.getByRole('button', { name: 'Replace code…' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Replace the room QR code?' });
  await expect(dialog).toContainText('stops working the moment you confirm');
  await dialog.getByRole('button', { name: 'Keep the current code' }).click();
  await expect(dialog).toHaveCount(0);
  expect(rotations).toEqual([]);
});

test('without a room code nothing is drawn to print', async ({ page }) => {
  await page.goto('/admin/qr-codes');
  await expect(page.getByText('This restaurant has no room code yet.')).toBeVisible();
  await expect(page.locator('#qr-card-venue')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Replace code…' })).toBeDisabled();
});

test('a failed load says so instead of "no tables"', async ({ page }) => {
  await page.route('**/rest/v1/tables**', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"down"}' }));
  await page.goto('/admin/qr-codes');
  await expect(page.getByRole('alert').filter({ hasText: 'The codes could not be loaded.' })).toBeVisible();
  await page.getByRole('button', { name: 'A4 Sheet' }).click();
  await expect(page.getByText('No tables created yet.')).toHaveCount(0);
});
