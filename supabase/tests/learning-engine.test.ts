/**
 * @vitest-environment node
 *
 * The learning recommendation engine, against real PostgreSQL.
 *
 * Two classes of guarantee:
 *   - the MATHS is right (lift, Bayesian smoothing, attribution, holdout)
 *   - learning can reorder good suggestions but can NEVER introduce a bad one.
 *     Every guardrail is re-asserted here with the learning signals turned up,
 *     because a scoring change is exactly how a sold-out dish would sneak back.
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

const STAFF = '22222222-2222-2222-2222-222222222222';
const BURGER = 'cccccccc-0000-0000-0000-000000000001';
const FRIES = 'cccccccc-0000-0000-0000-000000000002';
const COLA = 'cccccccc-0000-0000-0000-000000000003';
const COFFEE = 'cccccccc-0000-0000-0000-000000000004';
const SOLD_OUT = 'cccccccc-0000-0000-0000-000000000005';
const SESSION = 'eeeeeeee-0000-0000-0000-000000000001';
const TOKEN = 'sess-token-7';

async function seed() {
  await db.exec(`
    TRUNCATE public.suggestion_conversions, public.suggestion_stats, public.menu_item_affinity,
             public.analytics_events, public.menu_item_recommendations, public.audit_log,
             public.payment_callback_events, public.payment_transactions,
             public.order_ticket_events, public.order_items, public.orders,
             public.table_sessions, public.tables,
             public.menu_items, public.subcategories, public.categories,
             public.order_code_counters
      RESTART IDENTITY CASCADE;
    DELETE FROM public.user_roles;
    DELETE FROM auth.users;

    UPDATE public.restaurant_settings
       SET ordering_enabled = true, online_card_enabled = false,
           recommendations_enabled = true, reco_holdout_pct = 0,
           reco_weight_curated = 40, reco_weight_observed = 25,
           reco_weight_learned = 25, reco_weight_margin = 10, reco_exploration = 0,
           reco_min_acceptance = 0.030, reco_retire_after_impressions = 60,
           session_idle_timeout_minutes = 180
     WHERE id = 1;

    INSERT INTO auth.users(id, email) VALUES ('${STAFF}', 'staff@lasoul.test');
    INSERT INTO public.user_roles(user_id, role) VALUES ('${STAFF}', 'admin'), ('${STAFF}', 'staff');

    INSERT INTO public.categories(id, name, sort_order) VALUES
      ('aaaaaaaa-0000-0000-0000-000000000001', 'Food', 1),
      ('aaaaaaaa-0000-0000-0000-000000000002', 'Drinks', 2);
    INSERT INTO public.subcategories(id, category_id, name, sort_order) VALUES
      ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Burgers', 1),
      ('bbbbbbbb-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'Sides', 2),
      ('bbbbbbbb-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000002', 'Soft Drinks', 3),
      ('bbbbbbbb-0000-0000-0000-000000000004', 'aaaaaaaa-0000-0000-0000-000000000002', 'Hot Drinks', 4);

    INSERT INTO public.menu_items(id, subcategory_id, name, price, is_available, margin_score) VALUES
      ('${BURGER}',   'bbbbbbbb-0000-0000-0000-000000000001', 'La Soul Burger', 18.00, true, 40),
      ('${FRIES}',    'bbbbbbbb-0000-0000-0000-000000000002', 'French Fries',    6.00, true, 80),
      ('${COLA}',     'bbbbbbbb-0000-0000-0000-000000000003', 'Coca-Cola',       4.00, true, 70),
      ('${COFFEE}',   'bbbbbbbb-0000-0000-0000-000000000004', 'Espresso',        3.00, true, 90),
      ('${SOLD_OUT}', 'bbbbbbbb-0000-0000-0000-000000000002', 'Truffle Fries',   9.00, false, 95);

    INSERT INTO public.tables(id, table_number) VALUES ('dddddddd-0000-0000-0000-000000000001', 7);
    INSERT INTO public.table_sessions(id, table_id, token, is_active, guest_name, last_heartbeat_at)
      VALUES ('${SESSION}', 'dddddddd-0000-0000-0000-000000000001', '${TOKEN}', true, 'Amina', now());
  `);
  await actAs(db, null);
}

/**
 * Write order history directly.
 *
 * The 5-orders-per-minute guard exists to stop a guest hammering checkout; it
 * would make it impossible to fixture ninety days of baskets, so it is lifted
 * for the insert and restored immediately.
 */
async function seedBaskets(baskets: string[][]) {
  await db.exec(`ALTER TABLE public.orders DISABLE TRIGGER trg_enforce_order_limits`);
  for (const items of baskets) {
    const { rows } = await db.query<{ id: string }>(`
      INSERT INTO public.orders(table_session_id, total, status, payment_method, payment_status,
                                released_to_kitchen_at, order_code)
      VALUES ($1, 0, 'served', 'cash', 'paid', now(), '001')
      RETURNING id
    `, [SESSION]);
    const orderId = rows[0].id;
    for (const item of items) {
      await db.query(
        `INSERT INTO public.order_items(order_id, menu_item_id, quantity, unit_price, status)
         SELECT $1, $2, 1, price, 'served' FROM public.menu_items WHERE id = $2`,
        [orderId, item],
      );
    }
  }
  await db.exec(`ALTER TABLE public.orders ENABLE TRIGGER trg_enforce_order_limits`);
}

async function recommend(cart: string[], placement = 'cart', sessionId: string | null = SESSION) {
  const { rows } = await db.query<{ id: string; recommendation_type: string; source_item_id: string | null }>(
    `SELECT * FROM public.guest_get_recommendations($1::uuid[], $2, 'en', 8, $3::uuid)`,
    [cart, placement, sessionId],
  );
  return rows;
}

beforeAll(async () => {
  db = (await createTestDatabase({ quiet: true })) as unknown as Db;
}, 120_000);
afterAll(async () => { await db?.close(); });
beforeEach(seed);

// ---------------------------------------------------------------------------

describe('observed pairings (market-basket lift)', () => {
  it('discovers a genuine pairing from real orders', async () => {
    // Burger+fries together 8 times; cola appears everywhere so it is popular
    // but NOT specifically paired with the burger.
    await seedBaskets([
      ...Array.from({ length: 8 }, () => [BURGER, FRIES, COLA]),
      ...Array.from({ length: 8 }, () => [COFFEE, COLA]),
    ]);

    await actAs(db, STAFF);
    const { rows } = await db.query<{ refresh_menu_affinity: number }>(
      `SELECT public.refresh_menu_affinity(90, 3) AS refresh_menu_affinity`);
    expect(rows[0].refresh_menu_affinity).toBeGreaterThan(0);

    const { rows: pair } = await db.query<{ lift: string; confidence: string }>(
      `SELECT lift, confidence FROM public.menu_item_affinity WHERE item_a = $1 AND item_b = $2`,
      [BURGER, FRIES]);
    await actAs(db, null);

    // Everyone who ordered a burger also ordered fries.
    expect(Number(pair[0].confidence)).toBe(1);
    // Fries appear in 8 of 16 orders, so P(fries) = 0.5 and lift = 1/0.5 = 2.
    expect(Number(pair[0].lift)).toBeCloseTo(2, 1);
  });

  it('does not treat a merely popular item as a pairing', async () => {
    await seedBaskets([
      ...Array.from({ length: 6 }, () => [BURGER, COLA]),
      ...Array.from({ length: 6 }, () => [COFFEE, COLA]),
      ...Array.from({ length: 6 }, () => [FRIES, COLA]),
    ]);

    await actAs(db, STAFF);
    await db.query(`SELECT public.refresh_menu_affinity(90, 3)`);
    const { rows } = await db.query<{ lift: string }>(
      `SELECT lift FROM public.menu_item_affinity WHERE item_a = $1 AND item_b = $2`, [BURGER, COLA]);
    await actAs(db, null);

    // Cola is in every order, so ordering a burger tells you nothing extra.
    expect(Number(rows[0].lift)).toBeCloseTo(1, 1);
  });

  it('refuses to guess from too little history', async () => {
    await seedBaskets([[BURGER, FRIES], [BURGER, FRIES]]);
    await actAs(db, STAFF);
    const { rows } = await db.query<{ refresh_menu_affinity: number }>(
      `SELECT public.refresh_menu_affinity(90, 3) AS refresh_menu_affinity`);
    await actAs(db, null);
    expect(rows[0].refresh_menu_affinity).toBe(0);
  });

  it('ignores cancelled and unpaid-card orders when learning', async () => {
    await seedBaskets(Array.from({ length: 8 }, () => [BURGER, FRIES]));
    // Ten more baskets that never became sales.
    await db.exec(`ALTER TABLE public.orders DISABLE TRIGGER trg_enforce_order_limits`);
    await db.query(`
      INSERT INTO public.orders(table_session_id, total, status, payment_method, payment_status, order_code)
      SELECT $1, 0, 'awaiting_payment', 'card_online', 'pending', '999' FROM generate_series(1, 10)
    `, [SESSION]);
    await db.exec(`ALTER TABLE public.orders ENABLE TRIGGER trg_enforce_order_limits`);

    await actAs(db, STAFF);
    await db.query(`SELECT public.refresh_menu_affinity(90, 3)`);
    const { rows } = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.menu_item_affinity`);
    await actAs(db, null);
    // Still only the burger/fries relationship, both directions.
    expect(Number(rows[0].n)).toBe(2);
  });

  it('surfaces discovered pairings to management, flagging what is not yet curated', async () => {
    // Mixed history: without other baskets, P(fries) = 1 and lift collapses to
    // exactly 1 — "everyone orders fries" is not a pairing, it is a default.
    await seedBaskets([
      ...Array.from({ length: 10 }, () => [BURGER, FRIES]),
      ...Array.from({ length: 10 }, () => [COFFEE, COLA]),
    ]);
    await actAs(db, STAFF);
    await db.query(`SELECT public.refresh_menu_affinity(90, 3)`);
    const { rows } = await db.query<{ name_a: string; name_b: string; already_curated: boolean }>(
      `SELECT * FROM public.menu_pairings(10)`);
    await actAs(db, null);

    // Two real pairings, each listed once — not four mirrored rows.
    expect(rows).toHaveLength(2);
    const keys = rows.map((r) => [r.name_a, r.name_b].sort().join('|'));
    expect(new Set(keys).size).toBe(2);
    expect(rows.every((r) => r.already_curated === false)).toBe(true);
  });
});

describe('Bayesian smoothing', () => {
  it('does not let a 1-of-1 fluke outrank a proven pair', async () => {
    const { rows } = await db.query<{ fluke: string; proven: string }>(
      `SELECT public.smoothed_acceptance(1, 1) AS fluke,
              public.smoothed_acceptance(60, 400) AS proven`);
    expect(Number(rows[0].fluke)).toBeLessThan(Number(rows[0].proven));
  });

  it('converges on the true rate as evidence accumulates', async () => {
    const { rows } = await db.query<{ small: string; large: string }>(
      `SELECT public.smoothed_acceptance(3, 10) AS small,
              public.smoothed_acceptance(300, 1000) AS large`);
    // Both are "30%", but only the large sample is believed.
    expect(Number(rows[0].small)).toBeLessThan(0.3);
    expect(Number(rows[0].large)).toBeGreaterThan(0.28);
  });

  it('treats an unseen pair as plausible rather than worthless', async () => {
    const { rows } = await db.query<{ unseen: string }>(
      `SELECT public.smoothed_acceptance(0, 0) AS unseen`);
    expect(Number(rows[0].unseen)).toBeGreaterThan(0);
    expect(Number(rows[0].unseen)).toBeLessThan(0.1);
  });
});

describe('learning changes the order of suggestions', () => {
  async function curate(source: string, target: string, priority: number) {
    await db.query(
      `INSERT INTO public.menu_item_recommendations(source_item_id, recommended_item_id, recommendation_type, priority)
       VALUES ($1, $2, 'pair_with', $3)`, [source, target, priority]);
  }

  it('promotes the pair guests actually accept', async () => {
    await curate(BURGER, COLA, 60);
    await curate(BURGER, COFFEE, 60);

    // Same curated priority. Both clear the retirement floor, so this is a
    // pure ranking test: cola is accepted 30% of the time, coffee 10%.
    await db.query(`
      INSERT INTO public.suggestion_stats(source_item_id, recommended_item_id, placement, shown, accepted)
      VALUES ($1, $2, 'cart', 200, 60), ($1, $3, 'cart', 200, 20)
    `, [BURGER, COLA, COFFEE]);

    const rows = await recommend([BURGER]);
    const ids = rows.map((r) => r.id);
    expect(ids.indexOf(COLA)).toBeLessThan(ids.indexOf(COFFEE));
  });

  it('retires a pair that has been shown fairly and refused', async () => {
    await curate(BURGER, COFFEE, 100); // highest possible curated priority
    await db.query(`
      INSERT INTO public.suggestion_stats(source_item_id, recommended_item_id, placement, shown, accepted)
      VALUES ($1, $2, 'cart', 500, 1)
    `, [BURGER, COFFEE]);

    const rows = await recommend([BURGER]);
    expect(rows.map((r) => r.id)).not.toContain(COFFEE);
  });

  it('keeps showing a new pair while it is still learning', async () => {
    await curate(BURGER, COFFEE, 80);
    await db.query(`
      INSERT INTO public.suggestion_stats(source_item_id, recommended_item_id, placement, shown, accepted)
      VALUES ($1, $2, 'cart', 5, 0)
    `, [BURGER, COFFEE]);

    const rows = await recommend([BURGER]);
    expect(rows.map((r) => r.id)).toContain(COFFEE);
  });

  it('gives a new item a chance when exploration is on', async () => {
    await db.query(`UPDATE public.restaurant_settings SET reco_exploration = 50 WHERE id = 1`);
    await curate(BURGER, COLA, 90);
    await db.query(`
      INSERT INTO public.suggestion_stats(source_item_id, recommended_item_id, placement, shown, accepted)
      VALUES ($1, $2, 'cart', 5000, 900)
    `, [BURGER, COLA]);
    await curate(BURGER, COFFEE, 10);

    // Across many different sessions the never-shown item must sometimes win.
    let coffeeFirst = 0;
    for (let i = 0; i < 40; i += 1) {
      const { rows } = await db.query<{ id: string }>(
        `SELECT id FROM public.guest_get_recommendations($1::uuid[], 'cart', 'en', 1, gen_random_uuid())`,
        [[BURGER]]);
      if (rows[0]?.id === COFFEE) coffeeFirst += 1;
    }
    expect(coffeeFirst).toBeGreaterThan(0);
  });

  it('is stable for one table within a visit', async () => {
    await curate(BURGER, COLA, 50);
    await curate(BURGER, COFFEE, 50);
    await db.query(`UPDATE public.restaurant_settings SET reco_exploration = 40 WHERE id = 1`);

    const first = await recommend([BURGER]);
    const second = await recommend([BURGER]);
    const third = await recommend([BURGER]);
    expect(second.map((r) => r.id)).toEqual(first.map((r) => r.id));
    expect(third.map((r) => r.id)).toEqual(first.map((r) => r.id));
  });
});

describe('learning can never break a guardrail', () => {
  it('will not resurrect a sold-out item however well it performs', async () => {
    await db.query(
      `INSERT INTO public.menu_item_recommendations(source_item_id, recommended_item_id, recommendation_type, priority)
       VALUES ($1, $2, 'pair_with', 100)`, [BURGER, SOLD_OUT]);
    await db.query(`
      INSERT INTO public.suggestion_stats(source_item_id, recommended_item_id, placement, shown, accepted, attributed_revenue)
      VALUES ($1, $2, 'cart', 1000, 900, 9000)
    `, [BURGER, SOLD_OUT]);

    const rows = await recommend([BURGER]);
    expect(rows.map((r) => r.id)).not.toContain(SOLD_OUT);
  });

  it('will not suggest the same shelf even with a strong observed pairing', async () => {
    await seedBaskets(Array.from({ length: 10 }, () => [FRIES, SOLD_OUT]));
    await db.query(`UPDATE public.menu_items SET is_available = true WHERE id = $1`, [SOLD_OUT]);
    await actAs(db, STAFF);
    await db.query(`SELECT public.refresh_menu_affinity(90, 3)`);
    await actAs(db, null);

    // Both live in "Sides"; an observed pairing must not override the rule.
    const rows = await recommend([FRIES]);
    expect(rows.map((r) => r.id)).not.toContain(SOLD_OUT);
  });

  it('never returns the internal margin score', async () => {
    await db.query(
      `INSERT INTO public.menu_item_recommendations(source_item_id, recommended_item_id, recommendation_type)
       VALUES ($1, $2, 'pair_with')`, [BURGER, COFFEE]);
    const { rows } = await db.query<Record<string, unknown>>(
      `SELECT * FROM public.guest_get_recommendations($1::uuid[], 'cart', 'en', 4, $2::uuid)`,
      [[BURGER], SESSION]);
    for (const row of rows) expect(Object.keys(row)).not.toContain('margin_score');
  });

  it('still respects the master off switch', async () => {
    await db.query(
      `INSERT INTO public.menu_item_recommendations(source_item_id, recommended_item_id, recommendation_type)
       VALUES ($1, $2, 'pair_with')`, [BURGER, COFFEE]);
    await db.query(`UPDATE public.restaurant_settings SET recommendations_enabled = false WHERE id = 1`);
    expect(await recommend([BURGER])).toHaveLength(0);
  });
});

describe('revenue attribution', () => {
  it('records what a suggestion actually earned, priced by the server', async () => {
    await db.query(
      `SELECT public.guest_place_order($1, $2, 'Amina', 'cash', $3::jsonb, 0)`,
      [SESSION, TOKEN, JSON.stringify([
        { menu_item_id: BURGER, quantity: 1 },
        {
          menu_item_id: FRIES,
          quantity: 2,
          // A client claiming a bogus price must not be believed.
          price: 999,
          from_suggestion: { source_item_id: BURGER, placement: 'cart' },
        },
      ])],
    );

    const { rows } = await db.query<{ line_total: string; quantity: number; placement: string }>(
      `SELECT line_total, quantity, placement FROM public.suggestion_conversions`);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].line_total)).toBe(12); // 2 x 6.00 from menu_items
    expect(rows[0].placement).toBe('cart');
  });

  it('does not attribute lines the guest chose themselves', async () => {
    await db.query(
      `SELECT public.guest_place_order($1, $2, 'Amina', 'cash', $3::jsonb, 0)`,
      [SESSION, TOKEN, JSON.stringify([{ menu_item_id: BURGER, quantity: 1 }])],
    );
    const { rows } = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.suggestion_conversions`);
    expect(Number(rows[0].n)).toBe(0);
  });

  it('earns nothing from an order that was cancelled', async () => {
    const { rows: placed } = await db.query<{ result: Record<string, unknown> }>(
      `SELECT public.guest_place_order($1, $2, 'Amina', 'cash', $3::jsonb, 0) AS result`,
      [SESSION, TOKEN, JSON.stringify([
        { menu_item_id: FRIES, quantity: 1, from_suggestion: { source_item_id: BURGER, placement: 'cart' } },
      ])],
    );

    await actAs(db, STAFF);
    await db.query(`SELECT public.cancel_order($1, 'guest changed their mind')`, [placed[0].result.order_id]);
    const { rows } = await db.query<{ result: Record<string, number> }>(
      `SELECT public.suggestion_impact(30) AS result`);
    await actAs(db, null);

    expect(Number(rows[0].result.attributed_revenue)).toBe(0);
  });

  it('reports uplift against total revenue with the right denominator', async () => {
    await db.query(
      `SELECT public.guest_place_order($1, $2, 'Amina', 'cash', $3::jsonb, 0)`,
      [SESSION, TOKEN, JSON.stringify([
        { menu_item_id: BURGER, quantity: 1 },
        { menu_item_id: FRIES, quantity: 1, from_suggestion: { source_item_id: BURGER, placement: 'cart' } },
      ])],
    );

    await actAs(db, STAFF);
    const { rows } = await db.query<{ result: Record<string, number> }>(
      `SELECT public.suggestion_impact(30) AS result`);
    await actAs(db, null);

    expect(Number(rows[0].result.total_revenue)).toBe(24);
    expect(Number(rows[0].result.attributed_revenue)).toBe(6);
    expect(Number(rows[0].result.uplift_pct)).toBe(25);
    expect(Number(rows[0].result.attach_rate_pct)).toBe(100);
  });

  it('rebuilds learned stats from events and completed orders', async () => {
    await db.query(`SELECT public.record_analytics_events('v1', $1::jsonb)`, [JSON.stringify([
      { event: 'suggestion_shown', props: { item_id: FRIES, source_item_id: BURGER, placement: 'cart' } },
      { event: 'suggestion_shown', props: { item_id: FRIES, source_item_id: BURGER, placement: 'cart' } },
      { event: 'suggestion_accepted', props: { item_id: FRIES, source_item_id: BURGER, placement: 'cart' } },
    ])]);
    await db.query(
      `SELECT public.guest_place_order($1, $2, 'Amina', 'cash', $3::jsonb, 0)`,
      [SESSION, TOKEN, JSON.stringify([
        { menu_item_id: FRIES, quantity: 1, from_suggestion: { source_item_id: BURGER, placement: 'cart' } },
      ])],
    );

    await actAs(db, STAFF);
    await db.query(`SELECT public.refresh_suggestion_stats(90)`);
    const { rows } = await db.query<{ shown: number; accepted: number; attributed_revenue: string }>(
      `SELECT shown, accepted, attributed_revenue FROM public.suggestion_stats
        WHERE recommended_item_id = $1 AND source_item_id = $2`, [FRIES, BURGER]);
    await actAs(db, null);

    expect(rows[0].shown).toBe(2);
    expect(rows[0].accepted).toBe(1);
    expect(Number(rows[0].attributed_revenue)).toBe(6);
  });
});

describe('holdout', () => {
  it('shows nothing to a held-out session, and everything to the rest', async () => {
    await db.query(
      `INSERT INTO public.menu_item_recommendations(source_item_id, recommended_item_id, recommendation_type)
       VALUES ($1, $2, 'pair_with')`, [BURGER, COFFEE]);
    // The setting is capped at 50% on purpose — holding out more than half the
    // room to measure a suggestion is not a trade any restaurant should make.
    await db.query(`UPDATE public.restaurant_settings SET reco_holdout_pct = 50 WHERE id = 1`);

    const { rows: split } = await db.query<{ id: string; held: boolean }>(`
      SELECT id::text AS id, public.guest_in_reco_holdout(id) AS held
        FROM (SELECT gen_random_uuid() AS id FROM generate_series(1, 200)) s
    `);
    const heldOut = split.find((r) => r.held)!.id;
    const shown = split.find((r) => !r.held)!.id;

    expect(await recommend([BURGER], 'cart', heldOut)).toHaveLength(0);
    expect((await recommend([BURGER], 'cart', shown)).length).toBeGreaterThan(0);
  });

  it('assigns a session to the same group every time', async () => {
    await db.query(`UPDATE public.restaurant_settings SET reco_holdout_pct = 50 WHERE id = 1`);
    const { rows } = await db.query<{ a: boolean; b: boolean }>(
      `SELECT public.guest_in_reco_holdout($1) AS a, public.guest_in_reco_holdout($1) AS b`, [SESSION]);
    expect(rows[0].a).toBe(rows[0].b);
  });

  it('splits sessions roughly in line with the configured percentage', async () => {
    await db.query(`UPDATE public.restaurant_settings SET reco_holdout_pct = 20 WHERE id = 1`);
    const { rows } = await db.query<{ held: string; total: string }>(`
      SELECT count(*) FILTER (WHERE public.guest_in_reco_holdout(id))::text AS held,
             count(*)::text AS total
        FROM (SELECT gen_random_uuid() AS id FROM generate_series(1, 2000)) s
    `);
    const share = (Number(rows[0].held) / Number(rows[0].total)) * 100;
    expect(share).toBeGreaterThan(14);
    expect(share).toBeLessThan(26);
  });

  it('says when the comparison is not yet reliable', async () => {
    await db.query(`UPDATE public.restaurant_settings SET reco_holdout_pct = 20 WHERE id = 1`);
    await actAs(db, STAFF);
    const { rows } = await db.query<{ result: Record<string, unknown> }>(
      `SELECT public.reco_holdout_comparison(30) AS result`);
    await actAs(db, null);
    expect(rows[0].result.reliable).toBe(false);
  });
});

describe('menu intelligence reporting', () => {
  it('builds the per-item funnel from views, adds and real sales', async () => {
    await db.query(`SELECT public.record_analytics_events('v1', $1::jsonb)`, [JSON.stringify([
      { event: 'item_viewed', props: { item_id: BURGER } },
      { event: 'item_viewed', props: { item_id: BURGER } },
      { event: 'item_viewed', props: { item_id: BURGER } },
      { event: 'item_viewed', props: { item_id: BURGER } },
      { event: 'item_added', props: { item_id: BURGER } },
      { event: 'cart_item_removed', props: { item_id: BURGER } },
    ])]);
    await seedBaskets([[BURGER]]);

    await actAs(db, STAFF);
    const { rows } = await db.query<Record<string, string>>(
      `SELECT * FROM public.menu_item_performance(30) WHERE item_id = $1`, [BURGER]);
    await actAs(db, null);

    expect(Number(rows[0].views)).toBe(4);
    expect(Number(rows[0].adds)).toBe(1);
    expect(Number(rows[0].add_rate)).toBe(25);   // 1 of 4 looks
    expect(Number(rows[0].abandon_rate)).toBe(100); // the one add was removed
  });

  it('requires staff to read any of it', async () => {
    await actAs(db, null);
    await expect(db.query(`SELECT public.suggestion_impact(30)`)).rejects.toThrow(/Only staff/i);
    await expect(db.query(`SELECT public.recommendation_engine_health()`)).rejects.toThrow(/Only staff/i);
    await expect(db.query(`SELECT public.refresh_menu_intelligence()`)).rejects.toThrow(/Only staff/i);
  });

  it('reports what the engine knows, so it can be inspected rather than trusted', async () => {
    await actAs(db, STAFF);
    const { rows } = await db.query<{ result: Record<string, unknown> }>(
      `SELECT public.recommendation_engine_health() AS result`);
    await actAs(db, null);

    const health = rows[0].result;
    expect(health.enabled).toBe(true);
    expect(health).toHaveProperty('weights');
    expect(health).toHaveProperty('pairs_retired');
    expect(health).toHaveProperty('orders_analysed');
  });

  it('lists what being sold out is costing', async () => {
    await db.query(`UPDATE public.menu_items SET is_available = true WHERE id = $1`, [SOLD_OUT]);
    await seedBaskets(Array.from({ length: 5 }, () => [SOLD_OUT]));
    await db.query(`UPDATE public.menu_items SET is_available = false WHERE id = $1`, [SOLD_OUT]);

    await actAs(db, STAFF);
    const { rows } = await db.query<{ item_id: string; estimated_lost_revenue: string }>(
      `SELECT * FROM public.sold_out_impact(30)`);
    await actAs(db, null);

    expect(rows.map((r) => r.item_id)).toContain(SOLD_OUT);
    expect(Number(rows[0].estimated_lost_revenue)).toBeGreaterThan(0);
  });
});
