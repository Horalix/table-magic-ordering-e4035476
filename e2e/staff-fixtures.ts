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
  /** `has_role(_, 'admin')`. Staff who are not managers must not see admin links. */
  isAdmin: boolean;
  /**
   * What `staff_close_session` says the table still owes. Zero frees the table;
   * anything else is the server refusing, which the UI must show.
   */
  closeOutstanding: number;
  /** Every RPC the UI called that touches tables, calls or money, in order. */
  rpcCalls: { fn: string; body: Record<string, unknown> }[];
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

/**
 * An order the database held for staff to confirm: `pending`, never released,
 * with a reason. The kitchen must not see it as work.
 */
export const aHeldOrder = (over: Partial<Record<string, unknown>> = {}) => anOrder({
  id: 'order-held',
  order_code: '090',
  released_to_kitchen_at: null,
  held_reason: 'large_first_order',
  held_at: iso(1),
  created_at: iso(1),
  total: 72,
  guest_name: 'Haris',
  table_session_id: 'session-9',
  table_sessions: {
    tables: { table_number: 9, section_id: 'sec-1', sections: { name: 'Terrace', color: '#B0641F' } },
  },
  order_items: [{
    id: 'oi-held', order_id: 'order-held', menu_item_id: 'item-burger', quantity: 4,
    unit_price: 18, notes: null, status: 'pending', station: 'kitchen',
    menu_items: { name: 'Cevapi Platter', name_bs: 'Ćevapi', prep_minutes: 12 },
  }],
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
  isAdmin: true,
  closeOutstanding: 0,
  rpcCalls: [],
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
        return json(route, body._role === 'admin' ? state.signedIn && state.isAdmin : state.signedIn);

      case 'staff_close_session': {
        state.rpcCalls.push({ fn, body });
        const owed = state.closeOutstanding;
        return json(route, {
          closed: owed <= 0, already_closed: false, outstanding: owed, unpaid_orders: owed > 0 ? 1 : 0,
        });
      }

      case 'staff_resolve_bill_request': {
        state.rpcCalls.push({ fn, body });
        state.billRequests = state.billRequests.filter((b) => b.id !== body._request_id);
        return json(route, { resolved: true, closed: false, outstanding: 0 });
      }

      case 'staff_resolve_waiter_call': {
        state.rpcCalls.push({ fn, body });
        state.waiterCalls = state.waiterCalls.filter((c) => c.id !== body._call_id);
        return json(route, { resolved: true });
      }

      case 'record_table_payment': {
        state.rpcCalls.push({ fn, body });
        const order = state.orders.find((o) => o.id === body._order_id);
        if (order?.payment_status === 'paid') {
          return json(route, { status: 'already_paid', payment_method: order.payment_method });
        }
        if (order) { order.payment_status = 'paid'; order.payment_method = body._method; }
        return json(route, { status: 'paid', payment_method: body._method, total: order?.total ?? 0 });
      }

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

      case 'staff_release_held_order': {
        state.rpcCalls.push({ fn, body });
        const order = state.orders.find((o) => o.id === body._order_id);
        if (order && !order.released_to_kitchen_at) {
          order.released_to_kitchen_at = new Date().toISOString();
          order.held_reason = null;
          return json(route, { status: 'released', order_id: order.id, ticket_id: 'ticket-1' });
        }
        return json(route, { status: 'already_released', order_id: body._order_id });
      }

      case 'cancel_order': {
        state.rpcCalls.push({ fn, body });
        const order = state.orders.find((o) => o.id === body._order_id);
        if (order) { order.status = 'cancelled'; order.cancel_reason = body._reason; }
        return json(route, { status: 'cancelled', requires_refund: false, total: order?.total ?? 0 });
      }

      case 'staff_block_session': {
        state.rpcCalls.push({ fn, body });
        let cancelled = 0;
        for (const o of state.orders) {
          if (o.table_session_id === body._session_id && o.status === 'pending') { o.status = 'cancelled'; cancelled += 1; }
        }
        return json(route, { status: 'blocked', cancelled_orders: cancelled, orders_left: 0 });
      }

      default:
        return json(route, null);
    }
  });

  // ---- tables ----
  await page.route('**/rest/v1/orders**', (route) => {
    const url = new URL(route.request().url());
    const filter = url.searchParams.get('status') ?? '';
    /*
     * Held orders (20261024190000_order_abuse_guards.sql): the "Needs
     * confirming" card asks for exactly them, and the kitchen board asks to
     * leave them out. Both filters are honoured so a spec can prove a held
     * order is in the one place and not the other.
     */
    const held = (o: Record<string, unknown>) => !!o.held_reason && !o.released_to_kitchen_at;
    let rows = state.orders;
    if (url.searchParams.get('held_reason') === 'not.is.null') rows = rows.filter(held);
    if ((url.searchParams.get('or') ?? '').includes('held_reason.is.null')) rows = rows.filter((o) => !held(o));
    if (!filter) return json(route, rows);
    // `in.(a,b,c)` or `eq.x`
    const wanted = filter.startsWith('in.')
      ? filter.slice(4, -1).split(',').map((s) => s.replace(/"/g, ''))
      : [filter.replace('eq.', '')];
    return json(route, rows.filter((o) => wanted.includes(String(o.status))));
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
