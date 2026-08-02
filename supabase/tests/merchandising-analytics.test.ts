/**
 * @vitest-environment node
 *
 * Integration tests for the parts that decide what a guest is offered and what
 * management is told. Run against real PostgreSQL via PGlite.
 *
 * The guarantees here are commercial rather than financial, but two of them
 * matter as much as money:
 *   - a recommendation can never point at something the kitchen cannot make
 *   - a report can never count an order that never happened
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

const STAFF_ID = '22222222-2222-2222-2222-222222222222';
const BURGER = 'cccccccc-0000-0000-0000-000000000001';
const FRIES = 'cccccccc-0000-0000-0000-000000000002';
const COLA = 'cccccccc-0000-0000-0000-000000000003';
const SOLD_OUT_CAKE = 'cccccccc-0000-0000-0000-000000000004';
const SECOND_BURGER = 'cccccccc-0000-0000-0000-000000000005';
const NIGHT_TEA = 'cccccccc-0000-0000-0000-000000000006';
const SESSION = 'eeeeeeee-0000-0000-0000-000000000001';
const TOKEN = 'sess-token-7';

async function seed() {
  await db.exec(`
    TRUNCATE public.analytics_events, public.menu_item_recommendations,
             public.audit_log, public.payment_callback_events, public.payment_transactions,
             public.order_ticket_events, public.order_items, public.orders,
             public.table_sessions, public.tables,
             public.menu_items, public.subcategories, public.categories,
             public.order_code_counters
      RESTART IDENTITY CASCADE;
    DELETE FROM public.user_roles;
    DELETE FROM auth.users;

    UPDATE public.restaurant_settings
       SET ordering_enabled = true, online_card_enabled = false, recommendations_enabled = true
     WHERE id = 1;

    INSERT INTO auth.users(id, email) VALUES ('${STAFF_ID}', 'staff@lasoul.test');
    INSERT INTO public.user_roles(user_id, role) VALUES ('${STAFF_ID}', 'staff');

    INSERT INTO public.categories(id, name, sort_order)
      VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'Food', 1),
             ('aaaaaaaa-0000-0000-0000-000000000002', 'Drinks', 2);

    INSERT INTO public.subcategories(id, category_id, name, sort_order) VALUES
      ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Burgers', 1),
      ('bbbbbbbb-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'Sides', 2),
      ('bbbbbbbb-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000002', 'Soft Drinks', 3),
      ('bbbbbbbb-0000-0000-0000-000000000004', 'aaaaaaaa-0000-0000-0000-000000000001', 'Desserts', 4);

    INSERT INTO public.menu_items(id, subcategory_id, name, name_bs, price, is_available, margin_score) VALUES
      ('${BURGER}',         'bbbbbbbb-0000-0000-0000-000000000001', 'La Soul Burger', 'La Soul Burger', 18.00, true, 40),
      ('${FRIES}',          'bbbbbbbb-0000-0000-0000-000000000002', 'French Fries',   'Pomfrit',         6.00, true, 80),
      ('${COLA}',           'bbbbbbbb-0000-0000-0000-000000000003', 'Coca-Cola',      'Coca-Cola',       4.00, true, 70),
      ('${SOLD_OUT_CAKE}',  'bbbbbbbb-0000-0000-0000-000000000004', 'Chocolate Cake', 'Čokoladna torta',12.00, false, 90),
      ('${SECOND_BURGER}',  'bbbbbbbb-0000-0000-0000-000000000001', 'Chicken Burger', 'Piletina Burger',16.00, true, 60);

    -- Available only late in the evening.
    INSERT INTO public.menu_items(id, subcategory_id, name, price, is_available, available_from, available_to)
      VALUES ('${NIGHT_TEA}', 'bbbbbbbb-0000-0000-0000-000000000003', 'Night Tea', 5.00, true, '23:30', '23:59');

    INSERT INTO public.tables(id, table_number) VALUES ('dddddddd-0000-0000-0000-000000000001', 7);
    INSERT INTO public.table_sessions(id, table_id, token, is_active, guest_name)
      VALUES ('${SESSION}', 'dddddddd-0000-0000-0000-000000000001', '${TOKEN}', true, 'Amina');
  `);
  await actAs(db, null);
}

/*
 * Ranking behaviour is tested against `rank_recommendations`, which is the
 * pure, side-effect-free scorer. `guest_get_recommendations` is now a thin
 * wrapper that authorises the session and records the decision; that wrapper
 * has its own tests in decision-ledger.test.ts.
 */
async function recommend(cart: string[], placement = 'cart', language = 'en') {
  const { rows } = await db.query<{ id: string; recommendation_type: string; name: string }>(
    `SELECT * FROM public.rank_recommendations($1::uuid[], $2, $3, 8)`,
    [cart, placement, language],
  );
  return rows;
}

beforeAll(async () => {
  db = (await createTestDatabase({ quiet: true })) as unknown as Db;
}, 120_000);

afterAll(async () => { await db?.close(); });
beforeEach(seed);

// ---------------------------------------------------------------------------

describe('recommendations', () => {
  it('offers a curated pairing for what is in the cart', async () => {
    await db.query(
      `INSERT INTO public.menu_item_recommendations(source_item_id, recommended_item_id, recommendation_type, priority)
       VALUES ($1, $2, 'pair_with', 90)`, [BURGER, FRIES]);

    const rows = await recommend([BURGER]);
    expect(rows.map((r) => r.id)).toContain(FRIES);
  });

  it('never recommends a sold-out item, however well curated', async () => {
    await db.query(
      `INSERT INTO public.menu_item_recommendations(source_item_id, recommended_item_id, recommendation_type, priority)
       VALUES ($1, $2, 'pair_with', 100)`, [BURGER, SOLD_OUT_CAKE]);

    const rows = await recommend([BURGER]);
    expect(rows.map((r) => r.id)).not.toContain(SOLD_OUT_CAKE);
  });

  it('never recommends something already in the cart', async () => {
    await db.query(
      `INSERT INTO public.menu_item_recommendations(source_item_id, recommended_item_id, recommendation_type)
       VALUES ($1, $2, 'pair_with')`, [BURGER, FRIES]);

    const rows = await recommend([BURGER, FRIES]);
    expect(rows.map((r) => r.id)).not.toContain(FRIES);
  });

  it('does not offer another burger to someone who ordered a burger', async () => {
    const rows = await recommend([BURGER]);
    expect(rows.map((r) => r.id)).not.toContain(SECOND_BURGER);
  });

  it('does allow a same-shelf item when it is explicitly an upgrade', async () => {
    await db.query(
      `INSERT INTO public.menu_item_recommendations(source_item_id, recommended_item_id, recommendation_type, priority)
       VALUES ($1, $2, 'upgrade_to', 95)`, [BURGER, SECOND_BURGER]);

    const rows = await recommend([BURGER]);
    expect(rows.map((r) => r.id)).toContain(SECOND_BURGER);
  });

  it('respects a time window on the item', async () => {
    // Night Tea is only orderable 23:30-23:59; at any other time it is out.
    const rows = await recommend([BURGER]);
    const now = new Date();
    const inWindow = now.getHours() === 23 && now.getMinutes() >= 30;
    if (!inWindow) expect(rows.map((r) => r.id)).not.toContain(NIGHT_TEA);
  });

  it('respects a language restriction on the relationship', async () => {
    await db.query(
      `INSERT INTO public.menu_item_recommendations(source_item_id, recommended_item_id, recommendation_type, language, priority)
       VALUES ($1, $2, 'pair_with', 'bs', 99)`, [BURGER, COLA]);

    expect((await recommend([BURGER], 'cart', 'bs')).map((r) => r.id)).toContain(COLA);
    // English still gets the popularity fallback, but not the bs-only rule.
    const en = await recommend([BURGER], 'cart', 'en');
    const explicit = en.find((r) => r.id === COLA && r.recommendation_type === 'pair_with');
    expect(explicit).toBeUndefined();
  });

  it('keeps after-meal suggestions out of the cart placement', async () => {
    await db.query(
      `INSERT INTO public.menu_item_recommendations(recommended_item_id, recommendation_type, priority)
       VALUES ($1, 'after_meal', 90)`, [COLA]);

    const cart = await recommend([BURGER], 'cart');
    expect(cart.find((r) => r.recommendation_type === 'after_meal')).toBeUndefined();

    const after = await recommend([BURGER], 'after_meal');
    expect(after.map((r) => r.id)).toContain(COLA);
  });

  it('returns nothing when the restaurant switches recommendations off', async () => {
    await db.query(
      `INSERT INTO public.menu_item_recommendations(source_item_id, recommended_item_id, recommendation_type)
       VALUES ($1, $2, 'pair_with')`, [BURGER, FRIES]);
    await db.query(`UPDATE public.restaurant_settings SET recommendations_enabled = false WHERE id = 1`);

    expect(await recommend([BURGER])).toHaveLength(0);
  });

  it('never exposes the internal margin score', async () => {
    const { rows } = await db.query<Record<string, unknown>>(
      `SELECT * FROM public.rank_recommendations($1::uuid[], 'cart', 'en', 4)`, [[BURGER]]);
    for (const row of rows) {
      expect(Object.keys(row)).not.toContain('margin_score');
    }
  });
});

describe('menu search', () => {
  it('finds an item by its Bosnian name', async () => {
    const { rows } = await db.query<{ id: string }>(`SELECT id FROM public.guest_search_menu('pomfrit', 10)`);
    expect(rows.map((r) => r.id)).toContain(FRIES);
  });

  it('returns sold-out matches so the guest is told, not left guessing', async () => {
    const { rows } = await db.query<{ id: string; is_available: boolean }>(
      `SELECT id, is_available FROM public.guest_search_menu('chocolate', 10)`);
    const cake = rows.find((r) => r.id === SOLD_OUT_CAKE);
    expect(cake).toBeDefined();
    expect(cake?.is_available).toBe(false);
  });

  it('ignores a one-character query rather than returning the whole menu', async () => {
    const { rows } = await db.query(`SELECT * FROM public.guest_search_menu('a', 50)`);
    expect(rows).toHaveLength(0);
  });
});

describe('analytics ingestion', () => {
  const send = (events: unknown[], visit = 'visit-1') =>
    db.query<{ record_analytics_events: number }>(
      `SELECT public.record_analytics_events($1, $2::jsonb) AS record_analytics_events`,
      [visit, JSON.stringify(events)],
    );

  it('accepts a known event', async () => {
    const { rows } = await send([{ event: 'item_added', props: { item_id: BURGER }, at: new Date().toISOString() }]);
    expect(rows[0].record_analytics_events).toBe(1);
  });

  it('silently drops an event name that is not in the vocabulary', async () => {
    const { rows } = await send([{ event: 'exfiltrate_everything', props: {} }]);
    expect(rows[0].record_analytics_events).toBe(0);
  });

  it('strips non-scalar properties, so a payload can never be stored', async () => {
    await send([{ event: 'item_added', props: { item_id: BURGER, payload: { card: '4111111111111111' }, list: [1, 2] } }]);
    const { rows } = await db.query<{ props: Record<string, unknown> }>(
      `SELECT props FROM public.analytics_events ORDER BY id DESC LIMIT 1`);
    expect(rows[0].props).toEqual({ item_id: BURGER });
  });

  it('refuses an oversized batch', async () => {
    const batch = Array.from({ length: 30 }, () => ({ event: 'menu_viewed', props: {} }));
    const { rows } = await send(batch);
    expect(rows[0].record_analytics_events).toBe(0);
  });

  it('is not writable directly by an anonymous client', async () => {
    const { rows } = await db.query<{ has: boolean }>(
      `SELECT has_table_privilege('anon', 'public.analytics_events', 'INSERT') AS has`);
    expect(rows[0].has).toBe(false);
  });
});

describe('reconciliation', () => {
  async function placeAndPay(method: 'cash' | 'pos_terminal') {
    const { rows } = await db.query<{ result: Record<string, unknown> }>(
      `SELECT public.guest_place_order($1, $2, 'Amina', $3, $4::jsonb, 0) AS result`,
      [SESSION, TOKEN, method, JSON.stringify([{ menu_item_id: BURGER, quantity: 1 }])],
    );
    const id = rows[0].result.order_id as string;
    await actAs(db, STAFF_ID);
    await db.query(`SELECT public.record_table_payment($1, $2, NULL)`, [id, method]);
    await actAs(db, null);
    return id;
  }

  it('requires staff to read it at all', async () => {
    await actAs(db, null);
    await expect(db.query(`SELECT public.day_reconciliation(CURRENT_DATE)`))
      .rejects.toThrow(/Only staff/i);
  });

  it('keeps cash and the POS terminal in separate columns', async () => {
    await placeAndPay('cash');
    await placeAndPay('pos_terminal');

    await actAs(db, STAFF_ID);
    const { rows } = await db.query<{ result: Record<string, number> }>(
      `SELECT public.day_reconciliation(CURRENT_DATE) AS result`);
    await actAs(db, null);

    expect(Number(rows[0].result.paid_cash)).toBe(18);
    expect(Number(rows[0].result.paid_pos_terminal)).toBe(18);
    expect(Number(rows[0].result.gross)).toBe(36);
  });

  it('does not count an unpaid card order as revenue', async () => {
    await db.query(`UPDATE public.restaurant_settings SET online_card_enabled = true WHERE id = 1`);
    await db.query(
      `SELECT public.guest_place_order($1, $2, 'Amina', 'card_online', $3::jsonb, 0)`,
      [SESSION, TOKEN, JSON.stringify([{ menu_item_id: BURGER, quantity: 1 }])],
    );

    await actAs(db, STAFF_ID);
    const { rows } = await db.query<{ result: Record<string, number> }>(
      `SELECT public.day_reconciliation(CURRENT_DATE) AS result`);
    await actAs(db, null);

    expect(Number(rows[0].result.gross)).toBe(0);
    expect(Number(rows[0].result.orders)).toBe(0);
    // …but it is visible as money that started and never landed.
    expect(Number(rows[0].result.stuck_payments)).toBe(1);
    expect(Number(rows[0].result.stuck_amount)).toBe(18);
  });

  it('does not count a cancelled order as revenue', async () => {
    const id = await placeAndPay('cash');
    await actAs(db, '22222222-2222-2222-2222-222222222222');
    // Staff cannot cancel a paid order; make them an admin for this case.
    await db.query(`INSERT INTO public.user_roles(user_id, role) VALUES ($1, 'admin') ON CONFLICT DO NOTHING`, [STAFF_ID]);
    await db.query(`SELECT public.cancel_order($1, 'guest left')`, [id]);

    const { rows } = await db.query<{ result: Record<string, number> }>(
      `SELECT public.day_reconciliation(CURRENT_DATE) AS result`);
    await actAs(db, null);

    expect(Number(rows[0].result.gross)).toBe(0);
    expect(Number(rows[0].result.cancelled_orders)).toBe(1);
  });

  it('surfaces money that is still owed', async () => {
    await db.query(
      `SELECT public.guest_place_order($1, $2, 'Amina', 'cash', $3::jsonb, 0)`,
      [SESSION, TOKEN, JSON.stringify([{ menu_item_id: BURGER, quantity: 2 }])],
    );

    await actAs(db, STAFF_ID);
    const { rows } = await db.query<{ result: Record<string, number> }>(
      `SELECT public.day_reconciliation(CURRENT_DATE) AS result`);
    await actAs(db, null);

    expect(Number(rows[0].result.outstanding)).toBe(36);
    expect(Number(rows[0].result.outstanding_orders)).toBe(1);
  });

  it('counts rejected provider callbacks as a problem to chase', async () => {
    await db.query(
      `INSERT INTO public.payment_callback_events(event_hash, outcome) VALUES ('h1', 'amount_mismatch'), ('h2', 'currency_mismatch')`);

    await actAs(db, STAFF_ID);
    const { rows } = await db.query<{ result: Record<string, number> }>(
      `SELECT public.day_reconciliation(CURRENT_DATE) AS result`);
    await actAs(db, null);

    expect(Number(rows[0].result.callback_problems)).toBe(2);
  });
});
