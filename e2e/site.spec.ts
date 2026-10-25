import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

/**
 * The website at `/` (lasoul.net). The menu lives at /menu/lasoul; the site
 * must get a visitor there in one tap, in their language, without errors.
 */

const setLocale = async (page: Page, locale: 'en' | 'bs' | 'ar') => {
  await page.addInitScript((l) => localStorage.setItem('lasoul-lang', l as string), locale);
};

/** Console errors and uncaught exceptions while the page is open. */
const collectErrors = (page: Page) => {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
};

const LANGUAGE_BUTTON = /^(Change language|Promijeni jezik|تغيير اللغة):/;

test.describe('website', () => {
  test('renders the home page with a working "View the menu" link', async ({ page }) => {
    const errors = collectErrors(page);
    await setLocale(page, 'en');
    await page.goto('/');

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Burgers and cakes, made with soul.');
    await expect(page.getByRole('heading', { name: 'House signatures' })).toBeAttached();
    await expect(page.getByRole('heading', { name: 'Order from your table' })).toBeAttached();

    const cta = page.getByRole('link', { name: 'View the menu', exact: true });
    await expect(cta).toHaveAttribute('href', '/menu/lasoul');
    await cta.click();
    await expect(page).toHaveURL(/\/menu\/lasoul$/);
    await expect(page.getByRole('button', { name: /Food/ }).first()).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('the three menu cards open their part of the menu', async ({ page }) => {
    await setLocale(page, 'en');
    await page.goto('/');
    for (const [name, slug] of [['Drinks', 'drinks'], ['Food', 'food'], ['Desserts', 'desserts']]) {
      await expect(page.getByRole('link', { name: `Open ${name}` })).toHaveAttribute('href', `/menu/lasoul/${slug}`);
    }
  });

  test('switches to Bosnian, then to Arabic right-to-left', async ({ page }) => {
    const errors = collectErrors(page);
    await setLocale(page, 'en');
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');

    await page.getByRole('button', { name: LANGUAGE_BUTTON }).click();
    await page.getByRole('menuitem', { name: 'Bosanski' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Burgeri i kolači pravljeni s dušom.');
    await expect(page.locator('html')).toHaveAttribute('lang', 'bs');
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(page.getByRole('link', { name: 'Pogledajte meni', exact: true })).toHaveAttribute('href', '/menu/lasoul');

    await page.getByRole('button', { name: LANGUAGE_BUTTON }).click();
    await page.getByRole('menuitem', { name: 'العربية' }).click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('برغر وكيك، مُحضَّرة بكل شغف.');
    await expect(page).toHaveTitle(/بوتيك الكيك والبرغر/);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    expect(errors).toEqual([]);
  });

  test('shows only the facts that are known: address, phone and directions', async ({ page }) => {
    await setLocale(page, 'en');
    await page.goto('/');
    const visit = page.locator('#visit');
    await expect(visit.getByText('Butmirska cesta 16A | 16B')).toBeAttached();
    await expect(visit.getByRole('link', { name: '+387 33 877 779' })).toHaveAttribute('href', 'tel:+38733877779');
    await expect(visit.getByRole('link', { name: /Directions/ })).toHaveAttribute('href', /google\.com\/maps/);
    // Opening hours and social profiles are not known yet: nothing, not a placeholder.
    await expect(visit.getByText(/Opening hours|TBD|Instagram|Facebook/)).toHaveCount(0);
  });

  test('describes the restaurant to search engines', async ({ page }) => {
    await setLocale(page, 'en');
    await page.goto('/');
    await expect(page).toHaveTitle('La Soul — Cake & Burger Boutique in Sarajevo');
    const ld = await page.locator('script#site-restaurant-jsonld').textContent();
    const data = JSON.parse(ld ?? '{}');
    expect(data['@type']).toBe('Restaurant');
    expect(data.telephone).toBe('+38733877779');
    expect(data.address.streetAddress).toBe('Butmirska cesta 16A | 16B');
    expect(data.openingHoursSpecification).toBeUndefined();
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', /\/site\/og\.jpg$/);
  });
});
