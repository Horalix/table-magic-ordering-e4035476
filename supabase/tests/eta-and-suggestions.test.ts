/**
 * @vitest-environment node
 *
 * Estimates and context-aware suggestions.
 *
 * The rule these tests exist to defend: a number the system cannot back up is
 * not shown. A confidently wrong "ready in 8 minutes" is worse than no
 * estimate, because the guest starts counting — so `confidence: 'none'` has to
 * be a real, reachable answer, not a fallback nobody ever hits.
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
const BURGER = 'cccccccc-cccc-cccc-cccc-cccccccc0001';   // kitchen, 20 min
const SALAD = 'cccccccc-cccc-cccc-cccc-cccccccc0002';    // kitchen, 5 min, vegan
const COFFEE = 'cccccccc-cccc-cccc-cccc-cccccccc0003';   // bar, 2 min
const SOUP = 'cccccccc-cccc-cccc-cccc-cccccccc0004';     // kitchen, no prep_minutes
const NUTCAKE = 'cccccccc-cccc-cccc-cccc-cccccccc0005';  // kitchen, contains nuts
const SESSION = 'eeeeeeee-eeee-eeee-eeee-eeeeeeee0001';
const TOKEN = 'sess-token-7';

let db: Db;

async function seed() {
  await db.exec(`
    TRUNCATE public.audit_log, public.order_ticket_events, public.order_items, public.orders,
             public.table_sessions, public.tables, public.menu_item_prep_stats,
             public.suggestion_stats, public.menu_item_recommendations,
             public.menu_items, public.subcategories, public.categories, public.order_code_counters
      RESTART IDENTITY CASCADE;
    DELETE FROM public.user_roles;
    DELETE FROM auth.users;

    UPDATE public.restaurant_settings
       SET ordering_enabled = true, online_card_enabled = false,
           recommendations_enabled = true, reco_holdout_pct = 0,
           kitchen_capacity_minutes = 25, kitchen_delay_minutes = 0
     WHERE id = 1;

    INSERT INTO auth.users(id) VALUES ('${ADMIN}'), ('${STAFF}');
    INSERT INTO public.user_roles(user_id, role) VALUES ('${ADMIN}', 'admin'), ('${STAFF}', 'staff');

    INSERT INTO public.categories(id, name, sort_order) VALUES
      ('aaaaaaaa-0000-0000-0000-000000000001', 'Food', 1),
      ('aaaaaaaa-0000-0000-0000-000000000002', 'Drinks', 2);
    INSERT INTO public.subcategories(id, category_id, name, sort_order) VALUES
      ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Mains', 1),
      ('bbbbbbbb-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000002', 'Hot Drinks', 2);

    INSERT INTO public.menu_items(id, subcategory_id, name, price, is_available, station, prep_minutes, dietary_tags, allergens, margin_score) VALUES
      ('${BURGER}',  'bbbbbbbb-0000-0000-0000-000000000001', 'Beef Burger',  20.00, true, 'kitchen', 20, '{}',                 '{gluten}', 50),
      ('${SALAD}',   'bbbbbbbb-0000-0000-0000-000000000001', 'Garden Salad',  9.00, true, 'kitchen',  5, '{vegan,vegetarian}', '{}',       50),
      ('${COFFEE}',  'bbbbbbbb-0000-0000-0000-000000000002', 'Espresso',      3.00, true, 'bar',      2, '{vegan,vegetarian}', '{}',       50),
      ('${SOUP}',    'bbbbbbbb-0000-0000-0000-000000000001', 'Soup of Day',   7.00, true, 'kitchen', NULL, '{vegetarian}',     '{}',       50),
      ('${NUTCAKE}', 'bbbbbbbb-0000-0000-0000-000000000001', 'Walnut Cake',   8.00, true, 'kitchen',  3, '{vegetarian}',       '{nuts}',   50);

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

const eta = async (orderId: string) => {
  const { rows } = await db.query<{ result: Record<string, unknown> | null }>(
    `SELECT public.guest_order_eta($1) AS result`, [orderId]);
  return rows[0].result;
};

/*
 * Ranking behaviour is tested against `rank_recommendations`, which is the
 * pure, side-effect-free scorer. `guest_get_recommendations` is now a thin
 * wrapper that authorises the session and records the decision; that wrapper
 * has its own tests in decision-ledger.test.ts.
 */
const recommend = async (cart: string[], allergens: string[] = []) => {
  const { rows } = await db.query<{ id: string; name: string; recommendation_type: string }>(
    `SELECT id, name, recommendation_type
       FROM public.rank_recommendations($1::uuid[], 'cart', 'en', 8, $2::uuid, $3::text[])`,
    [cart, SESSION, allergens],
  );
  return rows;
};

beforeAll(async () => { db = (await createTestDatabase({ quiet: true })) as unknown as Db; }, 180_000);
afterAll(async () => { await db?.close(); });
beforeEach(seed);

describe('the estimate', () => {
  it('is a range, not a single number', async () => {
    // A single number invites the guest to start counting, and then to be
    // annoyed at minute nine of an eight-minute promise.
    const order = await placeOrder([BURGER]);
    const result = await eta(order);

    expect(Number(result!.low_minutes)).toBeGreaterThan(0);
    expect(Number(result!.high_minutes)).toBeGreaterThan(Number(result!.low_minutes));
  });

  it('is paced by the slowest dish, not the sum', async () => {
    // A burger and a coffee arrive together, in burger time.
    const order = await placeOrder([BURGER, COFFEE]);
    const result = await eta(order);

    expect(Number(result!.low_minutes)).toBeGreaterThanOrEqual(20);
    expect(Number(result!.low_minutes)).toBeLessThan(25);
  });

  it('refuses to guess when it knows nothing about the food', async () => {
    // The load-bearing case. Soup has no prep_minutes and no history, so
    // there is nothing to base an answer on and the honest answer is none.
    const order = await placeOrder([SOUP]);
    const result = await eta(order);

    expect(result!.confidence).toBe('none');
    expect(result!.reason).toBe('no_prep_data');
  });

  it('says its confidence is low when only part of the order is known', async () => {
    const order = await placeOrder([BURGER, SOUP]);
    const result = await eta(order);

    expect(result!.confidence).toBe('low');
  });

  it('says nothing for an order that is not in the kitchen', async () => {
    const order = await placeOrder([BURGER]);
    await actAs(db, STAFF);
    await db.query(`SELECT public.staff_update_order_status($1, 'confirmed')`, [order]);
    await db.query(`SELECT public.staff_update_order_status($1, 'preparing')`, [order]);
    await db.query(`SELECT public.staff_update_order_status($1, 'ready')`, [order]);
    await db.query(`SELECT public.staff_update_order_status($1, 'served')`, [order]);
    await actAs(db, null);

    expect((await eta(order))!.confidence).toBe('none');
  });

  it('quotes a longer wait when there is a queue ahead', async () => {
    const first = await placeOrder([BURGER]);
    const solo = await eta(first);

    // Two more burgers land ahead of a later order.
    await placeOrder([BURGER]);
    await placeOrder([BURGER]);
    const last = await placeOrder([BURGER]);
    const queued = await eta(last);

    expect(Number(queued!.low_minutes)).toBeGreaterThan(Number(solo!.low_minutes));
  });

  it('does not count an order against itself', async () => {
    // A table must not be quoted a longer wait because of the food it just
    // ordered — that is the one queue it is not waiting behind.
    const one = await placeOrder([BURGER]);
    const oneEta = await eta(one);

    await db.exec(`ALTER TABLE public.orders DISABLE TRIGGER trg_enforce_order_limits`);
    const big = await placeOrder([BURGER, BURGER, BURGER, BURGER]);
    await db.exec(`ALTER TABLE public.orders ENABLE TRIGGER trg_enforce_order_limits`);
    const bigEta = await eta(big);

    // Its own four burgers add nothing to the backlog; only the one order
    // placed before it does.
    expect(Number(bigEta!.backlog_minutes)).toBe(20);
    expect(Number(oneEta!.backlog_minutes)).toBe(0);
  });

  it('respects the manager saying the kitchen is behind', async () => {
    const before = await eta(await placeOrder([BURGER]));
    await db.exec(`UPDATE public.restaurant_settings SET kitchen_delay_minutes = 15 WHERE id = 1`);
    const after = await eta(await placeOrder([BURGER]));

    expect(Number(after!.low_minutes) - Number(before!.low_minutes)).toBeGreaterThanOrEqual(15);
  });
});

describe('learning how long things really take', () => {
  it('prefers what the kitchen actually did over what someone typed', async () => {
    // The burger is set to 20 minutes and has consistently taken 6. After
    // enough evidence the estimate corrects itself, with nobody editing
    // anything.
    await db.exec(`ALTER TABLE public.orders DISABLE TRIGGER trg_enforce_order_limits`);
    for (let i = 0; i < 6; i += 1) {
      const order = await placeOrder([BURGER]);
      await db.query(
        `UPDATE public.order_items SET started_at = now() - interval '6 minutes', ready_at = now()
          WHERE order_id = $1`, [order]);
    }
    await db.exec(`ALTER TABLE public.orders ENABLE TRIGGER trg_enforce_order_limits`);

    await actAs(db, STAFF);
    await db.query(`SELECT public.refresh_prep_stats(30)`);
    const { rows } = await db.query<{ minutes: number; source: string }>(
      `SELECT minutes, source FROM public.item_prep_estimate($1)`, [BURGER]);
    await actAs(db, null);

    expect(rows[0].source).toBe('observed');
    expect(Number(rows[0].minutes)).toBeCloseTo(6, 0);
  });

  it('ignores a ticket that was left open across a shift', async () => {
    // A five-hour "prep time" is a forgotten ticket, not a slow dish, and one
    // of them would drag a mean permanently.
    await db.exec(`ALTER TABLE public.orders DISABLE TRIGGER trg_enforce_order_limits`);
    for (let i = 0; i < 5; i += 1) {
      const order = await placeOrder([SALAD]);
      await db.query(
        `UPDATE public.order_items SET started_at = now() - interval '4 minutes', ready_at = now()
          WHERE order_id = $1`, [order]);
    }
    const forgotten = await placeOrder([SALAD]);
    await db.query(
      `UPDATE public.order_items SET started_at = now() - interval '5 hours', ready_at = now()
        WHERE order_id = $1`, [forgotten]);
    await db.exec(`ALTER TABLE public.orders ENABLE TRIGGER trg_enforce_order_limits`);

    await actAs(db, STAFF);
    await db.query(`SELECT public.refresh_prep_stats(30)`);
    const { rows } = await db.query<{ samples: number; median_minutes: number }>(
      `SELECT samples, median_minutes FROM public.menu_item_prep_stats WHERE menu_item_id = $1`, [SALAD]);
    await actAs(db, null);

    expect(rows[0].samples).toBe(5);
    expect(Number(rows[0].median_minutes)).toBeCloseTo(4, 0);
  });

  it('sticks with the menu setting until there is enough evidence', async () => {
    const order = await placeOrder([BURGER]);
    await db.query(
      `UPDATE public.order_items SET started_at = now() - interval '2 minutes', ready_at = now()
        WHERE order_id = $1`, [order]);

    await actAs(db, STAFF);
    await db.query(`SELECT public.refresh_prep_stats(30)`);
    const { rows } = await db.query<{ minutes: number; source: string }>(
      `SELECT minutes, source FROM public.item_prep_estimate($1)`, [BURGER]);
    await actAs(db, null);

    // One sample is noise. Acting on it would make the estimate swing wildly.
    expect(rows[0].source).toBe('menu');
    expect(Number(rows[0].minutes)).toBe(20);
  });
});

describe('kitchen load', () => {
  it('counts outstanding work per station', async () => {
    await placeOrder([BURGER, COFFEE]);

    const { rows } = await db.query<{ station: string; backlog_minutes: number }>(
      `SELECT station, backlog_minutes FROM public.kitchen_load() ORDER BY station`);

    const bar = rows.find((r) => r.station === 'bar')!;
    const kitchen = rows.find((r) => r.station === 'kitchen')!;
    expect(Number(kitchen.backlog_minutes)).toBe(20);
    expect(Number(bar.backlog_minutes)).toBe(2);
  });

  it('drops work once it is up', async () => {
    const order = await placeOrder([BURGER]);
    await actAs(db, STAFF);
    const { rows: items } = await db.query<{ id: string }>(
      `SELECT id FROM public.order_items WHERE order_id = $1`, [order]);
    await db.query(`SELECT public.staff_bump_order_item($1, 'ready')`, [items[0].id]);
    await actAs(db, null);

    const { rows } = await db.query<{ backlog_minutes: number }>(
      `SELECT backlog_minutes FROM public.kitchen_load() WHERE station = 'kitchen'`);
    expect(Number(rows[0].backlog_minutes)).toBe(0);
  });
});

describe('suggestions read the cart', () => {
  it('never suggests meat into an all-vegan cart', async () => {
    // Not a poor suggestion — for a guest who has shown what they eat, it
    // reads as not being listened to.
    const results = await recommend([SALAD]);
    expect(results.map((r) => r.id)).not.toContain(BURGER);
  });

  it('still suggests something to a vegan cart', async () => {
    const results = await recommend([SALAD]);
    expect(results.length).toBeGreaterThan(0);
    expect(results.map((r) => r.id)).toContain(COFFEE);
  });

  it('reads a diet only when the whole cart agrees', async () => {
    // One salad next to a burger says nothing about the table; a cart that is
    // entirely vegan is a statement. An empty cart is not either.
    const { rows } = await db.query<{ vegan: string | null; mixed: string | null; empty: string | null }>(`
      SELECT public.cart_diet(ARRAY['${SALAD}', '${COFFEE}']::uuid[]) AS vegan,
             public.cart_diet(ARRAY['${SALAD}', '${BURGER}']::uuid[]) AS mixed,
             public.cart_diet('{}'::uuid[])                           AS empty
    `);
    expect(rows[0].vegan).toBe('vegan');
    expect(rows[0].mixed).toBeNull();
    expect(rows[0].empty).toBeNull();
  });

  it('never suggests around an allergen the guest filtered out', async () => {
    const results = await recommend([BURGER], ['nuts']);
    expect(results.map((r) => r.id)).not.toContain(NUTCAKE);
  });

  it('suggests a drink when the cart has none', async () => {
    // The affinity table can never notice something ABSENT — it only knows
    // which items appear together.
    const results = await recommend([BURGER]);
    const drink = results.find((r) => r.id === COFFEE);
    expect(drink).toBeTruthy();
  });

  it('stops pushing a drink once there is one', async () => {
    const results = await recommend([BURGER, COFFEE]);
    expect(results.find((r) => r.id === COFFEE && r.recommendation_type === 'add_on')).toBeFalsy();
  });

  it('never suggests something already in the cart', async () => {
    const results = await recommend([BURGER, COFFEE, SALAD]);
    for (const id of [BURGER, COFFEE, SALAD]) {
      expect(results.map((r) => r.id)).not.toContain(id);
    }
  });
});

describe('suggestions read the kitchen', () => {
  it('prefers the quick dish when the kitchen is drowning', async () => {
    // Exploration off, so the only things separating these two candidates are
    // the curated priority and the capacity penalty. The burger is curated
    // HIGHER, so if it still loses under load, the penalty is what moved it.
    await db.exec(`
      UPDATE public.restaurant_settings SET reco_exploration = 0 WHERE id = 1;
      INSERT INTO public.menu_item_recommendations(source_item_id, recommended_item_id, recommendation_type, priority)
      VALUES ('${COFFEE}', '${BURGER}',  'pair_with', 90),
             ('${COFFEE}', '${NUTCAKE}', 'pair_with', 80);
    `);

    const quiet = (await recommend([COFFEE])).map((r) => r.id);
    expect(quiet.indexOf(BURGER)).toBeLessThan(quiet.indexOf(NUTCAKE));

    /*
     * Pile on work from OTHER tables until the kitchen is past capacity.
     *
     * Deliberately not this session's own orders: the repeat rules would then
     * exclude the burger as something this table already ordered, which is
     * correct behaviour but a different effect from the one under test here.
     * A kitchen is busy because of the room, not because of one table.
     */
    await db.exec(`
      INSERT INTO public.table_sessions(id, table_id, token, is_active, last_heartbeat_at)
      SELECT gen_random_uuid(), 'dddddddd-0000-0000-0000-000000000001', 'busy-' || g, true, now()
        FROM generate_series(1, 8) g;

      INSERT INTO public.orders(table_session_id, total, status, payment_status, payment_method,
                                released_to_kitchen_at)
      SELECT s.id, 20, 'pending', 'unpaid', 'cash', now()
        FROM public.table_sessions s WHERE s.token LIKE 'busy-%';

      INSERT INTO public.order_items(order_id, menu_item_id, quantity, unit_price, status)
      SELECT o.id, '${BURGER}', 1, 20, 'pending'
        FROM public.orders o
        JOIN public.table_sessions s ON s.id = o.table_session_id
       WHERE s.token LIKE 'busy-%';
    `);

    const busy = (await recommend([COFFEE])).map((r) => r.id);

    // Suggesting a 20-minute dish while the pass is drowning makes the wait
    // worse for the whole room in order to add one item.
    expect(busy.indexOf(NUTCAKE)).toBeLessThan(busy.indexOf(BURGER));
  });

  it('never penalises a drink for kitchen load', async () => {
    await db.exec(`ALTER TABLE public.orders DISABLE TRIGGER trg_enforce_order_limits`);
    for (let i = 0; i < 6; i += 1) await placeOrder([BURGER]);
    await db.exec(`ALTER TABLE public.orders ENABLE TRIGGER trg_enforce_order_limits`);

    // Pouring a drink does not compete with the pass, and under load it is
    // exactly the right thing to offer.
    const results = await recommend([SALAD]);
    expect(results.map((r) => r.id)).toContain(COFFEE);
  });
});

describe('dayparts', () => {
  it('buckets the clock into parts of a service day', async () => {
    const { rows } = await db.query<{ morning: string; evening: string }>(`
      SELECT public.daypart_of(timestamptz '2026-08-02 09:00+02') AS morning,
             public.daypart_of(timestamptz '2026-08-02 21:00+02') AS evening
    `);
    expect(rows[0].morning).toBe('morning');
    expect(rows[0].evening).toBe('evening');
  });

  it('prefers the daypart it has evidence for', async () => {
    // Same pair, opposite behaviour at breakfast and at dinner. A single
    // all-day rate would average these into a number wrong at both ends.
    await db.exec(`
      INSERT INTO public.suggestion_stats(recommended_item_id, placement, source_item_id, daypart, shown, accepted)
      VALUES ('${COFFEE}', 'cart', NULL, NULL,      100, 20),
             ('${COFFEE}', 'cart', NULL, 'morning', 100, 90),
             ('${COFFEE}', 'cart', NULL, 'evening', 100,  2);
    `);

    const { rows } = await db.query<{ morning: number; evening: number; overall: number }>(`
      SELECT public.daypart_acceptance('${COFFEE}', 'cart', NULL, 'morning') AS morning,
             public.daypart_acceptance('${COFFEE}', 'cart', NULL, 'evening') AS evening,
             public.daypart_acceptance('${COFFEE}', 'cart', NULL, 'lunch')   AS overall
    `);

    expect(Number(rows[0].morning)).toBeGreaterThan(0.7);
    expect(Number(rows[0].evening)).toBeLessThan(0.1);
    // No lunch row, so it falls back to the all-day figure rather than the prior.
    expect(Number(rows[0].overall)).toBeGreaterThan(0.15);
    expect(Number(rows[0].overall)).toBeLessThan(0.25);
  });

  it('smooths a daypart that has barely been seen', async () => {
    await db.exec(`
      INSERT INTO public.suggestion_stats(recommended_item_id, placement, source_item_id, daypart, shown, accepted)
      VALUES ('${COFFEE}', 'cart', NULL, 'morning', 1, 1);
    `);
    const { rows } = await db.query<{ v: number }>(
      `SELECT public.daypart_acceptance('${COFFEE}', 'cart', NULL, 'morning') AS v`);

    // One click out of one impression is not a 100% acceptance rate.
    expect(Number(rows[0].v)).toBeLessThan(0.3);
  });
});

describe('substitutes', () => {
  it('offers a curated alternative first', async () => {
    await db.exec(`
      INSERT INTO public.menu_item_recommendations(source_item_id, recommended_item_id, recommendation_type, priority)
      VALUES ('${BURGER}', '${SOUP}', 'alternative', 90);
    `);
    const { rows } = await db.query<{ id: string; match_reason: string }>(
      `SELECT id, match_reason FROM public.guest_get_substitutes('${BURGER}')`);

    expect(rows[0].id).toBe(SOUP);
    expect(rows[0].match_reason).toBe('chosen by us');
  });

  it('falls back to a similar dish at a similar price', async () => {
    const { rows } = await db.query<{ id: string }>(
      `SELECT id FROM public.guest_get_substitutes('${SALAD}')`);

    // Soup (7.00) is within 40% of the salad (9.00). The 20 KM burger is not.
    expect(rows.map((r) => r.id)).toContain(SOUP);
    expect(rows.map((r) => r.id)).not.toContain(BURGER);
  });

  it('never offers something that is itself unavailable', async () => {
    await db.exec(`UPDATE public.menu_items SET is_available = false WHERE id = '${SOUP}'`);
    const { rows } = await db.query<{ id: string }>(
      `SELECT id FROM public.guest_get_substitutes('${SALAD}')`);
    expect(rows.map((r) => r.id)).not.toContain(SOUP);
  });

  it('offers nothing rather than something unrelated', async () => {
    // An unrelated dish offered as a substitute is worse than an honest
    // "sorry, that is off tonight".
    await db.exec(`
      UPDATE public.menu_items SET is_available = false
       WHERE id IN ('${SOUP}', '${NUTCAKE}', '${BURGER}');
    `);
    const { rows } = await db.query(`SELECT id FROM public.guest_get_substitutes('${SALAD}')`);
    expect(rows).toHaveLength(0);
  });
});
