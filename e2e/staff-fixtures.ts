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

/**
 * What the owner-facing analytics read: insight cards, the menu-engineering
 * matrix, the suggestion funnel, the sales decomposition and the service
 * alerts. Shaped like the RPCs in 20261025120000–20261025126000 return them,
 * so the admin pages render real content instead of skeletons.
 */
export interface AdminAnalyticsFixtures {
  insights: Record<string, unknown>[];
  trends: Record<string, unknown>[];
  engineering: Record<string, unknown>[];
  funnel: Record<string, unknown>[];
  decomposition: Record<string, unknown> | null;
  anomalies: Record<string, unknown> | null;
  stations: Record<string, unknown> | null;
  prepHistory: Record<string, unknown> | null;
}

const insight = (over: Record<string, unknown>) => ({
  kind: 'leak', item_id: 'item-salad', related_item_id: null, headline: 'H', why: 'W', action: 'A',
  est_km_per_week: 50, confidence: 'high', evidence: 100, evidence_label: 'visits', link: '/admin/menu-intelligence#leaks',
  ...over,
});

const engineeringRow = (over: Record<string, unknown>) => ({
  item_id: String(over.name ?? 'x'), name: 'Dish', menu_class: 'main', category_name: 'Food', is_available: true,
  units: 100, lines: 100, revenue: 1800, available_days: 28, trading_days: 28, availability_basis: 'assumed',
  class_units: 600, class_lines: 600, class_items: 5, menu_mix: 0.2, mix_low: 0.18, mix_high: 0.22,
  popularity_threshold: 0.14, price: 18, unit_cost: 6, unit_cm: 12, class_avg_cm: 10, cost_estimated: false,
  popularity: 'high', profitability: 'high', quadrant: 'star', units_per_week: 25, class_units_per_week: 150,
  ...over,
});

/** A dish selling steadily at lunch and a little in the evening, ten weeks back. */
const prepItem = (item_id: string, name: string, lunch: number[]) => ({
  item_id, name, is_available: true, subcategory_id: 'sub-mains', subcategory: 'Mains',
  unit_cm: 12, unit_cost: 6, cost_estimated: false,
  series: { lunch, evening: lunch.map((v) => Math.round(v / 4)) },
  last28: { lunch: lunch.slice(0, 4).reduce((a, b) => a + b, 0), evening: 20 },
});

const changeTerm = (key: string, current: number, compare: number) => ({
  key, current, compare, dlog: Math.log(current / compare), change_pct: 100 * (current / compare - 1),
});

export const adminAnalyticsFixtures = (): AdminAnalyticsFixtures => ({
  insights: [
    insight({
      kind: 'sold_out', item_id: 'item-cake', headline: 'Chocolate cake has been sold out',
      why: 'While it was on, it took about 60 KM on a typical trading day.',
      action: 'Bring Chocolate cake back, or replace it with something similar',
      est_km_per_week: 100, confidence: 'medium', evidence: 10, evidence_label: 'trading days of sales', link: '/admin/menu',
    }),
    insight({
      kind: 'leak', item_id: 'item-salad', headline: 'Quinoa salad is looked at but rarely ordered',
      why: '300 looks and 1 order: 0.3% against 25.0% for a typical dish.',
      action: 'Rewrite the description of Quinoa salad, re-photograph it, or check its price',
      est_km_per_week: 167, evidence: 300, evidence_label: 'looks at the dish',
    }),
    insight({
      kind: 'pairing', item_id: 'item-burger', related_item_id: 'item-cola', headline: 'Suggest Cola with La Soul Burger',
      why: '2000 of 5000 orders with La Soul Burger also had Cola.',
      action: 'Add Cola as a suggestion for La Soul Burger', est_km_per_week: 35, confidence: 'medium',
      evidence: 5000, evidence_label: 'orders with La Soul Burger', link: '/admin/menu-intelligence#pairings',
    }),
    insight({
      kind: 'dog', item_id: 'item-toast', headline: 'Plain toast sells little and earns little',
      why: '2.1% of starters orders.', action: 'Take Plain toast off the menu, unless it is there on purpose as a cheaper anchor',
      est_km_per_week: 24, evidence: 640, evidence_label: 'starters orders', link: '/admin/menu-intelligence#engineering',
    }),
  ],
  trends: [],
  engineering: [
    engineeringRow({ name: 'La Soul Burger', quadrant: 'star', units: 180 }),
    engineeringRow({ name: 'Ćevapi', quadrant: 'plowhorse', profitability: 'low', unit_cm: 7, units: 160 }),
    engineeringRow({ name: 'Truffle risotto', quadrant: 'puzzle', popularity: 'low', menu_mix: 0.06, units: 30, cost_estimated: true }),
    engineeringRow({ name: 'Plain toast', menu_class: 'starter', quadrant: 'dog', popularity: 'low', profitability: 'low', menu_mix: 0.021, unit_cm: 2, units: 12 }),
    engineeringRow({ name: 'Tufahija', menu_class: 'dessert', quadrant: 'insufficient', popularity: 'insufficient', units: 7 }),
  ],
  funnel: [
    { placement: 'cart', week_start: '2026-10-19', decisions: 400, with_suggestion: 380, seen: 300, tapped: 40, paid: 22, paid_km: 132, km_per_1000_seen: 440 },
    { placement: 'cart', week_start: '2026-10-12', decisions: 380, with_suggestion: 360, seen: 280, tapped: 35, paid: 20, paid_km: 120, km_per_1000_seen: 428.57 },
    { placement: 'item', week_start: '2026-10-19', decisions: 120, with_suggestion: 110, seen: 90, tapped: 6, paid: 3, paid_km: 12, km_per_1000_seen: 133.33 },
  ],
  decomposition: {
    from: '2026-10-18', to: '2026-10-24', cmp_from: '2026-10-11', cmp_to: '2026-10-17', scale: 1, basis: 'visits',
    current: { net: 2754, visits: 90, units: 275.4, covered_visits: 10, covers: 22 },
    compare: { net: 3000, visits: 100, units: 300, covered_visits: 12, covers: 26 },
    total: {
      comparable: true, net: 2754, compare_net: 3000, change_pct: -8.2, dlog: Math.log(2754 / 3000),
      terms: [changeTerm('visits', 90, 100), changeTerm('items_per_visit', 3.06, 3), changeTerm('net_per_item', 10, 10)],
    },
    dayparts: [
      { daypart: 'lunch', visits: 50, compare_visits: 60, comparable: true, net: 1500, compare_net: 1800, change_pct: -16.7, terms: [] },
      { daypart: 'evening', visits: 40, compare_visits: 40, comparable: true, net: 1254, compare_net: 1200, change_pct: 4.5, terms: [] },
    ],
  },
  anomalies: {
    today: {
      day: '2026-10-25', so_far: 1240, history: 6, usual_so_far: 1100, usual_total: 2700, usual_share: 0.43,
      pace: 1.13, projected: 2884, z: 1.2, status: 'normal', alert: false,
    },
    days: [
      { day: '2026-10-22', weekday: 'Thursday', net: 600, traded: true, history: 6, median: 1000, z: -5.4, status: 'low', alert: true },
      { day: '2026-10-21', weekday: 'Wednesday', net: 980, traded: true, history: 6, median: 1000, z: -0.4, status: 'normal', alert: false },
    ],
  },
  stations: {
    window_days: 28, daypart_now: 'lunch', baseline: [],
    now: [
      { station: 'kitchen', daypart: 'lunch', tickets: 14, p50: 11, p90: 18.2, baseline_p90: 12, baseline_tickets: 120, baseline_daypart: 'lunch', ratio: 1.52, status: 'slow', alert: true },
      { station: 'bar', daypart: 'lunch', tickets: 22, p50: 3, p90: 5, baseline_p90: 5, baseline_tickets: 300, baseline_daypart: 'lunch', ratio: 1, status: 'normal', alert: false },
    ],
  },
  prepHistory: {
    day: '2026-10-26', weekday: 'Monday', weeks: [],
    items: [
      prepItem('item-burger', 'La Soul Burger', [22, 17, 21, 18, 24, 16, 20, 23, 17, 21]),
      prepItem('item-cevapi', 'Ćevapi', [32, 27, 31, 28, 34, 26, 30, 33, 27, 31]),
    ],
  },
});

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
   * The account's rows in user_roles ({ role, venue_id }), which say whose
   * screens these are (src/hooks/useStaffVenue.ts): an admin with no
   * restaurant is the owner, with one that restaurant's admin. Empty, as
   * before: staff of the site's own restaurant.
   */
  roles: Record<string, unknown>[];
  /**
   * What `staff_close_session` says the table still owes. Zero frees the table;
   * anything else is the server refusing, which the UI must show.
   */
  closeOutstanding: number;
  /** Every RPC the UI called that touches tables, calls or money, in order. */
  rpcCalls: { fn: string; body: Record<string, unknown> }[];
  /** What the owner-facing analytics RPCs answer. */
  analytics: AdminAnalyticsFixtures;
  /** Rows the UI inserted into menu_item_recommendations ("Suggest it"). */
  curated: Record<string, unknown>[];
  /**
   * menu_items rows answered to a lookup BY ID (`id=in.(…)`) — what the board
   * reads a combo part's allergens from. Any other menu_items read gets [].
   */
  menuItems: Record<string, unknown>[];
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
 * An order of one combo and nothing else: a single KITCHEN line whose drink
 * is the bar's (order_items.components, 20261026100000_promotions.sql). The
 * bar has nothing of its own on it — only the drink, through the combo.
 */
export const aComboOrder = (over: Partial<Record<string, unknown>> = {}, line: Partial<Record<string, unknown>> = {}) => anOrder({
  id: 'order-combo',
  order_code: '061',
  total: 23,
  order_items: [{
    id: 'oi-combo', order_id: 'order-combo', menu_item_id: 'item-combo', quantity: 1,
    unit_price: 23, notes: 'lemonade without ice', status: 'pending', station: 'kitchen',
    components: [
      { slot_label: 'Burger', item_id: 'item-chicken', name: 'Chicken Burger', station: 'kitchen' },
      { slot_label: 'Side', item_id: 'item-fries', name: 'Fries', station: 'kitchen' },
      { slot_label: 'Drink', item_id: 'item-lemonade', name: 'Strawberry Lemonade', station: 'bar' },
    ],
    menu_items: { name: 'Chicken Burger Combo', allergens: ['gluten'] },
    ...line,
  }],
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
  roles: [],
  closeOutstanding: 0,
  rpcCalls: [],
  analytics: adminAnalyticsFixtures(),
  curated: [],
  menuItems: [],
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

      case 'staff_take_table': {
        state.rpcCalls.push({ fn, body });
        return json(route, { taken: true });
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

      // ---- owner-facing analytics ----
      case 'management_insights':
        return json(route, state.analytics.insights);
      case 'item_trends':
        return json(route, state.analytics.trends);
      case 'menu_engineering':
        return json(route, state.analytics.engineering);
      case 'reco_funnel':
        return json(route, state.analytics.funnel);
      case 'sales_decomposition':
        state.rpcCalls.push({ fn, body });
        return json(route, state.analytics.decomposition);
      case 'daily_anomalies':
        return json(route, state.analytics.anomalies);
      case 'station_timings':
        return json(route, state.analytics.stations);
      case 'prep_history':
        return json(route, state.analytics.prepHistory);

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
    // The waiter phone asks for everything on a table except cancelled.
    if (filter.startsWith('neq.')) return json(route, rows.filter((o) => String(o.status) !== filter.slice(4)));
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
  // Monri readiness (GET): not connected, as in production until Monri issues the account.
  await page.route('**/functions/v1/monri-create-payment', (route) =>
    json(route, { configured: false, environment: 'test', currency: 'BAM' }));
  await page.route('**/rest/v1/tables**', (route) => json(route, []));
  await page.route('**/rest/v1/table_sessions**', (route) => json(route, []));
  await page.route('**/rest/v1/order_ticket_events**', (route) => json(route, []));
  await page.route('**/rest/v1/waiters**', (route) => json(route, []));
  await page.route('**/rest/v1/user_roles**', (route) => json(route, state.roles));
  await page.route('**/rest/v1/menu_items**', (route) => {
    const ids = new URL(route.request().url()).searchParams.get('id') ?? '';
    if (!ids.startsWith('in.(')) return json(route, []);
    const wanted = ids.slice(4, -1).split(',').map((s) => s.replace(/"/g, ''));
    return json(route, state.menuItems.filter((m) => wanted.includes(String(m.id))));
  });
  await page.route('**/rest/v1/menu_item_recommendations**', (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON();
      state.curated.push(...(Array.isArray(body) ? body : [body]));
      return json(route, [], 201);
    }
    return json(route, []);
  });

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
