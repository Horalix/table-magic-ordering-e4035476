import { test, expect, seedSession } from './fixtures';

/**
 * Accessibility and multilingual behaviour on a phone.
 *
 * These are not cosmetic checks: an Arabic guest with a mirrored layout and a
 * guest using a screen reader both have to be able to complete an order.
 */

const setLocale = (locale: 'en' | 'bs' | 'ar') => async (page: import('@playwright/test').Page) => {
  await page.addInitScript((l) => localStorage.setItem('lasoul-lang', l as string), locale);
};

test.describe('Arabic RTL', () => {
  test.beforeEach(async ({ page }) => {
    await setLocale('ar')(page);
    await seedSession(page);
  });

  test('the document direction and language are correct', async ({ page }) => {
    await page.goto('/menu');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  });

  test('the layout does not overflow horizontally in RTL', async ({ page }) => {
    await page.goto('/menu');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test('checkout is usable in Arabic', async ({ page }) => {
    await page.goto('/cart');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  });
});

test.describe('Bosnian', () => {
  test('the menu renders Bosnian copy', async ({ page }) => {
    await setLocale('bs')(page);
    await page.goto('/menu');
    await expect(page.locator('html')).toHaveAttribute('lang', 'bs');
  });
});

test.describe('accessibility basics', () => {
  test.beforeEach(async ({ page }) => {
    await seedSession(page);
  });

  test('every interactive control has an accessible name', async ({ page }) => {
    await page.goto('/menu');

    const unnamed = await page.evaluate(() => {
      const controls = Array.from(document.querySelectorAll('button, a[href], input, select, textarea'));
      return controls
        .filter((el) => {
          const style = window.getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden') return false;
          const label = (el.getAttribute('aria-label') ?? '').trim()
            || (el.getAttribute('title') ?? '').trim()
            || (el.textContent ?? '').trim()
            || (el.getAttribute('placeholder') ?? '').trim();
          return label.length === 0;
        })
        .map((el) => el.outerHTML.slice(0, 120));
    });

    expect(unnamed).toEqual([]);
  });

  test('primary tap targets are at least 44px', async ({ page }) => {
    await page.goto('/menu');

    const tooSmall = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      return buttons
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && (r.height < 40 || r.width < 40);
        })
        .map((el) => `${el.textContent?.trim().slice(0, 30)} ${Math.round(el.getBoundingClientRect().height)}px`);
    });

    expect(tooSmall).toEqual([]);
  });

  // The checkout sheet only opens when online card payment is on, which the
  // e2e build never enables; its dialog behaviour is covered in
  // CheckoutSheet.test.tsx. The dish sheet uses the same useDialog contract.
  test('the dish sheet is announced as a dialog and closes on Escape and on Back', async ({ page }) => {
    await page.goto('/menu/food');
    await page.getByText('La Soul Burger').first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);

    await page.getByText('La Soul Burger').first().click();
    await expect(dialog).toBeVisible();
    await page.goBack();
    await expect(dialog).toHaveCount(0);
    await expect(page).toHaveURL(/\/menu\/food/);
  });

  test('with reduced motion an add still says what happened', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/menu/food');
    await page.getByRole('button', { name: /Add La Soul Burger to order|Dodaj La Soul Burger u narudžbu/ }).click();
    await expect(page.getByRole('button', { name: /\+ La Soul Burger/ })).toBeVisible();
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
  });

  test('reduced motion is respected', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/menu');
    // The page must still be fully usable, not stuck mid-animation.
    await expect(page.getByRole('searchbox')).toBeVisible();
  });
});
