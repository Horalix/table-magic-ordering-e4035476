/**
 * demo-screens.mjs — a clean screenshot of every key screen of the demo.
 *
 * Opens the built demo (npm run build:demo) in a real browser, plays a guest
 * ordering at table 5 so the screens have something live on them, and saves a
 * PNG of each screen plus an index (README.md) saying what each one shows.
 *
 *   node scripts/demo-screens.mjs
 *   node scripts/demo-screens.mjs --out C:\somewhere --url http://localhost:8080 --scale 1 --only admin
 *
 * Phone screens are 390×844, desktop screens 1440×900, the TV board also in
 * its own portrait 1080×1920; all at --scale (2 by default, so a phone PNG is
 * 780×1688 pixels). Admin pages are saved twice: what fits the screen, and
 * the whole page (…-full.png).
 */
import path from 'node:path';
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { CONTEXT, demoServer, ensureDir, guestTablePath, options, quietDemo, settled } from './demo-lib.mjs';

const opts = options({ out: 'C:\\Users\\kerim\\demo-pitch\\screens', scale: '2' });
const OUT = ensureDir(path.resolve(String(opts.out)));
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };

const server = await demoServer(opts.url);
const browser = await chromium.launch();
const context = await browser.newContext({ ...CONTEXT, viewport: DESKTOP, deviceScaleFactor: Number(opts.scale) || 2 });
await quietDemo(context);

const index = [];
const failures = [];
const wanted = (name) => !opts.only || String(opts.only).split(',').some((prefix) => name.startsWith(prefix));

async function shot(page, name, description, { fullPage = false } = {}) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage, animations: 'disabled' });
  index.push([`${name}.png`, description]);
  console.log(`  ${name}.png`);
}

/** Runs one step; a step that fails is reported and the rest carry on. */
async function step(name, work) {
  try { await work(); } catch (error) {
    failures.push(`${name}: ${String(error?.message ?? error).split('\n')[0]}`);
    console.log(`  ! ${name} failed: ${String(error?.message ?? error).split('\n')[0]}`);
  }
}

async function open(url, viewport) {
  const page = await context.newPage();
  await page.setViewportSize(viewport);
  await page.goto(server.url + url, { waitUntil: 'load' });
  await settled(page);
  return page;
}

const go = async (page, url) => { await page.goto(server.url + url, { waitUntil: 'load' }); await settled(page); };
/** Staff screens ask for one tap before they may play sounds; give it, so the reminder is not in the picture. */
const allowSound = async (page) => {
  await page.getByRole('button', { name: /Alerts are silent|Sound blocked|Tap to enable sound/ }).first().click({ timeout: 1500 }).catch(() => undefined);
  await page.waitForTimeout(400);
};
const setLanguage = (page, lang) => page.evaluate((l) => localStorage.setItem('lasoul-lang', l), lang);

console.log(`Demo: ${server.url}\nSaving to: ${OUT}`);

// ------------------------------------------------------------------ the demo's own pages
if (wanted('demo')) {
  await step('demo-hub', async () => {
    const page = await open('/', DESKTOP);
    await shot(page, 'demo-01-hub', 'The demo’s front page: every screen of the product, one tap away, each already signed in.');
    await shot(page, 'demo-01-hub-full', 'The demo’s front page, whole page: the screens, a five-minute walkthrough, reset.', { fullPage: true });
    await page.close();
  });
}

// ------------------------------------------------------------------ the guest, on a phone
const guest = await open(guestTablePath(5), PHONE);
if (wanted('guest')) {
  await step('guest-welcome', async () => {
    await shot(guest, 'guest-01-welcome', 'Guest scans the QR code on table 5: one question, their name. No app, no account.');
    await guest.getByPlaceholder(/name/i).fill('Lejla');
    await guest.getByRole('button', { name: /continue/i }).click();
    await guest.waitForURL(/\/menu\//);
    await settled(guest, 900);
    await shot(guest, 'guest-02-menu-home', 'Menu home at table 5: featured dishes, today’s offers, search, call the waiter, language.');
    await guest.getByRole('heading', { name: 'Brunch' }).first().scrollIntoViewIfNeeded();
    await guest.mouse.wheel(0, 220);
    await settled(guest, 500);
    await shot(guest, 'guest-03-menu-categories', 'Menu home, further down: each category shown by photographs of its own dishes.');
    await shot(guest, 'guest-03-menu-home-full', 'Menu home, whole page: picks, offers, new dishes, six categories, jump-to sections, contact.', { fullPage: true });
  });
  await step('guest-category', async () => {
    await guest.getByRole('heading', { name: 'Mains' }).first().click();
    await settled(guest, 700);
    await shot(guest, 'guest-04-category-mains', 'A category page: sections, photos, prices, prep time, dietary icons, a lunch-deal price, one-tap add.');
    await guest.getByRole('button', { name: 'Truffle Risotto', exact: true }).click();
    await settled(guest, 700);
    await shot(guest, 'guest-05-dish-detail', 'Dish detail: large photo, description, allergens, portion, a note for the kitchen, quantity.');
    await guest.keyboard.press('Escape');
    await guest.waitForTimeout(500);
    await guest.getByRole('button', { name: 'Choose what comes in Burger Combo' }).click();
    await settled(guest, 600);
    await shot(guest, 'guest-06-combo', 'A combo: choose the burger and the drink, with surcharges shown; the kitchen and bar each get their part.');
    await guest.keyboard.press('Escape');
    await guest.waitForTimeout(500);
  });
  await step('guest-cart', async () => {
    await guest.getByRole('button', { name: 'Add Casa Burger to order' }).click();
    await guest.waitForTimeout(500);
    await guest.getByRole('button', { name: 'Add Truffle Risotto to order' }).click();
    await guest.waitForTimeout(900);
    await shot(guest, 'guest-07-order-bar', 'After adding two dishes: the running order bar with its total stays at the bottom of the menu.');
    await go(guest, '/cart');
    await shot(guest, 'guest-08-cart', 'The order before it is sent, with a suggestion chosen for what is in it (“often ordered with this”).');
    await guest.locator('button:has-text("Add")').last().click();
    await guest.waitForTimeout(900);
    await guest.getByRole('button', { name: /Send order/ }).click();
    await settled(guest, 600);
    await shot(guest, 'guest-09-checkout', 'How to pay: by card now (with an optional tip), or at the table in cash or by terminal.');
    await guest.getByRole('button', { name: /^Cash/ }).click();
    await guest.getByText(/Order sent/i).first().waitFor({ timeout: 20_000 });
    await settled(guest, 600);
    await shot(guest, 'guest-10-order-sent', 'Order sent: its number, when it will be ready, and that it is coming to table 5.');
    await guest.getByRole('button', { name: /Track your order/ }).click();
    await settled(guest, 900);
    await shot(guest, 'guest-11-order-tracking', 'The table’s tab: live order progress (received, preparing, ready, served), split the bill, request the bill.');
  });
  await step('guest-card', async () => {
    await go(guest, '/menu/casademo/desserts/');
    await guest.getByRole('button', { name: 'Add Basque Cheesecake to order' }).click();
    await guest.waitForTimeout(600);
    await go(guest, '/cart');
    await guest.getByRole('button', { name: /Send order/ }).click();
    await settled(guest, 500);
    await guest.getByRole('button', { name: /Pay now by card/ }).click();
    await guest.locator('[data-demo-card]').waitFor({ timeout: 20_000 });
    await settled(guest, 500);
    await shot(guest, 'guest-12-card-payment', 'Paying by card from the phone. In the demo the card is simulated and nothing is charged.');
    await guest.getByRole('button', { name: /Pay now/ }).click();
    await guest.getByText(/Payment received|paid|Order sent/i).first().waitFor({ timeout: 30_000 });
    await settled(guest, 900);
    await shot(guest, 'guest-13-card-paid', 'Card payment confirmed: only then does the order go to the kitchen.');
  });
  await step('guest-languages', async () => {
    await setLanguage(guest, 'bs');
    await go(guest, '/menu/casademo/');
    await shot(guest, 'guest-14-menu-bosnian', 'The same menu in Bosnian: every dish name and description is translated.');
    await setLanguage(guest, 'ar');
    await go(guest, '/menu/casademo/mains/');
    await shot(guest, 'guest-15-menu-arabic', 'The same menu in Arabic, right to left.');
    await setLanguage(guest, 'en');
  });
  await step('guest-reserve', async () => {
    await go(guest, '/reserve');
    await shot(guest, 'guest-16-reserve', 'Booking a table online: day, time and party size, no account needed.');
    await shot(guest, 'guest-16-reserve-full', 'Booking a table online, whole page.', { fullPage: true });
  });
}

// ------------------------------------------------------------------ the kitchen display
if (wanted('kitchen')) {
  await step('kitchen', async () => {
    const page = await open('/kitchen', DESKTOP);
    await allowSound(page);
    await shot(page, 'kitchen-01-board', 'Kitchen display: new, preparing and ready tickets with table, waiting time, allergens and notes; waiter calls and bill requests on top.');
    await page.getByRole('button', { name: 'All day' }).click();
    await settled(page, 500);
    await shot(page, 'kitchen-02-all-day', 'Kitchen “all day” view: how many of each dish are waiting, cooking and ready right now.');
    await page.getByRole('button', { name: 'Board', exact: true }).click();
    await page.getByRole('button', { name: 'Bar', exact: true }).click();
    await settled(page, 500);
    await shot(page, 'kitchen-03-bar', 'The bar’s view of the same board: only drinks, so each station sees its own work.');
    await page.getByRole('button', { name: 'All', exact: true }).click();
    await page.getByRole('button', { name: 'History' }).click();
    await settled(page, 700);
    await shot(page, 'kitchen-04-history', 'Kitchen history: what has been served today, to reprint or check.');
    await page.close();
  });
}

// ------------------------------------------------------------------ the waiter's phone
if (wanted('waiter')) {
  await step('waiter', async () => {
    const page = await open('/waiter', PHONE);
    await allowSound(page);
    await shot(page, 'waiter-01-attention', 'Waiter’s phone: what needs her now — food ready to carry, a table calling, a bill request — and what is owed.');
    await shot(page, 'waiter-01-full', 'Waiter’s phone, whole page: attention needed, in the kitchen, and all her tables.', { fullPage: true });
    await page.locator('button:has-text("My tables")').first().click();
    await settled(page, 600);
    await shot(page, 'waiter-02-my-tables', 'Waiter’s tables: who is seated, what they owe, and taking payment in cash or by terminal.');
    await page.close();
  });
}

// ------------------------------------------------------------------ the floor monitor
if (wanted('floor')) {
  await step('floor', async () => {
    const page = await open('/waiter/monitor', DESKTOP);
    await allowSound(page);
    await shot(page, 'floor-01-waiters', 'Floor monitor at the pass: each waiter’s tables and alerts; a waiter taps their name and PIN to act.');
    await page.getByText('All Tables').first().click();
    await settled(page, 700);
    await shot(page, 'floor-02-all-tables', 'Floor monitor, all tables: free, seated, food up, calling, wants the bill — the whole room at a glance.');
    await page.close();
  });
}

// ------------------------------------------------------------------ the TV menu board
if (wanted('tv')) {
  await step('tv', async () => {
    const page = await open('/tv', { width: 1080, height: 1920 });
    await page.waitForTimeout(1500);
    await shot(page, 'tv-01-portrait', 'TV menu board at the entrance (portrait 1080×1920): rotating sections with photos, prices and a QR code.');
    await page.setViewportSize(DESKTOP);
    await page.waitForTimeout(1500);
    await shot(page, 'tv-02-landscape', 'The TV menu board on a landscape screen (1440×900).');
    await page.close();
  });
}

// ------------------------------------------------------------------ the admin
const ADMIN = [
  ['admin-01-dashboard', '/admin', 'Admin dashboard: today’s revenue, orders, tables and calls, and the three most valuable things to do next.'],
  ['admin-02-analytics', '/admin/analytics', 'Analytics: why sales moved against last week (tables, spend, party size), by daypart, by day and by category.'],
  ['admin-03-reports', '/admin/reports', 'Daily report: sales by payment method, what is still owed, and closing the day against the drawer and terminal.'],
  ['admin-04-menu-intelligence', '/admin/menu-intelligence', 'Menu intelligence: what is worth acting on, in KM per week — dishes looked at but not ordered, pairings to suggest, items sold out.'],
  ['admin-08-impact', '/admin/impact', 'What the app earned: suggestions measured against tables that were shown none, with a cautious monthly figure.'],
  ['admin-09-promotions', '/admin/promotions', 'Promotions: featured dishes, sale prices with a window, what is new, and combos.'],
  ['admin-10-menu', '/admin/menu', 'Menu editor: categories and dishes in three languages, photos, allergens, prices, 86 a dish in one tap.'],
  ['admin-11-orders', '/admin/orders', 'Orders: every order with its status, payment and fiscal receipt, searchable; refunds and cancellations.'],
  ['admin-12-reservations', '/admin/reservations', 'Reservations: requests waiting for an answer, tonight’s bookings, confirm or propose another time.'],
  ['admin-13-tonight', '/admin/tonight', 'Tonight’s waiters: who works which section this shift.'],
  ['admin-14-tables', '/admin/tables', 'Tables: the floor’s tables and sections, and which are occupied now.'],
  ['admin-15-qr-codes', '/admin/qr-codes', 'QR codes: a code per table and one for the door, to print; rotate a code if it leaks.'],
  ['admin-16-sections', '/admin/sections', 'Floor sections: terrace, dining room, garden — the areas waiters are assigned to.'],
  ['admin-17-waiters', '/admin/waiters', 'Waiters: accounts, floor PINs and the kitchen tablet’s sign-in.'],
  ['admin-18-team', '/admin/team', 'Team (owner only): who manages the restaurant and every sign-in that exists.'],
  ['admin-19-performance', '/admin/performance', 'Performance: each waiter’s tables, sales, speed and guest ratings.'],
  ['admin-20-printing', '/admin/printing', 'Printing: network ticket printers, their status, what is waiting, and the ticket layout.'],
  ['admin-21-service', '/admin/service', 'Ordering & service: pause ordering, card payments, kitchen delay, order holds, suggestion settings, reservations.'],
  ['admin-22-audit', '/admin/audit', 'Audit log: who cancelled, refunded, reprinted or changed what, and when.'],
];

if (wanted('admin')) {
  const page = await open('/admin', DESKTOP);
  for (const [name, url, description] of ADMIN) {
    await step(name, async () => {
      await go(page, url);
      await shot(page, name, description);
      await shot(page, `${name}-full`, `${description} (whole page)`, { fullPage: true });
      if (url === '/admin/menu-intelligence') {
        for (const [tab, file, text] of [
          ['Menu', 'admin-05-menu-engineering', 'Menu engineering: every dish as a star, plowhorse, puzzle or dog, from what it sells and what it earns.'],
          ['Suggestions', 'admin-06-suggestions', 'Suggestions: how often each suggestion is shown, taken and paid for, and the pairings the data supports.'],
          ['Kitchen', 'admin-07-prep-forecast', 'Kitchen: tomorrow’s prep forecast per dish from ten weeks of the same weekday, and real prep times.'],
        ]) {
          await page.getByRole('tab', { name: tab }).or(page.getByRole('button', { name: tab, exact: true })).first().click();
          await settled(page, 800);
          await shot(page, file, text);
          await shot(page, `${file}-full`, `${text} (whole page)`, { fullPage: true });
        }
      }
    });
  }
  await page.close();
}

// ------------------------------------------------------------------ side by side
if (wanted('demo')) {
  await step('demo-stage', async () => {
    const page = await open(`/demo/stage?phone=${encodeURIComponent('/tab')}&screen=${encodeURIComponent('/kitchen')}`, { width: 1920, height: 1080 });
    await page.waitForTimeout(4500);
    await shot(page, 'demo-02-stage-guest-kitchen', 'Side by side (1920×1080): the guest’s phone tracking the order next to the kitchen display, live.');
    await go(page, `/demo/stage?phone=${encodeURIComponent('/waiter')}&screen=${encodeURIComponent('/admin')}`);
    await page.waitForTimeout(4500);
    await shot(page, 'demo-03-stage-waiter-admin', 'Side by side (1920×1080): the waiter’s phone next to the owner’s dashboard.');
    await page.close();
  });
}

await guest.close();
await browser.close();
await server.stop();

index.sort((a, b) => a[0].localeCompare(b[0]));
if (!opts.only) {
  writeFileSync(path.join(OUT, 'README.md'), [
    '# Demo screenshots',
    '',
    `Taken by \`node scripts/demo-screens.mjs\` from the offline demo build on ${new Date().toISOString().slice(0, 10)}.`,
    `Phone screens are 390×844, desktop 1440×900, at ×${opts.scale} pixel density. \`-full\` files are the whole page.`,
    '',
    '| File | What it shows |',
    '|---|---|',
    ...index.map(([file, description]) => `| ${file} | ${description} |`),
    '',
  ].join('\n'));
}
console.log(`\n${index.length} screenshots in ${OUT}`);
if (failures.length) {
  console.log(`\n${failures.length} step(s) failed:\n  ${failures.join('\n  ')}`);
  process.exitCode = 1;
}
