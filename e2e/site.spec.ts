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
    await expect(cta).toHaveAttribute('href', '/menu/lasoul/');
    await cta.click();
    await expect(page).toHaveURL(/\/menu\/lasoul\/$/);
    await expect(page.getByRole('button', { name: /Food/ }).first()).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('the three menu cards open their part of the menu', async ({ page }) => {
    await setLocale(page, 'en');
    await page.goto('/');
    for (const [name, slug] of [['Drinks', 'drinks'], ['Food', 'food'], ['Desserts', 'desserts']]) {
      await expect(page.getByRole('link', { name: `Open ${name}` })).toHaveAttribute('href', `/menu/lasoul/${slug}/`);
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
    await expect(page.getByRole('link', { name: 'Pogledajte meni', exact: true })).toHaveAttribute('href', '/menu/lasoul/');
    // Each language has its own address.
    await expect(page).toHaveURL(/\/bs\/$/);

    await page.getByRole('button', { name: LANGUAGE_BUTTON }).click();
    await page.getByRole('menuitem', { name: 'العربية' }).click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('برغر وكيك، مُحضَّرة بكل شغف.');
    await expect(page).toHaveTitle(/مقهى حلال في سراييفو/);
    await expect(page).toHaveURL(/\/ar\/$/);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    expect(errors).toEqual([]);
  });

  test('shows the facts: address, phone, hours, directions and Instagram', async ({ page }) => {
    await setLocale(page, 'en');
    await page.goto('/');
    const visit = page.locator('#visit');
    await expect(visit.getByText('Butmirska cesta 16A | 16B')).toBeAttached();
    await expect(visit.getByRole('link', { name: '+387 33 877 779' })).toHaveAttribute('href', 'tel:+38733877779');
    await expect(visit.getByRole('link', { name: /Directions/ })).toHaveAttribute('href', 'https://maps.app.goo.gl/UrsoG5vew2FfwMt66');
    await expect(visit.getByText('Every day')).toBeAttached();
    await expect(visit.getByText('11:00–21:00')).toBeAttached();
    await expect(visit.getByRole('link', { name: /Instagram/ })).toHaveAttribute('href', 'https://www.instagram.com/lasoul.bih');
    await expect(visit.getByText(/TBD|Facebook/)).toHaveCount(0);
  });

  test('answers the questions guests ask, on the page and as FAQ data', async ({ page }) => {
    await setLocale(page, 'en');
    await page.goto('/');
    const faq = page.locator('#faq');
    await expect(faq.getByText('Is everything at La Soul halal?')).toBeVisible();
    await faq.getByText('Do you serve alcohol?').click();
    await expect(faq.getByText(/La Soul is alcohol-free/)).toBeVisible();
    const graphs = await page.locator('script[type="application/ld+json"]').allTextContents();
    const nodes = graphs.flatMap((g) => JSON.parse(g)['@graph'] ?? []);
    const faqNode = nodes.find((n: { '@type': string }) => n['@type'] === 'FAQPage');
    expect(faqNode.mainEntity.length).toBeGreaterThanOrEqual(7);
  });

  test('describes the restaurant to search engines', async ({ page }) => {
    await setLocale(page, 'en');
    await page.goto('/');
    await expect(page).toHaveTitle('La Soul — Halal Café in Sarajevo: Burgers, Cakes & Coffee');
    const graphs = await page.locator('script[type="application/ld+json"]').allTextContents();
    const place = graphs.flatMap((g) => JSON.parse(g)['@graph'] ?? [])
      .find((n: { '@type': unknown }) => Array.isArray(n['@type']) && (n['@type'] as string[]).includes('Restaurant'));
    expect(place.telephone).toBe('+38733877779');
    expect(place.address.streetAddress).toBe('Butmirska cesta 16A | 16B');
    expect(place.geo).toMatchObject({ latitude: 43.827548, longitude: 18.3103156 });
    expect(place.openingHoursSpecification[0]).toMatchObject({ opens: '11:00', closes: '21:00' });
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /\/$/);
    await expect(page.locator('link[rel="alternate"][hreflang="bs"]')).toHaveAttribute('href', /\/bs\/$/);
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', /^https:\/\/.+\/site\/og\.jpg$/);
  });

  test('opens in the language of its address', async ({ page }) => {
    await setLocale(page, 'en');
    // Typed without the slash, it still lands on the page's own address.
    await page.goto('/bs');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Burgeri i kolači pravljeni s dušom.');
    await expect(page).toHaveURL(/\/bs\/$/);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /\/bs\/$/);
    await page.goto('/ar/');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('برغر وكيك، مُحضَّرة بكل شغف.');
  });

  // Most AI answer engines read the HTML and run no JavaScript.
  test('serves real words to crawlers that run no JavaScript', async ({ page }) => {
    const html = await (await page.request.get('/')).text();
    expect(html).toContain('<div data-prerender>');
    expect(html).toContain('<h1>Burgers and cakes, made with soul.</h1>');
    expect(html).toContain('Is everything at La Soul halal?');
    expect(html).toMatch(/<script type="application\/ld\+json">.*"FAQPage"/);
    expect(html).toMatch(/<link rel="alternate" hreflang="ar" href="[^"]+\/ar\/" \/>/);
    // Canonical addresses end in "/", the form the host serves every page at.
    expect(html).toMatch(/<link rel="canonical" href="https:\/\/[^"]+\/" \/>/);
  });

  test('publishes robots.txt, a sitemap and llms.txt', async ({ page }) => {
    const robots = await (await page.request.get('/robots.txt')).text();
    expect(robots).toContain('User-agent: GPTBot');
    expect(robots).toContain('Disallow: /admin');
    expect(robots).toMatch(/Sitemap: https:\/\/.+\/sitemap\.xml/);
    const sitemap = await (await page.request.get('/sitemap.xml')).text();
    expect(sitemap).toMatch(/<loc>https:\/\/.+\/bs\/<\/loc>/);
    expect(sitemap).toMatch(/<loc>https:\/\/.+\/menu\/lasoul\/<\/loc>/);
    const llms = await (await page.request.get('/llms.txt')).text();
    expect(llms).toMatch(/^# La Soul/);
    expect(llms).toContain('everything is halal');
  });

  test('a dish’s link opens that dish on the menu', async ({ page }) => {
    await setLocale(page, 'en');
    await page.goto('/menu/lasoul/food/?dish=item-burger');
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('dialog').getByRole('heading', { name: 'La Soul Burger' })).toBeVisible();
  });
});
