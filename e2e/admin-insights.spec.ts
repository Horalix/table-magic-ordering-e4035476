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

/** Menu intelligence's own parts of the database: the dishes, and what its buttons write. */
interface MenuWrites {
  patches: { id: string; body: Record<string, unknown> }[];
  binned: string[];
  restored: string[];
}

async function stubMenuWrites(page: Page, dishes: Record<string, unknown>[]): Promise<MenuWrites> {
  const writes: MenuWrites = { patches: [], binned: [], restored: [] };
  const reply = (route: import('@playwright/test').Route, body: unknown, status = 200) => route.fulfill({
    status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body),
  });
  await page.route('**/rest/v1/menu_items**', (route) => {
    const request = route.request();
    // The dish a request names: ?id=eq.<id>.
    const id = new URL(request.url()).searchParams.get('id')?.replace(/^eq\./, '') ?? '';
    if (request.method() === 'PATCH') {
      const body = request.postDataJSON() as Record<string, unknown>;
      writes.patches.push({ id, body });
      const dish = dishes.find((d) => d.id === id);
      if (dish) Object.assign(dish, body);
      return reply(route, [], 204);
    }
    // "Which dishes are featured?" asks for the ones with a place.
    if (request.url().includes('featured_rank=not.is.null')) return reply(route, dishes.filter((d) => d.featured_rank != null));
    // One dish, by id (its name for a button's message).
    if (id) return reply(route, dishes.filter((d) => d.id === id));
    return reply(route, dishes);
  });
  await page.route('**/rest/v1/rpc/admin_delete_menu_entry**', (route) => {
    writes.binned.push(String(route.request().postDataJSON()._id));
    return reply(route, { name: 'Plain toast' });
  });
  await page.route('**/rest/v1/rpc/admin_restore_menu_entry**', (route) => {
    writes.restored.push(String(route.request().postDataJSON()._id));
    return reply(route, { name: 'Plain toast' });
  });
  return writes;
}

const DISHES = () => [
  { id: 'La Soul Burger', name: 'La Soul Burger', price: 18, food_cost: 6, featured_rank: 1, is_available: true },
  { id: 'Truffle risotto', name: 'Truffle risotto', price: 22, food_cost: null, featured_rank: null, is_available: true },
  { id: 'item-toast', name: 'Plain toast', price: 4, food_cost: null, featured_rank: null, is_available: true },
  { id: 'item-cake', name: 'Chocolate cake', price: 9, food_cost: null, featured_rank: null, is_available: false },
];

test.describe('menu intelligence', () => {
  test('opens on four numbers and what to do, with the rest one tab away', async ({ page }) => {
    await page.goto('/admin/menu-intelligence');
    const summary = page.getByRole('region', { name: 'Summary' });
    // 167 + 100 + 35 + 24, every card a weekly figure.
    await expect(summary).toContainText('~326 KM a week');
    await expect(summary).toContainText('4 things to do');
    await expect(summary).toContainText('Not measured');
    await expect(summary).toContainText('1 star');
    await expect(summary).toContainText('1 plowhorse');
    await expect(summary).toContainText('1 more too close to call.');
    await expect(summary).toContainText('4 of 5');

    await expect(page.getByRole('tab', { name: /To do/ })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tab', { name: /To do/ })).toContainText('4');
    await expect(page.getByRole('list', { name: 'What to do next' })).toBeVisible();
    // The matrix is on the page, not on screen.
    await expect(page.getByRole('region', { name: 'Stars' })).toBeHidden();

    // A number opens its part of the page.
    await summary.getByRole('button', { name: /Menu shape/ }).click();
    await expect(page.getByRole('tab', { name: 'Menu' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('region', { name: 'Stars' })).toBeVisible();
    await summary.getByRole('button', { name: /Exact margins/ }).click();
    await expect(page.getByRole('heading', { name: 'What each dish costs you' })).toBeInViewport();
  });

  test('a link to a section opens the part it is in', async ({ page }) => {
    await page.goto('/admin/menu-intelligence#pairings');
    await expect(page.getByRole('tab', { name: 'Suggestions' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText('What actually goes together')).toBeVisible();
    await page.goto('/admin/menu-intelligence#engineering');
    await expect(page.getByRole('tab', { name: 'Menu' })).toHaveAttribute('aria-selected', 'true');
  });

  test('draws the menu-engineering matrix with an action per box', async ({ page }) => {
    await page.goto('/admin/menu-intelligence');
    await page.getByRole('tab', { name: 'Menu' }).click();
    const stars = page.getByRole('region', { name: 'Stars' });
    await expect(stars).toContainText('La Soul Burger');
    await expect(stars).toContainText('Protect it');
    await expect(page.getByRole('region', { name: 'Plowhorses' })).toContainText('Ćevapi');
    const puzzles = page.getByRole('region', { name: 'Puzzles' });
    await expect(puzzles).toContainText('Truffle risotto');
    await expect(puzzles).toContainText('estimated cost');
    await expect(page.getByRole('region', { name: 'Dogs' })).toContainText('Plain toast');
    await expect(page.getByText(/^Too close to call/)).toBeVisible();
    await expect(page.getByText('Tufahija', { exact: true })).toBeVisible();
    // The old revenue × margin-score list is gone.
    await expect(page.getByText('Worth protecting')).toHaveCount(0);
  });

  test('draws the menu as a map, and a dot opens its dish', async ({ page }) => {
    await page.goto('/admin/menu-intelligence');
    await page.getByRole('tab', { name: 'Menu' }).click();
    const map = page.getByRole('img', { name: 'Menu map: 1 stars, 1 plowhorses, 1 puzzles, 1 dogs' });
    await expect(map).toBeVisible();
    // One dot per dish that can be placed (the one too close to call is drawn too).
    const dots = map.locator('.recharts-scatter-symbol');
    await expect(dots).toHaveCount(5);
    await map.locator('path[name="Truffle risotto"]').click();
    const dish = page.getByTestId('matrix-dish');
    await expect(dish).toContainText('Truffle risotto');
    await expect(dish).toContainText('Puzzles: profitable, not popular');
    await expect(dish).toContainText('Keeps a portion (estimate)');
    await expect(dish).toContainText('12.00 KM');
    // 25 a week × 0.50 KM, rounded.
    await expect(dish).toContainText('+13 KM a week');
    await expect(dish).toContainText('if it sells the same');
    await expect(dish).toContainText('Rename it, give it a better photo');
    await expect(dish.getByRole('link', { name: 'Edit dish' })).toHaveAttribute('href', '/admin/menu?dish=Truffle%20risotto');
  });

  test('narrows the matrix to one kind of dish', async ({ page }) => {
    await page.goto('/admin/menu-intelligence');
    await page.getByRole('tab', { name: 'Menu' }).click();
    await page.getByRole('button', { name: 'Starters' }).click();
    await expect(page.getByRole('region', { name: 'Dogs' })).toContainText('Plain toast');
    await expect(page.getByRole('region', { name: 'Stars' })).not.toContainText('La Soul Burger');
    await expect(page.getByRole('img', { name: /^Menu map/ }).locator('.recharts-scatter-symbol')).toHaveCount(1);
  });

  test('shows one funnel from suggestion to sale, and says the increment is not measured', async ({ page }) => {
    await page.goto('/admin/menu-intelligence');
    await page.getByRole('tab', { name: 'Suggestions' }).click();
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
    await expect(list.getByRole('status').filter({ hasText: 'Added to suggestions' })).toBeVisible();
  });

  test('every card has its own button: take a dish off and Undo, put one back on, edit one', async ({ page }) => {
    const writes = await stubMenuWrites(page, DISHES());
    await page.goto('/admin/menu-intelligence');
    const list = page.getByRole('list', { name: 'What to do next' });

    // The dish that sells little and earns little goes to the bin, and comes back.
    const toast = list.getByRole('listitem').filter({ hasText: 'Plain toast sells little' });
    await toast.getByRole('button', { name: 'Take it off the menu' }).click();
    await expect(toast.getByRole('status')).toContainText('Plain toast is off the menu. It is in Menu → Recently deleted.');
    expect(writes.binned).toEqual(['item-toast']);
    await expect(toast.getByRole('button', { name: 'Take it off the menu' })).toHaveCount(0);
    await toast.getByRole('button', { name: 'Undo' }).click();
    await expect.poll(() => writes.restored).toEqual(['item-toast']);
    await expect(toast.getByRole('button', { name: 'Take it off the menu' })).toBeVisible();

    // The dish that has been sold out for days goes back on sale.
    const cake = list.getByRole('listitem').filter({ hasText: 'Chocolate cake has been sold out' });
    await cake.getByRole('button', { name: 'Put it back on' }).click();
    await expect(cake.getByRole('status')).toContainText('Chocolate cake is back on the menu');
    expect(writes.patches).toContainEqual({ id: 'item-cake', body: { is_available: true } });

    // The dish people look at and do not order opens in the menu's editor.
    const salad = list.getByRole('listitem').filter({ hasText: 'Quinoa salad is looked at' });
    await expect(salad.getByRole('link', { name: 'Edit dish' })).toHaveAttribute('href', '/admin/menu?dish=item-salad');
  });

  test('"Feature it" takes the first free place of three, and says so when there is none', async ({ staff, page }) => {
    staff.analytics.insights = [
      { kind: 'puzzle', item_id: 'Truffle risotto', related_item_id: null, headline: 'Truffle risotto is profitable but rarely ordered',
        why: '6.0% of mains orders.', action: 'Rename Truffle risotto, give it a better photo and move it up its section',
        est_km_per_week: 60, confidence: 'high', evidence: 500, evidence_label: 'mains orders', link: '/admin/menu-intelligence#engineering' },
    ];
    const dishes = DISHES();
    const writes = await stubMenuWrites(page, dishes);
    await page.goto('/admin/menu-intelligence');
    const card = page.getByRole('list', { name: 'What to do next' }).getByRole('listitem');
    await card.getByRole('button', { name: 'Feature it' }).click();
    // The burger has place 1.
    await expect(card.getByRole('status')).toContainText('Truffle risotto now leads the menu home');
    expect(writes.patches).toContainEqual({ id: 'Truffle risotto', body: { featured_rank: 2 } });
    await card.getByRole('button', { name: 'Undo' }).click();
    await expect.poll(() => writes.patches.at(-1)).toEqual({ id: 'Truffle risotto', body: { featured_rank: null } });

    // With three featured, nothing is pushed out behind the owner's back.
    dishes[2].featured_rank = 2;
    dishes[3].featured_rank = 3;
    await card.getByRole('button', { name: 'Feature it' }).click();
    await expect(page.getByText(/Three dishes are already featured \(La Soul Burger, Plain toast, Chocolate cake\)/)).toBeVisible();
  });

  test('a dish\'s cost is typed where the margins are read', async ({ page }) => {
    const writes = await stubMenuWrites(page, DISHES());
    await page.goto('/admin/menu-intelligence#costs');
    await expect(page.getByText('1 of 4 dishes have a cost')).toBeVisible();
    const costs = page.getByRole('list', { name: 'Dish costs' });
    // No cost yet and the most money a week first; the one already recorded last.
    await expect(costs.getByRole('listitem').first()).toContainText('Truffle risotto');
    await expect(costs.getByRole('listitem').last()).toContainText('La Soul Burger');
    // The estimate in use is the placeholder, not a value.
    const risotto = page.getByLabel('Ingredient cost of Truffle risotto, in KM');
    await expect(risotto).toHaveValue('');
    await expect(risotto).toHaveAttribute('placeholder', '6.00');

    await risotto.fill('abc');
    await expect(costs.getByRole('listitem').first()).toContainText('A number like 3,20');
    await risotto.fill('7,50');
    await risotto.press('Enter');
    await expect.poll(() => writes.patches).toContainEqual({ id: 'Truffle risotto', body: { food_cost: 7.5 } });
    await expect(costs.getByRole('listitem').first()).toContainText('Keeps 14.50 KM · 66%');
    await expect(page.getByText('2 of 4 dishes have a cost')).toBeVisible();
    // It stays where it was typed.
    await expect(costs.getByRole('listitem').first()).toContainText('Truffle risotto');

    // Emptying it goes back to the estimate.
    await risotto.fill('');
    await risotto.press('Enter');
    await expect.poll(() => writes.patches.at(-1)).toEqual({ id: 'Truffle risotto', body: { food_cost: null } });
    await expect(page.getByText('1 of 4 dishes have a cost')).toBeVisible();
  });

  test('fits a phone, on every tab', async ({ page }) => {
    await stubMenuWrites(page, DISHES());
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/admin/menu-intelligence');
    await expect(page.getByRole('region', { name: 'Summary' })).toContainText('~326 KM a week');
    await fitsWidth(page);
    for (const tab of ['Menu', 'Suggestions', 'Kitchen']) {
      await page.getByRole('tab', { name: tab }).click();
      await fitsWidth(page);
    }
    await page.getByRole('tab', { name: 'Menu' }).click();
    await expect(page.getByRole('region', { name: 'Stars' })).toBeVisible();
    await expect(page.getByLabel('Ingredient cost of Truffle risotto, in KM')).toBeVisible();
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
