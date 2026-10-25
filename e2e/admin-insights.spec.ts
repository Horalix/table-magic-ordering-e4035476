import { test, expect } from './staff-fixtures';
import type { Page } from '@playwright/test';

/**
 * The owner-facing analytics: what to do next, why sales moved, whether
 * today is normal, and the menu-engineering matrix.
 *
 * The statistics are tested against PostgreSQL in supabase/tests; these specs
 * hold the pages to the promise that the answer reaches the owner as a
 * sentence they can act on — and still fits on a phone.
 */

/** No sideways scrolling at a phone's width. */
async function fitsWidth(page: Page, width = 390) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, `page is ${overflow}px wider than a ${width}px phone`).toBeLessThanOrEqual(0);
}

test.describe('the dashboard', () => {
  test('leads with the three things most worth doing, in KM a week', async ({ page }) => {
    await page.goto('/admin');
    const cards = page.getByRole('list', { name: 'Top three things to do' }).getByRole('listitem');
    await expect(cards).toHaveCount(3);
    // Worth first: 167, then 100, then 35. The 24 KM card waits on the full list.
    await expect(cards.nth(0)).toContainText('Quinoa salad is looked at but rarely ordered');
    await expect(cards.nth(0)).toContainText('worth about 167 KM a week; based on 300 looks at the dish.');
    await expect(cards.nth(1)).toContainText('Chocolate cake has been sold out');
    await expect(cards.nth(2)).toContainText('Suggest Cola with La Soul Burger');
    await expect(page.getByRole('link', { name: /All 4/ })).toBeVisible();
  });

  test('says whether today is normal: pace, a bad day, a slow kitchen', async ({ page }) => {
    await page.goto('/admin');
    const card = page.getByLabel('Is today normal');
    await expect(card).toContainText('1,240 KM so far, 113% of a usual Sunday by this time');
    await expect(card).toContainText('Thursday 22 Oct: 600 KM, 40% below a usual Thursday (1,000 KM).');
    await expect(card).toContainText('Kitchen: slowest 1 in 10 tickets 18 min in the last 2 hours, usually 12 (1.5×).');
    await expect(card).toContainText('Bar: slowest 1 in 10 tickets 5 min');
  });

  test('says so when nothing passed', async ({ staff, page }) => {
    staff.analytics.insights = [];
    await page.goto('/admin');
    await expect(page.getByText('Nothing worth your time right now.')).toBeVisible();
  });

  test('fits a phone', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/admin');
    await expect(page.getByText('Quinoa salad is looked at but rarely ordered')).toBeVisible();
    await fitsWidth(page);
  });
});

test.describe('analytics', () => {
  test('opens with why sales changed, in one sentence', async ({ staff, page }) => {
    await page.goto('/admin/analytics');
    const card = page.getByLabel('Why sales changed');
    await expect(card).toContainText('Net sales −8% vs last week: 10% fewer tables at lunch; spend per table +2%.');
    await expect(card).toContainText('vs the same days of the 4 weeks before');
    // The second comparison asks for the 28 days before the current week.
    await expect.poll(() => staff.rpcCalls.filter((c) => c.fn === 'sales_decomposition').length).toBe(2);
    const second = staff.rpcCalls.filter((c) => c.fn === 'sales_decomposition')[1].body;
    expect(second).toMatchObject({ _from: '2026-10-18', _to: '2026-10-24', _cmp_from: '2026-09-20', _cmp_to: '2026-10-17' });
  });

  test('fits a phone', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/admin/analytics');
    await expect(page.getByLabel('Why sales changed')).toBeVisible();
    await fitsWidth(page);
  });
});

test.describe('menu intelligence', () => {
  test('draws the menu-engineering matrix with an action per box', async ({ page }) => {
    await page.goto('/admin/menu-intelligence');
    const stars = page.getByRole('region', { name: 'Stars' });
    await expect(stars).toContainText('La Soul Burger');
    await expect(stars).toContainText('Protect it');
    await expect(page.getByRole('region', { name: 'Plowhorses' })).toContainText('Ćevapi');
    const puzzles = page.getByRole('region', { name: 'Puzzles' });
    await expect(puzzles).toContainText('Truffle risotto');
    await expect(puzzles).toContainText('estimated cost');
    await expect(page.getByRole('region', { name: 'Dogs' })).toContainText('Plain toast');
    await expect(page.getByText('Too close to call')).toBeVisible();
    await expect(page.getByText('Tufahija', { exact: true })).toBeVisible();
    // The old revenue × margin-score list is gone.
    await expect(page.getByText('Worth protecting')).toHaveCount(0);
  });

  test('narrows the matrix to one kind of dish', async ({ page }) => {
    await page.goto('/admin/menu-intelligence');
    await page.getByRole('button', { name: 'Starters' }).click();
    await expect(page.getByRole('region', { name: 'Dogs' })).toContainText('Plain toast');
    await expect(page.getByRole('region', { name: 'Stars' })).not.toContainText('La Soul Burger');
  });

  test('shows one funnel from suggestion to sale, and says the increment is not measured', async ({ page }) => {
    await page.goto('/admin/menu-intelligence');
    const cart = page.getByRole('region', { name: 'In the cart' });
    await expect(cart).toContainText('252.00 KM');
    await expect(cart).toContainText('434.48 KM per 1,000 seen');
    await expect(page.getByText(/Incremental effect: not measured/)).toBeVisible();
  });

  test('lists every card, and "Suggest it" adds the pairing', async ({ staff, page }) => {
    await page.goto('/admin/menu-intelligence');
    const list = page.getByRole('list', { name: 'What to do next' });
    await expect(list.getByRole('listitem')).toHaveCount(4);
    await list.getByRole('button', { name: 'Suggest it' }).click();
    await expect.poll(() => staff.curated.length).toBe(1);
    expect(staff.curated[0]).toMatchObject({ source_item_id: 'item-burger', recommended_item_id: 'item-cola' });
  });

  test('fits a phone', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/admin/menu-intelligence');
    await expect(page.getByRole('region', { name: 'Stars' })).toBeVisible();
    await fitsWidth(page);
  });
});

test.describe('daily report', () => {
  test("shows tomorrow's prep when it beats \"same as last week\"", async ({ page }) => {
    await page.goto('/admin/reports');
    const card = page.getByLabel("Tomorrow's prep");
    await expect(card).toContainText('Prep for Monday');
    await expect(card).toContainText('Ćevapi');
    await expect(card).toContainText('La Soul Burger');
  });

  test('withholds it when it does not', async ({ staff, page }) => {
    const climbing = [100, 90, 80, 70, 60, 50, 40, 30, 20, 10];
    const history = staff.analytics.prepHistory as { items: Record<string, unknown>[] };
    // Four climbing dishes: enough comparisons to judge, and "last week" wins.
    history.items = [1, 2, 3, 4].map((i) => ({
      ...history.items[0], item_id: `climb-${i}`, name: `Dish ${i}`, series: { lunch: climbing },
    }));
    await page.goto('/admin/reports');
    await expect(page.getByLabel("Tomorrow's prep")).toContainText('no better than simply repeating the week before');
  });

  test('fits a phone', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/admin/reports');
    await expect(page.getByLabel("Tomorrow's prep")).toContainText('Ćevapi');
    await fitsWidth(page);
  });
});
