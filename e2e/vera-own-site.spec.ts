import { test, expect } from './fixtures';
import { installVeraStubs } from './vera-fixtures';

/**
 * Vera Italia's own site, veraitalia.net: this code built with
 * VITE_HOME_VENUE=veraitalia (src/lib/home-venue.ts). Runs against that
 * build only, and is skipped in the normal run against La Soul's:
 *
 *   VITE_HOME_VENUE=veraitalia npx vite build --mode e2e --outDir dist-e2e-vera
 *   npx vite preview --outDir dist-e2e-vera --port 4184
 *   E2E_HOME_VENUE=veraitalia E2E_BASE_URL=http://localhost:4184 npx playwright test e2e/vera-own-site.spec.ts
 */
test.skip(process.env.E2E_HOME_VENUE !== 'veraitalia', 'Vera Italia’s own build only');

test.describe('Vera Italia’s own site', () => {
  test('opens on Vera Italia’s website, with nothing of La Soul’s', async ({ page }) => {
    await installVeraStubs(page);
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Vera Italia' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-venue', 'veraitalia');
    await expect(page.getByRole('img', { name: 'La Soul' })).toHaveCount(0);
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest-veraitalia.webmanifest');
    await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute('content', 'Vera Italia');
  });

  test('tells search engines and link previews it is veraitalia.net', async ({ page }) => {
    const home = await (await page.request.get('/')).text();
    expect(home).toContain('<title>Vera Italia — Cucina Italiana</title>');
    expect(home).toContain('<link rel="canonical" href="https://veraitalia.net/" />');
    expect(home).not.toContain('<title>La Soul');

    expect(await (await page.request.get('/robots.txt')).text()).toContain('Sitemap: https://veraitalia.net/sitemap.xml');
    const sitemap = await (await page.request.get('/sitemap.xml')).text();
    expect(sitemap).toContain('<loc>https://veraitalia.net/</loc>');
    expect(sitemap).not.toContain('lasoul');
    expect(await (await page.request.get('/llms.txt')).text()).toMatch(/^# Vera Italia/);
    expect(await (await page.request.get('/manifest.webmanifest')).json()).toMatchObject({ name: 'Vera Italia', start_url: '/menu/veraitalia/' });
  });

  test('its old address and La Soul’s language pages land on its root', async ({ page }) => {
    await installVeraStubs(page);
    for (const path of ['/veraitalia', '/bs', '/ar']) {
      await page.goto(path);
      await expect(page).toHaveURL(/:\d+\/$/);
      await expect(page.getByRole('heading', { level: 1, name: 'Vera Italia' })).toBeVisible();
    }
  });

  test('a bare /menu is Vera Italia’s menu, and the website leads to it', async ({ page }) => {
    await installVeraStubs(page);
    await page.goto('/menu');
    await expect(page).toHaveURL(/\/menu\/veraitalia\/$/);
    await expect(page.getByRole('heading', { level: 2, name: 'Pizza Napoletana' })).toBeVisible();

    await page.goto('/');
    await page.getByRole('link', { name: 'View the menu' }).first().click();
    await expect(page).toHaveURL(/\/menu\/veraitalia\/$/);
  });
});
