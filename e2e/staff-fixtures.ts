import { test as base, expect, type Page, type Route } from '@playwright/test';

/**
 * Fixtures for the screens staff actually work on.
 *
 * The guest suite had 97 runs and these three screens had none, which is the
 * wrong way round: the kitchen display is the largest file in the app and the
 * one somebody stares at for eight hours. A guest who hits a bug reloads; a
 * kitchen that hits one starts losing tickets.
 *
 * Same isolation guarantees as the guest fixtures — every Supabase call is
 * intercepted, `state` is `auto` so a spec cannot accidentally run unstubbed,
 * and realtime is refused so the polling fallback is what gets exercised.
 */

const STAFF_ID = 'staff-user-1';

export interface StaffState {
  orders: Record<string, unknown>[];
  waiterCalls: Record<string, unknown>[];
  billRequests: Record<string, unknown>[];
  settings: Record<string, unknown>;
  /** Set false to test the redirect out of a staff screen. */
  signedIn: boolean;
  /** Status transitions the UI asked for, in order. */
  statusWrites: { id: string; status: string }[];
  /** Item-level advances the UI asked for. */
  itemWrites: { id: string; status: string }[];
  /** Ticket-claim calls, so double-print protection can be asserted. */
  printClaims: string[];
}

const iso = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();

/** One kitchen ticket, shaped the way the board's select() returns it. */
export const anOrder = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'order-1',
  order_code: '047',
  status: 'pending',
  payment_status: 'unpaid',
  payment_method: 'cash',
  total: 38,
  notes: null,
  created_at: iso(4),
  released_to_kitchen_at: iso(4),
  confirmed_at: null,
  preparing_at: null,
  ready_at: null,
  served_at: null,
  guest_name: 'Amina',
  table_session_id: 'session-1',
  table_sessions: {
    tables: { table_number: 7, section_id: 'sec-1', sections: { name: 'Terrace', color: '#B0641F' } },
  },
  order_items: [
    {
      id: 'oi-1', order_id: 'order-1', menu_item_id: 'item-burger', quantity: 2,
      unit_price: 18, notes: null, status: 'pending', station: 'kitchen',
      menu_items: { name: 'La Soul Burger', name_bs: 'La Soul Burger', prep_minutes: 12 },
    },
    {
      id: 'oi-2', order_id: 'order-1', menu_item_id: 'item-coffee', quantity: 1,
      unit_price: 2, notes: 'no sugar', status: 'pending', station: 'bar',
      menu_items: { name: 'Espresso', name_bs: 'Espresso', prep_minutes: 2 },
    },
  ],
  ...over,
});

export const defaultStaffState = (): StaffState => ({
  orders: [anOrder()],
  waiterCalls: [],
  billRequests: [],
  settings: {
    id: 1, ordering_enabled: true, kitchen_delay_minutes: 0,
    auto_print_enabled: false, kitchen_capacity_minutes: 25,
  },
  signedIn: true,
  statusWrites: [],
  itemWrites: [],
  printClaims: [],
});

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({
    status,
    contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify(body),
  });

export async function installStaffStubs(page: Page, state: StaffState) {
  /*
   * ORDER MATTERS, and it is the opposite of what it looks like.
   *
   * Playwright tries handlers in REVERSE registration order — the last one
   * registered wins. So the broad catch-all goes first and the specific
   * handlers after it, otherwise the catch-all answers every RPC with `[]`,
   * `has_role` comes back falsy, and every staff screen quietly redirects to
   * the login page with no error anywhere.
   */
  await page.route('**/rest/v1/**', (route) => json(route, []));

  // ---- auth ----
  await page.route('**/auth/v1/**', (route) => {
    const url = route.request().url();
    if (url.includes('/logout')) return json(route, {});
    if (!state.signedIn) return json(route, { session: null, user: null }, 400);
    return json(route, {
      access_token: 'stub-token',
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      refresh_token: 'stub-refresh',
      user: { id: STAFF_ID, aud: 'authenticated', email: 'kitchen@lasoul.test', role: 'authenticated' },
    });
  });

  // ---- RPCs ----
  await page.route('**/rest/v1/rpc/**', async (route) => {
    const fn = route.request().url().split('/rpc/')[1]?.split('?')[0];
    const body = route.request().postDataJSON() ?? {};

    switch (fn) {
      case 'has_role':
        return json(route, state.signedIn);

      case 'claim_ticket_print': {
        const id = String(body._order_id ?? '');
        // Atomic claim: true to the first caller only. This is the whole
        // reason two tablets cannot print the same ticket.
        const first = !state.printClaims.includes(id);
        state.printClaims.push(id);
        return json(route, first);
      }

      case 'staff_bump_order_item': {
        state.itemWrites.push({ id: String(body._item_id ?? ''), status: String(body._status ?? '') });
        return json(route, { status: String(body._status ?? ''), order_status: 'preparing' });
      }

      case 'staff_bump_order_items': {
        for (const id of (body._item_ids as string[] | undefined) ?? []) {
          state.itemWrites.push({ id, status: String(body._status ?? '') });
        }
        return json(route, { updated: ((body._item_ids as string[] | undefined) ?? []).length, failed: 0 });
      }

      case 'kitchen_load':
        return json(route, [{ station: 'kitchen', open_items: 2, backlog_minutes: 12, load_factor: 0.5 }]);

      case 'staff_update_order_status': {
        const id = String(body._order_id ?? '');
        const next = String(body._status ?? '');
        state.statusWrites.push({ id, status: next });
        const order = state.orders.find((o) => o.id === id);
        if (order) order.status = next;
        return json(route, { status: next });
      }

      case 'kds_all_day':
        return json(route, []);

      default:
        return json(route, null);
    }
  });

  // ---- tables ----
  await page.route('**/rest/v1/orders**', (route) => {
    const url = new URL(route.request().url());
    const filter = url.searchParams.get('status') ?? '';
    if (!filter) return json(route, state.orders);
    // `in.(a,b,c)` or `eq.x`
    const wanted = filter.startsWith('in.')
      ? filter.slice(4, -1).split(',').map((s) => s.replace(/"/g, ''))
      : [filter.replace('eq.', '')];
    return json(route, state.orders.filter((o) => wanted.includes(String(o.status))));
  });

  await page.route('**/rest/v1/sections**', (route) =>
    json(route, [{ id: 'sec-1', name: 'Terrace', color: '#B0641F' }]));
  await page.route('**/rest/v1/waiter_calls**', (route) => json(route, state.waiterCalls));
  await page.route('**/rest/v1/bill_requests**', (route) => json(route, state.billRequests));
  await page.route('**/rest/v1/restaurant_settings**', (route) => json(route, state.settings));
  await page.route('**/rest/v1/tables**', (route) => json(route, []));
  await page.route('**/rest/v1/table_sessions**', (route) => json(route, []));
  await page.route('**/rest/v1/order_ticket_events**', (route) => json(route, []));
  await page.route('**/rest/v1/waiters**', (route) => json(route, []));
  await page.route('**/rest/v1/menu_items**', (route) => json(route, []));

  // Realtime refused on purpose: the 15-second polling fallback is what these
  // specs exercise, and it is the path that actually runs on restaurant wifi.
  await page.route('**/realtime/v1/**', (route) => route.abort());
}

/**
 * Put a staff session where supabase-js will find it.
 *
 * `auth.getSession()` reads localStorage and only goes to the network to
 * refresh, so stubbing `/auth/v1/**` alone leaves StaffGate seeing no session
 * and bouncing every screen to the login page. The key is derived from the
 * project URL — `https://e2e.invalid` in the E2E build — so it is
 * `sb-e2e-auth-token`.
 */
export async function seedStaffSession(page: Page) {
  await page.addInitScript((userId) => {
    localStorage.setItem('sb-e2e-auth-token', JSON.stringify({
      access_token: 'stub-token',
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      refresh_token: 'stub-refresh',
      user: {
        id: userId,
        aud: 'authenticated',
        role: 'authenticated',
        email: 'kitchen@lasoul.test',
        app_metadata: { provider: 'email' },
        user_metadata: {},
        created_at: new Date().toISOString(),
      },
    }));
  }, STAFF_ID);
}

/** Take the session away again, for the specs that assert the redirect. */
export async function clearStaffSession(page: Page) {
  await page.addInitScript(() => localStorage.removeItem('sb-e2e-auth-token'));
}

export const test = base.extend<{ staff: StaffState }>({
  staff: [
    async ({ page }, use) => {
      const state = defaultStaffState();
      await installStaffStubs(page, state);
      await seedStaffSession(page);
      await use(state);
    },
    { auto: true },
  ],
});

export { expect };
