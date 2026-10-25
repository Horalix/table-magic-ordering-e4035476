/**
 * @vitest-environment node
 *
 * Cloud printers (20261026120000_cloud_printers.sql).
 *
 * A network printer polls the server and prints its own tickets. What has to
 * hold, each one a way a kitchen loses or doubles a ticket:
 *
 *  - it only gets its own station's tickets, and never a held order;
 *  - it and a tablet can never both print the same ticket;
 *  - plugging one in does not print the history of the restaurant;
 *  - a job it fetched and never confirmed becomes visible, not lost;
 *  - a reprint knows it is a reprint;
 *  - staff can see whether it is alive, but never its secret.
 */
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error -- plain JS harness, no types needed
import { createTestDatabase, actAs } from '../../scripts/db-harness.mjs';

type Db = {
  query: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
  exec: (sql: string) => Promise<unknown>;
  close: () => Promise<void>;
};

const ADMIN = '11111111-1111-1111-1111-111111111111';
const STAFF = '22222222-2222-2222-2222-222222222222';
const BURGER = 'cccccccc-cccc-cccc-cccc-cccccccc0001';
const COFFEE = 'cccccccc-cccc-cccc-cccc-cccccccc0003';
const SESSION = 'eeeeeeee-eeee-eeee-eeee-eeeeeeee0001';
const TOKEN = 'sess-token-7';
const KITCHEN_TOKEN = 'k'.repeat(40);
const BAR_TOKEN = 'b'.repeat(40);

let db: Db;

async function seed() {
  await db.exec(`
    TRUNCATE public.audit_log, public.order_ticket_events, public.order_items, public.orders,
             public.table_sessions, public.tables, public.printers,
             public.menu_items, public.subcategories, public.categories, public.order_code_counters
      RESTART IDENTITY CASCADE;
    DELETE FROM public.user_roles;
    DELETE FROM auth.users;

    UPDATE public.restaurant_settings SET ordering_enabled = true, online_card_enabled = false WHERE id = 1;

    INSERT INTO auth.users(id) VALUES ('${ADMIN}'), ('${STAFF}');
    INSERT INTO public.user_roles(user_id, role) VALUES ('${ADMIN}', 'admin'), ('${STAFF}', 'staff');

    INSERT INTO public.categories(id, name, sort_order) VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'Food', 1);
    INSERT INTO public.subcategories(id, category_id, name, sort_order) VALUES
      ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'All', 1);
    INSERT INTO public.menu_items(id, subcategory_id, name, price, is_available, station) VALUES
      ('${BURGER}', 'bbbbbbbb-0000-0000-0000-000000000001', 'La Soul Burger', 18.00, true, 'kitchen'),
      ('${COFFEE}', 'bbbbbbbb-0000-0000-0000-000000000001', 'Espresso', 3.00, true, 'bar');

    INSERT INTO public.tables(id, table_number) VALUES ('dddddddd-0000-0000-0000-000000000001', 7);
    INSERT INTO public.table_sessions(id, table_id, token, is_active, guest_name, last_heartbeat_at)
      VALUES ('${SESSION}', 'dddddddd-0000-0000-0000-000000000001', '${TOKEN}', true, 'Amina', now());

    INSERT INTO public.printers(name, station, poll_token) VALUES
      ('Kitchen printer', 'kitchen', '${KITCHEN_TOKEN}'),
      ('Bar printer', 'bar', '${BAR_TOKEN}');
  `);
  await actAs(db, null);
}

async function placeOrder(items: string[], quantity = 1) {
  const { rows } = await db.query<{ result: Record<string, unknown> }>(
    `SELECT public.guest_place_order($1, $2, 'Amina', 'cash', $3::jsonb, 0) AS result`,
    [SESSION, TOKEN, JSON.stringify(items.map((id) => ({ menu_item_id: id, quantity })))],
  );
  return rows[0].result as { order_id: string; held?: boolean };
}

const checkin = async (token: string, protocol = 'star_cloudprnt') => {
  const { rows } = await db.query<{ r: Record<string, unknown> | null }>(
    `SELECT public.cloud_printer_checkin($1, $2, '00:11:62:aa:bb:cc', '200 OK') AS r`, [token, protocol]);
  return rows[0].r;
};

const claim = async (token: string, ticketId: string | null = null) => {
  const { rows } = await db.query<{ r: Record<string, unknown> | null }>(
    `SELECT public.cloud_print_claim($1, $2::uuid) AS r`, [token, ticketId]);
  return rows[0].r;
};

const report = async (token: string, ok: boolean, ticketId: string | null = null, error: string | null = null) => {
  const { rows } = await db.query<{ r: string | null }>(
    `SELECT public.cloud_print_report($1, $2::uuid, $3, $4) AS r`, [token, ticketId, ok, error]);
  return rows[0].r;
};

const ticket = async (orderId: string, type = 'kitchen') => {
  const { rows } = await db.query<{
    id: string; status: string; print_verified: boolean | null; claimed_by_device: string | null;
    last_error: string | null; original_printed_at: string | null; printed_at: string | null;
  }>(`SELECT id, status, print_verified, claimed_by_device, last_error, original_printed_at, printed_at
        FROM public.order_ticket_events WHERE order_id = $1 AND ticket_type = $2`, [orderId, type]);
  return rows[0];
};

beforeAll(async () => { db = (await createTestDatabase({ quiet: true })) as unknown as Db; }, 180_000);
afterAll(async () => { await db.close(); });
beforeEach(seed);

describe('checking in', () => {
  it('knows the printer by its secret and records that it is alive', async () => {
    const printer = await checkin(KITCHEN_TOKEN);
    expect(printer).toMatchObject({ name: 'Kitchen printer', station: 'kitchen', next_ticket_id: null });
    const { rows } = await db.query<{ protocol: string; device_mac: string; seen: boolean }>(
      `SELECT protocol, device_mac, last_seen_at > now() - interval '5 seconds' AS seen FROM public.printers WHERE poll_token = $1`,
      [KITCHEN_TOKEN]);
    expect(rows[0]).toEqual({ protocol: 'star_cloudprnt', device_mac: '00:11:62:aa:bb:cc', seen: true });
  });

  it('does not know a wrong or a disabled token', async () => {
    expect(await checkin('x'.repeat(40))).toBeNull();
    expect(await checkin('short')).toBeNull();
    await db.exec(`UPDATE public.printers SET enabled = false WHERE poll_token = '${KITCHEN_TOKEN}'`);
    expect(await checkin(KITCHEN_TOKEN)).toBeNull();
  });

  it('says when there is a ticket waiting', async () => {
    const { order_id } = await placeOrder([BURGER]);
    const printer = await checkin(KITCHEN_TOKEN);
    expect(printer?.next_ticket_id).toBe((await ticket(order_id)).id);
  });
});

describe('what a printer prints', () => {
  it('only its own station', async () => {
    const { order_id } = await placeOrder([BURGER, COFFEE]);
    const kitchen = await claim(KITCHEN_TOKEN);
    expect(kitchen).toMatchObject({ order_id, ticket_type: 'kitchen' });
    expect(await claim(KITCHEN_TOKEN)).toBeNull();
    expect(await claim(BAR_TOKEN)).toMatchObject({ order_id, ticket_type: 'bar' });
  });

  it('both stations on a one-printer setup', async () => {
    await db.exec(`UPDATE public.printers SET station = 'all' WHERE poll_token = '${KITCHEN_TOKEN}'`);
    await placeOrder([BURGER, COFFEE]);
    const first = await claim(KITCHEN_TOKEN);
    const second = await claim(KITCHEN_TOKEN);
    expect([first?.ticket_type, second?.ticket_type].sort()).toEqual(['bar', 'kitchen']);
  });

  it('never a held order — until someone confirms it', async () => {
    await db.exec(`UPDATE public.restaurant_settings SET hold_first_order_km = 50 WHERE id = 1`);
    const held = await placeOrder([BURGER], 3);
    expect(held.held).toBe(true);
    expect(await claim(KITCHEN_TOKEN)).toBeNull();

    await actAs(db, STAFF);
    await db.query(`SELECT public.staff_release_held_order($1)`, [held.order_id]);
    await actAs(db, null);

    expect(await claim(KITCHEN_TOKEN)).toMatchObject({ order_id: held.order_id });
    await db.exec(`UPDATE public.restaurant_settings SET hold_first_order_km = NULL WHERE id = 1`);
  });

  it('not the history of the restaurant when first plugged in', async () => {
    const { order_id } = await placeOrder([BURGER]);
    await db.query(`UPDATE public.order_ticket_events SET updated_at = now() - interval '3 hours' WHERE order_id = $1`, [order_id]);
    expect(await claim(KITCHEN_TOKEN)).toBeNull();
  });

  it('not food that is already up', async () => {
    const { order_id } = await placeOrder([BURGER]);
    await db.query(`SELECT set_config('lasoul.financial_ctx', 'on', false)`);
    await db.query(`UPDATE public.orders SET status = 'cancelled' WHERE id = $1`, [order_id]);
    await db.query(`SELECT set_config('lasoul.financial_ctx', '', false)`);
    expect(await claim(KITCHEN_TOKEN)).toBeNull();
  });
});

describe('a retried fetch', () => {
  it('gets the same job back, not the next one', async () => {
    const first = await placeOrder([BURGER]);
    const second = await placeOrder([BURGER]);
    const job = await claim(KITCHEN_TOKEN, (await ticket(first.order_id)).id);
    const again = await claim(KITCHEN_TOKEN, String(job?.ticket_id));
    expect(again?.order_id).toBe(first.order_id);
    expect((await ticket(second.order_id)).status).toBe('queued');
  });

  it('but another printer cannot take it', async () => {
    await db.exec(`UPDATE public.printers SET station = 'all' WHERE poll_token = '${BAR_TOKEN}'`);
    const { order_id } = await placeOrder([BURGER]);
    const job = await claim(KITCHEN_TOKEN);
    expect(await claim(BAR_TOKEN, String(job?.ticket_id))).toBeNull();
    expect((await ticket(order_id)).claimed_by_device).toBe('cloud:Kitchen printer');
  });
});

describe('a printer and a tablet', () => {
  it('cannot both print the same ticket — tablet first', async () => {
    const { order_id } = await placeOrder([BURGER]);
    await actAs(db, STAFF);
    const { rows } = await db.query<{ won: boolean }>(`SELECT public.claim_ticket_print($1, 'tablet-a') AS won`, [order_id]);
    await actAs(db, null);
    expect(rows[0].won).toBe(true);
    expect(await claim(KITCHEN_TOKEN)).toBeNull();
  });

  it('cannot both print the same ticket — printer first', async () => {
    const { order_id } = await placeOrder([BURGER]);
    expect(await claim(KITCHEN_TOKEN)).not.toBeNull();
    await actAs(db, STAFF);
    const { rows } = await db.query<{ won: boolean }>(`SELECT public.claim_ticket_print($1, 'tablet-a') AS won`, [order_id]);
    await actAs(db, null);
    expect(rows[0].won).toBe(false);
  });
});

describe('the result', () => {
  it('a confirmed print is verified — the printer itself said so', async () => {
    const { order_id } = await placeOrder([BURGER]);
    const claimed = await claim(KITCHEN_TOKEN);
    expect(await report(KITCHEN_TOKEN, true, String(claimed?.ticket_id))).toBe(claimed?.ticket_id);
    expect(await ticket(order_id)).toMatchObject({ status: 'printed', print_verified: true, claimed_by_device: 'cloud:Kitchen printer' });
  });

  it('a report without our job id settles the job this printer has out', async () => {
    // Epson's response does not reliably echo our id back.
    const { order_id } = await placeOrder([BURGER]);
    await claim(KITCHEN_TOKEN);
    await report(KITCHEN_TOKEN, false, null, 'EPTR_REC_EMPTY');
    expect(await ticket(order_id)).toMatchObject({ status: 'failed', last_error: 'EPTR_REC_EMPTY' });
  });

  it('cannot settle another printer’s job', async () => {
    const { order_id } = await placeOrder([BURGER]);
    const claimed = await claim(KITCHEN_TOKEN);
    expect(await report(BAR_TOKEN, true, String(claimed?.ticket_id))).toBeNull();
    expect((await ticket(order_id)).status).toBe('claimed');
  });

  it('a job fetched and never confirmed becomes visible, not lost', async () => {
    const { order_id } = await placeOrder([BURGER]);
    await claim(KITCHEN_TOKEN);
    await db.query(`UPDATE public.order_ticket_events SET claimed_at = now() - interval '3 minutes' WHERE order_id = $1`, [order_id]);
    await checkin(KITCHEN_TOKEN);
    const row = await ticket(order_id);
    expect(row.status).toBe('failed');
    expect(row.last_error).toMatch(/never confirmed/);
  });
});

describe('reprints', () => {
  it('remember when the original came out', async () => {
    const { order_id } = await placeOrder([BURGER]);
    await claim(KITCHEN_TOKEN);
    await report(KITCHEN_TOKEN, true);
    const first = (await ticket(order_id)).printed_at;

    await actAs(db, STAFF);
    await db.query(`SELECT public.requeue_ticket_print($1, 'kitchen')`, [order_id]);
    await actAs(db, null);

    const claimed = await claim(KITCHEN_TOKEN);
    const ms = (v: unknown) => new Date(String(v instanceof Date ? v.toISOString() : v)).getTime();
    expect(ms(claimed?.original_printed_at)).toBe(ms(first));
    await report(KITCHEN_TOKEN, true);

    // A second reprint still points at the FIRST print, not the reprint.
    await actAs(db, STAFF);
    await db.query(`SELECT public.requeue_ticket_print($1, 'kitchen')`, [order_id]);
    await actAs(db, null);
    expect(ms((await ticket(order_id)).original_printed_at)).toBe(ms(first));
  });
});

describe('health', () => {
  it('tells staff a printer is online, and how much is waiting', async () => {
    await placeOrder([BURGER]);
    await checkin(KITCHEN_TOKEN);
    await actAs(db, STAFF);
    const { rows } = await db.query<{ name: string; online: boolean; waiting: number }>(
      `SELECT name, online, waiting FROM public.printer_health() ORDER BY name`);
    await actAs(db, null);
    expect(rows).toEqual([
      { name: 'Bar printer', online: false, waiting: 0 },
      { name: 'Kitchen printer', online: true, waiting: 1 },
    ]);
  });

  it('never shows staff the poll secret', async () => {
    await actAs(db, STAFF);
    const { rows } = await db.query<Record<string, unknown>>(`SELECT * FROM public.printer_health()`);
    await actAs(db, null);
    expect(Object.keys(rows[0])).not.toContain('poll_token');
    expect(JSON.stringify(rows)).not.toContain(KITCHEN_TOKEN);
  });

  it('is for staff only', async () => {
    await actAs(db, null);
    await expect(db.query(`SELECT * FROM public.printer_health()`)).rejects.toThrow(/Only staff/);
  });
});

describe('test page', () => {
  it('is offered once after a manager asks, and not again after it printed', async () => {
    await db.exec(`UPDATE public.printers SET test_requested_at = now() WHERE poll_token = '${KITCHEN_TOKEN}'`);
    expect((await checkin(KITCHEN_TOKEN))?.test_pending).toBe(true);
    await db.query(`SELECT public.cloud_printer_test_done($1, true)`, [KITCHEN_TOKEN]);
    expect((await checkin(KITCHEN_TOKEN))?.test_pending).toBe(false);
  });
});
