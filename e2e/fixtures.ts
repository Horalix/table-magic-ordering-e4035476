import { test as base, expect, type Page, type Route } from '@playwright/test';

/**
 * E2E fixtures.
 *
 * Every Supabase call is intercepted, so the suite runs with no project, no
 * network and no risk of touching a real payment endpoint. The stubs mirror
 * the RPC contracts in supabase/migrations — when a contract changes, the
 * SQL integration suite catches it first and these stubs are updated to match.
 */

export interface StubState {
  serviceStatus: Record<string, unknown>;
  categories: unknown[];
  /** Successive results returned by guest_get_order_payment, in order. */
  paymentPolls: Record<string, unknown>[];
  placedOrders: Record<string, unknown>[];
  cardStartFails: boolean;
  /** What guest_resume_session reports on a cold start. */
  sessionResume: Record<string, unknown>;
  /** What guest_check_venue_token reports for the scanned code. */
  venueToken: Record<string, unknown>;
}

export const defaultState = (): StubState => ({
  serviceStatus: {
    ordering_enabled: true,
    online_card_enabled: false,
    pay_at_table_enabled: true,
    paused_message: null,
    last_order_time: null,
    kitchen_delay_minutes: 0,
    recommendations_enabled: true,
  },
  categories: [
    { id: 'cat-food', name: 'Food', name_bs: 'Hrana', name_ar: 'الطعام', sort_order: 1, image_url: null, created_at: new Date().toISOString() },
    { id: 'cat-drinks', name: 'Drinks', name_bs: 'Pića', name_ar: 'المشروبات', sort_order: 2, image_url: null, created_at: new Date().toISOString() },
  ],
  paymentPolls: [],
  placedOrders: [],
  cardStartFails: false,
  sessionResume: { status: 'active', session_id: 'session-1', table_number: 7, guest_name: 'Amina' },
  venueToken: { valid: true, ordering_enabled: true, paused_message: null, max_table_number: 12 },
});

const MENU_ITEM = {
  id: 'item-burger',
  name: 'La Soul Burger',
  name_bs: 'La Soul Burger',
  name_ar: 'برغر لا سول',
  description: 'Premium beef, aged cheddar, truffle mayo',
  description_bs: null,
  description_ar: null,
  price: 18,
  image_url: null,
  dietary_tags: [],
  merchandising_tags: ['popular'],
  allergens: ['gluten', 'dairy'],
  portion_note: '220 g',
  prep_minutes: 12,
  is_available: true,
  subcategory_id: 'sub-burgers',
  sort_order: 1,
  category_name: 'Food',
};

function jsonRoute(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(body),
  });
}

export async function installSupabaseStubs(page: Page, state: StubState) {
  await page.route('**/rest/v1/rpc/**', async (route) => {
    const url = route.request().url();
    const fn = url.split('/rpc/')[1]?.split('?')[0];
    const body = route.request().postDataJSON() ?? {};

    switch (fn) {
      case 'guest_get_service_status':
        return jsonRoute(route, state.serviceStatus);

      // Explicit rather than falling through to null: the session guard's
      // behaviour on a cold start is exactly what these specs are testing.
      case 'guest_resume_session':
        return jsonRoute(route, state.sessionResume);

      case 'guest_check_venue_token':
        return jsonRoute(route, state.venueToken);

      case 'guest_start_table_session':
        return jsonRoute(route, {
          status: 'created', role: 'host',
          session_id: 'session-1', session_token: 'sess-token-7', guest_name: 'Amina',
        });

      case 'guest_inspect_table':
        return jsonRoute(route, { status: 'empty' });

      case 'guest_search_menu': {
        const q = String(body._query ?? '').toLowerCase();
        const hit = MENU_ITEM.name.toLowerCase().includes(q);
        return jsonRoute(route, q.length >= 2 && hit ? [MENU_ITEM] : []);
      }

      case 'guest_get_recommendations':
        return jsonRoute(route, []);

      case 'get_popular_items':
        return jsonRoute(route, []);

      case 'touch_session':
        return jsonRoute(route, true);

      case 'guest_place_order': {
        const card = body._payment_method === 'card_online';
        const order = {
          order_id: `order-${state.placedOrders.length + 1}`,
          order_code: String(47 + state.placedOrders.length).padStart(3, '0'),
          status: card ? 'awaiting_payment' : 'pending',
          total: 18,
          tip_amount: 0,
          payment_method: body._payment_method,
          payment_status: card ? 'pending' : 'unpaid',
          awaiting_payment: card,
        };
        state.placedOrders.push(order);
        return jsonRoute(route, order);
      }

      case 'guest_get_order_payment': {
        const next = state.paymentPolls.shift() ?? state.paymentPolls[state.paymentPolls.length - 1] ?? {
          status: 'ok', payment_status: 'pending', order_status: 'awaiting_payment', released: false,
        };
        return jsonRoute(route, next);
      }

      case 'guest_switch_to_pay_at_table':
        return jsonRoute(route, { status: 'released', order_code: '047' });

      case 'guest_call_waiter':
        return jsonRoute(route, { call_id: 'call-1', status: 'pending' });

      case 'record_analytics_events':
        return jsonRoute(route, 1);

      case 'guest_list_pending_join_requests':
        return jsonRoute(route, []);

      case 'guest_get_tab':
        return jsonRoute(route, { orders: [], bill_request: null, members: ['Amina'] });

      case 'guest_get_waiter_for_review':
        return jsonRoute(route, null);

      default:
        return jsonRoute(route, null);
    }
  });

  await page.route('**/rest/v1/categories**', (route) => {
    // PostgREST returns a bare object (not an array) when the client used
    // .single(); CategoryPage does, so honour the Accept header or the whole
    // page never resolves.
    const accept = route.request().headers()['accept'] ?? '';
    const wantsOne = accept.includes('vnd.pgrst.object');
    const url = new URL(route.request().url());
    const nameFilter = url.searchParams.get('name');
    const rows = nameFilter
      ? state.categories.filter((c) => `eq.${(c as { name: string }).name}` === nameFilter)
      : state.categories;
    return jsonRoute(route, wantsOne ? (rows[0] ?? null) : rows);
  });
  await page.route('**/rest/v1/subcategories**', (route) =>
    jsonRoute(route, [{ id: 'sub-burgers', category_id: 'cat-food', name: 'Burgers', name_bs: 'Burgeri', sort_order: 1 }]));
  await page.route('**/rest/v1/menu_items**', (route) => jsonRoute(route, [MENU_ITEM]));
  await page.route('**/rest/v1/restaurant_settings**', (route) => jsonRoute(route, null));

  // The card-start Edge Function. Never reaches Monri.
  await page.route('**/functions/v1/monri-create-payment', (route) =>
    state.cardStartFails
      ? jsonRoute(route, { error: 'card_unavailable', reason: 'disabled' }, 503)
      : jsonRoute(route, {
          ok: true,
          payment_transaction_id: 'ptx-1',
          monri_order_number: 'LS-TEST-1',
          client_secret: 'cs_test_stub',
          authenticity_token: 'auth_test_stub',
          environment: 'test',
        }));

  // Realtime is not needed for guest specs.
  await page.route('**/realtime/v1/**', (route) => route.abort());
}

/**
 * Put a live table session in localStorage so the guest can order.
 *
 * addInitScript runs on every navigation, so this seeds only once — otherwise
 * navigating from the menu to the cart would wipe the items just added.
 */
export async function seedSession(page: Page) {
  await page.addInitScript(() => {
    if (localStorage.getItem('lasoul-cart')) return;
    localStorage.setItem('lasoul-cart', JSON.stringify({
      state: {
        items: [],
        tableNumber: 7,
        qrToken: 'qr-token-7',
        sessionToken: 'sess-token-7',
        sessionId: 'session-1',
        guestName: 'Amina',
        lastOrderTime: null,
        pendingPayment: null,
        clientId: 'e2e-device',
      },
      version: 0,
    }));
  });
}

/**
 * `state` is `auto` on purpose.
 *
 * Playwright fixtures are lazy: without this, a spec that does not destructure
 * `state` would run with no interception at all and silently talk to whatever
 * Supabase project the build points at. Auto-instantiation makes "stubs are
 * installed" a property of the suite rather than of each spec's signature.
 */
export const test = base.extend<{ state: StubState }>({
  state: [
    async ({ page }, use) => {
      const state = defaultState();
      await installSupabaseStubs(page, state);
      await use(state);
    },
    { auto: true },
  ],
});

export { expect };
