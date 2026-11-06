import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

/**
 * The menu board (/tv) on a TV whose browser darkens every page: Chrome's
 * "dark theme for web pages" repaints a light page dark itself, and the
 * entrance TV had it on — the ivory menu came out charcoal, the sage band
 * murky. The board is drawn for one look and says so (index.html and
 * src/lib/light-only.ts), so it is shown as it was drawn.
 *
 * A file of its own: the browser has to be started with the setting on.
 */
test.use({
  viewport: { width: 1080, height: 1920 },
  deviceScaleFactor: 1,
  colorScheme: 'dark',
  // What Chrome's "dark theme for web pages" turns on.
  launchOptions: { args: ['--blink-settings=forceDarkModeEnabled=true'] },
});

/** The colour the screen shows at the middle of a box, as painted, not as the stylesheet says. */
async function paintedAt(page: Page, box: { x: number; y: number; width: number; height: number }) {
  const png = (await page.screenshot({ clip: box })).toString('base64');
  return page.evaluate(async (data) => {
    const img = new Image();
    img.src = `data:image/png;base64,${data}`;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const [r, g, b] = ctx.getImageData(img.width >> 1, img.height >> 1, 1, 1).data;
    return { r, g, b };
  }, png);
}

test('the board stays light', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', "Chrome's own dark theme for web pages");

  // The browser does darken a page that says nothing: the same ivory comes out near black.
  const plain = await context.newPage();
  await plain.setContent('<body style="margin:0;height:100vh;background:#faf8f4"></body>');
  const darkened = await paintedAt(plain, { x: 100, y: 100, width: 8, height: 8 });
  expect(Math.max(darkened.r, darkened.g, darkened.b), `a plain page is painted rgb(${darkened.r}, ${darkened.g}, ${darkened.b})`).toBeLessThan(80);
  await plain.close();

  await page.goto('/tv?every=600');
  await expect(page.getByRole('heading', { level: 2, name: 'Burgers' })).toBeVisible();

  // The menu sheet's own ivory, below the last dish.
  const main = (await page.locator('main').boundingBox())!;
  const sheet = await paintedAt(page, { x: main.x + main.width / 2 - 4, y: main.y + main.height - 24, width: 8, height: 8 });
  expect(Math.min(sheet.r, sheet.g, sheet.b), `the menu sheet is painted rgb(${sheet.r}, ${sheet.g}, ${sheet.b})`).toBeGreaterThan(225);
  await expect(page.locator('meta[name="color-scheme"]')).toHaveAttribute('content', 'only light');
});
