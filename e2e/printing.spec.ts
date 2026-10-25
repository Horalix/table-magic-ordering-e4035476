import { test, expect, anOrder, aHeldOrder } from './staff-fixtures';
import type { Page, Route } from '@playwright/test';

/**
 * Printing, end to end, against the stubbed database.
 *
 * The SQL that decides who may print what is tested in
 * supabase/tests/cloud-printers.test.ts; the printer protocols in
 * src/lib/cloud-print.test.ts. These specs hold the screens to it: a tablet
 * prints what is queued and nothing held, steps aside for a working network
 * printer, says out loud when a printer is down or a ticket did not print,
 * and the owner can add a printer and retry a ticket in a couple of taps.
 */

const json = (route: Route, body: unknown, status = 200) => route.fulfill({
  status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body),
});

const now = () => new Date().toISOString();

interface TicketRow {
  id: string; order_id: string; ticket_type: string; status: string; attempts: number;
  last_error: string | null; printed_at: string | null; print_verified: boolean | null;
  claimed_by_device: string | null; created_at: string; updated_at: string;
  orders?: Record<string, unknown>;
}

const ticketRow = (over: Partial<TicketRow>): TicketRow => ({
  id: 't1', order_id: 'order-1', ticket_type: 'kitchen', status: 'queued', attempts: 0, last_error: null,
  printed_at: null, print_verified: null, claimed_by_device: null, created_at: now(), updated_at: now(),
  ...over,
});

/** The ticket queue, as the kitchen and the admin read it. */
async function stubTickets(page: Page, rows: () => TicketRow[]) {
  await page.route('**/rest/v1/order_ticket_events**', (route) => {
    const url = new URL(route.request().url());
    const status = url.searchParams.get('status');
    const all = rows();
    return json(route, status === 'eq.queued' ? all.filter((r) => r.status === 'queued') : all);
  });
}

async function stubHealth(page: Page, printers: Record<string, unknown>[]) {
  await page.route('**/rest/v1/rpc/printer_health**', (route) => json(route, printers));
}

const kitchenPrinter = (over: Record<string, unknown> = {}) => ({
  id: 'p1', name: 'Kitchen printer', station: 'kitchen', protocol: 'star_cloudprnt', enabled: true,
  online: true, last_seen_at: now(), last_status: '200 OK', last_error: null, waiting: 0, ...over,
});

test.describe('a tablet that prints', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('kitchen:isPrinter', 'true');
      // Headless print dialogs: report "closed" at once.
      window.print = () => { window.dispatchEvent(new Event('afterprint')); };
    });
  });

  test('prints what the database queued for it', async ({ staff, page }) => {
    await stubTickets(page, () => [ticketRow({ order_id: 'order-1' })]);
    await page.goto('/kitchen');
    await expect(page.getByText('#047')).toBeVisible();
    await expect.poll(() => staff.printClaims, { timeout: 10_000 }).toContain('order-1');
  });

  test('does not print a held order until someone confirms it', async ({ staff, page }) => {
    staff.orders = [aHeldOrder()];
    // The database queues a ticket only on release.
    await stubTickets(page, () => staff.orders
      .filter((o) => o.released_to_kitchen_at)
      .map((o) => ticketRow({ id: `t-${o.id}`, order_id: String(o.id) })));
    await page.goto('/kitchen');
    await expect(page.getByRole('region', { name: 'Needs confirming' })).toBeVisible();
    await page.waitForTimeout(1500);
    expect(staff.printClaims).toEqual([]);

    await page.getByRole('button', { name: 'Confirm order for table 9' }).click();
    await expect.poll(() => staff.printClaims, { timeout: 20_000 }).toContain('order-held');
  });

  test('leaves a station to an online network printer', async ({ staff, page }) => {
    await stubTickets(page, () => [ticketRow({ order_id: 'order-1' })]);
    await stubHealth(page, [kitchenPrinter()]);
    await page.goto('/kitchen');
    await page.getByRole('button', { name: 'Kitchen', exact: true }).click();
    await expect(page.getByText('Kitchen printer: Online')).toBeVisible();
    await page.waitForTimeout(1500);
    expect(staff.printClaims).toEqual([]);
  });

  test('takes over when the network printer goes quiet', async ({ staff, page }) => {
    await stubTickets(page, () => [ticketRow({ order_id: 'order-1' })]);
    await stubHealth(page, [kitchenPrinter({ online: false, last_seen_at: new Date(Date.now() - 4 * 60_000).toISOString() })]);
    await page.goto('/kitchen');
    await expect(page.getByText(/Kitchen printer: Offline — last seen 4 min ago/)).toBeVisible();
    await expect.poll(() => staff.printClaims, { timeout: 10_000 }).toContain('order-1');
  });
});

test.describe('the board says what printed', () => {
  test('a ticket that did not print is impossible to miss', async ({ page }) => {
    await stubTickets(page, () => [ticketRow({ status: 'failed', last_error: 'The printer is out of paper' })]);
    await page.goto('/kitchen');
    await expect(page.getByRole('alert').filter({ hasText: 'Did not print — The printer is out of paper' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Reprint/ }).first()).toBeVisible();
  });

  test('a printed ticket says when and where', async ({ page }) => {
    await stubTickets(page, () => [ticketRow({
      status: 'printed', printed_at: now(), print_verified: true, claimed_by_device: 'cloud:Kitchen printer',
    })]);
    await page.goto('/kitchen');
    await expect(page.getByLabel('Print status').first()).toContainText('Kitchen printer');
  });

  test('a reprint for a station with an online printer just goes back in its queue', async ({ staff, page }) => {
    await stubTickets(page, () => [ticketRow({ status: 'printed', printed_at: now(), print_verified: true, claimed_by_device: 'cloud:Kitchen printer' })]);
    await stubHealth(page, [kitchenPrinter({ station: 'all' })]);
    const requeued: string[] = [];
    await page.route('**/rest/v1/rpc/requeue_ticket_print**', (route) => {
      requeued.push(String(route.request().postDataJSON()?._ticket_type));
      return json(route, { requeued: true, previous_printed_at: now(), attempts: 1 });
    });
    await page.goto('/kitchen');
    await page.getByRole('button', { name: /Reprint/ }).first().click();
    await expect(page.getByText('Reprinting on Kitchen printer').first()).toBeVisible();
    expect(requeued.sort()).toEqual(['bar', 'kitchen']);
    expect(staff.printClaims).toEqual([]);
  });
});

test.describe('admin: printers and the queue', () => {
  test('adding a network printer gives the address to paste into it', async ({ page }) => {
    const printers: Record<string, unknown>[] = [];
    await page.route('**/rest/v1/printers**', (route) => {
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON();
        const row = {
          id: 'p-new', protocol: null, device_mac: null, last_seen_at: null, last_status: null, last_error: null,
          test_requested_at: null, last_test_printed_at: null, plain_text: false, enabled: true, created_at: now(),
          ...(Array.isArray(body) ? body[0] : body),
        };
        printers.push(row);
        return json(route, row, 201);
      }
      return json(route, printers);
    });
    await page.goto('/admin/printing');
    await expect(page.getByRole('heading', { name: /Network printers/ })).toBeVisible();
    await page.getByRole('button', { name: 'Add printer' }).click();
    await expect(page.getByText('Kitchen printer').first()).toBeVisible();
    // Never connected yet, so the setup is open with the address in it.
    await expect(page.getByText(/\/functions\/v1\/cloudprnt\/[0-9a-f]{64}/)).toBeVisible();
    await expect(page.getByText('Never connected')).toBeVisible();
    expect(printers[0]).toMatchObject({ name: 'Kitchen printer', station: 'kitchen', paper_width: 80 });
  });

  test('a failed ticket can be retried in one tap', async ({ page }) => {
    await stubTickets(page, () => [ticketRow({
      status: 'failed', last_error: 'The printer reported 511 Media Decoding Error',
      orders: { order_code: '047', status: 'preparing', table_sessions: { tables: { table_number: 7 } } },
    })]);
    const requeued: unknown[] = [];
    await page.route('**/rest/v1/rpc/requeue_ticket_print**', (route) => {
      requeued.push(route.request().postDataJSON());
      return json(route, { requeued: true, previous_printed_at: null, attempts: 1 });
    });
    await page.goto('/admin/printing');
    const queue = page.getByRole('list', { name: 'Tickets' });
    await expect(queue).toContainText('Table 7');
    await expect(queue).toContainText('Did not print — The printer reported 511 Media Decoding Error');
    await queue.getByRole('button', { name: 'Retry table 7 kitchen' }).click();
    await expect.poll(() => requeued).toEqual([{ _order_id: 'order-1', _ticket_type: 'kitchen' }]);
  });

  test('shows the ticket as it will print, notes banded', async ({ page }) => {
    await page.goto('/admin/printing');
    const preview = page.getByRole('img', { name: /Ticket preview, 80 mm paper/ });
    await expect(preview).toContainText('KITCHEN ORDER');
    await expect(preview).toContainText('TABLE 7');
    await expect(preview).toContainText('! no onions, well done');
    await page.getByRole('group', { name: 'Preview station' }).getByRole('button', { name: 'Bar' }).click();
    await expect(preview).toContainText('BAR ORDER');
    await expect(preview).toContainText('2 x Coca-Cola');
  });

  test('fits a phone', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/admin/printing');
    await expect(page.getByRole('heading', { name: /Network printers/ })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe('station tickets on the board', () => {
  test('shows the parts of a combo under the dish', async ({ staff, page }) => {
    staff.orders = [anOrder({
      order_items: [{
        id: 'oi-c', order_id: 'order-1', menu_item_id: 'item-menu', quantity: 1, unit_price: 22, notes: null,
        status: 'pending', station: 'kitchen',
        components: [{ slot_label: 'Side', name: 'Pomfrit', station: 'kitchen' }, { slot_label: 'Drink', name: 'Coca-Cola', station: 'bar' }],
        menu_items: { name: 'Burger menu' },
      }],
    })];
    await page.goto('/kitchen');
    await expect(page.getByText('Burger menu')).toBeVisible();
    await expect(page.getByText('Pomfrit')).toBeVisible();
    await expect(page.getByText('Coca-Cola')).toBeVisible();
  });
});
