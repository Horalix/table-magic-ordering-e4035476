import { test, expect, anOrder, aHeldOrder } from './staff-fixtures';
import type { Page } from '@playwright/test';

/**
 * The waiter phone, timed: what needs me, in what order, and how few taps.
 */

const iso = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

const json = (body: unknown) => ({
  status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body),
});

/** Marko, with tables 7 and 6. */
async function asMarko(page: Page) {
  await page.route('**/rest/v1/waiters**', (route) => route.fulfill(json(
    route.request().url().includes('user_id=eq')
      ? { id: 'waiter-1', user_id: 'staff-user-1', display_name: 'Marko' }
      : [{ id: 'waiter-1', user_id: 'staff-user-1', display_name: 'Marko' }],
  )));
  await page.route('**/rest/v1/table_sessions**', (route) => route.fulfill(json(
    route.request().url().includes('assigned_waiter_id=is.null') ? [] : [
      { id: 'session-1', opened_at: iso(40), guest_name: 'Amina', table_id: 't7', tables: { table_number: 7, section_id: 'sec-1' } },
      { id: 'session-6', opened_at: iso(70), guest_name: 'Haris', table_id: 't6', tables: { table_number: 6, section_id: 'sec-1' } },
    ],
  )));
}

const t6 = { tables: { table_number: 6 } };
const t7 = { tables: { table_number: 7 } };

test.describe('what needs me now', () => {
  test('food that is up comes first, then a call, then the bill', async ({ staff, page }) => {
    staff.orders = [anOrder({ id: 'w1', status: 'ready', table_session_id: 'session-1', table_sessions: t7, ready_at: iso(1) })];
    staff.waiterCalls = [{ id: 'c1', status: 'pending', created_at: iso(3), table_session_id: 'session-1', table_sessions: t7 }];
    staff.billRequests = [{ id: 'b1', status: 'pending', created_at: iso(4), table_session_id: 'session-6', table_sessions: t6 }];
    await asMarko(page);
    await page.goto('/waiter');
    const list = page.locator('section').filter({ hasText: 'Attention needed' });
    await expect(list.getByText('Ready to run')).toBeVisible();
    const order = await list.getByText(/Ready to run|Needs you|Wants the bill/).allTextContents();
    expect(order.map((t) => t.split(' ·')[0].trim())).toEqual(['Ready to run', 'Needs you', 'Wants the bill']);
  });

  // A table on nobody's section used to be silent on every phone.
  test('a call from a table with no waiter reaches everyone, and one tap takes the table', async ({ staff, page }) => {
    await asMarko(page);
    await page.route('**/rest/v1/table_sessions**', (route) => route.fulfill(json(
      route.request().url().includes('assigned_waiter_id=is.null')
        ? [{ id: 'session-9', opened_at: iso(5), guest_name: 'Lejla', table_id: 't9', tables: { table_number: 9, section_id: null } }]
        : [],
    )));
    staff.waiterCalls = [{ id: 'c9', status: 'pending', created_at: iso(1), table_session_id: 'session-9', table_sessions: { tables: { table_number: 9 } } }];
    await page.goto('/waiter');
    const list = page.locator('section').filter({ hasText: 'Attention needed' });
    await expect(list.getByText('Table 9', { exact: true })).toBeVisible();
    await expect(list.getByText('No waiter on table 9')).toBeVisible();
    await list.getByRole('button', { name: 'Take table' }).click();
    await expect.poll(() => staff.rpcCalls.filter((c) => c.fn === 'staff_take_table').map((c) => c.body))
      .toEqual([{ _session_id: 'session-9' }]);
    await expect(page.getByText('Table 9 is yours')).toBeVisible();
  });

  test('marking plates served is one tap', async ({ staff, page }) => {
    staff.orders = [anOrder({ id: 'w1', status: 'ready', table_session_id: 'session-1', table_sessions: t7 })];
    await asMarko(page);
    await page.goto('/waiter');
    await page.getByRole('button', { name: 'Mark served' }).click();
    await expect.poll(() => staff.statusWrites).toEqual([{ id: 'w1', status: 'served' }]);
  });

  // A new order on my table used to appear without a sound or a buzz: the
  // waiter only knew by looking.
  test('a new order on my table buzzes the phone; what was there already does not', async ({ staff, page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __buzz: unknown[] };
      w.__buzz = [];
      Object.defineProperty(navigator, 'vibrate', { value: (p: unknown) => { w.__buzz.push(p); return true; }, configurable: true });
    });
    staff.orders = [anOrder({ id: 'o-old', table_session_id: 'session-1', table_sessions: t7 })];
    await asMarko(page);
    await page.goto('/waiter');
    await expect(page.getByText('In the kitchen')).toBeVisible();
    const buzzes = () => page.evaluate(() => (window as unknown as { __buzz: unknown[] }).__buzz);
    expect(await buzzes()).toEqual([]);

    staff.orders = [...staff.orders, anOrder({ id: 'o-new', order_code: '048', table_session_id: 'session-6', table_sessions: t6 })];
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect.poll(buzzes).toEqual([150]);
  });
});

test.describe('sound and vibration are on by default', () => {
  const recordBuzzes = (page: Page) => page.addInitScript(() => {
    const w = window as unknown as { __buzz: unknown[] };
    w.__buzz = [];
    Object.defineProperty(navigator, 'vibrate', { value: (p: unknown) => { w.__buzz.push(p); return true; }, configurable: true });
  });
  const buzzes = (page: Page) => page.evaluate(() => (window as unknown as { __buzz: unknown[] }).__buzz);

  // A mute used to be kept forever: one tap in a staff meeting, silent every shift after.
  test('a phone muted in an earlier shift starts with sound on', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('waiter-sound-on', 'false'));
    await asMarko(page);
    await page.goto('/waiter');
    await expect(page.getByRole('button', { name: 'Mute waiter alert sound' })).toBeVisible();
    await expect(page.getByText(/Sound is off/)).toHaveCount(0);
  });

  test('a mute that has run out is over', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('waiter-sound-muted-until', String(Date.now() - 1_000)));
    await asMarko(page);
    await page.goto('/waiter');
    await expect(page.getByRole('button', { name: 'Mute waiter alert sound' })).toBeVisible();
  });

  // Calls and bills used to be muted along with the speaker: no sound and no buzz.
  test('muted, a call still buzzes the phone, and the screen says when sound comes back', async ({ staff, page }) => {
    await recordBuzzes(page);
    await asMarko(page);
    await page.goto('/waiter');
    await expect(page.getByRole('heading', { level: 1, name: 'Marko' })).toBeVisible();
    await page.getByRole('button', { name: 'Mute waiter alert sound' }).click();
    const strip = page.getByText(/^Sound is off until \d\d:\d\d — the phone only buzzes\. Tap to turn on\.$/);
    await expect(strip).toBeVisible();

    staff.waiterCalls = [{ id: 'c1', status: 'pending', created_at: iso(0), table_session_id: 'session-1', table_sessions: t7 }];
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect.poll(() => buzzes(page)).toEqual([[200, 100, 200]]);

    await strip.click();
    await expect(page.getByRole('button', { name: 'Mute waiter alert sound' })).toBeVisible();
    await expect(page.getByText(/Sound is off/)).toHaveCount(0);
  });
});

/**
 * The live feed (Supabase Realtime, protocol 2.0.0), faked: it lets the staff
 * channel join, says whether the database will send its changes, and
 * announces a change the test hands it, as the server does after an INSERT.
 */
async function fakeLiveFeed(page: Page, { refuse = false } = {}) {
  let announce: ((table: string, record: Record<string, unknown>) => void) | null = null;
  await page.routeWebSocket(/\/realtime\/v1\/websocket/, (ws) => {
    ws.onMessage((raw) => {
      const [joinRef, ref, topic, event, payload] = JSON.parse(String(raw));
      const reply = (response = {}) => ws.send(JSON.stringify([joinRef, ref, topic, 'phx_reply', { status: 'ok', response }]));
      if (event !== 'phx_join') { if (ref) reply(); return; }
      const bindings = ((payload.config?.postgres_changes ?? []) as Record<string, unknown>[]).map((b, i) => ({ ...b, id: 100 + i }));
      reply({ postgres_changes: bindings });
      ws.send(JSON.stringify([null, null, topic, 'system', refuse
        ? { extension: 'postgres_changes', status: 'error', message: 'Unable to subscribe to changes with given parameters.' }
        : { extension: 'postgres_changes', status: 'ok', message: 'Subscribed to PostgreSQL' }]));
      announce = (table, record) => {
        const id = bindings.find((b) => b.table === table)?.id;
        ws.send(JSON.stringify([null, null, topic, 'postgres_changes', {
          ids: [id],
          data: {
            schema: 'public', table, type: 'INSERT', commit_timestamp: new Date().toISOString(), errors: null,
            columns: Object.keys(record).map((name) => ({ name, type: 'text' })), record,
          },
        }]));
      };
    });
  });
  return {
    joined: () => announce !== null,
    insert: (table: string, record: Record<string, unknown>) => announce!(table, record),
  };
}

test.describe('a new order reaches the phone the moment it is placed', () => {
  // Every staff channel asked for three tables the database does not put on
  // the live feed, so it refused them all: the phone said "Live" and a new
  // order turned up at the next one-minute check.
  test('shown and buzzed within a second, with no refresh', async ({ staff, page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __buzz: unknown[] };
      w.__buzz = [];
      Object.defineProperty(navigator, 'vibrate', { value: (p: unknown) => { w.__buzz.push(p); return true; }, configurable: true });
    });
    const feed = await fakeLiveFeed(page);
    staff.orders = [anOrder({ id: 'o-old', table_session_id: 'session-1', table_sessions: t7 })];
    await asMarko(page);
    await page.goto('/waiter');
    await expect(page.getByText('In the kitchen')).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'Live' })).toBeVisible();
    await expect.poll(feed.joined).toBe(true);

    // The guest at table 6 orders.
    const placed = anOrder({
      id: 'o-new', order_code: '048', table_session_id: 'session-6', table_sessions: t6,
      order_items: [{ id: 'oi-new', order_id: 'o-new', menu_item_id: 'item-tiramisu', quantity: 1, unit_price: 9, notes: null, status: 'pending', station: 'kitchen', menu_items: { name: 'Tiramisu' } }],
    });
    staff.orders = [...staff.orders, placed];
    feed.insert('orders', { id: 'o-new', table_session_id: 'session-6', status: 'pending' });

    await expect(page.getByText('Tiramisu')).toBeVisible({ timeout: 1_500 });
    await expect.poll(() => page.evaluate(() => (window as unknown as { __buzz: unknown[] }).__buzz), { timeout: 1_500 }).toEqual([150]);
  });

  test('a feed the database refuses is not called "Live"', async ({ page }) => {
    await fakeLiveFeed(page, { refuse: true });
    await asMarko(page);
    await page.goto('/waiter');
    await expect(page.getByText('In the kitchen')).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'Offline · retrying' })).toBeVisible();
  });
});

test.describe('the bill', () => {
  test('take the money and free the table in two taps', async ({ staff, page }) => {
    staff.orders = [anOrder({ id: 'w6', status: 'served', table_session_id: 'session-6', table_sessions: t6, total: 38, payment_status: 'unpaid' })];
    staff.billRequests = [{ id: 'b1', status: 'pending', created_at: iso(2), table_session_id: 'session-6', table_sessions: t6 }];
    await asMarko(page);
    await page.goto('/waiter');

    const card = page.locator('div').filter({ hasText: 'Wants the bill' }).filter({ has: page.getByRole('button', { name: 'Cash' }) }).last();
    await card.getByRole('button', { name: 'Cash' }).click();
    await page.getByRole('button', { name: '38.00 KM received + free table 6' }).click();

    await expect.poll(() => staff.rpcCalls.map((c) => c.fn)).toEqual(['record_table_payment', 'staff_close_session']);
    expect(staff.rpcCalls[0].body).toMatchObject({ _order_id: 'w6', _method: 'cash' });
    expect(staff.rpcCalls[1].body).toEqual({ _session_id: 'session-6' });
  });

  test('a table that paid online is one tap from free', async ({ staff, page }) => {
    staff.orders = [anOrder({
      id: 'w6', status: 'served', table_session_id: 'session-6', table_sessions: t6,
      payment_method: 'card_online', payment_status: 'paid',
    })];
    staff.billRequests = [{ id: 'b1', status: 'pending', created_at: iso(2), table_session_id: 'session-6', table_sessions: t6 }];
    await asMarko(page);
    await page.goto('/waiter');
    await page.getByRole('button', { name: 'Nothing owed — free table 6' }).click();
    await page.getByRole('button', { name: 'Free table', exact: true }).click();
    await expect.poll(() => staff.rpcCalls.map((c) => c.fn)).toEqual(['staff_close_session']);
  });

  test('just recording the payment still leaves the table open', async ({ staff, page }) => {
    staff.orders = [anOrder({ id: 'w6', status: 'served', table_session_id: 'session-6', table_sessions: t6, total: 38, payment_status: 'unpaid' })];
    staff.billRequests = [{ id: 'b1', status: 'pending', created_at: iso(2), table_session_id: 'session-6', table_sessions: t6 }];
    await asMarko(page);
    await page.goto('/waiter');
    await page.getByRole('button', { name: 'Terminal' }).first().click();
    await page.getByRole('button', { name: 'Yes, 38.00 KM received' }).click();
    await expect.poll(() => staff.rpcCalls.map((c) => c.fn)).toEqual(['record_table_payment']);
  });
});

test.describe('saying who is going', () => {
  // A call from a table nobody has reaches every phone; without a claim two
  // waiters walked to it, or none did, while every device kept chiming.
  test('"I\'m going" claims a call from the phone, and the card says it is me', async ({ staff, page }) => {
    const claims: unknown[] = [];
    await page.route('**/rest/v1/rpc/staff_ack_waiter_call**', (route) => {
      const body = route.request().postDataJSON();
      claims.push(body);
      // As the server would: the call is now this user's.
      staff.waiterCalls = staff.waiterCalls.map((c) => (c.id === body._call_id
        ? { ...c, status: 'acknowledged', acknowledged_by: 'staff-user-1', acknowledged_at: new Date().toISOString() }
        : c));
      return route.fulfill(json({ status: 'acknowledged', claimed_by: 'staff-user-1', mine: true }));
    });
    staff.waiterCalls = [{
      id: 'c1', status: 'pending', created_at: iso(2), acknowledged_by: null, acknowledged_at: null,
      table_session_id: 'session-1', table_sessions: t7,
    }];
    await asMarko(page);
    await page.goto('/waiter');

    const list = page.locator('section').filter({ hasText: 'Attention needed' });
    await expect(list.getByText('Nobody going yet')).toBeVisible();
    const going = list.getByRole('button', { name: /I.m going/ });
    expect((await going.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await going.click();

    await expect.poll(() => claims).toEqual([{ _call_id: 'c1' }]);
    // "You", not the waiter's own name read back to them.
    await expect(list.getByText(/^You are going/)).toBeVisible();
    await expect(list.getByRole('button', { name: /I.m going/ })).toHaveCount(0);
    // Done is still one tap away.
    await expect(list.getByRole('button', { name: 'Done' })).toBeVisible();
  });

  test('a call someone else has taken says who, with no second claim offered', async ({ staff, page }) => {
    staff.waiterCalls = [{
      id: 'c2', status: 'acknowledged', created_at: iso(4), acknowledged_by: 'staff-user-2', acknowledged_at: iso(1),
      table_session_id: 'session-1', table_sessions: t7,
    }];
    await asMarko(page);
    await page.route('**/rest/v1/waiters**', (route) => route.fulfill(json(
      route.request().url().includes('user_id=eq')
        ? { id: 'waiter-1', user_id: 'staff-user-1', display_name: 'Marko' }
        : [{ id: 'waiter-1', user_id: 'staff-user-1', display_name: 'Marko' }, { id: 'waiter-2', user_id: 'staff-user-2', display_name: 'Selma' }],
    )));
    await page.goto('/waiter');
    const list = page.locator('section').filter({ hasText: 'Attention needed' });
    await expect(list.getByText(/^Selma is going/)).toBeVisible();
    await expect(list.getByRole('button', { name: /I.m going/ })).toHaveCount(0);
  });
});

test.describe('the phone tells the truth about itself', () => {
  // A phone that came up on dead wifi said "All caught up" and "Nothing
  // cooking" under the red banner — the calm words are the ones believed.
  test('a first load that fails says so instead of "All caught up", and Try again recovers', async ({ page }) => {
    let failing = true;
    await asMarko(page);
    // A 500, not a 503: the client retries a 503 with back-off on its own.
    await page.route('**/rest/v1/orders**', (route) => (
      failing && !route.request().url().includes('held_reason')
        ? route.fulfill({ ...json({ message: 'unreachable' }), status: 500 })
        : route.fallback()));
    await page.goto('/waiter');

    await expect(page.getByText('Your tables could not be loaded')).toBeVisible();
    await expect(page.getByText('All caught up')).toHaveCount(0);
    await expect(page.getByText('Nothing cooking for your tables.')).toHaveCount(0);
    await expect(page.getByText('0 tables')).toHaveCount(0);

    failing = false;
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByText('All caught up')).toBeVisible();
    await expect(page.getByText('Your tables could not be loaded')).toHaveCount(0);
    await expect(page.getByRole('alert').filter({ hasText: 'Could not' })).toHaveCount(0);
  });

  test('"In the kitchen" is only what the kitchen has; a card order still paying is listed apart', async ({ staff, page }) => {
    staff.orders = [
      anOrder({ id: 'k1', status: 'preparing', table_session_id: 'session-1', table_sessions: t7 }),
      anOrder({
        id: 'k2', status: 'awaiting_payment', payment_method: 'card_online', payment_status: 'pending',
        table_session_id: 'session-6', table_sessions: t6,
        order_items: [{ quantity: 1, status: 'pending', notes: null, menu_items: { name: 'Tufahija' } }],
      }),
      aHeldOrder({ table_session_id: 'session-1', table_sessions: t7 }),
    ];
    await asMarko(page);
    await page.goto('/waiter');

    const kitchen = page.locator('section').filter({ has: page.getByRole('heading', { name: 'In the kitchen', exact: true }) });
    await expect(kitchen).toContainText('La Soul Burger');
    await expect(kitchen).not.toContainText('Tufahija');
    await expect(kitchen.getByText('1', { exact: true })).toBeVisible();
    // The header's count is the list's count.
    await expect(page.getByText('In kitchen', { exact: true }).locator('..')).toContainText('1');

    await expect(page.getByRole('region', { name: 'Not in the kitchen yet' })).toContainText('Tufahija');
    // The held order is on the Needs confirming card, once — not again below.
    await expect(page.getByText('Cevapi Platter')).toHaveCount(1);
    await expect(page.getByRole('region', { name: 'Needs confirming' })).toContainText('Cevapi Platter');
  });
});

test.describe('each restaurant in its own look', () => {
  const VERA = 'a5000000-0000-4000-8000-000000000002';

  // A Vera Italia waiter on La Soul's site worked a sage-green phone headed
  // "Vera Italia".
  test('a Vera Italia waiter\'s phone and floor monitor wear Vera Italia', async ({ staff, page }) => {
    staff.roles = [{ role: 'staff', venue_id: VERA }];
    await asMarko(page);
    await page.goto('/waiter');
    await expect(page.getByText('· Vera Italia')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-venue', 'veraitalia');

    await page.getByRole('link', { name: 'Floor monitor' }).click();
    await expect(page.getByRole('heading', { name: 'Vera Italia · Floor' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-venue', 'veraitalia');
  });

  test('La Soul\'s waiter keeps La Soul\'s', async ({ page }) => {
    await asMarko(page);
    await page.goto('/waiter');
    await expect(page.getByText('· La Soul')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-venue', 'lasoul');
  });
});

test.describe('the floor monitor', () => {
  const terrace = { id: 'sec-1', name: 'Terrace', color: '#B0641F' };

  async function floor(page: Page, sessions: Record<string, unknown>[]) {
    await page.route('**/rest/v1/tables**', (route) => route.fulfill(json([
      { id: 't7', table_number: 7, section_id: 'sec-1', sections: terrace },
      { id: 't8', table_number: 8, section_id: 'sec-1', sections: terrace },
    ])));
    await page.route('**/rest/v1/table_sessions**', (route) => route.fulfill(json(sessions)));
    await page.route('**/rest/v1/waiters**', (route) => route.fulfill(json([
      { id: 'waiter-1', user_id: 'staff-user-1', display_name: 'Marko', is_active: true, has_pin: true },
    ])));
    await page.route('**/rest/v1/rpc/verify_waiter_pin**', (route) => route.fulfill(json(true)));
  }

  // `animate-pulse` faded the whole card, so the tables that most needed a
  // waiter looked disabled for half of every second.
  test('a calling table is at full strength, and the rail counts in words', async ({ staff, page }) => {
    staff.waiterCalls = [
      { id: 'c1', status: 'pending', created_at: iso(2), table_session_id: 'session-7', acknowledged_by: null, acknowledged_at: null },
      { id: 'c2', status: 'pending', created_at: iso(1), table_session_id: 'session-8', acknowledged_by: null, acknowledged_at: null },
    ];
    await floor(page, [
      { id: 'session-7', table_id: 't7', is_active: true, opened_at: iso(30), guest_name: 'Amina', assigned_waiter_id: 'waiter-1', covers: null },
      { id: 'session-8', table_id: 't8', is_active: true, opened_at: iso(10), guest_name: null, assigned_waiter_id: 'waiter-1', covers: null },
    ]);
    await page.goto('/waiter/monitor');
    await expect(page.getByRole('button', { name: /Marko/ })).toContainText('2 calls');

    await page.getByRole('button', { name: /All Tables/ }).click();
    const card = page.getByRole('button', { name: 'Table 7 — Calling' });
    await expect(card).toBeVisible();
    await expect(card).not.toHaveClass(/animate-pulse/);
    await expect(card).toHaveCSS('opacity', '1');
  });

  test('a waiter with no tables gets one empty message that says why', async ({ page }) => {
    await floor(page, []);
    // Nobody's section is assigned today, and no table is given to Marko.
    await page.goto('/waiter/monitor');
    await page.getByRole('button', { name: /Marko/ }).click();
    for (const digit of ['1', '2', '3', '4']) await page.getByRole('button', { name: digit, exact: true }).click();
    await expect(page.getByText(/No tables for you today yet/)).toBeVisible();
    await expect(page.getByText('No tables.', { exact: true })).toHaveCount(0);
    await expect(page.getByText('No tables assigned right now.')).toHaveCount(0);
  });
});
