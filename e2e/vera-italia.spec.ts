import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';
import { installVeraStubs, seatAtVera } from './vera-fixtures';

/** Scroll the page through once so every lazy photo loads, then back to the top, for the screenshot. */
async function settle(page: Page) {
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 500) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 120));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForLoadState('networkidle');
}

/**
 * Vera Italia: the same app in its own room (docs/two-restaurants.md).
 * Its menu shows its own dishes, wears its own look, and tells the database
 * which restaurant every request is about.
 */

test.describe('Vera Italia’s menu', () => {
  test('opens in its own look, with its four courses', async ({ page }) => {
    await installVeraStubs(page);
    await page.goto('/menu/veraitalia/');

    await expect(page.getByRole('img', { name: 'Vera Italia' }).first()).toBeVisible();
    for (const course of ['Antipasti & Insalate', 'Pasta & Risotto', 'Pizza Napoletana', 'Carne']) {
      await expect(page.getByRole('heading', { level: 2, name: course })).toBeVisible();
    }
    await expect(page.locator('html')).toHaveAttribute('data-venue', 'veraitalia');
    // Nothing of La Soul's: not its wordmark, not its promise.
    await expect(page.getByRole('img', { name: 'La Soul' })).toHaveCount(0);
    await settle(page);
    await page.screenshot({ path: `test-results/vera-home-${test.info().project.name}.png`, fullPage: true });
  });

  test('a course opens with its sections and dishes, every request naming Vera Italia', async ({ page }) => {
    const seen: (string | undefined)[] = [];
    await installVeraStubs(page, seen);
    await page.goto('/menu/veraitalia/');
    await page.getByRole('heading', { level: 2, name: 'Pizza Napoletana' }).click();

    await expect(page).toHaveURL(/\/menu\/veraitalia\/pizza-napoletana\//);
    await expect(page.getByRole('heading', { level: 2, name: 'Classiche' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Speciali' })).toBeVisible();
    await expect(page.getByText('Truffle Pizza').first()).toBeVisible();
    expect(seen.length).toBeGreaterThan(0);
    expect(new Set(seen)).toEqual(new Set(['veraitalia']));
    await settle(page);
    await page.screenshot({ path: `test-results/vera-pizza-${test.info().project.name}.png`, fullPage: true });
  });

  test('a seated guest sees their table and can call the waiter', async ({ page }) => {
    await installVeraStubs(page);
    await seatAtVera(page);
    await page.goto('/menu/veraitalia/');
    await expect(page.getByRole('button', { name: /Table 7/ })).toBeVisible();
    await page.getByRole('heading', { level: 2, name: 'Pasta & Risotto' }).click();
    await expect(page.getByText('Truffle Pasta').first()).toBeVisible();
    await settle(page);
    await page.screenshot({ path: `test-results/vera-pasta-${test.info().project.name}.png`, fullPage: false });
  });

  test('La Soul’s menu keeps La Soul’s look', async ({ page }) => {
    await page.goto('/menu/lasoul/');
    await expect(page.locator('html')).toHaveAttribute('data-venue', 'lasoul');
    await expect(page.getByRole('img', { name: 'La Soul' }).first()).toBeVisible();
  });
});

test.describe('Vera Italia’s website', () => {
  test('shows the room, the signature dishes and the courses, and leads to the menu', async ({ page }) => {
    await installVeraStubs(page);
    await page.goto('/veraitalia/');
    await expect(page.getByRole('heading', { level: 1, name: 'Vera Italia' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-venue', 'veraitalia');
    for (const dish of ['Truffle Pizza', 'Burrata Pizza', 'Truffle Pasta']) {
      await expect(page.getByRole('heading', { level: 3, name: dish })).toBeVisible();
    }
    await settle(page);
    await page.screenshot({ path: `test-results/vera-site-${test.info().project.name}.png`, fullPage: true });
    await page.getByRole('link', { name: 'View the menu' }).first().click();
    await expect(page).toHaveURL(/\/menu\/veraitalia\/$/);
  });
});
