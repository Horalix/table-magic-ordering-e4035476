import { test, expect } from './staff-fixtures';
import type { Page, Route } from '@playwright/test';

/**
 * Whose admin is this? The owner, La Soul's admin, Vera Italia's admin.
 *
 * The owner (an admin of no one restaurant) opens on both restaurants at
 * once, switches between them, and runs the team. A restaurant's admin sees
 * their restaurant's name and nothing of the other's: no switch, no
 * Overview, no Team, and those addresses send them to their dashboard.
 * Every admin page in the navigation is opened as each of them, with its
 * main dialog or action, and must not throw.
 */

const LA_SOUL = { slug: 'lasoul', name: 'La Soul', id: 'a5000000-0000-4000-8000-000000000001' };
const VERA = { slug: 'veraitalia', name: 'Vera Italia', id: 'a5000000-0000-4000-8000-000000000002' };
type Venue = typeof LA_SOUL;

const OWNER_ROLES = [{ user_id: 'staff-user-1', role: 'admin', venue_id: null }];
const adminOf = (v: Venue) => [{ user_id: 'staff-user-1', role: 'admin', venue_id: v.id }];

/** A test value for the Team form; it exists only in this file and the stub. */
const INITIAL_PASSWORD = 'e2e-initial-pass-1';

const json = (route: Route, body: unknown, status = 200) => route.fulfill({
  status,
  contentType: 'application/json',
  headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' },
  body: JSON.stringify(body),
});

const today = new Date().toISOString().slice(0, 10);
const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);

/** One restaurant's row of owner_overview(), shaped as 20261031110000_owner_overview.sql returns it. */
const overviewRow = (v: Venue, over: Record<string, unknown> = {}) => ({
  venue_id: v.id, slug: v.slug, name: v.name, is_live: true, day: today,
  sales: { gross: 0, net: 0, orders: 0, average_order: 0, paid: 0, open: 0, cancelled: 0, stuck_payments: 0 },
  last_week: { day: weekAgo, gross: 0, orders: 0, gross_by_now: 0, orders_by_now: 0 },
  seated: { tables_now: 0, covers_now: null, sittings_today: 0, covers_today: 0 },
  kitchen: { new: 0, accepted: 0, preparing: 0, ready: 0, held: 0, oldest_wait_minutes: null },
  floor: { calls: 0, oldest_call_minutes: null, bills: 0, oldest_bill_minutes: null },
  rating: { average: null, count: 0 },
  top_dish: null,
  printers: { total: 1, enabled: 1, online: 1, down: [], waiting: 0 },
  stale_orders: 0,
  ...over,
});

/** Two different evenings: a guest waiting at La Soul, a printer down at Vera Italia. */
const OVERVIEW = [
  overviewRow(LA_SOUL, {
    sales: { gross: 412.5, net: 400, orders: 23, average_order: 17.93, paid: 18, open: 4, cancelled: 1, stuck_payments: 0 },
    last_week: { day: weekAgo, gross: 520, orders: 30, gross_by_now: 375, orders_by_now: 21 },
    seated: { tables_now: 9, covers_now: 21, sittings_today: 31, covers_today: 60 },
    kitchen: { new: 2, accepted: 1, preparing: 3, ready: 1, held: 0, oldest_wait_minutes: 14 },
    floor: { calls: 1, oldest_call_minutes: 4, bills: 2, oldest_bill_minutes: 3 },
    rating: { average: 4.6, count: 5 },
    top_dish: { item_id: 'item-burger', name: 'La Soul Burger', units: 14, revenue: 252 },
  }),
  overviewRow(VERA, {
    sales: { gross: 188, net: 180, orders: 9, average_order: 20.89, paid: 6, open: 3, cancelled: 0, stuck_payments: 0 },
    last_week: { day: weekAgo, gross: 300, orders: 12, gross_by_now: 210, orders_by_now: 10 },
    seated: { tables_now: 4, covers_now: null, sittings_today: 8, covers_today: 0 },
    kitchen: { new: 0, accepted: 0, preparing: 2, ready: 0, held: 0, oldest_wait_minutes: 26 },
    rating: { average: 4.0, count: 2 },
    top_dish: { item_id: 'item-pizza', name: 'Pizza Margherita', units: 6, revenue: 84 },
    printers: { total: 1, enabled: 1, online: 0, down: ['Cucina'], waiting: 3 },
  }),
];

interface TeamStub {
  accounts: Record<string, unknown>[];
  calls: Record<string, unknown>[];
}

/** What the owner-only parts answer, and a record of who asked. */
async function stubOwnerParts(page: Page) {
  const overviewCalls: number[] = [];
  await page.route('**/rest/v1/rpc/owner_overview', (route) => {
    overviewCalls.push(Date.now());
    return json(route, OVERVIEW);
  });
  // Admin → Performance reads this on load; the default stub's null is not a report.
  await page.route('**/rest/v1/rpc/staff_performance', (route) => json(route, {
    from: weekAgo, to: today, today, waiters: [], unassigned: { orders: 0, net_sales: 0 }, low_ratings: [],
  }));

  const team: TeamStub = {
    calls: [],
    accounts: [
      { user_id: 'staff-user-1', email: 'kitchen@lasoul.test', username: null, display_name: null, kind: 'owner', venue: null, you: true },
      { user_id: 'u-ana', email: 'ana@lasoul.test', username: null, display_name: null, kind: 'admin', venue: 'lasoul', you: false },
      { user_id: 'u-amar', email: null, username: 'amar', display_name: 'Amar', kind: 'waiter', venue: 'lasoul', you: false },
      { user_id: 'u-kitchen', email: 'kitchen-screen@lasoul.test', username: null, display_name: null, kind: 'kitchen', venue: 'lasoul', you: false },
      { user_id: 'u-giulia', email: null, username: 'giulia', display_name: 'Giulia', kind: 'waiter', venue: 'veraitalia', you: false },
    ],
  };
  const known = new Set(['ana@lasoul.test', 'kitchen@lasoul.test', 'kitchen-screen@lasoul.test', 'existing@vera.test']);
  await page.route('**/functions/v1/manage-admins', (route) => {
    if (route.request().method() === 'OPTIONS') return json(route, {}, 204);
    const body = route.request().postDataJSON() ?? {};
    team.calls.push(body);
    if (body.action === 'list') {
      return json(route, { venues: [LA_SOUL, VERA].map(({ slug, name }) => ({ slug, name })), accounts: team.accounts });
    }
    if (body.action === 'appoint') {
      const email = String(body.email);
      if (!known.has(email) && !body.password) {
        return json(route, { error: `No account uses ${email} yet. Type an initial password (10+ characters) to create it`, code: 'needs_password' }, 400);
      }
      team.accounts.push({ user_id: `u-${email}`, email, username: null, display_name: null, kind: 'admin', venue: body.venue, you: false });
      return json(route, { ok: true, created: !known.has(email) });
    }
    if (body.action === 'revoke') {
      team.accounts = team.accounts.filter((a) => !(a.user_id === body.user_id && a.kind === 'admin' && a.venue === body.venue));
      return json(route, { ok: true });
    }
    return json(route, { error: 'Unknown action' }, 400);
  });
  return { overviewCalls, team };
}

/**
 * Uncaught errors: a page that opens must raise none. A request the browser
 * cut short because the test moved on to the next page is not the page
 * failing (WebKit words it as an access-control failure).
 */
function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => {
    if (/due to access control checks|^Load failed$|^Failed to fetch$/.test(e.message)) return;
    errors.push(e.message);
  });
  return errors;
}

const isPhone = (page: Page) => (page.viewportSize()?.width ?? 1280) < 1024;

/** The sidebar: always there on a laptop, behind the menu button on a phone. */
async function openDrawer(page: Page) {
  if (!isPhone(page)) return;
  const open = page.getByRole('button', { name: 'Open admin navigation' });
  await open.click();
  await expect(page.getByRole('button', { name: 'Close admin navigation' })).toBeVisible();
}

/**
 * A toast sits over a phone's top bar for a few seconds, and stays while the
 * pointer rests on it; move away and let it go before the next tap.
 */
async function toastSeen(page: Page, text: string) {
  await expect(page.getByText(text)).toBeVisible();
  await page.mouse.move(0, (page.viewportSize()?.height ?? 800) - 1);
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0, { timeout: 15_000 });
}

const adminMenu = (page: Page) => page.getByRole('navigation', { name: 'Admin menu' });
const quickTabs = (page: Page) => page.getByRole('navigation', { name: 'Admin quick navigation' });
const restaurantSwitch = (page: Page) => page.getByRole('group', { name: 'Restaurant', exact: true });

async function go(page: Page, label: string) {
  await openDrawer(page);
  await adminMenu(page).getByRole('link', { name: label, exact: true }).click();
}

interface AdminPage {
  label: string;
  path: string;
  heading: string | RegExp;
  /** The page's main dialog or action, done and undone without writing anything. */
  act?: (page: Page) => Promise<void>;
}

/** Every page in the admin navigation, in its order. */
const PAGES: AdminPage[] = [
  {
    label: 'Dashboard', path: '/admin', heading: 'Dashboard',
    act: async (page) => {
      await page.getByRole('button', { name: 'Dismiss setup guide' }).click();
      await expect(page.getByText('Get your restaurant ready')).toHaveCount(0);
    },
  },
  {
    label: 'Tonight', path: '/admin/tonight', heading: 'Tonight’s Floor',
    act: async (page) => {
      await page.getByRole('button', { name: /Terrace/ }).first().click();
      await expect(page.getByRole('dialog', { name: 'Terrace' })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
    },
  },
  {
    label: 'Orders', path: '/admin/orders', heading: 'Orders',
    act: async (page) => {
      await page.getByRole('button', { name: 'Cancel order 047' }).click();
      await expect(page.getByRole('dialog', { name: /Cancel order #047/ })).toBeVisible();
      await page.getByRole('button', { name: 'Keep order' }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
    },
  },
  {
    label: 'Tables', path: '/admin/tables', heading: 'Table Management',
    act: async (page) => {
      await page.getByRole('button', { name: 'Generate tables' }).click();
      await toastSeen(page, 'Enter a number between 1 and 100');
    },
  },
  { label: 'Floor Monitor', path: '/waiter/monitor', heading: '' },
  { label: 'Kitchen', path: '/kitchen', heading: '' },
  {
    label: 'Menu', path: '/admin/menu', heading: 'Menu Management',
    act: async (page) => {
      await page.getByRole('button', { name: 'Re-translate All' }).click();
      await expect(page.getByRole('alertdialog', { name: 'Re-translate the whole menu?' })).toBeVisible();
      await page.getByRole('button', { name: 'Keep my translations' }).click();
      await expect(page.getByRole('alertdialog')).toHaveCount(0);
    },
  },
  {
    label: 'Promotions', path: '/admin/promotions', heading: 'Promotions',
    act: async (page) => { await page.getByLabel('Find a dish').fill('pizza'); },
  },
  {
    label: 'Sections', path: '/admin/sections', heading: 'Sections & Waiters',
    act: async (page) => {
      await page.getByRole('button', { name: 'Delete section Terrace' }).click();
      await expect(page.getByRole('alertdialog')).toBeVisible();
      await page.getByRole('button', { name: 'Cancel' }).click();
      await expect(page.getByRole('alertdialog')).toHaveCount(0);
    },
  },
  {
    label: 'Waiters', path: '/admin/waiters', heading: 'Waiters',
    act: async (page) => {
      await page.getByRole('button', { name: 'Create', exact: true }).click();
      await toastSeen(page, 'Username (3+), password (6+), and display name are required');
    },
  },
  {
    label: 'QR Codes', path: '/admin/qr-codes', heading: 'QR Codes',
    act: async (page) => {
      await page.getByRole('button', { name: 'A4 Sheet' }).click();
      await expect(page.getByText('No tables created yet.')).toBeVisible();
    },
  },
  {
    label: 'Printing', path: '/admin/printing', heading: 'Printing',
    act: async (page) => {
      const bar = page.getByRole('group', { name: 'Preview station' }).getByRole('button', { name: 'Bar' });
      await bar.click();
      await expect(bar).toHaveAttribute('aria-pressed', 'true');
    },
  },
  {
    label: 'Service & suggestions', path: '/admin/service', heading: 'Service & merchandising',
    act: async (page) => {
      await page.getByRole('switch', { name: 'Accept orders from guests' }).click();
      await expect(page.getByRole('alertdialog', { name: 'Stop accepting orders?' })).toBeVisible();
      await page.getByRole('button', { name: 'Keep taking orders' }).click();
      await expect(page.getByRole('alertdialog')).toHaveCount(0);
    },
  },
  { label: 'What the app earned', path: '/admin/impact', heading: 'What the app earned' },
  { label: 'Daily Report', path: '/admin/reports', heading: 'Daily Report' },
  {
    label: 'Performance', path: '/admin/performance', heading: 'Staff performance',
    act: async (page) => { await expect(page.getByLabel('From', { exact: true })).toHaveValue(weekAgo); },
  },
  { label: 'Menu intelligence', path: '/admin/menu-intelligence', heading: 'Menu intelligence' },
  { label: 'Analytics', path: '/admin/analytics', heading: /^Analytics/ },
  {
    label: 'Audit log', path: '/admin/audit', heading: 'Audit log',
    act: async (page) => {
      const money = page.getByRole('button', { name: 'Money' });
      await money.click();
      await expect(money).toHaveAttribute('aria-pressed', 'true');
    },
  },
];

/** The two staff screens in the admin's navigation, which have no admin chrome of their own. */
async function staffScreen(page: Page, p: AdminPage, venue: Venue) {
  if (p.path === '/waiter/monitor') {
    await expect(page.getByRole('heading', { level: 1, name: `${venue.name} · Floor` })).toBeVisible();
    await page.getByRole('button', { name: /All Tables/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'All tables' })).toBeVisible();
  } else {
    await expect(page.getByRole('heading', { level: 1, name: /Kitchen & Bar/ })).toContainText(venue.name);
  }
}

/**
 * Open every page in the navigation, as this account looking at this
 * restaurant: its heading, its main dialog or action, the restaurant's name
 * on the page, and nothing thrown.
 */
async function walkEveryPage(page: Page, venue: Venue, other: Venue, { owner }: { owner: boolean }) {
  for (const p of PAGES) {
    if (p.path === '/waiter/monitor' || p.path === '/kitchen') {
      await go(page, p.label);
      await expect(page).toHaveURL(new RegExp(`${p.path}$`));
      await staffScreen(page, p, venue);
      await page.goto('/admin/orders');
      continue;
    }
    await go(page, p.label);
    await expect(page).toHaveURL(new RegExp(`${p.path}$`));
    await expect(page.getByRole('heading', { level: 1, name: p.heading, exact: typeof p.heading === 'string' })).toBeVisible();
    // The restaurant's name, wherever the admin names it.
    await expect(page).toHaveTitle(`${p.label} · ${venue.name} admin`);
    await expect(page.locator('aside h1')).toHaveText(venue.name);
    if (isPhone(page)) await expect(page.getByText(`${venue.name} admin`, { exact: true })).toBeVisible();
    if (!owner) await expect(page.locator('aside')).not.toContainText(other.name);
    await p.act?.(page);
  }
}

test.describe('the owner', () => {
  test.beforeEach(({ staff }) => { staff.roles = OWNER_ROLES; });

  test('opens on both restaurants, each with what needs attention', async ({ page }) => {
    const errors = watchErrors(page);
    const { overviewCalls } = await stubOwnerParts(page);
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/admin\/overview$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
    await expect(page).toHaveTitle('Overview · La Soul & Vera Italia');

    const laSoul = page.getByRole('region', { name: 'La Soul', exact: true });
    const vera = page.getByRole('region', { name: 'Vera Italia', exact: true });
    await expect(laSoul).toBeVisible();
    await expect(vera).toBeVisible();
    await expect(laSoul.getByText('412.50 KM')).toBeVisible();
    await expect(laSoul.getByText(/\+10% vs 375\.00 KM by this time last \w+day/)).toBeVisible();
    await expect(laSoul.getByText('18 paid · 4 open · 1 cancelled')).toBeVisible();
    await expect(laSoul.getByText('La Soul Burger')).toBeVisible();
    await expect(laSoul.getByText('1 guest call waiting · 4 min')).toBeVisible();
    await expect(vera.getByText('188.00 KM')).toBeVisible();
    await expect(vera.getByText('Pizza Margherita')).toBeVisible();
    await expect(vera.getByText('Printer down: Cucina')).toBeVisible();
    await expect(vera.getByText('An order has waited 26 min')).toBeVisible();
    // Nothing of one restaurant in the other's card.
    await expect(laSoul).not.toContainText('Pizza Margherita');
    await expect(laSoul).not.toContainText('Cucina');
    await expect(vera).not.toContainText('La Soul Burger');
    await expect(vera).not.toContainText('guest call');

    // Side by side on a laptop, one above the other on a phone.
    const [a, b] = [await laSoul.boundingBox(), await vera.boundingBox()];
    if (isPhone(page)) expect(b!.y).toBeGreaterThan(a!.y + a!.height - 1);
    else expect(Math.abs(b!.y - a!.y)).toBeLessThan(2);

    // In the navigation for the owner: Overview and Team, and on a phone a tab.
    await expect(adminMenu(page).getByRole('link', { name: 'Overview', exact: true })).toHaveCount(1);
    await expect(adminMenu(page).getByRole('link', { name: 'Team', exact: true })).toHaveCount(1);
    if (isPhone(page)) await expect(quickTabs(page).getByRole('link', { name: 'Overview' })).toBeVisible();

    expect(overviewCalls.length).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });

  test('keeps itself up to date, every 30 seconds', async ({ page }) => {
    const { overviewCalls } = await stubOwnerParts(page);
    await page.clock.install();
    await page.goto('/admin/overview');
    await expect(page.getByRole('region', { name: 'La Soul', exact: true })).toBeVisible();
    const first = overviewCalls.length;
    await page.clock.fastForward('00:31');
    await expect.poll(() => overviewCalls.length).toBeGreaterThan(first);
  });

  test('"Open Vera Italia admin" goes to its dashboard, and the switch goes both ways', async ({ page }) => {
    const errors = watchErrors(page);
    await stubOwnerParts(page);
    await page.goto('/admin');
    await page.getByRole('button', { name: 'Open Vera Italia admin' }).click();
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page).toHaveTitle('Dashboard · Vera Italia admin');
    await expect(page.locator('aside h1')).toHaveText('Vera Italia');
    expect(await page.evaluate(() => localStorage.getItem('lasoul.staff-venue'))).toBe('veraitalia');

    // The setup guide is put away for Vera Italia only.
    await page.getByRole('button', { name: 'Dismiss setup guide' }).click();
    await expect(page.getByText('Get your restaurant ready')).toHaveCount(0);

    await openDrawer(page);
    await expect(restaurantSwitch(page).getByRole('button', { name: 'Vera Italia' })).toHaveAttribute('aria-pressed', 'true');
    await restaurantSwitch(page).getByRole('button', { name: 'La Soul' }).click();
    await expect(page).toHaveTitle('Dashboard · La Soul admin');
    await expect(page.locator('aside h1')).toHaveText('La Soul');
    await expect(page.getByText('Get your restaurant ready')).toBeVisible();

    await openDrawer(page);
    await restaurantSwitch(page).getByRole('button', { name: 'Vera Italia' }).click();
    await expect(page).toHaveTitle('Dashboard · Vera Italia admin');
    await expect(page.getByText('Get your restaurant ready')).toHaveCount(0);

    // Back to both, and from there into La Soul.
    await go(page, 'Overview');
    await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
    await page.getByRole('button', { name: 'Open La Soul admin' }).click();
    await expect(page).toHaveTitle('Dashboard · La Soul admin');
    expect(errors).toEqual([]);
  });

  test('with nothing picked, looks at this site\'s own restaurant', async ({ page }) => {
    await stubOwnerParts(page);
    await page.goto('/admin/orders');
    await expect(page).toHaveTitle(`Orders · ${process.env.E2E_HOME_VENUE === 'veraitalia' ? 'Vera Italia' : 'La Soul'} admin`);
  });

  for (const [venue, other] of [[LA_SOUL, VERA], [VERA, LA_SOUL]] as const) {
    test(`every admin page opens under ${venue.name}, with its name`, async ({ page }) => {
      test.setTimeout(150_000);
      const errors = watchErrors(page);
      await stubOwnerParts(page);
      await page.goto('/admin');
      await page.getByRole('button', { name: `Open ${venue.name} admin` }).click();
      await expect(page).toHaveTitle(`Dashboard · ${venue.name} admin`);
      await walkEveryPage(page, venue, other, { owner: true });
      expect(errors).toEqual([]);
    });
  }

  test('runs the team: appoints a new admin, an existing one, and revokes one', async ({ page }) => {
    const errors = watchErrors(page);
    const { team } = await stubOwnerParts(page);
    await page.goto('/admin');
    await go(page, 'Team');
    await expect(page.getByRole('heading', { level: 1, name: 'Team' })).toBeVisible();

    const laSoul = page.getByRole('region', { name: 'La Soul team' });
    const vera = page.getByRole('region', { name: 'Vera Italia team' });
    await expect(laSoul.getByText('ana@lasoul.test')).toBeVisible();
    await expect(laSoul.getByText('Amar', { exact: true })).toBeVisible();
    await expect(laSoul.getByText('kitchen-screen@lasoul.test')).toBeVisible();
    await expect(vera.getByText('Giulia', { exact: true })).toBeVisible();
    await expect(vera.getByText('No admin of its own yet: you run it.')).toBeVisible();
    await expect(vera).not.toContainText('ana@lasoul.test');

    // A new account needs the initial password the owner types.
    await page.getByLabel('Their email').fill('marco@vera.test');
    await page.getByRole('group', { name: 'Restaurant they will run' }).getByRole('button', { name: 'Vera Italia' }).click();
    await page.getByRole('button', { name: 'Appoint Vera Italia admin' }).click();
    await expect(page.getByText(/No account uses marco@vera\.test yet/)).toBeVisible();
    await expect(page.locator('#team-password')).toBeFocused();

    await page.locator('#team-password').fill(INITIAL_PASSWORD);
    await page.getByRole('button', { name: 'Appoint Vera Italia admin' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'ask them to change it after signing in' })).toBeVisible();
    await expect(vera.getByText('marco@vera.test')).toBeVisible();
    await expect(page.locator('#team-password')).toHaveValue('');
    expect(team.calls.filter((c) => c.action === 'appoint').at(-1)).toMatchObject({ email: 'marco@vera.test', venue: 'veraitalia', password: INITIAL_PASSWORD });
    // The password went to the function, and nowhere on this device.
    expect(await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }))).not.toContain(INITIAL_PASSWORD);

    // An account that exists only gets the role; no password is sent.
    await page.getByLabel('Their email').fill('existing@vera.test');
    await page.getByRole('button', { name: 'Appoint Vera Italia admin' }).click();
    await expect(page.getByText('existing@vera.test is now the admin of Vera Italia')).toBeVisible();
    expect(team.calls.filter((c) => c.action === 'appoint').at(-1)).not.toHaveProperty('password');

    // Revoke La Soul's admin: that role only.
    await laSoul.getByRole('button', { name: 'Revoke ana@lasoul.test as La Soul admin' }).click();
    await expect(page.getByRole('alertdialog', { name: 'Revoke ana@lasoul.test?' })).toBeVisible();
    await page.getByRole('button', { name: 'Revoke admin' }).click();
    await expect(laSoul.getByText('ana@lasoul.test')).toHaveCount(0);
    expect(team.calls.find((c) => c.action === 'revoke')).toEqual({ action: 'revoke', user_id: 'u-ana', venue: 'lasoul' });

    // The owner is listed, and cannot be revoked from here.
    const owner = page.getByRole('list').filter({ hasText: '(you)' });
    await expect(owner).toContainText('kitchen@lasoul.test');
    await expect(owner.getByRole('button', { name: /Revoke/ })).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('changes their password from the admin menu', async ({ page }) => {
    const errors = watchErrors(page);
    await stubOwnerParts(page);
    const passwordWrites: unknown[] = [];
    await page.route('**/auth/v1/user**', async (route) => {
      if (route.request().method() === 'PUT') passwordWrites.push(route.request().postDataJSON());
      return route.fallback();
    });
    await page.goto('/admin/orders');
    await openDrawer(page);
    await page.getByRole('button', { name: 'Change password' }).click();
    const dialog = page.getByRole('dialog', { name: 'Change password' });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Current password').fill(INITIAL_PASSWORD);
    await dialog.getByLabel('New password', { exact: true }).fill('short');
    await expect(dialog.getByText('At least 10 characters.', { exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Change password' })).toBeDisabled();
    await dialog.getByLabel('New password', { exact: true }).fill('a-new-e2e-pass-2');
    await dialog.getByLabel('New password again').fill('a-new-e2e-pass-2');
    await dialog.getByRole('button', { name: 'Change password' }).click();
    await expect(page.getByText('Password changed.', { exact: false })).toBeVisible();
    await expect(dialog).toHaveCount(0);
    expect(passwordWrites).toEqual([expect.objectContaining({ password: 'a-new-e2e-pass-2' })]);
    expect(errors).toEqual([]);
  });
});

for (const [venue, other] of [[VERA, LA_SOUL], [LA_SOUL, VERA]] as const) {
  test.describe(`${venue.name}'s own admin`, () => {
    test.beforeEach(({ staff }) => { staff.roles = adminOf(venue); });

    test(`sees only ${venue.name}: no switch, no Overview, no Team`, async ({ page }) => {
      const errors = watchErrors(page);
      const { overviewCalls, team } = await stubOwnerParts(page);
      await page.goto('/admin');
      await expect(page).toHaveURL(/\/admin$/);
      await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
      await expect(page).toHaveTitle(`Dashboard · ${venue.name} admin`);
      await expect(page.locator('aside h1')).toHaveText(venue.name);
      await expect(page.locator('aside')).not.toContainText(other.name);
      await expect(restaurantSwitch(page)).toHaveCount(0);
      await expect(adminMenu(page).getByRole('link', { name: 'Overview' })).toHaveCount(0);
      await expect(adminMenu(page).getByRole('link', { name: 'Team' })).toHaveCount(0);
      await expect(quickTabs(page).getByRole('link', { name: 'Overview' })).toHaveCount(0);

      // The owner's addresses send them to their own dashboard.
      for (const path of ['/admin/overview', '/admin/team']) {
        await page.goto(path);
        await expect(page).toHaveURL(/\/admin$/);
        await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
        await expect(page).toHaveTitle(`Dashboard · ${venue.name} admin`);
      }
      // ...without ever asking for both restaurants or the team.
      expect(overviewCalls).toEqual([]);
      expect(team.calls).toEqual([]);

      // A choice the owner left on this device does not follow them.
      await page.evaluate((slug) => localStorage.setItem('lasoul.staff-venue', slug), other.slug);
      await page.reload();
      await expect(page).toHaveTitle(`Dashboard · ${venue.name} admin`);
      expect(await page.evaluate(() => localStorage.getItem('lasoul.staff-venue'))).not.toBe(other.slug);

      // They can change their own password.
      await openDrawer(page);
      await page.getByRole('button', { name: 'Change password' }).click();
      await expect(page.getByRole('dialog', { name: 'Change password' })).toBeVisible();
      await page.keyboard.press('Escape');
      expect(errors).toEqual([]);
    });

    test(`every admin page opens, named ${venue.name}`, async ({ page }) => {
      test.setTimeout(150_000);
      const errors = watchErrors(page);
      await stubOwnerParts(page);
      await page.goto('/admin');
      await expect(page).toHaveTitle(`Dashboard · ${venue.name} admin`);
      await walkEveryPage(page, venue, other, { owner: false });
      expect(errors).toEqual([]);
    });
  });
}

/*
 * Vera Italia's own site (veraitalia.net, src/lib/home-venue.ts). Runs
 * against that build only, as e2e/vera-own-site.spec.ts does:
 *
 *   VITE_HOME_VENUE=veraitalia npx vite build --mode e2e --outDir dist-e2e-vera
 *   npx vite preview --outDir dist-e2e-vera --port 4184
 *   E2E_HOME_VENUE=veraitalia E2E_BASE_URL=http://localhost:4184 npx playwright test e2e/admin-roles.spec.ts
 */
test.describe('on Vera Italia\'s own site', () => {
  test.skip(process.env.E2E_HOME_VENUE !== 'veraitalia', 'Vera Italia’s own build only');

  test('the admin sign-in is Vera Italia\'s, with nothing of La Soul\'s', async ({ page, staff }) => {
    staff.signedIn = false;
    await page.goto('/admin/login');
    await expect(page.getByRole('heading', { level: 1, name: 'Vera Italia Admin' })).toBeVisible();
    await expect(page.getByRole('img', { name: 'Vera Italia' })).toBeVisible();
    await expect(page.getByRole('img', { name: 'La Soul' })).toHaveCount(0);
    await expect(page.getByText('La Soul')).toHaveCount(0);
    await expect(page).toHaveTitle('Vera Italia admin sign in');
  });

  test('La Soul\'s admin signing in here still sees La Soul', async ({ page, staff }) => {
    staff.roles = adminOf(LA_SOUL);
    await stubOwnerParts(page);
    await page.goto('/admin');
    await expect(page).toHaveTitle('Dashboard · La Soul admin');
    await expect(page.locator('aside')).not.toContainText('Vera Italia');
  });
});

