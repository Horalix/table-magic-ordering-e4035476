import { test, expect } from './staff-fixtures';
import type { Locator, Page } from '@playwright/test';

/**
 * "What's new": the one-minute walkthrough an admin sees once on each device
 * after the navigation was rebuilt (src/components/admin/nav/whats-new.ts).
 *
 * Shown once, on the first admin page after signing in; put away for good by
 * Skip, Done or Escape; there again from the account area, from More on a
 * phone, from the search, and from an address ending ?tour=1. Each step
 * points at the real thing on the screen in hand, and none of it may sit
 * over what it points at or run off the screen.
 *
 * Every other spec starts with it already seen (staff-fixtures.ts,
 * `whatsNewSeen`), or it would open over the page under test.
 */

const OWNER = [{ user_id: 'staff-user-1', role: 'admin', venue_id: null }];
const LA_SOUL_ADMIN = [{ user_id: 'staff-user-1', role: 'admin', venue_id: 'a5000000-0000-4000-8000-000000000001' }];
const SEEN_KEY = 'tf.whatsNew.staff-user-1';
const VERSION = '2026-11-design';

const PHONE = { width: 390, height: 844 };
const SMALL_PHONE = { width: 375, height: 667 };
const LAPTOP = { width: 1440, height: 900 };

const TITLES = [
  'The admin has a new layout', 'Five areas', 'Find anything', 'Service',
  'On your iPhone', 'The floor monitor', 'What the app earned', 'That is the tour',
];

const tour = (page: Page) => page.getByTestId('whats-new-tour');
const light = (page: Page) => page.getByTestId('tour-light');
const seen = (page: Page) => page.evaluate((key) => localStorage.getItem(key), SEEN_KEY);
/** The page behind has loaded and knows whose admin this is: by now the walkthrough is open, if it is going to be. */
const settled = async (page: Page) => {
  await expect(page.getByTestId((page.viewportSize()?.width ?? 1280) < 1024 ? 'admin-top-venue' : 'admin-venue')).toHaveText(/La Soul|Vera Italia/);
};

/** The first thing on screen that carries one of these names. */
async function onScreen(page: Page, names: string[]): Promise<Locator | null> {
  for (const name of names) {
    for (const el of await page.locator(`[data-tour~="${name}"]`).all()) {
      if (await el.isVisible()) return el;
    }
  }
  return null;
}

/** The light is on exactly this, give or take its margin. */
async function lit(page: Page, names: string[]) {
  const target = await onScreen(page, names);
  expect(target, `something named ${names.join(' or ')} is on this screen`).not.toBeNull();
  await expect.poll(async () => {
    const [a, b] = [await light(page).boundingBox(), await target!.boundingBox()];
    return !!a && !!b && Math.abs(a.x - (b.x - 6)) <= 2 && Math.abs(a.y - (b.y - 6)) <= 2 && Math.abs(a.width - (b.width + 12)) <= 3 && Math.abs(a.height - (b.height + 12)) <= 3;
  }, { message: `the light is on ${names[0]}` }).toBe(true);
}

/** The card is whole on the screen, and not over the thing it points at. */
async function cardInPlace(page: Page) {
  const { width, height } = page.viewportSize()!;
  await expect.poll(async () => {
    const card = await tour(page).boundingBox();
    const spot = await light(page).boundingBox();
    if (!card) return 'no card';
    if (card.x < 0 || card.y < 0 || card.x + card.width > width + 0.5 || card.y + card.height > height + 0.5) return `off the screen ${JSON.stringify(card)}`;
    const over = spot && spot.width > 0
      && card.x < spot.x + spot.width && spot.x < card.x + card.width && card.y < spot.y + spot.height && spot.y < card.y + card.height;
    return over ? `over what it points at ${JSON.stringify({ card, spot })}` : 'in place';
  }).toBe('in place');
}

test.describe('the first time after the update', () => {
  test.use({ whatsNewSeen: false });

  test('it opens once, on the first admin page, and Skip puts it away for good', async ({ page }) => {
    await page.setViewportSize(LAPTOP);
    await page.goto('/admin/orders');
    await expect(tour(page)).toBeVisible();
    await expect(tour(page)).toContainText('Step 1 of 8');
    await expect(tour(page).getByRole('heading', { name: TITLES[0] })).toBeVisible();
    await expect(tour(page)).toContainText('Nothing was removed.');
    // The page is there behind it, untouched and not moved.
    await expect(page.locator('main h1')).toHaveText('Orders');
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    expect(await seen(page)).toBeNull();

    await tour(page).getByRole('button', { name: 'Skip' }).click();
    await expect(tour(page)).toHaveCount(0);
    expect(await seen(page)).toBe(VERSION);

    // Not on the next page, and not after signing in again on this device.
    await page.getByRole('navigation', { name: 'Admin menu' }).getByRole('link', { name: 'Menu' }).click();
    await expect(page).toHaveURL(/\/admin\/menu$/);
    await expect(tour(page)).toHaveCount(0);
    await page.reload();
    await settled(page);
    await expect(tour(page)).toHaveCount(0);
  });

  for (const [name, size] of [['a laptop', LAPTOP], ['a phone', PHONE], ['a small phone', SMALL_PHONE]] as const) {
    test(`on ${name} every step points at the real thing, stays on the screen, and Done is remembered`, async ({ page }) => {
      const wide = size.width >= 1024;
      await page.setViewportSize(size);
      await page.goto('/admin/orders');
      await expect(tour(page)).toBeVisible();

      /** What each step lights: the sidebar's things on a laptop, the bars' on a phone; nothing where there is nothing to point at. */
      const LIGHTS: (string[] | null)[] = [
        null, ['areas'], ['search'], ['service'], null,
        wide ? ['floor-monitor'] : ['more'], ['reports'], wide ? ['whats-new'] : ['more'],
      ];
      for (let i = 0; i < TITLES.length; i += 1) {
        await expect(tour(page)).toContainText(`Step ${i + 1} of 8`);
        await expect(tour(page).getByRole('heading', { name: TITLES[i], exact: true })).toBeVisible();
        if (LIGHTS[i]) await lit(page, LIGHTS[i]!);
        else await expect.poll(async () => (await light(page).boundingBox())?.width ?? -1).toBe(0);
        await cardInPlace(page);
        // Words a phone does not zoom or squint at, and buttons a thumb can hit.
        const next = tour(page).getByRole('button', { name: i === TITLES.length - 1 ? 'Done' : 'Next' });
        expect((await next.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        if (!wide) expect(await tour(page).locator('#whats-new-words p').first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
        if (i === TITLES.length - 1) {
          // The right arrow steps on but never ends it: only Done does, so a held key cannot close the last step unread.
          await page.keyboard.press('ArrowRight');
          await expect(tour(page)).toContainText('Step 8 of 8');
        }
        await next.click();
      }
      await expect(tour(page)).toHaveCount(0);
      expect(await seen(page)).toBe(VERSION);
      // Nothing was moved or left open behind it.
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
      await page.reload();
      await settled(page);
      await expect(tour(page)).toHaveCount(0);
    });
  }

  test('says where the phone’s Setup is, and what a laptop’s shortcut is', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto('/admin');
    await tour(page).getByRole('button', { name: 'Next' }).click();
    await expect(tour(page)).toContainText('Setup is under More');
    await expect(tour(page)).toContainText('Menu is now Dishes, under Menu.');
    await tour(page).getByRole('button', { name: 'Next' }).click();
    await expect(tour(page)).toContainText('Tap the magnifier');

    await page.setViewportSize(LAPTOP);
    await expect(tour(page)).toContainText(/Press (Ctrl K|⌘K), or click here/);
    await tour(page).getByRole('button', { name: 'Back' }).click();
    await expect(tour(page)).toContainText('its pages are the tabs across the top');
    // Turned or resized, the light follows the thing to where it now is.
    await lit(page, ['areas']);
    await cardInPlace(page);
  });

  test('Escape is Skip; the arrow keys step; the keyboard stays inside; a stray click does not lose it', async ({ page }, testInfo) => {
    await page.setViewportSize(LAPTOP);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/admin/orders');
    await expect(tour(page)).toBeVisible();
    await expect(tour(page).getByRole('button', { name: 'Next' })).toBeFocused();

    await page.keyboard.press('ArrowRight');
    await expect(tour(page)).toContainText('Step 2 of 8');
    await page.keyboard.press('ArrowRight');
    await expect(tour(page)).toContainText('Step 3 of 8');
    await page.keyboard.press('ArrowLeft');
    await expect(tour(page)).toContainText('Step 2 of 8');
    await tour(page).getByRole('button', { name: 'Back' }).click();
    await expect(tour(page)).toContainText('Step 1 of 8');
    // Back took itself away from under the keyboard: it is on the card still.
    await expect(tour(page).getByRole('button', { name: 'Next' })).toBeFocused();

    // Tab goes round the card and never out to the page behind (a phone has no Tab key; iPhone’s Safari does not tab to buttons).
    if (testInfo.project.name === 'desktop') {
      for (let i = 0; i < 6; i += 1) {
        await page.keyboard.press('Tab');
        expect(await page.evaluate(() => !!document.activeElement?.closest('[data-testid="whats-new-tour"]'))).toBe(true);
      }
    }

    // The page behind cannot be clicked, and clicking it does not close the tour.
    await page.mouse.click(700, 30);
    await page.mouse.click(1200, 600);
    await expect(tour(page)).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/orders$/);

    await page.keyboard.press('Escape');
    await expect(tour(page)).toHaveCount(0);
    expect(await seen(page)).toBe(VERSION);
  });

  test('the owner is told where Team and Both restaurants are', async ({ page, staff }) => {
    staff.roles = OWNER;
    await page.setViewportSize(LAPTOP);
    await page.goto('/admin');
    // The owner's first page is both restaurants; the tour opens there, once it is known who this is.
    await expect(page).toHaveURL(/\/admin\/overview$/);
    await expect(tour(page)).toBeVisible();
    await tour(page).getByRole('button', { name: 'Next' }).click();
    await expect(tour(page)).toContainText('Team is under Setup. Overview is now Both restaurants, under Home.');
  });

  test('a restaurant’s own admin is told nothing of the owner’s pages', async ({ page, staff }) => {
    staff.roles = LA_SOUL_ADMIN;
    await page.setViewportSize(LAPTOP);
    await page.goto('/admin');
    await expect(tour(page)).toBeVisible();
    for (let i = 0; i < TITLES.length; i += 1) {
      await expect(tour(page)).toContainText(`Step ${i + 1} of 8`);
      await expect(tour(page)).not.toContainText(/Team|Both restaurants|Overview|Vera Italia/);
      await tour(page).getByRole('button', { name: i === TITLES.length - 1 ? 'Done' : 'Next' }).click();
    }
    await expect(tour(page)).toHaveCount(0);
  });

  test('each admin sees it once on a shared device: one account’s Done is not another’s', async ({ page }) => {
    await page.setViewportSize(LAPTOP);
    // Someone else has been through it on this laptop.
    await page.addInitScript(([version]) => localStorage.setItem('tf.whatsNew.someone-else', version), [VERSION]);
    await page.goto('/admin/orders');
    await expect(tour(page)).toBeVisible();
  });
});

test.describe('asked for again', () => {
  test('it does not open by itself once seen', async ({ page }) => {
    await page.setViewportSize(LAPTOP);
    await page.goto('/admin/orders');
    await settled(page);
    await expect(page.getByRole('heading', { level: 1, name: 'Orders' })).toBeVisible();
    await expect(tour(page)).toHaveCount(0);
  });

  test('from the sidebar on a laptop, and the keyboard goes back to where it was', async ({ page }) => {
    await page.setViewportSize(LAPTOP);
    await page.goto('/admin/orders');
    const again = page.locator('aside').getByRole('button', { name: 'What’s new' });
    await again.click();
    await expect(tour(page)).toContainText('Step 1 of 8');
    await tour(page).getByRole('button', { name: 'Skip' }).click();
    await expect(tour(page)).toHaveCount(0);
    await expect(again).toBeFocused();
    // The sidebar still fits a 1366×768 laptop with the new row in it.
    await page.setViewportSize({ width: 1366, height: 768 });
    expect(await page.locator('aside').evaluate((el) => el.scrollHeight <= el.clientHeight)).toBe(true);
    await expect(page.locator('aside').getByRole('button', { name: 'Sign out' })).toBeInViewport({ ratio: 1 });
  });

  test('from More on a phone', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto('/admin/orders');
    await page.getByRole('navigation', { name: 'Admin quick navigation' }).getByRole('button', { name: 'More' }).click();
    const more = page.getByRole('dialog', { name: 'More' });
    await more.getByRole('button', { name: /^What’s new/ }).click();
    await expect(more).toHaveCount(0);
    await expect(tour(page)).toContainText('Step 1 of 8');
    await cardInPlace(page);
    await page.keyboard.press('Escape');
    await expect(tour(page)).toHaveCount(0);
  });

  test('from the search: “tour”, “what\'s new”, “help”', async ({ page }) => {
    await page.setViewportSize(LAPTOP);
    await page.goto('/admin/orders');
    await expect(page.getByRole('heading', { level: 1, name: 'Orders' })).toBeVisible();
    const search = page.getByRole('dialog', { name: 'Search the admin' });
    await page.keyboard.press('Control+k');
    const box = search.getByRole('combobox');
    // As a keyboard types it, with a straight apostrophe.
    for (const words of ['help', 'what\'s new', 'tour']) {
      await box.fill(words);
      await expect(search.getByRole('option', { selected: true })).toContainText('What’s new');
    }
    await page.keyboard.press('Enter');
    await expect(search).toHaveCount(0);
    await expect(tour(page)).toContainText('Step 1 of 8');
  });

  test('from an address ending ?tour=1, which is then tidied away', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto('/admin/reservations?tour=1');
    await expect(tour(page)).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/reservations$/);
    await tour(page).getByRole('button', { name: 'Skip' }).click();
    // Refreshing does not bring it back.
    await page.reload();
    await settled(page);
    await expect(tour(page)).toHaveCount(0);
  });
});
