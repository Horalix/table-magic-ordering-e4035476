/**
 * @vitest-environment node
 *
 * Integration tests for the money-critical paths, run against a real
 * PostgreSQL (PGlite) with every migration applied — real triggers, real
 * PL/pgSQL, real constraints.
 *
 * These encode the guarantees the restaurant depends on:
 *   - a card order never reaches the kitchen unpaid
 *   - the guest cannot influence the total
 *   - a wrong-amount or wrong-currency callback never marks an order paid
 *   - duplicate callbacks are inert
 *   - only staff can say money arrived
 */
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error -- plain JS harness, no types needed
import { createTestDatabase, actAs } from '../../scripts/db-harness.mjs';

type Db = {
  query: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
  exec: (sql: string) => Promise<unknown>;
  close: () => Promise<void>;
};

let db: Db;

const ADMIN_ID = '11111111-1111-1111-1111-111111111111';
const STAFF_ID = '22222222-2222-2222-2222-222222222222';

/** Seed a minimal but realistic restaurant. */
async function seed() {
  await db.exec(`
    TRUNCATE public.audit_log, public.payment_callback_events, public.payment_transactions,
             public.order_refunds, public.order_ticket_events, public.order_items,
             public.orders, public.table_sessions, public.tables,
             public.menu_items, public.subcategories, public.categories,
             public.order_code_counters
      RESTART IDENTITY CASCADE;
    DELETE FROM public.user_roles;
    DELETE FROM auth.users;

    UPDATE public.restaurant_settings
       SET ordering_enabled = true, online_card_enabled = false, pay_at_table_enabled = true
     WHERE id = 1;

    INSERT INTO auth.users(id, email) VALUES
      ('${ADMIN_ID}', 'admin@lasoul.test'),
      ('${STAFF_ID}', 'staff@lasoul.test');
    INSERT INTO public.user_roles(user_id, role) VALUES
      ('${ADMIN_ID}', 'admin'), ('${STAFF_ID}', 'staff');

    INSERT INTO public.categories(id, name, sort_order)
      VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'Food', 1);
    INSERT INTO public.subcategories(id, category_id, name, sort_order)
      VALUES ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Burgers', 1);
    INSERT INTO public.menu_items(id, subcategory_id, name, price, is_available) VALUES
      ('cccccccc-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'La Soul Burger', 18.00, true),
      ('cccccccc-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000001', 'French Fries', 6.00, true),
      ('cccccccc-0000-0000-0000-000000000003', 'bbbbbbbb-0000-0000-0000-000000000001', 'Sold Out Special', 25.00, false);

    INSERT INTO public.tables(id, table_number) VALUES ('dddddddd-0000-0000-0000-000000000001', 7);
    INSERT INTO public.table_sessions(id, table_id, token, is_active, guest_name)
      VALUES ('eeeeeeee-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001', 'sess-token-7', true, 'Amina');
  `);
  await actAs(db, null);
}

const SESSION = 'eeeeeeee-0000-0000-0000-000000000001';
const TOKEN = 'sess-token-7';
const BURGER = 'cccccccc-0000-0000-0000-000000000001';
const FRIES = 'cccccccc-0000-0000-0000-000000000002';
const SOLD_OUT = 'cccccccc-0000-0000-0000-000000000003';

async function placeOrder(items: unknown[], method = 'cash', tip = 0) {
  const { rows } = await db.query<{ result: Record<string, unknown> }>(
    `SELECT public.guest_place_order($1, $2, $3, $4, $5::jsonb, $6) AS result`,
    [SESSION, TOKEN, 'Amina', method, JSON.stringify(items), tip],
  );
  return rows[0].result;
}

async function enableOnlineCard(on: boolean) {
  await db.query(`UPDATE public.restaurant_settings SET online_card_enabled = $1 WHERE id = 1`, [on]);
}

async function orderRow(id: string) {
  const { rows } = await db.query<Record<string, unknown>>(`SELECT * FROM public.orders WHERE id = $1`, [id]);
  return rows[0];
}

async function ticketCount(orderId: string) {
  const { rows } = await db.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM public.order_ticket_events WHERE order_id = $1`, [orderId]);
  return Number(rows[0].n);
}

beforeAll(async () => {
  db = (await createTestDatabase({ quiet: true })) as unknown as Db;
}, 120_000);

afterAll(async () => {
  await db?.close();
});

beforeEach(seed);

// ---------------------------------------------------------------------------

describe('server-side pricing', () => {
  it('ignores any price the client sends and uses the menu price', async () => {
    const result = await placeOrder([
      { menu_item_id: BURGER, quantity: 2, price: 0.01, unit_price: 0.01, total: 0.02 },
    ]);
    expect(Number(result.total)).toBe(36);
  });

  it('caps the tip at 40% of the items total', async () => {
    const result = await placeOrder([{ menu_item_id: BURGER, quantity: 1 }], 'cash', 999);
    // 18.00 items → tip capped at 7.20 → total 25.20
    expect(Number(result.tip_amount)).toBe(7.2);
    expect(Number(result.total)).toBe(25.2);
  });

  it('rejects a negative tip by flooring it at zero', async () => {
    const result = await placeOrder([{ menu_item_id: BURGER, quantity: 1 }], 'cash', -50);
    expect(Number(result.tip_amount)).toBe(0);
    expect(Number(result.total)).toBe(18);
  });

  it('clamps quantity to the 1..10 range', async () => {
    const result = await placeOrder([{ menu_item_id: FRIES, quantity: 9999 }]);
    expect(Number(result.total)).toBe(60); // 10 x 6.00
  });

  it('refuses a sold-out item and names it', async () => {
    await expect(placeOrder([{ menu_item_id: SOLD_OUT, quantity: 1 }]))
      .rejects.toThrow(/Sold Out Special/);
  });

  it('gives every order a short, speakable code', async () => {
    const a = await placeOrder([{ menu_item_id: BURGER, quantity: 1 }]);
    const b = await placeOrder([{ menu_item_id: FRIES, quantity: 1 }]);
    expect(a.order_code).toMatch(/^\d{3}$/);
    expect(b.order_code).toMatch(/^\d{3}$/);
    expect(a.order_code).not.toBe(b.order_code);
  });
});

describe('pay-at-table orders', () => {
  it('goes straight to the kitchen and queues exactly one ticket', async () => {
    const result = await placeOrder([{ menu_item_id: BURGER, quantity: 1 }], 'cash');
    const order = await orderRow(result.order_id as string);

    expect(order.status).toBe('pending');
    expect(order.payment_status).toBe('unpaid');
    expect(order.payment_method).toBe('cash');
    expect(order.released_to_kitchen_at).not.toBeNull();
    expect(await ticketCount(result.order_id as string)).toBe(1);
  });

  it('records the physical POS terminal separately from cash', async () => {
    const result = await placeOrder([{ menu_item_id: BURGER, quantity: 1 }], 'pos_terminal');
    const order = await orderRow(result.order_id as string);
    expect(order.payment_method).toBe('pos_terminal');
    expect(order.payment_status).toBe('unpaid');
  });
});

describe('card orders are held until money is confirmed', () => {
  it('refuses a card order while online payments are off', async () => {
    await enableOnlineCard(false);
    await expect(placeOrder([{ menu_item_id: BURGER, quantity: 1 }], 'card_online'))
      .rejects.toThrow(/unavailable/i);
  });

  it('creates the order in awaiting_payment with no kitchen ticket', async () => {
    await enableOnlineCard(true);
    const result = await placeOrder([{ menu_item_id: BURGER, quantity: 1 }], 'card_online');
    const order = await orderRow(result.order_id as string);

    expect(result.awaiting_payment).toBe(true);
    expect(order.status).toBe('awaiting_payment');
    expect(order.payment_status).toBe('pending');
    expect(order.released_to_kitchen_at).toBeNull();
    expect(await ticketCount(result.order_id as string)).toBe(0);
  });

  it('keeps an awaiting_payment order out of every kitchen query', async () => {
    await enableOnlineCard(true);
    await placeOrder([{ menu_item_id: BURGER, quantity: 1 }], 'card_online');

    const { rows } = await db.query<{ n: string }>(`
      SELECT count(*)::text AS n FROM public.orders
       WHERE status IN ('pending','confirmed','preparing','ready')
    `);
    expect(Number(rows[0].n)).toBe(0);
  });
});

describe('Monri callbacks', () => {
  async function cardOrder() {
    await enableOnlineCard(true);
    const result = await placeOrder([{ menu_item_id: BURGER, quantity: 1 }], 'card_online');
    const { rows } = await db.query<{ result: Record<string, unknown> }>(
      `SELECT public.monri_register_attempt($1, $2, $3, 'BAM', 'purchase') AS result`,
      [result.order_id, SESSION, TOKEN],
    );
    return { order: result, attempt: rows[0].result };
  }

  async function callback(overrides: Record<string, unknown> = {}) {
    const base = {
      hash: 'evt-' + Math.random().toString(36).slice(2),
      orderNumber: null as string | null,
      paymentId: 'pay_1',
      status: 'approved',
      amount: 1800,
      currency: 'BAM',
      raw: {},
      ...overrides,
    };
    const { rows } = await db.query<{ result: Record<string, unknown> }>(
      `SELECT public.monri_apply_callback($1,$2,$3,$4,$5,$6,$7::jsonb) AS result`,
      [base.hash, base.orderNumber, base.paymentId, base.status, base.amount, base.currency, JSON.stringify(base.raw)],
    );
    return rows[0].result;
  }

  it('reuses the live attempt instead of creating a second chargeable one', async () => {
    const { order } = await cardOrder();
    const { rows } = await db.query<{ result: Record<string, unknown> }>(
      `SELECT public.monri_register_attempt($1, $2, $3, 'BAM', 'purchase') AS result`,
      [order.order_id, SESSION, TOKEN],
    );
    expect(rows[0].result.reuse).toBe(true);

    const { rows: count } = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.payment_transactions WHERE order_id = $1`, [order.order_id]);
    expect(Number(count[0].n)).toBe(1);
  });

  it('releases the order exactly once on an approved callback', async () => {
    const { order, attempt } = await cardOrder();
    const first = await callback({ orderNumber: attempt.monri_order_number });

    expect(first.outcome).toBe('approved_released');
    expect(first.released).toBe(true);

    const row = await orderRow(order.order_id as string);
    expect(row.status).toBe('pending');
    expect(row.payment_status).toBe('paid');
    expect(row.paid_at).not.toBeNull();
    expect(await ticketCount(order.order_id as string)).toBe(1);
  });

  it('treats an identical retried callback as a duplicate with no side effects', async () => {
    const { order, attempt } = await cardOrder();
    const hash = 'stable-hash-1';
    await callback({ hash, orderNumber: attempt.monri_order_number });
    const second = await callback({ hash, orderNumber: attempt.monri_order_number });

    expect(second.outcome).toBe('duplicate');
    expect(second.released).toBe(false);
    expect(await ticketCount(order.order_id as string)).toBe(1);
  });

  it('does not release the order when the amount is wrong', async () => {
    const { order, attempt } = await cardOrder();
    const result = await callback({ orderNumber: attempt.monri_order_number, amount: 100 });

    expect(result.outcome).toBe('amount_mismatch');
    expect(result.released).toBe(false);

    const row = await orderRow(order.order_id as string);
    expect(row.status).toBe('awaiting_payment');
    expect(row.payment_status).toBe('pending');
    expect(await ticketCount(order.order_id as string)).toBe(0);
  });

  it('does not release the order when the currency is wrong', async () => {
    const { order, attempt } = await cardOrder();
    const result = await callback({ orderNumber: attempt.monri_order_number, currency: 'EUR' });

    expect(result.outcome).toBe('currency_mismatch');
    const row = await orderRow(order.order_id as string);
    expect(row.status).toBe('awaiting_payment');
    expect(await ticketCount(order.order_id as string)).toBe(0);
  });

  it('never downgrades a paid order with a late pending callback', async () => {
    const { order, attempt } = await cardOrder();
    await callback({ orderNumber: attempt.monri_order_number, status: 'approved' });
    const late = await callback({ orderNumber: attempt.monri_order_number, status: 'pending' });

    expect(late.outcome).toBe('stale_status');
    const row = await orderRow(order.order_id as string);
    expect(row.payment_status).toBe('paid');
  });

  it('parks a declined order in payment_failed, still out of the kitchen', async () => {
    const { order, attempt } = await cardOrder();
    const result = await callback({ orderNumber: attempt.monri_order_number, status: 'declined' });

    expect(result.outcome).toBe('payment_failed');
    const row = await orderRow(order.order_id as string);
    expect(row.status).toBe('payment_failed');
    expect(row.payment_status).toBe('failed');
    expect(await ticketCount(order.order_id as string)).toBe(0);
  });

  it('ignores a callback for an unknown order number', async () => {
    const result = await callback({ orderNumber: 'LS-DOESNOTEXIST' });
    expect(result.outcome).toBe('unknown_transaction');
  });

  it('records every callback for reconciliation', async () => {
    const { attempt } = await cardOrder();
    await callback({ orderNumber: attempt.monri_order_number });
    const { rows } = await db.query<{ outcome: string }>(
      `SELECT outcome FROM public.payment_callback_events ORDER BY created_at DESC LIMIT 1`);
    expect(rows[0].outcome).toBe('approved_released');
  });
});

describe('guest recovery after a failed card payment', () => {
  it('lets the guest switch to pay-at-table, which releases the order', async () => {
    await enableOnlineCard(true);
    const placed = await placeOrder([{ menu_item_id: BURGER, quantity: 1 }], 'card_online');

    const { rows } = await db.query<{ result: Record<string, unknown> }>(
      `SELECT public.guest_switch_to_pay_at_table($1, $2, $3, 'cash') AS result`,
      [SESSION, TOKEN, placed.order_id],
    );

    expect(rows[0].result.status).toBe('released');
    const row = await orderRow(placed.order_id as string);
    expect(row.status).toBe('pending');
    expect(row.payment_method).toBe('cash');
    expect(row.payment_status).toBe('unpaid');
    expect(await ticketCount(placed.order_id as string)).toBe(1);
  });

  it('refuses to switch while a card payment is still in flight', async () => {
    await enableOnlineCard(true);
    const placed = await placeOrder([{ menu_item_id: BURGER, quantity: 1 }], 'card_online');
    await db.query(
      `SELECT public.monri_register_attempt($1, $2, $3, 'BAM', 'purchase')`,
      [placed.order_id, SESSION, TOKEN],
    );
    await db.query(`UPDATE public.payment_transactions SET status = 'pending' WHERE order_id = $1`, [placed.order_id]);

    const { rows } = await db.query<{ result: Record<string, unknown> }>(
      `SELECT public.guest_switch_to_pay_at_table($1, $2, $3, 'cash') AS result`,
      [SESSION, TOKEN, placed.order_id],
    );
    expect(rows[0].result.status).toBe('payment_in_flight');
  });
});

describe('the integrity trigger', () => {
  it('blocks a direct write to payment_status', async () => {
    const placed = await placeOrder([{ menu_item_id: BURGER, quantity: 1 }]);
    await expect(
      db.query(`UPDATE public.orders SET payment_status = 'paid' WHERE id = $1`, [placed.order_id]),
    ).rejects.toThrow(/authorised operation/i);
  });

  it('blocks a direct write to the total', async () => {
    const placed = await placeOrder([{ menu_item_id: BURGER, quantity: 1 }]);
    await expect(
      db.query(`UPDATE public.orders SET total = 0.01 WHERE id = $1`, [placed.order_id]),
    ).rejects.toThrow(/authorised operation/i);
  });

  it('blocks an illegal kitchen transition', async () => {
    const placed = await placeOrder([{ menu_item_id: BURGER, quantity: 1 }]);
    await db.query(`UPDATE public.orders SET status = 'served' WHERE id = $1`, [placed.order_id])
      .catch(() => { /* pending -> served is not legal either; check below */ });

    await db.query(`UPDATE public.orders SET status = 'preparing' WHERE id = $1`, [placed.order_id]);
    await db.query(`UPDATE public.orders SET status = 'served' WHERE id = $1`, [placed.order_id]);

    await expect(
      db.query(`UPDATE public.orders SET status = 'preparing' WHERE id = $1`, [placed.order_id]),
    ).rejects.toThrow(/Illegal order transition/i);
  });

  it('blocks pushing an order into awaiting_payment from a client', async () => {
    const placed = await placeOrder([{ menu_item_id: BURGER, quantity: 1 }]);
    await expect(
      db.query(`UPDATE public.orders SET status = 'awaiting_payment' WHERE id = $1`, [placed.order_id]),
    ).rejects.toThrow(/authorised operation/i);
  });

  it('allows the normal kitchen flow', async () => {
    const placed = await placeOrder([{ menu_item_id: BURGER, quantity: 1 }]);
    for (const status of ['confirmed', 'preparing', 'ready', 'served']) {
      await db.query(`UPDATE public.orders SET status = $2 WHERE id = $1`, [placed.order_id, status]);
    }
    const row = await orderRow(placed.order_id as string);
    expect(row.status).toBe('served');
  });
});

describe('staff financial operations', () => {
  it('refuses to record a payment when nobody is signed in', async () => {
    const placed = await placeOrder([{ menu_item_id: BURGER, quantity: 1 }]);
    await actAs(db, null);
    await expect(
      db.query(`SELECT public.record_table_payment($1, 'cash', NULL)`, [placed.order_id]),
    ).rejects.toThrow(/Only staff/i);
  });

  it('lets staff record cash and marks the order paid', async () => {
    const placed = await placeOrder([{ menu_item_id: BURGER, quantity: 1 }]);
    await actAs(db, STAFF_ID);
    await db.query(`SELECT public.record_table_payment($1, 'cash', 'exact change')`, [placed.order_id]);
    await actAs(db, null);

    const row = await orderRow(placed.order_id as string);
    expect(row.payment_status).toBe('paid');
    expect(row.payment_method).toBe('cash');
    expect(row.paid_by).toBe(STAFF_ID);
  });

  it('keeps the POS terminal distinguishable from cash in the record', async () => {
    const placed = await placeOrder([{ menu_item_id: BURGER, quantity: 1 }]);
    await actAs(db, STAFF_ID);
    await db.query(`SELECT public.record_table_payment($1, 'pos_terminal', NULL)`, [placed.order_id]);
    await actAs(db, null);

    const row = await orderRow(placed.order_id as string);
    expect(row.payment_method).toBe('pos_terminal');
  });

  it('refuses a payment method it does not understand', async () => {
    const placed = await placeOrder([{ menu_item_id: BURGER, quantity: 1 }]);
    await actAs(db, STAFF_ID);
    await expect(
      db.query(`SELECT public.record_table_payment($1, 'bitcoin', NULL)`, [placed.order_id]),
    ).rejects.toThrow(/cash or pos_terminal/i);
    await actAs(db, null);
  });

  it('requires a manager to cancel an order that is already paid', async () => {
    const placed = await placeOrder([{ menu_item_id: BURGER, quantity: 1 }]);
    await actAs(db, STAFF_ID);
    await db.query(`SELECT public.record_table_payment($1, 'cash', NULL)`, [placed.order_id]);
    await expect(
      db.query(`SELECT public.cancel_order($1, 'guest left')`, [placed.order_id]),
    ).rejects.toThrow(/manager/i);

    await actAs(db, ADMIN_ID);
    const { rows } = await db.query<{ result: Record<string, unknown> }>(
      `SELECT public.cancel_order($1, 'guest left') AS result`, [placed.order_id]);
    expect(rows[0].result.status).toBe('cancelled');
    expect(rows[0].result.requires_refund).toBe(true);
    await actAs(db, null);
  });

  it('requires a reason to cancel', async () => {
    const placed = await placeOrder([{ menu_item_id: BURGER, quantity: 1 }]);
    await actAs(db, STAFF_ID);
    await expect(db.query(`SELECT public.cancel_order($1, '  ')`, [placed.order_id]))
      .rejects.toThrow(/reason is required/i);
    await actAs(db, null);
  });

  it('only lets a manager refund, and never more than was paid', async () => {
    const placed = await placeOrder([{ menu_item_id: BURGER, quantity: 1 }]);
    await actAs(db, STAFF_ID);
    await db.query(`SELECT public.record_table_payment($1, 'cash', NULL)`, [placed.order_id]);
    await expect(
      db.query(`SELECT public.record_order_refund($1, 5, 'cash', 'spilled', true, NULL)`, [placed.order_id]),
    ).rejects.toThrow(/manager/i);

    await actAs(db, ADMIN_ID);
    await expect(
      db.query(`SELECT public.record_order_refund($1, 500, 'cash', 'spilled', true, NULL)`, [placed.order_id]),
    ).rejects.toThrow(/between 0 and/i);

    await db.query(`SELECT public.record_order_refund($1, 5, 'cash', 'spilled', true, NULL)`, [placed.order_id]);
    const row = await orderRow(placed.order_id as string);
    expect(Number(row.refunded_amount)).toBe(5);
    expect(row.payment_status).toBe('partially_refunded');
    await actAs(db, null);
  });

  it('writes an audit row for every financial action', async () => {
    const placed = await placeOrder([{ menu_item_id: BURGER, quantity: 1 }]);
    await actAs(db, STAFF_ID);
    await db.query(`SELECT public.record_table_payment($1, 'cash', NULL)`, [placed.order_id]);
    await actAs(db, null);

    const { rows } = await db.query<{ action: string; actor_user_id: string }>(
      `SELECT action, actor_user_id FROM public.audit_log WHERE entity_id = $1 ORDER BY created_at DESC`,
      [placed.order_id]);
    expect(rows.map((r) => r.action)).toContain('payment.recorded_cash');
    expect(rows[0].actor_user_id).toBe(STAFF_ID);
  });
});

describe('print claiming', () => {
  it('lets exactly one device claim a ticket', async () => {
    const placed = await placeOrder([{ menu_item_id: BURGER, quantity: 1 }]);
    await actAs(db, STAFF_ID);

    const first = await db.query<{ claim_ticket_print: boolean }>(
      `SELECT public.claim_ticket_print($1, 'kitchen-ipad') AS claim_ticket_print`, [placed.order_id]);
    const second = await db.query<{ claim_ticket_print: boolean }>(
      `SELECT public.claim_ticket_print($1, 'bar-tablet') AS claim_ticket_print`, [placed.order_id]);

    expect(first.rows[0].claim_ticket_print).toBe(true);
    expect(second.rows[0].claim_ticket_print).toBe(false);
    await actAs(db, null);
  });

  it('returns a failed ticket to the queue so it can be reprinted', async () => {
    const placed = await placeOrder([{ menu_item_id: BURGER, quantity: 1 }]);
    await actAs(db, STAFF_ID);
    await db.query(`SELECT public.claim_ticket_print($1, 'kitchen-ipad')`, [placed.order_id]);
    await db.query(`SELECT public.report_ticket_print($1, false, 'printer offline')`, [placed.order_id]);

    const again = await db.query<{ claim_ticket_print: boolean }>(
      `SELECT public.claim_ticket_print($1, 'kitchen-ipad') AS claim_ticket_print`, [placed.order_id]);
    expect(again.rows[0].claim_ticket_print).toBe(true);
    await actAs(db, null);
  });
});

describe('session and table security', () => {
  it('rejects an order with the wrong session token', async () => {
    await expect(
      db.query(`SELECT public.guest_place_order($1, 'wrong-token', 'x', 'cash', $2::jsonb, 0)`,
        [SESSION, JSON.stringify([{ menu_item_id: BURGER, quantity: 1 }])]),
    ).rejects.toThrow(/Invalid or expired table session/i);
  });

  it('rejects an order on a closed session', async () => {
    await db.query(`UPDATE public.table_sessions SET is_active = false WHERE id = $1`, [SESSION]);
    await expect(placeOrder([{ menu_item_id: BURGER, quantity: 1 }]))
      .rejects.toThrow(/Invalid or expired table session/i);
  });

  it('refuses orders while ordering is paused', async () => {
    await db.query(`UPDATE public.restaurant_settings SET ordering_enabled = false WHERE id = 1`);
    await expect(placeOrder([{ menu_item_id: BURGER, quantity: 1 }]))
      .rejects.toThrow(/paused/i);
  });

  it('only reveals a guest their own order payment state', async () => {
    const placed = await placeOrder([{ menu_item_id: BURGER, quantity: 1 }]);
    const { rows } = await db.query<{ result: Record<string, unknown> }>(
      `SELECT public.guest_get_order_payment($1, $2, $3) AS result`, [SESSION, TOKEN, placed.order_id]);
    expect(rows[0].result.status).toBe('ok');
    expect(rows[0].result.payment_status).toBe('unpaid');

    await expect(
      db.query(`SELECT public.guest_get_order_payment($1, 'nope', $2)`, [SESSION, placed.order_id]),
    ).rejects.toThrow(/Invalid or expired table session/i);
  });
});
