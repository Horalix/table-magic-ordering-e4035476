/**
 * @vitest-environment node
 *
 * The print queue.
 *
 * The failure this file exists to prevent is the quiet one: a tablet claims a
 * ticket, dies, and the database records the ticket as printed. Nobody sees a
 * missing ticket — the order simply never gets cooked, and every screen says
 * everything is fine.
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
const FRIES = 'cccccccc-cccc-cccc-cccc-cccccccc0002';
const COFFEE = 'cccccccc-cccc-cccc-cccc-cccccccc0003';
const SESSION = 'eeeeeeee-eeee-eeee-eeee-eeeeeeee0001';
const TOKEN = 'sess-token-7';

let db: Db;

async function seed() {
  await db.exec(`
    TRUNCATE public.audit_log, public.order_ticket_events, public.order_items, public.orders,
             public.table_sessions, public.tables,
             public.menu_items, public.subcategories, public.categories, public.order_code_counters
      RESTART IDENTITY CASCADE;
    DELETE FROM public.user_roles;
    DELETE FROM auth.users;

    UPDATE public.restaurant_settings SET ordering_enabled = true, online_card_enabled = false WHERE id = 1;

    INSERT INTO auth.users(id) VALUES ('${ADMIN}'), ('${STAFF}');
    INSERT INTO public.user_roles(user_id, role) VALUES ('${ADMIN}', 'admin'), ('${STAFF}', 'staff');

    INSERT INTO public.categories(id, name, sort_order) VALUES
      ('aaaaaaaa-0000-0000-0000-000000000001', 'Food', 1),
      ('aaaaaaaa-0000-0000-0000-000000000002', 'Drinks', 2);
    INSERT INTO public.subcategories(id, category_id, name, sort_order) VALUES
      ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Burgers', 1),
      ('bbbbbbbb-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000002', 'Hot Drinks', 2);

    INSERT INTO public.menu_items(id, subcategory_id, name, price, is_available, station, allergens) VALUES
      ('${BURGER}', 'bbbbbbbb-0000-0000-0000-000000000001', 'La Soul Burger', 18.00, true, 'kitchen', ARRAY['gluten','dairy']),
      ('${FRIES}',  'bbbbbbbb-0000-0000-0000-000000000001', 'French Fries',    6.00, true, 'kitchen', '{}'),
      ('${COFFEE}', 'bbbbbbbb-0000-0000-0000-000000000002', 'Espresso',        3.00, true, 'bar', '{}');

    INSERT INTO public.tables(id, table_number) VALUES ('dddddddd-0000-0000-0000-000000000001', 7);
    INSERT INTO public.table_sessions(id, table_id, token, is_active, guest_name, last_heartbeat_at)
      VALUES ('${SESSION}', 'dddddddd-0000-0000-0000-000000000001', '${TOKEN}', true, 'Amina', now());
  `);
  await actAs(db, null);
}

async function placeOrder(items: string[]) {
  const { rows } = await db.query<{ result: Record<string, unknown> }>(
    `SELECT public.guest_place_order($1, $2, 'Amina', 'cash', $3::jsonb, 0) AS result`,
    [SESSION, TOKEN, JSON.stringify(items.map((id) => ({ menu_item_id: id, quantity: 1 })))],
  );
  return rows[0].result.order_id as string;
}

const tickets = async (orderId: string) => {
  const { rows } = await db.query<{
    ticket_type: string; status: string; print_verified: boolean | null;
    attempts: number; last_error: string | null; payload: Record<string, unknown>;
  }>(
    `SELECT ticket_type, status, print_verified, attempts, last_error, payload
       FROM public.order_ticket_events WHERE order_id = $1 ORDER BY ticket_type`,
    [orderId],
  );
  return rows;
};

beforeAll(async () => { db = (await createTestDatabase({ quiet: true })) as unknown as Db; }, 180_000);
afterAll(async () => { await db.close(); });
beforeEach(seed);

describe('station tickets', () => {
  it('sends the drink to the bar and the food to the kitchen', async () => {
    const order = await placeOrder([BURGER, COFFEE]);
    const rows = await tickets(order);

    expect(rows.map((r) => r.ticket_type)).toEqual(['bar', 'kitchen']);

    const bar = rows.find((r) => r.ticket_type === 'bar')!;
    const barItems = bar.payload.items as { name: string }[];
    expect(barItems).toHaveLength(1);
    expect(barItems[0].name).toBe('Espresso');
  });

  it('does not print an empty ticket at a station with nothing to make', async () => {
    // A blank ticket sliding out of the bar printer teaches staff to ignore
    // the bar printer, which is worse than no ticket at all.
    const order = await placeOrder([BURGER, FRIES]);
    const rows = await tickets(order);

    expect(rows.map((r) => r.ticket_type)).toEqual(['kitchen']);
  });

  it('carries the order code and allergens the ticket has to show', async () => {
    const order = await placeOrder([BURGER]);
    const rows = await tickets(order);
    const payload = rows[0].payload as { order_code: string; items: { allergens: string[] }[] };

    expect(payload.order_code).toBeTruthy();
    expect(payload.items[0].allergens).toEqual(['gluten', 'dairy']);
  });
});

describe('claiming', () => {
  it('claims for exactly one device', async () => {
    const order = await placeOrder([BURGER]);

    await actAs(db, STAFF);
    const { rows: first } = await db.query<{ won: boolean }>(
      `SELECT public.claim_ticket_print($1, 'tablet-a') AS won`, [order]);
    const { rows: second } = await db.query<{ won: boolean }>(
      `SELECT public.claim_ticket_print($1, 'tablet-b') AS won`, [order]);
    await actAs(db, null);

    expect(first[0].won).toBe(true);
    expect(second[0].won).toBe(false);
  });

  it('does not call a claim a print', async () => {
    // The whole point. Winning the claim used to set status='printed', so a
    // device that then died left a ticket the database believed was on paper.
    const order = await placeOrder([BURGER]);

    await actAs(db, STAFF);
    await db.query(`SELECT public.claim_ticket_print($1, 'tablet-a')`, [order]);
    await actAs(db, null);

    expect((await tickets(order))[0].status).toBe('claimed');
  });

  it('claims each station separately', async () => {
    const order = await placeOrder([BURGER, COFFEE]);

    await actAs(db, STAFF);
    const { rows } = await db.query<{ won: boolean }>(
      `SELECT public.claim_ticket_print($1, 'bar-tablet', 'bar') AS won`, [order]);
    await actAs(db, null);

    expect(rows[0].won).toBe(true);
    const rowsAfter = await tickets(order);
    expect(rowsAfter.find((r) => r.ticket_type === 'bar')!.status).toBe('claimed');
    expect(rowsAfter.find((r) => r.ticket_type === 'kitchen')!.status).toBe('queued');
  });
});

describe('reporting', () => {
  it('records an unverified success as unverified', async () => {
    const order = await placeOrder([BURGER]);

    await actAs(db, STAFF);
    await db.query(`SELECT public.claim_ticket_print($1, 'tablet-a')`, [order]);
    await db.query(`SELECT public.report_ticket_print($1, true, NULL, 'kitchen', false)`, [order]);
    await actAs(db, null);

    const row = (await tickets(order))[0];
    expect(row.status).toBe('printed');
    expect(row.print_verified).toBe(false);
  });

  it('records a verified success as verified', async () => {
    const order = await placeOrder([BURGER]);

    await actAs(db, STAFF);
    await db.query(`SELECT public.claim_ticket_print($1, 'tablet-a')`, [order]);
    await db.query(`SELECT public.report_ticket_print($1, true, NULL, 'kitchen', true)`, [order]);
    await actAs(db, null);

    expect((await tickets(order))[0].print_verified).toBe(true);
  });

  it('puts a failure back where a human can see it', async () => {
    const order = await placeOrder([BURGER]);

    await actAs(db, STAFF);
    await db.query(`SELECT public.claim_ticket_print($1, 'tablet-a')`, [order]);
    await db.query(`SELECT public.report_ticket_print($1, false, 'paper out')`, [order]);
    await actAs(db, null);

    const row = (await tickets(order))[0];
    expect(row.status).toBe('failed');
    expect(row.print_verified).toBeNull();
  });

  it('lets a failed ticket be claimed again', async () => {
    const order = await placeOrder([BURGER]);

    await actAs(db, STAFF);
    await db.query(`SELECT public.claim_ticket_print($1, 'tablet-a')`, [order]);
    await db.query(`SELECT public.report_ticket_print($1, false, 'paper out')`, [order]);
    const { rows } = await db.query<{ won: boolean }>(
      `SELECT public.claim_ticket_print($1, 'tablet-b') AS won`, [order]);
    await actAs(db, null);

    expect(rows[0].won).toBe(true);
  });
});

describe('the stale sweeper', () => {
  it('turns a dead tablet into a visible reprint', async () => {
    const order = await placeOrder([BURGER]);

    await actAs(db, STAFF);
    await db.query(`SELECT public.claim_ticket_print($1, 'doomed-tablet')`, [order]);
    // The tablet dies here.
    await db.exec(`UPDATE public.order_ticket_events SET claimed_at = now() - interval '5 minutes'`);
    const { rows } = await db.query<{ swept: number }>(
      `SELECT public.requeue_stale_ticket_prints(90) AS swept`);
    await actAs(db, null);

    expect(rows[0].swept).toBe(1);
    const row = (await tickets(order))[0];
    expect(row.status).toBe('failed');
    expect(row.last_error ?? '').toContain('never reported back');
  });

  it('leaves a claim that is still plausibly printing alone', async () => {
    const order = await placeOrder([BURGER]);

    await actAs(db, STAFF);
    await db.query(`SELECT public.claim_ticket_print($1, 'busy-tablet')`, [order]);
    const { rows } = await db.query<{ swept: number }>(
      `SELECT public.requeue_stale_ticket_prints(90) AS swept`);
    await actAs(db, null);

    expect(rows[0].swept).toBe(0);
    expect((await tickets(order))[0].status).toBe('claimed');
  });

  it('is safe to call from every open device', async () => {
    await actAs(db, STAFF);
    const { rows: a } = await db.query<{ swept: number }>(`SELECT public.requeue_stale_ticket_prints() AS swept`);
    const { rows: b } = await db.query<{ swept: number }>(`SELECT public.requeue_stale_ticket_prints() AS swept`);
    await actAs(db, null);

    expect(a[0].swept).toBe(0);
    expect(b[0].swept).toBe(0);
  });

  it('is staff-only', async () => {
    await expect(db.query(`SELECT public.requeue_stale_ticket_prints()`))
      .rejects.toThrow(/Only staff/);
  });
});

describe('reprint', () => {
  it('reports when the original went out, so the line can tell them apart', async () => {
    const order = await placeOrder([BURGER]);

    await actAs(db, STAFF);
    await db.query(`SELECT public.claim_ticket_print($1, 'tablet-a')`, [order]);
    await db.query(`SELECT public.report_ticket_print($1, true, NULL, 'kitchen', true)`, [order]);
    const { rows } = await db.query<{ result: { requeued: boolean; previous_printed_at: string | null } }>(
      `SELECT public.requeue_ticket_print($1) AS result`, [order]);
    await actAs(db, null);

    expect(rows[0].result.requeued).toBe(true);
    expect(rows[0].result.previous_printed_at).toBeTruthy();
  });

  it('clears the verified flag so a reprint cannot inherit the original evidence', async () => {
    const order = await placeOrder([BURGER]);

    await actAs(db, STAFF);
    await db.query(`SELECT public.claim_ticket_print($1, 'tablet-a')`, [order]);
    await db.query(`SELECT public.report_ticket_print($1, true, NULL, 'kitchen', true)`, [order]);
    await db.query(`SELECT public.requeue_ticket_print($1)`, [order]);
    await actAs(db, null);

    const row = (await tickets(order))[0];
    expect(row.status).toBe('queued');
    expect(row.print_verified).toBeNull();
  });

  it('counts attempts so a ticket nobody can print is visible as such', async () => {
    const order = await placeOrder([BURGER]);

    await actAs(db, STAFF);
    for (let i = 0; i < 3; i += 1) {
      await db.query(`SELECT public.claim_ticket_print($1, 'tablet-a')`, [order]);
      await db.query(`SELECT public.report_ticket_print($1, false, 'paper out')`, [order]);
    }
    await actAs(db, null);

    expect((await tickets(order))[0].attempts).toBe(3);
  });
});
