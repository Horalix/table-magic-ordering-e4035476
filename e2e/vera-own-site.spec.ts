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
    // Where it is, on the photograph and in the visit section; "Opening soon" no longer.
    await expect(page.getByText('Italian restaurant · Sarajevo')).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Sarajevo' })).toBeAttached();
    await expect(page.getByText('Opening soon')).toHaveCount(0);
    await expect(page.locator('html')).toHaveAttribute('data-venue', 'veraitalia');
    await expect(page.getByRole('img', { name: 'La Soul' })).toHaveCount(0);
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest-veraitalia.webmanifest');
    await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute('content', 'Vera Italia');
  });

  test('a shared link to its menu or a course previews as Vera Italia, and installs as Vera Italia', async ({ page }) => {
    // What a link preview or a crawler reads: the HTML as served, before any code runs.
    for (const [path, title] of [['/menu/veraitalia/', 'Menu — Vera Italia, Italian Restaurant in Sarajevo'], ['/menu/veraitalia/pizza-napoletana/', 'Pizza Napoletana in Sarajevo — Vera Italia']]) {
      const html = await (await page.request.get(path)).text();
      expect(html).toContain(`<title>${title}</title>`);
      expect(html).toContain('href="/manifest-veraitalia.webmanifest"');
      expect(html).toContain('<meta name="apple-mobile-web-app-title" content="Vera Italia" />');
      expect(html).not.toContain('<title>La Soul');
    }
    expect(await (await page.request.get('/manifest-veraitalia.webmanifest')).json())
      .toMatchObject({ name: 'Vera Italia', start_url: '/menu/veraitalia/' });
  });

  test('tells search engines and link previews it is veraitalia.net', async ({ page }) => {
    const home = await (await page.request.get('/')).text();
    expect(home).toContain('<title>Vera Italia — Italian Restaurant &amp; Pizza in Sarajevo</title>');
    expect(home).toContain('<meta name="geo.placename" content="Sarajevo" />');
    expect(await (await page.request.get('/bs/')).text()).toContain('<title>Vera Italia — italijanski restoran i pizza u Sarajevu</title>');
    expect(home).toContain('<link rel="canonical" href="https://veraitalia.net/" />');
    expect(home).not.toContain('<title>La Soul');

    expect(await (await page.request.get('/robots.txt')).text()).toContain('Sitemap: https://veraitalia.net/sitemap.xml');
    const sitemap = await (await page.request.get('/sitemap.xml')).text();
    expect(sitemap).toContain('<loc>https://veraitalia.net/</loc>');
    expect(sitemap).not.toContain('lasoul');
    expect(await (await page.request.get('/llms.txt')).text()).toMatch(/^# Vera Italia/);
    expect(await (await page.request.get('/manifest.webmanifest')).json()).toMatchObject({ name: 'Vera Italia', start_url: '/menu/veraitalia/' });
  });

  test('its old address lands on its root; /bs/ and /ar/ are its website in Bosnian and Arabic', async ({ page }) => {
    await installVeraStubs(page);
    await page.goto('/veraitalia');
    await expect(page).toHaveURL(/:\d+\/$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Vera Italia' })).toBeVisible();

    await page.goto('/bs/');
    await expect(page.getByRole('link', { name: 'Pogledajte meni' }).first()).toBeVisible();
    await page.goto('/ar/');
    await expect(page.getByRole('link', { name: 'عرض القائمة' }).first()).toBeVisible();

    // What a crawler reads at each: its own language, and the other two linked.
    for (const [path, lang] of [['/', 'en'], ['/bs/', 'bs'], ['/ar/', 'ar']]) {
      const html = await (await page.request.get(path)).text();
      expect(html).toMatch(new RegExp(`<html lang="${lang}"`));
      for (const other of ['/', '/bs/', '/ar/']) expect(html).toContain(`href="https://veraitalia.net${other}"`);
    }
  });

  test('every dish has its own page, and the website answers what people ask', async ({ page }) => {
    const dish = await (await page.request.get('/menu/veraitalia/dish/truffle-pizza/')).text();
    expect(dish).toContain('<title>Truffle Pizza — 25 KM · Vera Italia, Sarajevo</title>');
    expect(dish).toContain('"priceCurrency":"BAM"');

    const home = await (await page.request.get('/')).text();
    const ld = JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(home)![1]) as { '@graph': { '@type': string }[] };
    expect(ld['@graph'].map((n) => n['@type'])).toEqual(expect.arrayContaining(['Restaurant', 'WebSite', 'FAQPage']));
    expect(home).toContain('Is the pizza at Vera Italia Neapolitan?');
    expect(await (await page.request.get('/llms-full.txt')).text()).toContain('[Truffle Pizza](https://veraitalia.net/menu/veraitalia/dish/truffle-pizza/) / ');
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
