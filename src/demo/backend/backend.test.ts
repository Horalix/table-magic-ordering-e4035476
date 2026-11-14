/**
 * @vitest-environment node
 *
 * The demo backend, end to end: the real migrations in an in-process
 * PostgreSQL, the demo's seed, and requests shaped exactly as supabase-js
 * sends them. What these check is what a presenter relies on — an order
 * placed as a guest reaches the kitchen, moves through the kitchen's steps by
 * the schema's own rules, is paid, and shows up in the owner's numbers.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { ACCOUNTS, RESTAURANT, tableQrToken } from '../brand';
import { keepAlive, seedDemo } from '../seed';
import { ITEM, ITEMS } from '../seed/menu';
import { runPrinters } from '../seed/printers';
import { createDemoSchema } from '../testing/node-database';
import { mintAccessToken } from './auth';
import { DemoBackend } from './router';
import type { BackendRequest, Identity } from './types';

let db: PGlite;
let backend: DemoBackend;
const seededAt = new Date();

const VENUE = { 'x-venue': RESTAURANT.slug };
const GUEST: Identity = { role: 'anon', sub: null, email: null };
const staff = (area: keyof typeof ACCOUNTS): Identity => ({ role: 'authenticated', sub: ACCOUNTS[area].id, email: ACCOUNTS[area].email });
const bearer = (area: keyof typeof ACCOUNTS) => ({ ...VENUE, authorization: `Bearer ${mintAccessToken(ACCOUNTS[area].id, ACCOUNTS[area].email)}` });

const request = (method: string, path: string, opts: { query?: Record<string, string>; body?: unknown; headers?: Record<string, string> } = {}): BackendRequest => ({
  method, path, query: new URLSearchParams(opts.query ?? {}), headers: { ...VENUE, ...(opts.headers ?? {}) }, body: opts.body ?? null,
});
const get = async <T>(path: string, query: Record<string, string>, headers: Record<string, string> = {}) => {
  const res = await backend.handle(request('GET', path, { query, headers }));
  return { status: res.status, data: (res.body ? JSON.parse(res.body) : null) as T, headers: res.headers };
};
const rpc = async <T>(name: string, args: Record<string, unknown>, who: Identity) => {
  const { data, error } = await backend.rpc<T>(name, args, who, VENUE);
  if (error) throw Object.assign(new Error(error.message), error);
  return data as T;
};

/** A guest sits down at a free table and orders. */
async function sitAndOrder(table: number, items: { menu_item_id: string; quantity: number; unit_price_seen?: number }[], method = 'cash') {
  const session = await rpc<{ status: string; session_id: string; session_token: string }>('guest_start_table_session', {
    _table_number: table, _qr_token: tableQrToken(table), _client_id: `test-${table}-${Date.now()}`, _guest_name: 'Test guest',
  }, GUEST);
  const order = await rpc<{ order_id: string; order_code: string; status: string; held: boolean; total: number }>('guest_place_order', {
    _session_id: session.session_id, _session_token: session.session_token, _guest_name: 'Test guest',
    _payment_method: method, _items: items, _tip: 0,
  }, GUEST);
  return { session, order };
}

beforeAll(async () => {
  db = await createDemoSchema();
  await seedDemo(db, seededAt);
  backend = new DemoBackend(db);
}, 240_000);

afterAll(async () => { await db.close(); });

describe('the seeded restaurant', () => {
  it('has the fictional restaurant only, under its own name', async () => {
    const { rows } = await db.query<{ slug: string; name: string }>('SELECT slug, name FROM public.venues');
    expect(rows).toEqual([{ slug: RESTAURANT.slug, name: RESTAURANT.name }]);
  });

  it('shows a guest the whole menu, in three languages, without signing in', async () => {
    const categories = await get<{ name: string }[]>('/rest/v1/categories', { select: '*', order: 'sort_order' });
    expect(categories.data.map((c) => c.name)).toEqual(['Brunch', 'Starters & Salads', 'Mains', 'Desserts', 'Coffee & Tea', 'Cold Drinks']);
    const items = await get<{ name: string; name_bs: string | null; name_ar: string | null; description_ar: string | null; allergens: string[] }[]>(
      '/rest/v1/menu_items', { select: 'name,name_bs,name_ar,description_ar,allergens' });
    expect(items.data).toHaveLength(ITEMS.length);
    expect(items.data.every((i) => i.name_bs && i.name_ar && i.description_ar)).toBe(true);
  });

  it('never shows either real restaurant in what a guest reads', async () => {
    const menu = await get<unknown[]>('/rest/v1/menu_items', { select: '*' });
    const settings = await db.query('SELECT print_header, print_footer FROM public.restaurant_settings');
    expect(JSON.stringify([menu.data, settings.rows])).not.toMatch(/la soul|lasoul|vera italia/i);
  });

  it('keeps orders from a guest who is not signed in', async () => {
    const orders = await get<{ code: string }>('/rest/v1/orders', { select: 'id', limit: '5' });
    expect(orders.status).toBe(401);
    expect(orders.data.code).toBe('42501');
  });

  it('has ten weeks of trading for the owner to read', async () => {
    const sales = await rpc<{ by_day: { day: string; net_sales: number; orders: number }[] }>('sales_analytics', {}, staff('admin'));
    expect(sales.by_day.length).toBeGreaterThanOrEqual(7);
    expect(sales.by_day.every((d) => d.orders > 10 && d.net_sales > 500)).toBe(true);
    const days = await db.query<{ n: number }>('SELECT count(DISTINCT public.business_day(created_at))::int AS n FROM public.orders');
    expect(days.rows[0].n).toBeGreaterThanOrEqual(69);
  });

  it('opens with a floor in mid-service and table 5 free for the demo guest', async () => {
    const { rows } = await db.query<{ table_number: number }>(
      `SELECT t.table_number FROM public.table_sessions s JOIN public.tables t ON t.id = s.table_id WHERE s.is_active ORDER BY 1`);
    const seated = rows.map((r) => r.table_number);
    expect(seated.length).toBeGreaterThanOrEqual(6);
    expect(seated).not.toContain(RESTAURANT.guestTable);
    const stages = await db.query<{ status: string }>(
      `SELECT DISTINCT o.status::text AS status FROM public.orders o JOIN public.table_sessions s ON s.id = o.table_session_id WHERE s.is_active`);
    expect(stages.rows.map((r) => r.status).sort()).toEqual(['pending', 'preparing', 'ready', 'served']);
  });

  it('answers the owner-only overview for the owner and refuses a waiter', async () => {
    const overview = await rpc<{ slug: string }[]>('owner_overview', {}, staff('admin'));
    expect(overview.map((v) => v.slug)).toEqual([RESTAURANT.slug]);
    await expect(rpc('owner_overview', {}, staff('waiter'))).rejects.toThrow();
  });
});

describe('an order, from the guest to the till', () => {
  it('reaches the kitchen, follows the kitchen’s steps, is paid and counted', async () => {
    const before = await rpc<{ by_day: { day: string; orders: number }[] }>('sales_analytics', {}, staff('admin'));
    const ordersBefore = before.by_day[before.by_day.length - 1].orders;

    const heard: string[] = [];
    const stop = await db.listen('demo_changes', (payload) => { heard.push((JSON.parse(payload) as { t: string }).t); });

    const { order } = await sitAndOrder(RESTAURANT.guestTable, [
      { menu_item_id: ITEM.casaBurger, quantity: 1 }, { menu_item_id: ITEM.lemonMint, quantity: 2 },
    ]);
    expect(order.status).toBe('pending');
    expect(order.held).toBe(false);
    // Casa Burger 16.50 + two Lemon & Mint at the happy-hour price of 5.50.
    expect(Number(order.total)).toBe(27.5);

    // The live feed announced it: what makes the kitchen screen in another tab refresh.
    expect(heard).toContain('orders');
    expect(heard).toContain('order_items');
    await stop();

    // The kitchen display's own query, as the kitchen tablet.
    const board = await get<{ id: string; order_items: { station: string }[]; table_sessions: { tables: { table_number: number } } }[]>(
      '/rest/v1/orders',
      { select: '*,order_items(*,menu_items(name,prep_minutes)),table_sessions!inner(tables!inner(table_number,section_id,sections(name,color)))', status: 'in.(pending,confirmed,preparing)' },
      bearer('kitchen'),
    );
    const ticket = board.data.find((o) => o.id === order.order_id);
    expect(ticket?.table_sessions.tables.table_number).toBe(RESTAURANT.guestTable);
    expect(ticket?.order_items.map((i) => i.station).sort()).toEqual(['bar', 'kitchen']);

    // A guest cannot move an order; the kitchen can, but not backwards.
    await expect(rpc('staff_update_order_status', { _order_id: order.order_id, _status: 'ready' }, GUEST)).rejects.toThrow(/staff/i);
    await rpc('staff_update_order_status', { _order_id: order.order_id, _status: 'preparing' }, staff('kitchen'));
    await rpc('staff_update_order_status', { _order_id: order.order_id, _status: 'ready' }, staff('kitchen'));
    await expect(rpc('staff_update_order_status', { _order_id: order.order_id, _status: 'pending' }, staff('kitchen'))).rejects.toThrow(/Cannot move an order/);

    // The waiter serves it and takes the money, once.
    await rpc('staff_update_order_status', { _order_id: order.order_id, _status: 'served' }, staff('waiter'));
    const paid = await rpc<{ status: string }>('record_table_payment', { _order_id: order.order_id, _method: 'cash' }, staff('waiter'));
    expect(paid.status).toBe('paid');
    const again = await rpc<{ status: string }>('record_table_payment', { _order_id: order.order_id, _method: 'cash' }, staff('waiter'));
    expect(again.status).toBe('already_paid');

    const after = await rpc<{ by_day: { day: string; orders: number }[] }>('sales_analytics', {}, staff('admin'));
    expect(after.by_day[after.by_day.length - 1].orders).toBe(ordersBefore + 1);
  });

  it('prints the ticket on the simulated network printers', async () => {
    const waiting = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.order_ticket_events WHERE status = 'queued'`);
    await runPrinters(db);
    await runPrinters(db);
    const left = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.order_ticket_events WHERE status = 'queued'`);
    expect(left.rows[0].n).toBeLessThanOrEqual(Math.max(0, waiting.rows[0].n - 1));
    const health = await rpc<{ online: boolean }[]>('printer_health', {}, staff('admin'));
    expect(health.length).toBe(2);
    expect(health.every((p) => p.online)).toBe(true);
  });

  it('refuses an order whose prices the guest saw are no longer right, and says what changed', async () => {
    const session = await rpc<{ session_id: string; session_token: string }>('guest_start_table_session', {
      _table_number: 6, _qr_token: tableQrToken(6), _client_id: 'test-prices', _guest_name: 'Test guest',
    }, GUEST);
    const res = await backend.handle(request('POST', '/rest/v1/rpc/guest_place_order', {
      body: {
        _session_id: session.session_id, _session_token: session.session_token, _guest_name: 'Test guest', _payment_method: 'cash',
        _items: [{ menu_item_id: ITEM.casaBurger, quantity: 1, unit_price_seen: 9 }], _tip: 0,
      },
    }));
    expect(res.status).toBe(400);
    const error = JSON.parse(res.body!) as { message: string; details: string };
    expect(error.message).toMatch(/^Prices changed/);
    expect(JSON.parse(error.details)[0]).toMatchObject({ menu_item_id: ITEM.casaBurger, unit_price: 16.5 });
  });

  it('takes orders at any hour: the demo has no opening hours to hold an order for', async () => {
    const { rows } = await db.query<{ service_open: string | null; service_close: string | null }>(
      'SELECT service_open, service_close FROM public.restaurant_settings WHERE venue_id = $1::text::uuid', [RESTAURANT.dbId]);
    expect(rows[0]).toEqual({ service_open: null, service_close: null });
  });

  it('holds a large first order until staff confirm it', async () => {
    const { order } = await sitAndOrder(10, [
      { menu_item_id: ITEM.truffleRisotto, quantity: 4 }, { menu_item_id: ITEM.casaBurger, quantity: 4 }, { menu_item_id: ITEM.chickenCaesar, quantity: 2 },
    ]);
    expect(order.held).toBe(true);
    const released = await rpc<{ status: string }>('staff_release_held_order', { _order_id: order.order_id }, staff('waiter'));
    expect(released.status).toBe('released');
  });

  it('takes a simulated card payment through the same path a real approval takes', async () => {
    const { session, order } = await sitAndOrder(14, [{ menu_item_id: ITEM.cheesecake, quantity: 2 }], 'card_online');
    expect(order.status).toBe('awaiting_payment');
    const start = await backend.handle(request('POST', '/functions/v1/monri-create-payment', {
      body: { order_id: order.order_id, session_id: session.session_id, session_token: session.session_token },
    }));
    const attempt = JSON.parse(start.body!) as { client_secret: string };
    expect(attempt.client_secret).toMatch(/^demo:/);
    const result = await backend.handle(request('POST', '/functions/v1/demo-card-result', { body: { client_secret: attempt.client_secret, approved: true } }));
    expect(JSON.parse(result.body!)).toMatchObject({ released: true });
    const payment = await rpc<{ payment_status: string; released: boolean }>('guest_get_order_payment', {
      _session_id: session.session_id, _session_token: session.session_token, _order_id: order.order_id,
    }, GUEST);
    expect(payment).toMatchObject({ payment_status: 'paid', released: true });
  });
});

describe('signing in', () => {
  it('signs a demo account in with its password and nobody with a wrong one', async () => {
    const ok = await backend.handle(request('POST', '/auth/v1/token', {
      query: { grant_type: 'password' }, body: { email: ACCOUNTS.admin.email, password: ACCOUNTS.admin.password },
    }));
    expect(ok.status).toBe(200);
    expect(JSON.parse(ok.body!).user.id).toBe(ACCOUNTS.admin.id);
    const wrong = await backend.handle(request('POST', '/auth/v1/token', {
      query: { grant_type: 'password' }, body: { email: ACCOUNTS.admin.email, password: 'nope' },
    }));
    expect(wrong.status).toBe(400);
  });

  it('signs a waiter in by username, as the waiter-login function does', async () => {
    const res = await backend.handle(request('POST', '/functions/v1/waiter-login', { body: { username: 'Amra', password: ACCOUNTS.waiter.password } }));
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body!).user.id).toBe(ACCOUNTS.waiter.id);
  });

  it('lists the team for the owner only', async () => {
    const list = await backend.handle(request('POST', '/functions/v1/manage-admins', { body: { action: 'list' }, headers: bearer('admin') }));
    const team = JSON.parse(list.body!) as { accounts: { kind: string }[] };
    expect(team.accounts.map((a) => a.kind).sort()).toEqual(['admin', 'kitchen', 'kitchen', 'owner', 'waiter', 'waiter', 'waiter', 'waiter']);
    const refused = await backend.handle(request('POST', '/functions/v1/manage-admins', { body: { action: 'list' }, headers: bearer('waiter') }));
    expect(refused.status).toBe(403);
  });
});

describe('coming back later', () => {
  it('settles the old floor, fills in the days between and seats a new floor, without duplicating anything', async () => {
    const before = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM public.orders');
    const sitting = (await db.query<{ id: string }>('SELECT id FROM public.table_sessions WHERE is_active')).rows.map((r) => r.id);
    const later = new Date(seededAt.getTime() + 50 * 3600_000);
    await keepAlive(db, later);
    const after = await db.query<{ n: number; ids: number }>('SELECT count(*)::int AS n, count(DISTINCT id)::int AS ids FROM public.orders');
    expect(after.rows[0].n).toBeGreaterThan(before.rows[0].n + 60);
    const future = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM public.orders WHERE created_at > $1::text::timestamptz', [later.toISOString()]);
    expect(future.rows[0].n).toBe(0);
    // Every table that was sitting has gone home, paid; the room has been seated again.
    const stale = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.table_sessions WHERE is_active AND id = ANY($1::text::uuid[])`, [`{${sitting.join(',')}}`]);
    expect(stale.rows[0].n).toBe(0);
    const unpaid = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.orders WHERE table_session_id = ANY($1::text::uuid[]) AND status <> 'cancelled' AND payment_status <> 'paid'`, [`{${sitting.join(',')}}`]);
    expect(unpaid.rows[0].n).toBe(0);
    const seated = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM public.table_sessions WHERE is_active');
    expect(seated.rows[0].n).toBeGreaterThanOrEqual(6);
    // Opening it again a minute later changes nothing.
    await keepAlive(db, new Date(later.getTime() + 60_000));
    const again = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM public.orders');
    expect(again.rows[0].n).toBe(after.rows[0].n);
  }, 120_000);
});
